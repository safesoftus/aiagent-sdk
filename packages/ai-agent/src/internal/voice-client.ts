// SmallWebRTC voice client for the widget — a trimmed, dependency-free
// adaptation of the dashboard's `frontend/src/lib/pipecat/client.ts`
// (same signaling handshake, Opus fmtp tuning, RTVI client-ready latch,
// and renegotiation handling), minus dashboard auth/tenant headers: the
// widget's signaling capability IS the unguessable `session_id` minted by
// the public session endpoint.

import type { VoiceSessionDescriptor } from "./widget-api";
import { MIC_CONSTRAINTS, platform } from "./platform";

export type VoiceState = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface RtviMessage {
  label?: string;
  type: string;
  data?: Record<string, unknown> & {
    text?: string;
    final?: boolean;
    spoken?: boolean;
    aggregated_by?: string;
  };
  message?: Record<string, unknown> & { type?: string };
  [key: string]: unknown;
}

/** Role derived from an RTVI message type; null for non-transcript frames. */
export function transcriptRole(msg: RtviMessage): "agent" | "user" | null {
  switch (msg.type) {
    case "bot-transcription":
    case "bot-llm-text":
    case "bot-tts-text":
    case "bot-output":
      return "agent";
    case "user-transcription":
      return "user";
    default:
      return null;
  }
}

/**
 * Whether a frame should append to the visible transcript. Mirrors the
 * dashboard's dedupe rule: the backend emits several overlapping agent
 * streams for one utterance; ONLY the spoken sentence-aggregated
 * `bot-output` fires exactly once per spoken sentence (greeting included).
 * User side: final transcriptions only.
 */
export function isRenderableTranscript(msg: RtviMessage): boolean {
  const role = transcriptRole(msg);
  if (!role) return false;
  if (role === "agent") {
    return (
      msg.type === "bot-output" &&
      msg.data?.spoken === true &&
      msg.data?.aggregated_by === "sentence"
    );
  }
  return msg.data?.final === true;
}

/** `data.type` of the worker's end-of-session announcement (VOSO-658). */
export const SESSION_ENDED_MESSAGE_TYPE = "session-ended";

/**
 * True when `msg` is the worker announcing that it ended the session on
 * purpose — the RTVI `server-message` it writes right before it closes the
 * peer on its graceful end path (End node, `end_call`, callee screen).
 * Mirrors `frontend/src/lib/pipecat/session-end.ts`.
 */
export function isSessionEndedMessage(msg: {
  label?: unknown;
  type?: unknown;
  data?: unknown;
  [key: string]: unknown;
}): boolean {
  // RTVI only: `voso-debug` envelopes share this data channel and must
  // never latch an end (that would hide a genuine transport failure).
  if (msg.label !== "rtvi-ai" || msg.type !== "server-message") return false;
  const data = msg.data;
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === SESSION_ENDED_MESSAGE_TYPE
  );
}

/** `data.type` of the RTVI `server-message` twin of the vendor's
 *  `queue_status` event (agent-integration E7 §4.3). */
export const QUEUE_STATUS_MESSAGE_TYPE = "queue_status";
/** `session-ended.reason` after a wait that timed out. */
export const QUEUE_TIMEOUT_REASON = "queue_timeout";

/**
 * The queue transition an RTVI envelope carries, if any: `"waiting"`,
 * `"admitted"` or `"timed_out"` from `server-message {type: "queue_status",
 * status}`; `"timed_out"` also from `session-ended {reason: "queue_timeout"}`.
 * Anything else (other envelopes, a foreign label) is `null`.
 */
export function queueTransition(msg: {
  label?: unknown;
  type?: unknown;
  data?: unknown;
}): "waiting" | "admitted" | "timed_out" | null {
  if (msg.label !== "rtvi-ai" || msg.type !== "server-message") return null;
  const data = msg.data;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.type === QUEUE_STATUS_MESSAGE_TYPE) {
    const status = record.status;
    if (status === "waiting" || status === "admitted" || status === "timed_out") return status;
    return null;
  }
  if (record.type === "session-ended" && record.reason === QUEUE_TIMEOUT_REASON) {
    return "timed_out";
  }
  return null;
}

/**
 * Terminal state for an RTCPeerConnection `failed`: after the worker's own
 * end announcement it is the DTLS close of a session that ended on purpose
 * (an ordinary "disconnected"); with no announcement it is a real error.
 */
export function peerFailureState(serverEnded: boolean): "disconnected" | "error" {
  return serverEnded ? "disconnected" : "error";
}

export interface VoiceClientOptions {
  onStateChange?: (state: VoiceState) => void;
  onRemoteAudio?: (stream: MediaStream) => void;
  onAppMessage?: (msg: RtviMessage) => void;
  onError?: (err: Error) => void;
}

export class VoiceClient {
  /** The worker announced it ended the session on purpose (see `isSessionEndedMessage`). */
  private serverEnded = false;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private pcId: string | null = null;
  private state: VoiceState = "idle";
  private disposed = false;
  private audioRendering = false;
  private clientReadySent = false;

  constructor(
    protected readonly session: VoiceSessionDescriptor,
    private readonly opts: VoiceClientOptions,
  ) {}

  /**
   * A client that redeems a conversation token (`GET
   * /v1/convai/conversation/token`, E2 D-4 / E4 Q6) instead of a minted
   * session: the first offer carries `conversation_token`, and the answer's
   * session descriptor (`session_id`, the disconnect proof, `conversation_id`)
   * is adopted before anything else uses it. Inside 15 minutes the same token
   * re-joins the same conversation (Q29).
   */
  static fromConversationToken<T extends VoiceClient>(
    this: new (session: VoiceSessionDescriptor, opts: VoiceClientOptions) => T,
    token: string,
    where: { signalingUrl: string; iceServers?: VoiceSessionDescriptor["ice_servers"] },
    opts: VoiceClientOptions,
  ): T {
    return new this(
      {
        session_id: "",
        conversation_id: "",
        signaling_url: where.signalingUrl,
        ice_servers: where.iceServers,
        conversation_token: token,
      },
      opts,
    );
  }

  // ── Protected extension points (E4 Q12) ───────────────────────────────
  // Every default reproduces the widget's behaviour byte-for-byte (the
  // golden audio-path test). Staff-only behaviour (dashboard auth headers,
  // receive-only listen-in, …) lives in a subclass OUTSIDE this package.

  /** Headers added to the offer POST after Content-Type, before the trace headers. */
  protected extraOfferHeaders(): Record<string, string> {
    return {};
  }

  /** Headers of the disconnect POST. */
  protected disconnectHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  /** Where the disconnect POST goes. */
  protected disconnectEndpoint(): string {
    return disconnectUrl(this.session.signaling_url);
  }

  /** Body of the disconnect POST — the ownership proof (VOSO-191). */
  protected disconnectBody(): { session_id: string; session_token?: string } {
    return { session_id: this.session.session_id, session_token: this.session.session_token };
  }

  /** Console text when the disconnect POST is skipped (no token) or rejected. */
  protected disconnectWarning(kind: "skipped" | "rejected", status?: number): string {
    return kind === "skipped"
      ? "Widget voice disconnect skipped: no session_token"
      : `Widget voice disconnect rejected: ${status}`;
  }

  /** The error a non-2xx signaling answer raises. */
  protected signalingFailure(status: number, statusText: string, body: unknown): Error {
    const detail =
      body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string"
        ? (body as { detail: string }).detail
        : statusText;
    return new Error(`Signaling failed (${status}): ${detail}`);
  }

  /** The local capture to publish; `null` publishes nothing. */
  protected async localMedia(): Promise<MediaStream | null> {
    return (platform().mediaDevices() as MediaDevices).getUserMedia(MIC_CONSTRAINTS);
  }

  /** Attach the local capture (or a receive path) to the peer before the offer. */
  protected configureTransceivers(pc: RTCPeerConnection, stream: MediaStream | null): void {
    if (!stream) return;
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
  }

  /** `data` of the RTVI `client-ready` frame (none by default — the widget's frame). */
  protected clientReadyData(): Record<string, unknown> | undefined {
    return undefined;
  }

  /** The worker's `session-ended` announcement arrived (`reason` when a string). */
  protected onSessionEndedFrame(_reason: string | null): void {}

  /** The peer closed after that announcement; the client has released it. */
  protected onAnnouncedEndClosed(): void {}

  /** The live peer connection (`null` when not connected). */
  protected peer(): RTCPeerConnection | null {
    return this.pc;
  }

  /** The published local capture (`null` when none). */
  protected mic(): MediaStream | null {
    return this.localStream;
  }

  /** Send one JSON frame on the data channel; `false` when it is not open. */
  protected sendFrame(frame: Record<string, unknown>): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(frame));
    return true;
  }

  getState(): VoiceState {
    return this.state;
  }

  private setState(next: VoiceState) {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
  }

  async connect(): Promise<void> {
    if (this.state !== "idle") throw new Error(`Cannot connect from "${this.state}"`);
    this.setState("connecting");
    try {
      const iceServers = (this.session.ice_servers ?? []).map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      }));
      const pc = new (platform().RTCPeerConnection)({
        iceServers:
          iceServers.length > 0
            ? iceServers
            : [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.pc = pc;

      pc.addEventListener("connectionstatechange", () => {
        if (this.disposed) return;
        const cs = pc.connectionState;
        if (cs === "connected") this.setState("connected");
        else if (cs === "failed") {
          // After the worker's `session-ended` announcement this is the
          // expected close of a finished call, not a failure (VOSO-658).
          const next = peerFailureState(this.serverEnded);
          this.setState(next);
          if (next === "error") this.opts.onError?.(new Error("WebRTC connection failed"));
          // Announced end: the session is over on both ends — release the
          // mic and the peer now (the widget's endCall runs local cleanup
          // too; both are idempotent).
          else {
            void this.cleanup();
            this.onAnnouncedEndClosed();
          }
        } else if (cs === "closed" || cs === "disconnected") {
          this.setState("disconnected");
        }
      });

      pc.addEventListener("track", (event) => {
        if (this.disposed) return;
        const [stream] = event.streams;
        if (stream) this.opts.onRemoteAudio?.(stream);
      });

      const dc = pc.createDataChannel("pipecat");
      this.dc = dc;
      dc.addEventListener("open", () => {
        if (!this.disposed) this.maybeSendClientReady();
      });
      dc.addEventListener("message", (event) => {
        if (this.disposed || typeof event.data !== "string") return;
        try {
          const parsed = JSON.parse(event.data) as RtviMessage;
          if (isSessionEndedMessage(parsed)) {
            this.serverEnded = true;
            const reason = (parsed.data as { reason?: unknown } | undefined)?.reason;
            this.onSessionEndedFrame(typeof reason === "string" ? reason : null);
          }
          if (parsed.type === "signalling" && parsed.message?.type === "renegotiate") {
            void this.renegotiate();
            return;
          }
          this.opts.onAppMessage?.(parsed);
        } catch {
          // raw keep-alives etc.
        }
      });

      // AEC on (stops agent TTS echoing into the mic); AGC + browser noise
      // suppression off — same capture profile as the dashboard preview (Q21).
      const stream = await this.localMedia();
      this.localStream = stream;
      this.configureTransceivers(pc, stream);

      await this.negotiate(false);
    } catch (err) {
      this.setState("error");
      await this.cleanup();
      const error = err instanceof Error ? err : new Error("WebRTC connection failed");
      this.opts.onError?.(error);
      throw error;
    }
  }

  private async negotiate(isRenegotiation: boolean): Promise<void> {
    const pc = this.pc;
    if (!pc) throw new Error("PeerConnection gone");
    const offer = await pc.createOffer({
      voiceActivityDetection: false,
    } as RTCOfferOptions);
    if (offer.sdp) offer.sdp = tuneOpusFmtp(offer.sdp);
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const local = pc.localDescription;
    if (!local) throw new Error("No local SDP");

    const token = !this.session.session_id && this.session.conversation_token;
    const body: Record<string, unknown> = token
      ? { conversation_token: token, sdp: local.sdp, type: local.type }
      : {
          sdp: local.sdp,
          type: local.type,
          session_id: this.session.session_id,
          request_data: { session_id: this.session.session_id },
        };
    if (this.pcId) body.pc_id = this.pcId;
    if (isRenegotiation) body.restart_pc = false;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraOfferHeaders(),
    };
    addTraceHeaders(headers, this.session.trace_context);
    const res = await platform().fetch(this.session.signaling_url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // keep statusText
      }
      throw this.signalingFailure(res.status, res.statusText, parsed);
    }
    const answer = (await res.json()) as {
      sdp: string;
      type: RTCSdpType;
      pc_id: string;
    } & Partial<VoiceSessionDescriptor>;
    this.pcId = answer.pc_id;
    // A token offer's answer names the session it redeemed into (E4 P1).
    if (token && answer.session_id) Object.assign(this.session, answerDescriptor(answer));
    await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
  }

  private async renegotiate(): Promise<void> {
    if (!this.pc || this.disposed) return;
    try {
      await this.negotiate(true);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error("Renegotiation failed"));
    }
  }

  /** Report that the remote <audio> is actually playing — releases the
   *  server-held greeting via the RTVI client-ready handshake. */
  notifyAudioRendering(): void {
    this.audioRendering = true;
    this.maybeSendClientReady();
  }

  /**
   * Send typed text as a REAL user turn on the live call (RTVI
   * `send-text` over the data channel — the server injects it into the
   * pipeline's LLM context and runs a completion, interrupting the bot
   * if it is mid-utterance). Returns `false` when the channel is not
   * open or the text is blank; the caller keeps the composer's text.
   */
  sendUserText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(buildSendTextEnvelope(trimmed)));
    return true;
  }

  /**
   * Answer a client tool call the agent made on this call (RTVI
   * `llm-function-call-result`; the vendor's `client_tool_result`). Late,
   * duplicate or unknown ids are ignored server-side. Returns `false` when
   * the channel is not open.
   */
  sendClientToolResult(toolCallId: string, result: string, isError = false): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(buildFunctionCallResultEnvelope(toolCallId, result, isError)));
    return true;
  }

  /**
   * Approve or deny an MCP tool call the agent is waiting on (RTVI
   * `mcp-tool-approval-result`; the vendor's `mcp_tool_approval_result`,
   * E3 §4.6). Late / unknown ids are ignored server-side. Returns `false`
   * when the channel is not open.
   */
  sendMcpToolApproval(toolCallId: string, isApproved: boolean): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(buildMcpToolApprovalEnvelope(toolCallId, isApproved)));
    return true;
  }

  /**
   * Push background context into the live conversation without a turn
   * (RTVI `append-to-context`; the vendor's `contextual_update`). The agent
   * does not speak; it reads the note on its next reply. A later update
   * with the same `contextId` replaces the earlier one. Returns `false`
   * when the channel is not open.
   */
  sendContextualUpdate(text: string, contextId?: string): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(buildAppendToContextEnvelope(text, contextId)));
    return true;
  }

  /**
   * Tell the agent the user is active without a turn (RTVI `user-activity`;
   * the vendor's `user_activity`, E2 D-9): resets the idle clock. Returns
   * `false` when the channel is not open.
   */
  sendUserActivity(): boolean {
    return this.sendFrame(buildUserActivityEnvelope());
  }

  /**
   * Per-response feedback (RTVI `feedback {score, event_id}`; the vendor's
   * `feedback`, E4 Q16): `like` / `dislike`, `null` clears it. Stored in the
   * ONE feedback store (E2 D-10). Returns `false` when the channel is not open.
   */
  sendFeedback(score: "like" | "dislike" | null, eventId: number): boolean {
    return this.sendFrame(buildFeedbackEnvelope(score, eventId));
  }

  private maybeSendClientReady(): void {
    if (this.clientReadySent || !this.audioRendering) return;
    if (!this.dc || this.dc.readyState !== "open") return;
    const data = this.clientReadyData();
    this.dc.send(
      JSON.stringify({
        label: "rtvi-ai",
        type: "client-ready",
        id: `client-ready-${Date.now().toString(36)}`,
        ...(data ? { data } : {}),
      }),
    );
    this.clientReadySent = true;
  }

  setMicrophoneEnabled(enabled: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) track.enabled = enabled;
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    // Ownership proof (VOSO-191): the worker rejects teardown without the
    // token minted alongside this session. A token-less descriptor (older
    // API during deploy skew) would be a guaranteed 401 — skip the request
    // and let the server side fall back to ICE-timeout teardown. After the
    // worker's own end announcement there is nothing left to tear down.
    const proof = this.disconnectBody();
    if (this.serverEnded) {
      // The worker announced the end and tore the session down itself:
      // nothing to request, nothing to warn about.
    } else if (!proof.session_token) {
      console.warn(this.disconnectWarning("skipped"));
    } else {
      try {
        const res = await platform().fetch(this.disconnectEndpoint(), {
          method: "POST",
          headers: this.disconnectHeaders(),
          body: JSON.stringify(proof),
          keepalive: true,
        });
        if (!res.ok) {
          // A rejected disconnect leaves the server session to ICE timeout.
          console.warn(this.disconnectWarning("rejected", res.status));
        }
      } catch {
        // best effort
      }
    }
    await this.cleanup();
    this.setState("disconnected");
  }

  private async cleanup(): Promise<void> {
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
  }
}

/** RTVI `send-text` envelope for one typed user turn. Exported for tests
 *  (and mirrored by the dashboard preview's composer — the two senders
 *  must emit the same wire shape the preview pipeline parses). */
export function buildSendTextEnvelope(content: string): Record<string, unknown> {
  return {
    label: "rtvi-ai",
    type: "send-text",
    id: `send-text-${Date.now().toString(36)}`,
    data: {
      content,
      options: { run_immediately: true, audio_response: true },
    },
  };
}

/** RTVI `llm-function-call-result` envelope — the app's answer to an
 *  `llm-function-call` (E3 §4.1.5). The vendor's three fields only; the
 *  server resolves the pending call by `tool_call_id`. Exported for tests. */
export function buildFunctionCallResultEnvelope(
  toolCallId: string,
  result: string,
  isError: boolean,
): Record<string, unknown> {
  return {
    label: "rtvi-ai",
    type: "llm-function-call-result",
    id: `tool-result-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, result, is_error: isError },
  };
}

/** RTVI `mcp-tool-approval-result` envelope (E3 §4.6). Exported for tests. */
export function buildMcpToolApprovalEnvelope(
  toolCallId: string,
  isApproved: boolean,
): Record<string, unknown> {
  return {
    label: "rtvi-ai",
    type: "mcp-tool-approval-result",
    id: `mcp-approval-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, is_approved: isApproved },
  };
}

/** The `data` of an RTVI `mcp-tool-call` message, or `null` for any other
 *  type (E3 §4.6). The caller parses it with `mcpToolCallFromRecord`. */
export function mcpToolCallDataFromRtvi(msg: RtviMessage): Record<string, unknown> | null {
  if (msg.type !== "mcp-tool-call") return null;
  const data = msg.data as Record<string, unknown> | undefined;
  return data ?? null;
}

/** RTVI `append-to-context` envelope (E3 §4.2). `context_id` only when
 *  given. Exported for tests. */
export function buildAppendToContextEnvelope(
  text: string,
  contextId?: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = { text };
  if (contextId !== undefined) data.context_id = contextId;
  return {
    label: "rtvi-ai",
    type: "append-to-context",
    id: `context-${Date.now().toString(36)}`,
    data,
  };
}

/** The agent's client tool call on the data channel (`llm-function-call`),
 *  decoded; `null` for every other message. */
export function clientToolCallFromRtvi(msg: RtviMessage): {
  toolName: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  expectsResponse: boolean;
  responseTimeoutSecs?: number;
} | null {
  if (msg.type !== "llm-function-call") return null;
  const data = msg.data as Record<string, unknown> | undefined;
  const toolName = data?.function_name;
  const toolCallId = data?.tool_call_id;
  if (typeof toolName !== "string" || typeof toolCallId !== "string") return null;
  const args = data?.args;
  const parameters =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const timeout = data?.response_timeout_secs;
  return {
    toolName,
    toolCallId,
    parameters,
    // Absent on a pre-E3 emitter: assume the agent waits (safe default —
    // an answer nobody waits for is dropped silently).
    expectsResponse: data?.expects_response !== false,
    ...(typeof timeout === "number" ? { responseTimeoutSecs: timeout } : {}),
  };
}

/** RTVI `user-activity` envelope (E2 D-9). Exported for tests. */
export function buildUserActivityEnvelope(): Record<string, unknown> {
  return {
    label: "rtvi-ai",
    type: "user-activity",
    id: `user-activity-${Date.now().toString(36)}`,
  };
}

/** RTVI `feedback` envelope (E4 Q16 → E2 D-10 store). Exported for tests. */
export function buildFeedbackEnvelope(
  score: "like" | "dislike" | null,
  eventId: number,
): Record<string, unknown> {
  return {
    label: "rtvi-ai",
    type: "feedback",
    id: `feedback-${Date.now().toString(36)}`,
    data: { score, event_id: eventId },
  };
}

/** The descriptor keys a token offer's answer carries. */
function answerDescriptor(answer: Partial<VoiceSessionDescriptor>): Partial<VoiceSessionDescriptor> {
  const { session_id, session_token, conversation_id } = answer;
  return { session_id, session_token, conversation_id: conversation_id ?? "" };
}

function addTraceHeaders(
  headers: Record<string, string>,
  context: Record<string, string> | undefined,
): void {
  for (const name of ["traceparent", "tracestate"] as const) {
    const value = context?.[name];
    if (value) headers[name] = value;
  }
}

function disconnectUrl(signalingUrl: string): string {
  const url = new URL(signalingUrl);
  url.pathname = url.pathname.replace(/\/api\/offer\/?$/, "/api/disconnect");
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Resolve once ICE gathering completes, or after a short cap. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = platform().setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 250);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Force `usedtx=0;useinbandfec=1` onto every Opus m-line (see the
 *  dashboard client for the full rationale: DTX clips quiet word onsets;
 *  FEC lets the browser reconstruct dropped packets). Exported for tests. */
export function tuneOpusFmtp(sdp: string): string {
  const opusPts = [...sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/\d+/gim)].map((m) => m[1]);
  if (opusPts.length === 0) return sdp;

  const haveFmtp = new Set<string>();
  const lines = sdp.split(/\r\n|\n/);
  const out = lines.map((line) => {
    const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
    if (!m || !opusPts.includes(m[1])) return line;
    haveFmtp.add(m[1]!);
    return `a=fmtp:${m[1]} ${withOpusDirectives(m[2] ?? "")}`;
  });

  const missing = opusPts.filter((pt) => pt !== undefined && !haveFmtp.has(pt));
  if (missing.length === 0) return out.join("\r\n");

  const withFmtp: string[] = [];
  for (const line of out) {
    withFmtp.push(line);
    const rm = line.match(/^a=rtpmap:(\d+)\s+opus\/\d+/i);
    if (rm && missing.includes(rm[1])) {
      withFmtp.push(`a=fmtp:${rm[1]} usedtx=0;useinbandfec=1`);
    }
  }
  return withFmtp.join("\r\n");
}

function withOpusDirectives(params: string): string {
  let next = /usedtx=/i.test(params)
    ? params.replace(/usedtx=\d+/i, "usedtx=0")
    : `${params};usedtx=0`;
  next = /useinbandfec=/i.test(next)
    ? next.replace(/useinbandfec=\d+/i, "useinbandfec=1")
    : `${next};useinbandfec=1`;
  return next;
}

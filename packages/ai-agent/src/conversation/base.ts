// The shared conversation state machine (E4 plan §1.1 semantics, §4.6 table):
// status / mode / canSendFeedback, RTVI → callbacks, client tools, MCP
// approvals, session end on every path (user, agent, fatal error, ICE loss).
import { SessionConnectionError } from "../errors";
import { AlignmentTracker } from "../internal/alignment";
import { platform } from "../internal/platform";
import { conversationWireId, resolveWebRtcTarget } from "../internal/session-resolver";
import { sourceInfo } from "../internal/source-info";
import { persistentUserId } from "../internal/user-id";
import {
  clientToolCallFromRtvi,
  isSessionEndedMessage,
  type RtviMessage,
  type VoiceState,
} from "../internal/voice-client";
import { PASSTHROUGH } from "../internal/rtvi-events";
import { LIBRARY_NAME, LIBRARY_VERSION } from "../version";
import type { DisconnectionDetails, McpToolCall, Mode, SessionConfig, Status } from "../types";
import { runClientTool } from "./client-tools";
import { SdkClient } from "./client";

/** Options this transport cannot forward yet (reported once through onDebug, never thrown). */
const UNFORWARDED = ["overrides", "dynamicVariables", "userId", "customLlmExtraBody", "toolMockConfig"] as const;

export abstract class BaseConversation {
  protected client: SdkClient | null = null;
  protected status: Status = "disconnected";
  private mode: Mode = "listening";
  private canSendFeedback = false;
  private conversationId = "";
  private eventId = 0;
  private lastAgentEventId = 0;
  private readonly alignment: AlignmentTracker;
  private readonly approvals = new Map<string, AbortController>();
  private ready: { resolve: () => void; reject: (err: Error) => void } | null = null;
  /** Q10: a random per-browser id (not forwarded on the WebRTC token path yet). */
  readonly userId: string;

  protected constructor(
    protected readonly config: SessionConfig,
    protected readonly textOnly: boolean,
  ) {
    this.userId = config.userId ?? persistentUserId();
    this.alignment = new AlignmentTracker((a) => config.onAudioAlignment?.(a));
  }

  // ── lifecycle ─────────────────────────────────────────────────────────

  /** @internal Connect; resolves once the agent is ready (`bot-ready`). Use `Conversation.startSession`. */
  async start(): Promise<void> {
    this.setStatus("connecting");
    // The vendor announces `false` on connecting even though it is the start value.
    this.config.onCanSendFeedbackChange?.({ canSendFeedback: false });
    // Text sessions announce the listening mode before connecting (the vendor's order).
    if (this.textOnly) this.config.onModeChange?.({ mode: "listening" });
    const ignored = UNFORWARDED.filter((key) => this.config[key] !== undefined);
    if (ignored.length > 0) this.config.onDebug?.({ type: "ignored_options", ignored });
    // React Native: speaker routing before connecting (no-op on the web).
    if (!this.textOnly) platform().audioSession?.start();
    try {
      const target = await resolveWebRtcTarget(this.config);
      // endSession() ran while the token request was in flight: stop here
      // instead of connecting a session the caller already ended.
      if (this.status !== "connecting") {
        throw new SessionConnectionError("The session was ended before it was ready", "ended_while_connecting");
      }
      if (target.conversationId) this.conversationId = target.conversationId;
      const client = SdkClient.fromConversationToken(
        target.token,
        { signalingUrl: target.signalingUrl, iceServers: target.iceServers },
        {
          onStateChange: (state) => this.onTransportState(state),
          onRemoteAudio: (stream) => this.onRemoteAudio(stream, () => client.notifyAudioRendering()),
          onAppMessage: (msg) => this.onRtvi(msg),
          onError: (err) => this.onTransportError(err),
        },
      );
      client.textOnly = this.textOnly;
      client.about = { library: LIBRARY_NAME, library_version: LIBRARY_VERSION, platform: platform().name ?? "web" };
      client.onMic = (stream) => this.onLocalAudio(stream);
      // Text: nothing to render — client-ready goes on data-channel open.
      if (this.textOnly) client.notifyAudioRendering();
      this.client = client;
      const ready = new Promise<void>((resolve, reject) => (this.ready = { resolve, reject }));
      await client.connect();
      if (!this.conversationId) this.conversationId = conversationWireId(client.conversationId());
      await ready;
    } catch (err) {
      this.ready = null;
      // A failed start leaves nothing live: peer, microphone, server session
      // and volume providers are released before the rethrow.
      // (A server-side end already did this in endFromServer.)
      const client = this.client;
      this.client = null;
      if (this.status === "connecting") {
        if (client) void client.disconnect().catch(() => undefined);
        this.teardownMedia();
      }
      // A failed connect releases the audio session too (the vendor leaks it, §11 T26).
      if (!this.textOnly) platform().audioSession?.stop();
      this.setStatus("disconnected");
      throw err instanceof Error ? err : new SessionConnectionError(String(err), "connect_failed");
    }
  }

  /** End the session (no-op unless connecting / connected). */
  async endSession(): Promise<void> {
    if (this.status !== "connected" && this.status !== "connecting") return;
    // Ended while still connecting (from onConversationCreated, or before the
    // token request built the client): the pending start rejects instead of
    // waiting forever, and start() stops at its next step.
    const pending = this.ready;
    this.ready = null;
    this.setStatus("disconnecting");
    this.setCanSendFeedback(false);
    try {
      await this.client?.disconnect();
    } finally {
      this.finish({ reason: "user" });
      pending?.reject(new SessionConnectionError("The session was ended before it was ready", "ended_while_connecting"));
    }
  }

  private finish(details: DisconnectionDetails): void {
    this.alignment.end();
    for (const controller of this.approvals.values()) controller.abort();
    this.approvals.clear();
    this.teardownMedia();
    if (!this.textOnly) platform().audioSession?.stop();
    this.setStatus("disconnected");
    this.config.onDisconnect?.(details);
  }

  /** The server ended the session (announcement) or a fatal error: end locally, no disconnect POST after an announcement. */
  private endFromServer(details: DisconnectionDetails): void {
    if (this.status === "disconnected" || this.status === "disconnecting") return;
    // Ended while still connecting (e.g. a queued session ended before
    // bot-ready): startSession must reject, never wait forever.
    const pending = this.ready;
    this.ready = null;
    this.setStatus("disconnecting");
    this.setCanSendFeedback(false);
    void this.client?.disconnect();
    this.finish(details);
    pending?.reject(
      new SessionConnectionError(
        details.reason === "error" ? details.message : "The session ended before it was ready",
        "session_ended",
      ),
    );
  }

  // ── public API shared by voice and text ───────────────────────────────

  getId(): string {
    return this.conversationId;
  }

  isOpen(): boolean {
    return this.status === "connected";
  }

  sendUserMessage(text: string): void {
    this.outgoing({ type: "user_message", text });
    this.client?.sendUserText(text);
  }

  sendContextualUpdate(text: string, options?: { contextId?: string }): void {
    this.outgoing({ type: "contextual_update", text, context_id: options?.contextId });
    this.client?.sendContextualUpdate(text, options?.contextId);
  }

  sendUserActivity(): void {
    this.outgoing({ type: "user_activity" });
    this.client?.sendUserActivity();
  }

  sendMCPToolApprovalResult(toolCallId: string, isApproved: boolean): void {
    this.outgoing({ type: "mcp_tool_approval_result", tool_call_id: toolCallId, is_approved: isApproved });
    this.approvals.get(toolCallId)?.abort();
    this.approvals.delete(toolCallId);
    this.client?.sendMcpToolApproval(toolCallId, isApproved);
  }

  /**
   * Per-response feedback (Q16): `feedback {score, event_id}` over the data
   * channel into the ONE feedback store (E2 D-10, `widget_feedback` per-response
   * rows); `null` clears the thumb. `eventId` defaults to the last agent
   * message's `event_id` (`onMessage`). Not connected → a console warning (the
   * vendor's behaviour), nothing sent.
   */
  sendFeedback(like: boolean | null, eventId?: number): void {
    if (this.status !== "connected") {
      console.warn("Cannot send feedback: the conversation is not connected");
      return;
    }
    const score = like === null ? null : like ? "like" : "dislike";
    const event_id = eventId ?? this.lastAgentEventId;
    this.outgoing({ type: "feedback", score, event_id });
    this.client?.sendFeedback(score, event_id);
  }

  // ── platform hooks (voice / text) ─────────────────────────────────────

  protected onRemoteAudio(_stream: MediaStream, rendered: () => void): void {
    rendered();
  }

  protected onLocalAudio(_stream: MediaStream | null): void {}

  protected teardownMedia(): void {}

  // ── transport → callbacks ─────────────────────────────────────────────

  private onTransportState(state: VoiceState): void {
    if (state !== "error") return;
    if (this.status === "connecting" && this.ready) {
      this.ready.reject(new SessionConnectionError("WebRTC connection failed", "connection_failed"));
      this.ready = null;
      return;
    }
    // Q24: no ICE restart — a lost transport ends the session honestly.
    this.endFromServer({
      reason: "error",
      message: "WebRTC connection failed",
      context: { type: "connection_state_changed", reason: "failed" },
    });
  }

  private onTransportError(err: Error): void {
    // The peer failure is reported through the state above; a failed start
    // rejects startSession (the client never calls onError for it).
    if (this.status !== "connected" || err.message === "WebRTC connection failed") return;
    this.config.onError?.(err.message);
  }

  private onRtvi(msg: RtviMessage): void {
    this.config.onIncomingEvent?.(msg);
    if (msg.label !== "rtvi-ai") {
      this.config.onDebug?.(msg);
      return;
    }
    const data = (msg.data ?? {}) as Record<string, unknown>;
    switch (msg.type) {
      case "bot-ready":
        return this.onBotReady();
      case "bot-started-speaking":
        return this.setMode("speaking");
      case "bot-stopped-speaking":
        this.alignment.end();
        return this.setMode("listening");
      case "bot-output":
        return this.onBotOutput(data);
      case "bot-output-correction":
        this.config.onAgentResponseCorrection?.({
          original_agent_response: String(data.original ?? ""),
          corrected_agent_response: String(data.corrected ?? ""),
          event_id: this.lastAgentEventId,
        });
        return;
      case "user-transcription":
        if (data.final === true) {
          this.config.onMessage?.({ message: String(data.text ?? ""), role: "user", source: "user", event_id: ++this.eventId });
        } else {
          this.config.onDebug?.(msg);
        }
        return;
      case "bot-llm-started":
        return this.config.onAgentChatResponsePart?.({ text: "", type: "start", event_id: this.eventId + 1 });
      case "bot-llm-text":
        return this.config.onAgentChatResponsePart?.({ text: String(data.text ?? ""), type: "delta", event_id: this.eventId + 1 });
      case "bot-llm-stopped":
        return this.config.onAgentChatResponsePart?.({ text: "", type: "stop", event_id: this.eventId + 1 });
      case "llm-function-call":
        void this.onClientToolCall(msg);
        return;
      case "mcp-tool-call":
        return this.onMcpToolCall(data as unknown as McpToolCall);
      case "mcp-connection-status":
        this.config.onMCPConnectionStatus?.(data as never);
        return;
      case "server-message":
        if (isSessionEndedMessage(msg)) {
          const reason = typeof data.reason === "string" ? data.reason : undefined;
          return this.endFromServer({
            reason: "agent",
            context: { type: "end_call", reason: reason ?? "Agent ended the call" },
          });
        }
        this.config.onDebug?.(msg);
        return;
      case "error": {
        const message = String(data.error ?? "unknown error");
        this.config.onError?.(`Server error: ${message}`, { fatal: data.fatal === true });
        if (data.fatal === true) this.endFromServer({ reason: "error", message, context: { type: "error" } });
        return;
      }
      case "error-response":
        this.config.onError?.(`Server error: ${String(data.error ?? "unknown error")}`);
        return;
      default:
        if (!PASSTHROUGH.has(msg.type)) this.config.onDebug?.(msg);
    }
  }

  private onBotReady(): void {
    if (this.status !== "connecting") return;
    this.config.onConversationCreated?.(this);
    // The callback may have ended the session (endSession while connecting):
    // then no connected status, no onConnect, no resolve.
    if (this.status !== "connecting") return;
    this.setStatus("connected");
    this.setCanSendFeedback(true);
    this.config.onConnect?.({ conversationId: this.conversationId });
    this.ready?.resolve();
    this.ready = null;
    // The vendor's WebRTC order: metadata AFTER startSession resolves.
    setTimeout(() => {
      this.config.onConversationMetadata?.({
        conversation_id: this.conversationId,
        agent_output_audio_format: "pcm_48000",
        user_input_audio_format: "pcm_48000",
      });
    }, 0);
  }

  private onBotOutput(data: Record<string, unknown>): void {
    const text = String(data.text ?? "");
    if (data.aggregated_by === "interrupted") {
      this.alignment.end();
      this.config.onInterruption?.({ event_id: this.lastAgentEventId });
      this.setMode("listening");
      return;
    }
    if (data.spoken !== true) return;
    if (data.aggregated_by === "word" && typeof data.tts_offset_ms === "number") {
      this.alignment.word(text, data.tts_offset_ms);
      return;
    }
    if (data.aggregated_by === "sentence") {
      this.lastAgentEventId = ++this.eventId;
      this.config.onMessage?.({ message: text, role: "agent", source: "ai", event_id: this.lastAgentEventId });
    }
  }

  private async onClientToolCall(msg: RtviMessage): Promise<void> {
    const call = clientToolCallFromRtvi(msg);
    if (!call) return;
    try {
      const outcome = await runClientTool(this.config.clientTools, call.toolName, call.parameters);
      if (!outcome) {
        if (this.config.onUnhandledClientToolCall) {
          this.config.onUnhandledClientToolCall({
            tool_name: call.toolName,
            tool_call_id: call.toolCallId,
            parameters: call.parameters,
            event_id: this.eventId,
          });
          return;
        }
        const message = `Client tool with name ${call.toolName} is not defined on client`;
        this.config.onError?.(message, { clientToolName: call.toolName });
        if (call.expectsResponse) this.client?.sendClientToolResult(call.toolCallId, message, true);
        return;
      }
      if (outcome.error) this.config.onError?.(outcome.error.message, outcome.error.context);
      if (call.expectsResponse) this.client?.sendClientToolResult(call.toolCallId, outcome.result, outcome.isError);
    } catch (err) {
      this.config.onError?.(`Unexpected error in client tool call handling: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private onMcpToolCall(call: McpToolCall): void {
    this.config.onMCPToolCall?.(call);
    if (call.state !== "awaiting_approval") {
      this.approvals.get(call.tool_call_id)?.abort();
      this.approvals.delete(call.tool_call_id);
      return;
    }
    const handler = this.config.onMCPToolApprovalRequest;
    if (!handler) return;
    if (this.approvals.has(call.tool_call_id)) {
      this.config.onError?.(`Duplicate MCP approval request for ${call.tool_call_id}`);
      return;
    }
    const controller = new AbortController();
    this.approvals.set(call.tool_call_id, controller);
    void (async () => {
      let approved = false;
      try {
        const answer = await handler(call, { signal: controller.signal });
        if (typeof answer === "boolean") approved = answer;
        else this.config.onError?.("onMCPToolApprovalRequest must return a boolean; denied");
      } catch (err) {
        this.config.onError?.(`onMCPToolApprovalRequest failed; denied: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (controller.signal.aborted || !this.approvals.has(call.tool_call_id)) return;
      this.approvals.delete(call.tool_call_id);
      this.client?.sendMcpToolApproval(call.tool_call_id, approved);
    })();
  }

  // ── state ─────────────────────────────────────────────────────────────

  private setStatus(status: Status): void {
    if (this.status === status) return;
    this.status = status;
    this.config.onStatusChange?.({ status });
  }

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.config.onModeChange?.({ mode });
  }

  /** `canSendFeedback` follows `status === "connected"` only (§10 M1). */
  private setCanSendFeedback(value: boolean): void {
    if (this.canSendFeedback === value) return;
    this.canSendFeedback = value;
    this.config.onCanSendFeedbackChange?.({ canSendFeedback: value });
  }

  private outgoing(event: Record<string, unknown>): void {
    this.config.onOutgoingEvent?.({ ...event, source: sourceInfo().source });
  }
}

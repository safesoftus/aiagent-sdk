// test/golden.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

// ../ai-agent/src/internal/platform.ts
var browserDefaults = () => ({
  RTCPeerConnection: globalThis.RTCPeerConnection,
  RTCSessionDescription: globalThis.RTCSessionDescription,
  mediaDevices: () => globalThis.navigator?.mediaDevices,
  fetch: (...args) => globalThis.fetch(...args),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms)
});
var overrides = {};
function platform() {
  return { ...browserDefaults(), ...overrides };
}
var MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  video: false
};

// ../ai-agent/src/internal/voice-client.ts
var SESSION_ENDED_MESSAGE_TYPE = "session-ended";
function isSessionEndedMessage(msg) {
  if (msg.label !== "rtvi-ai" || msg.type !== "server-message") return false;
  const data = msg.data;
  return typeof data === "object" && data !== null && data.type === SESSION_ENDED_MESSAGE_TYPE;
}
function peerFailureState(serverEnded) {
  return serverEnded ? "disconnected" : "error";
}
var VoiceClient = class {
  constructor(session, opts) {
    this.session = session;
    this.opts = opts;
    /** The worker announced it ended the session on purpose (see `isSessionEndedMessage`). */
    this.serverEnded = false;
    this.pc = null;
    this.dc = null;
    this.localStream = null;
    this.pcId = null;
    this.state = "idle";
    this.disposed = false;
    this.audioRendering = false;
    this.clientReadySent = false;
  }
  /**
   * A client that redeems a conversation token (`GET
   * /v1/convai/conversation/token`, E2 D-4 / E4 Q6) instead of a minted
   * session: the first offer carries `conversation_token`, and the answer's
   * session descriptor (`session_id`, the disconnect proof, `conversation_id`)
   * is adopted before anything else uses it. Inside 15 minutes the same token
   * re-joins the same conversation (Q29).
   */
  static fromConversationToken(token, where, opts) {
    return new this(
      {
        session_id: "",
        conversation_id: "",
        signaling_url: where.signalingUrl,
        ice_servers: where.iceServers,
        conversation_token: token
      },
      opts
    );
  }
  // ── Protected extension points (E4 Q12) ───────────────────────────────
  // Every default reproduces the widget's behaviour byte-for-byte (the
  // golden audio-path test). Staff-only behaviour (dashboard auth headers,
  // receive-only listen-in, …) lives in a subclass OUTSIDE this package.
  /** Headers added to the offer POST after Content-Type, before the trace headers. */
  extraOfferHeaders() {
    return {};
  }
  /** Headers of the disconnect POST. */
  disconnectHeaders() {
    return { "Content-Type": "application/json" };
  }
  /** Where the disconnect POST goes. */
  disconnectEndpoint() {
    return disconnectUrl(this.session.signaling_url);
  }
  /** Body of the disconnect POST — the ownership proof (VOSO-191). */
  disconnectBody() {
    return { session_id: this.session.session_id, session_token: this.session.session_token };
  }
  /** Console text when the disconnect POST is skipped (no token) or rejected. */
  disconnectWarning(kind, status) {
    return kind === "skipped" ? "Widget voice disconnect skipped: no session_token" : `Widget voice disconnect rejected: ${status}`;
  }
  /** The error a non-2xx signaling answer raises. */
  signalingFailure(status, statusText, body) {
    const detail = body && typeof body === "object" && typeof body.detail === "string" ? body.detail : statusText;
    return new Error(`Signaling failed (${status}): ${detail}`);
  }
  /** The local capture to publish; `null` publishes nothing. */
  async localMedia() {
    return platform().mediaDevices().getUserMedia(MIC_CONSTRAINTS);
  }
  /** Attach the local capture (or a receive path) to the peer before the offer. */
  configureTransceivers(pc, stream) {
    if (!stream) return;
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
  }
  /** `data` of the RTVI `client-ready` frame (none by default — the widget's frame). */
  clientReadyData() {
    return void 0;
  }
  /** The worker's `session-ended` announcement arrived (`reason` when a string). */
  onSessionEndedFrame(_reason) {
  }
  /** The peer closed after that announcement; the client has released it. */
  onAnnouncedEndClosed() {
  }
  /** The live peer connection (`null` when not connected). */
  peer() {
    return this.pc;
  }
  /** The published local capture (`null` when none). */
  mic() {
    return this.localStream;
  }
  /** Send one JSON frame on the data channel; `false` when it is not open. */
  sendFrame(frame) {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(frame));
    return true;
  }
  getState() {
    return this.state;
  }
  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
  }
  async connect() {
    if (this.state !== "idle") throw new Error(`Cannot connect from "${this.state}"`);
    this.setState("connecting");
    try {
      const iceServers = (this.session.ice_servers ?? []).map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential
      }));
      const pc = new (platform()).RTCPeerConnection({
        iceServers: iceServers.length > 0 ? iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
      });
      this.pc = pc;
      pc.addEventListener("connectionstatechange", () => {
        if (this.disposed) return;
        const cs = pc.connectionState;
        if (cs === "connected") this.setState("connected");
        else if (cs === "failed") {
          const next = peerFailureState(this.serverEnded);
          this.setState(next);
          if (next === "error") this.opts.onError?.(new Error("WebRTC connection failed"));
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
        const [stream2] = event.streams;
        if (stream2) this.opts.onRemoteAudio?.(stream2);
      });
      const dc = pc.createDataChannel("pipecat");
      this.dc = dc;
      dc.addEventListener("open", () => {
        if (!this.disposed) this.maybeSendClientReady();
      });
      dc.addEventListener("message", (event) => {
        if (this.disposed || typeof event.data !== "string") return;
        try {
          const parsed = JSON.parse(event.data);
          if (isSessionEndedMessage(parsed)) {
            this.serverEnded = true;
            const reason = parsed.data?.reason;
            this.onSessionEndedFrame(typeof reason === "string" ? reason : null);
          }
          if (parsed.type === "signalling" && parsed.message?.type === "renegotiate") {
            void this.renegotiate();
            return;
          }
          this.opts.onAppMessage?.(parsed);
        } catch {
        }
      });
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
  async negotiate(isRenegotiation) {
    const pc = this.pc;
    if (!pc) throw new Error("PeerConnection gone");
    const offer = await pc.createOffer({
      voiceActivityDetection: false
    });
    if (offer.sdp) offer.sdp = tuneOpusFmtp(offer.sdp);
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);
    const local = pc.localDescription;
    if (!local) throw new Error("No local SDP");
    const token = !this.session.session_id && this.session.conversation_token;
    const body = token ? { conversation_token: token, sdp: local.sdp, type: local.type } : {
      sdp: local.sdp,
      type: local.type,
      session_id: this.session.session_id,
      request_data: { session_id: this.session.session_id }
    };
    if (this.pcId) body.pc_id = this.pcId;
    if (isRenegotiation) body.restart_pc = false;
    const headers = {
      "Content-Type": "application/json",
      ...this.extraOfferHeaders()
    };
    addTraceHeaders(headers, this.session.trace_context);
    const res = await platform().fetch(this.session.signaling_url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let parsed = null;
      try {
        parsed = await res.json();
      } catch {
      }
      throw this.signalingFailure(res.status, res.statusText, parsed);
    }
    const answer = await res.json();
    this.pcId = answer.pc_id;
    if (token && answer.session_id) Object.assign(this.session, answerDescriptor(answer));
    await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
  }
  async renegotiate() {
    if (!this.pc || this.disposed) return;
    try {
      await this.negotiate(true);
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error("Renegotiation failed"));
    }
  }
  /** Report that the remote <audio> is actually playing — releases the
   *  server-held greeting via the RTVI client-ready handshake. */
  notifyAudioRendering() {
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
  sendUserText(text) {
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
  sendClientToolResult(toolCallId, result, isError = false) {
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
  sendMcpToolApproval(toolCallId, isApproved) {
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
  sendContextualUpdate(text, contextId) {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(buildAppendToContextEnvelope(text, contextId)));
    return true;
  }
  /**
   * Tell the agent the user is active without a turn (RTVI `user-activity`;
   * the vendor's `user_activity`, E2 D-9): resets the idle clock. Returns
   * `false` when the channel is not open.
   */
  sendUserActivity() {
    return this.sendFrame(buildUserActivityEnvelope());
  }
  /**
   * Per-response feedback (RTVI `feedback {score, event_id}`; the vendor's
   * `feedback`, E4 Q16): `like` / `dislike`, `null` clears it. Stored in the
   * ONE feedback store (E2 D-10). Returns `false` when the channel is not open.
   */
  sendFeedback(score, eventId) {
    return this.sendFrame(buildFeedbackEnvelope(score, eventId));
  }
  maybeSendClientReady() {
    if (this.clientReadySent || !this.audioRendering) return;
    if (!this.dc || this.dc.readyState !== "open") return;
    const data = this.clientReadyData();
    this.dc.send(
      JSON.stringify({
        label: "rtvi-ai",
        type: "client-ready",
        id: `client-ready-${Date.now().toString(36)}`,
        ...data ? { data } : {}
      })
    );
    this.clientReadySent = true;
  }
  setMicrophoneEnabled(enabled) {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) track.enabled = enabled;
  }
  async disconnect() {
    this.disposed = true;
    const proof = this.disconnectBody();
    if (this.serverEnded) {
    } else if (!proof.session_token) {
      console.warn(this.disconnectWarning("skipped"));
    } else {
      try {
        const res = await platform().fetch(this.disconnectEndpoint(), {
          method: "POST",
          headers: this.disconnectHeaders(),
          body: JSON.stringify(proof),
          keepalive: true
        });
        if (!res.ok) {
          console.warn(this.disconnectWarning("rejected", res.status));
        }
      } catch {
      }
    }
    await this.cleanup();
    this.setState("disconnected");
  }
  async cleanup() {
    try {
      this.dc?.close();
    } catch {
    }
    this.dc = null;
    try {
      this.pc?.close();
    } catch {
    }
    this.pc = null;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
  }
};
function buildSendTextEnvelope(content) {
  return {
    label: "rtvi-ai",
    type: "send-text",
    id: `send-text-${Date.now().toString(36)}`,
    data: {
      content,
      options: { run_immediately: true, audio_response: true }
    }
  };
}
function buildFunctionCallResultEnvelope(toolCallId, result, isError) {
  return {
    label: "rtvi-ai",
    type: "llm-function-call-result",
    id: `tool-result-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, result, is_error: isError }
  };
}
function buildMcpToolApprovalEnvelope(toolCallId, isApproved) {
  return {
    label: "rtvi-ai",
    type: "mcp-tool-approval-result",
    id: `mcp-approval-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, is_approved: isApproved }
  };
}
function buildAppendToContextEnvelope(text, contextId) {
  const data = { text };
  if (contextId !== void 0) data.context_id = contextId;
  return {
    label: "rtvi-ai",
    type: "append-to-context",
    id: `context-${Date.now().toString(36)}`,
    data
  };
}
function buildUserActivityEnvelope() {
  return {
    label: "rtvi-ai",
    type: "user-activity",
    id: `user-activity-${Date.now().toString(36)}`
  };
}
function buildFeedbackEnvelope(score, eventId) {
  return {
    label: "rtvi-ai",
    type: "feedback",
    id: `feedback-${Date.now().toString(36)}`,
    data: { score, event_id: eventId }
  };
}
function answerDescriptor(answer) {
  const { session_id, session_token, conversation_id } = answer;
  return { session_id, session_token, conversation_id: conversation_id ?? "" };
}
function addTraceHeaders(headers, context) {
  for (const name of ["traceparent", "tracestate"]) {
    const value = context?.[name];
    if (value) headers[name] = value;
  }
}
function disconnectUrl(signalingUrl) {
  const url = new URL(signalingUrl);
  url.pathname = url.pathname.replace(/\/api\/offer\/?$/, "/api/disconnect");
  url.search = "";
  url.hash = "";
  return url.toString();
}
function waitForIceGathering(pc) {
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
function tuneOpusFmtp(sdp) {
  const opusPts = [...sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/\d+/gim)].map((m) => m[1]);
  if (opusPts.length === 0) return sdp;
  const haveFmtp = /* @__PURE__ */ new Set();
  const lines = sdp.split(/\r\n|\n/);
  const out = lines.map((line) => {
    const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
    if (!m || !opusPts.includes(m[1])) return line;
    haveFmtp.add(m[1]);
    return `a=fmtp:${m[1]} ${withOpusDirectives(m[2] ?? "")}`;
  });
  const missing = opusPts.filter((pt) => pt !== void 0 && !haveFmtp.has(pt));
  if (missing.length === 0) return out.join("\r\n");
  const withFmtp = [];
  for (const line of out) {
    withFmtp.push(line);
    const rm = line.match(/^a=rtpmap:(\d+)\s+opus\/\d+/i);
    if (rm && missing.includes(rm[1])) {
      withFmtp.push(`a=fmtp:${rm[1]} usedtx=0;useinbandfec=1`);
    }
  }
  return withFmtp.join("\r\n");
}
function withOpusDirectives(params) {
  let next = /usedtx=/i.test(params) ? params.replace(/usedtx=\d+/i, "usedtx=0") : `${params};usedtx=0`;
  next = /useinbandfec=/i.test(next) ? next.replace(/useinbandfec=\d+/i, "useinbandfec=1") : `${next};useinbandfec=1`;
  return next;
}

// test/golden.test.ts
var events = [];
var record = (event) => events.push(event);
function normalizeIds(value) {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (typeof value !== "object" || value === null) return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = key === "id" && typeof inner === "string" ? inner.replace(/^(.*)-[0-9a-z]+$/, "$1-ID") : normalizeIds(inner);
  }
  return out;
}
var FakeTarget = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Map();
  }
  addEventListener(type, fn) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  emit(type, event = {}) {
    for (const fn of [...this.listeners.get(type) ?? []]) fn(event);
  }
};
var FakeDataChannel = class extends FakeTarget {
  constructor() {
    super(...arguments);
    this.readyState = "open";
  }
  send(payload) {
    record({ kind: "send", frame: normalizeIds(JSON.parse(payload)) });
  }
  close() {
    this.readyState = "closed";
  }
};
var OFFER_SDP = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=sendrecv",
  ""
].join("\r\n");
var FakePeerConnection = class _FakePeerConnection extends FakeTarget {
  constructor(config) {
    super();
    this.connectionState = "new";
    // Never "complete": the ICE-gather cap's timer is what ends the wait.
    this.iceGatheringState = "gathering";
    this.localDescription = null;
    this.dc = new FakeDataChannel();
    _FakePeerConnection.last = this;
    record({ kind: "pc", config });
  }
  static {
    this.last = null;
  }
  createDataChannel(label) {
    record({ kind: "dc", label });
    return this.dc;
  }
  addTrack() {
  }
  getSenders() {
    return [];
  }
  async createOffer(options) {
    record({ kind: "sdp", op: "createOffer", options });
    return { sdp: OFFER_SDP, type: "offer" };
  }
  async setLocalDescription(d) {
    record({ kind: "sdp", op: "setLocalDescription", type: d.type, sdp: d.sdp });
    this.localDescription = d;
  }
  async setRemoteDescription(d) {
    record({ kind: "sdp", op: "setRemoteDescription", type: d.type, sdp: d.sdp });
  }
  close() {
    this.connectionState = "closed";
  }
};
var realSetTimeout = globalThis.setTimeout;
var pause = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));
Reflect.set(globalThis, "RTCPeerConnection", FakePeerConnection);
Reflect.set(globalThis, "setTimeout", ((fn, delay, ...rest) => {
  if (typeof delay === "number" && delay <= 1e3) record({ kind: "timer", delay });
  return realSetTimeout(fn, delay, ...rest);
}));
var fetches = 0;
Reflect.set(globalThis, "fetch", async (url, init) => {
  fetches += 1;
  record({
    kind: "fetch",
    url: String(url),
    method: init?.method ?? "GET",
    headers: init?.headers ?? {},
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    ...init?.keepalive !== void 0 ? { keepalive: init.keepalive } : {}
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({ sdp: "v=0\r\na=answer\r\n", type: "answer", pc_id: `pc-${fetches}` })
  };
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async (constraints) => {
        record({ kind: "gum", constraints });
        const track = { enabled: true, stop() {
        } };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      }
    }
  }
});
function newClient() {
  return new VoiceClient(
    {
      session_id: "sess_golden",
      session_token: "st_golden",
      conversation_id: "conv-golden",
      signaling_url: "https://preview.test/api/offer",
      trace_context: { traceparent: "00-aaaa-bbbb-01", tracestate: "voso=1" }
    },
    { onStateChange: (state) => record({ kind: "state", state }) }
  );
}
async function waitForFetches(n) {
  for (let i = 0; i < 200 && fetches < n; i += 1) await pause(5);
  assert.ok(fetches >= n, `expected ${n} fetches, saw ${fetches}`);
}
test("golden: the widget voice client's audio path is byte-identical", async () => {
  record({ kind: "scenario", name: "agent-ended" });
  const client = newClient();
  await client.connect();
  const pc = FakePeerConnection.last ?? assert.fail("connect() built a peer connection");
  pc.connectionState = "connected";
  pc.emit("connectionstatechange");
  pc.dc.emit("open");
  client.notifyAudioRendering();
  client.sendUserText("hi");
  client.sendClientToolResult("t1", "ok", false);
  client.sendMcpToolApproval("m1", true);
  client.sendContextualUpdate("ctx", "c1");
  pc.dc.emit("message", {
    data: JSON.stringify({ label: "rtvi-ai", type: "signalling", message: { type: "renegotiate" } })
  });
  await waitForFetches(2);
  await pause(5);
  pc.dc.emit("message", {
    data: JSON.stringify({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: "session-ended", reason: "end_call" }
    })
  });
  await client.disconnect();
  record({ kind: "scenario", name: "user-ended" });
  const second = newClient();
  await second.connect();
  await second.disconnect();
  const actual = `${JSON.stringify(events, null, 2)}
`;
  const file = new URL("../test/golden/voice-client.json", import.meta.url);
  if (process.env.GOLDEN_RECORD === "1") writeFileSync(file, actual);
  assert.equal(actual, readFileSync(file, "utf8"));
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vdGVzdC9nb2xkZW4udGVzdC50cyIsICIuLi8uLi9haS1hZ2VudC9zcmMvaW50ZXJuYWwvcGxhdGZvcm0udHMiLCAiLi4vLi4vYWktYWdlbnQvc3JjL2ludGVybmFsL3ZvaWNlLWNsaWVudC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHRlc3QgZnJvbSBcIm5vZGU6dGVzdFwiO1xuaW1wb3J0IGFzc2VydCBmcm9tIFwibm9kZTphc3NlcnQvc3RyaWN0XCI7XG5pbXBvcnQgeyByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tIFwibm9kZTpmc1wiO1xuaW1wb3J0IHsgVm9pY2VDbGllbnQgfSBmcm9tIFwiLi4vc3JjL3ZvaWNlXCI7XG5cbi8vIEdvbGRlbiBhdWRpby1wYXRoIGVudmVsb3BlIChFNCBwbGFuIFx1MDBBNzUsIEExIFx1MjAxNCBWT1NPLTc1NykuIFJlY29yZHMgdGhlIEZVTExcbi8vIG9yZGVyZWQgc2VxdWVuY2UgdGhlIHdpZGdldCdzIFZvaWNlQ2xpZW50IHByb2R1Y2VzIGFnYWluc3QgYSBmYWtlIHBlZXIgXHUyMDE0XG4vLyBwZWVyIGNvbmZpZyAoZmFsbGJhY2sgU1RVTiksIGRhdGEtY2hhbm5lbCBsYWJlbCwgbWljIGNvbnN0cmFpbnRzIChRMjE6IE5TXG4vLyBhbmQgQUdDIG9mZiksIGNyZWF0ZU9mZmVyIG9wdGlvbnMsIHRoZSBPcHVzIGZtdHAgdGhlIG9mZmVyIGlzIHR1bmVkIHRvLFxuLy8gdGhlIElDRS1nYXRoZXIgY2FwLCBldmVyeSBmZXRjaCAoVVJMLCBtZXRob2QsIGhlYWRlcnMsIGJvZHkpLCBldmVyeVxuLy8gZGF0YS1jaGFubmVsIGZyYW1lIGFuZCBldmVyeSBzdGF0ZSBcdTIwMTQgYW5kIGNvbXBhcmVzIGl0IGJ5dGUtZm9yLWJ5dGUgd2l0aFxuLy8gdGVzdC9nb2xkZW4vdm9pY2UtY2xpZW50Lmpzb24sIHJlY29yZGVkIGZyb20gdGhlIHdpZGdldCdzIHZvaWNlLnRzIEJFRk9SRVxuLy8gaXQgbW92ZWQgaW50byBAY29udm9zby9haS1hZ2VudC4gYEdPTERFTl9SRUNPUkQ9MSBucG0gdGVzdGAgcmV3cml0ZXMgdGhlXG4vLyBmaWxlOyBuZXZlciByZS1yZWNvcmQgdG8gbWFrZSBhIGNoYW5nZSBwYXNzLlxuXG50eXBlIExpc3RlbmVyID0gKGV2ZW50OiB1bmtub3duKSA9PiB2b2lkO1xudHlwZSBFdmVudCA9IFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBraW5kOiBzdHJpbmcgfTtcblxuY29uc3QgZXZlbnRzOiBFdmVudFtdID0gW107XG5jb25zdCByZWNvcmQgPSAoZXZlbnQ6IEV2ZW50KSA9PiBldmVudHMucHVzaChldmVudCk7XG5cbi8qKiBgXCI8cHJlZml4Pi08YmFzZTM2IGNsb2NrPlwiYCBpZHMgXHUyMTkyIGBcIjxwcmVmaXg+LUlEXCJgICh0aGUgY2xvY2sgaXMgbm90IHRoZSBjb250cmFjdCkuICovXG5mdW5jdGlvbiBub3JtYWxpemVJZHModmFsdWU6IHVua25vd24pOiB1bmtub3duIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKG5vcm1hbGl6ZUlkcyk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiB2YWx1ZTtcbiAgY29uc3Qgb3V0OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIGlubmVyXSBvZiBPYmplY3QuZW50cmllcyh2YWx1ZSkpIHtcbiAgICBvdXRba2V5XSA9XG4gICAgICBrZXkgPT09IFwiaWRcIiAmJiB0eXBlb2YgaW5uZXIgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBpbm5lci5yZXBsYWNlKC9eKC4qKS1bMC05YS16XSskLywgXCIkMS1JRFwiKVxuICAgICAgICA6IG5vcm1hbGl6ZUlkcyhpbm5lcik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuY2xhc3MgRmFrZVRhcmdldCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgbGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIExpc3RlbmVyW10+KCk7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogc3RyaW5nLCBmbjogTGlzdGVuZXIpOiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5zZXQodHlwZSwgWy4uLih0aGlzLmxpc3RlbmVycy5nZXQodHlwZSkgPz8gW10pLCBmbl0pO1xuICB9XG4gIHJlbW92ZUV2ZW50TGlzdGVuZXIodHlwZTogc3RyaW5nLCBmbjogTGlzdGVuZXIpOiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5zZXQodHlwZSwgKHRoaXMubGlzdGVuZXJzLmdldCh0eXBlKSA/PyBbXSkuZmlsdGVyKChmKSA9PiBmICE9PSBmbikpO1xuICB9XG4gIGVtaXQodHlwZTogc3RyaW5nLCBldmVudDogdW5rbm93biA9IHt9KTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBmbiBvZiBbLi4uKHRoaXMubGlzdGVuZXJzLmdldCh0eXBlKSA/PyBbXSldKSBmbihldmVudCk7XG4gIH1cbn1cblxuY2xhc3MgRmFrZURhdGFDaGFubmVsIGV4dGVuZHMgRmFrZVRhcmdldCB7XG4gIHJlYWR5U3RhdGUgPSBcIm9wZW5cIjtcbiAgc2VuZChwYXlsb2FkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICByZWNvcmQoeyBraW5kOiBcInNlbmRcIiwgZnJhbWU6IG5vcm1hbGl6ZUlkcyhKU09OLnBhcnNlKHBheWxvYWQpKSB9KTtcbiAgfVxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnJlYWR5U3RhdGUgPSBcImNsb3NlZFwiO1xuICB9XG59XG5cbi8qKiBBbiBvZmZlciB3aXRoIG9uZSBPcHVzIHBheWxvYWQgdHlwZSBhbmQgTk8gZm10cCBsaW5lLCBzbyB0aGUgdHVuZXInc1xuICogIGluc2VydGlvbiBpcyB3aGF0IHRoZSBnb2xkZW4gY2FwdHVyZXMuICovXG5jb25zdCBPRkZFUl9TRFAgPSBbXG4gIFwidj0wXCIsXG4gIFwibz0tIDEgMiBJTiBJUDQgMTI3LjAuMC4xXCIsXG4gIFwicz0tXCIsXG4gIFwidD0wIDBcIixcbiAgXCJtPWF1ZGlvIDkgVURQL1RMUy9SVFAvU0FWUEYgMTExXCIsXG4gIFwiYz1JTiBJUDQgMC4wLjAuMFwiLFxuICBcImE9cnRwbWFwOjExMSBvcHVzLzQ4MDAwLzJcIixcbiAgXCJhPXNlbmRyZWN2XCIsXG4gIFwiXCIsXG5dLmpvaW4oXCJcXHJcXG5cIik7XG5cbmNsYXNzIEZha2VQZWVyQ29ubmVjdGlvbiBleHRlbmRzIEZha2VUYXJnZXQge1xuICBzdGF0aWMgbGFzdDogRmFrZVBlZXJDb25uZWN0aW9uIHwgbnVsbCA9IG51bGw7XG4gIGNvbm5lY3Rpb25TdGF0ZSA9IFwibmV3XCI7XG4gIC8vIE5ldmVyIFwiY29tcGxldGVcIjogdGhlIElDRS1nYXRoZXIgY2FwJ3MgdGltZXIgaXMgd2hhdCBlbmRzIHRoZSB3YWl0LlxuICBpY2VHYXRoZXJpbmdTdGF0ZSA9IFwiZ2F0aGVyaW5nXCI7XG4gIGxvY2FsRGVzY3JpcHRpb246IHsgc2RwOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9IHwgbnVsbCA9IG51bGw7XG4gIHJlYWRvbmx5IGRjID0gbmV3IEZha2VEYXRhQ2hhbm5lbCgpO1xuICBjb25zdHJ1Y3Rvcihjb25maWc6IHVua25vd24pIHtcbiAgICBzdXBlcigpO1xuICAgIEZha2VQZWVyQ29ubmVjdGlvbi5sYXN0ID0gdGhpcztcbiAgICByZWNvcmQoeyBraW5kOiBcInBjXCIsIGNvbmZpZyB9KTtcbiAgfVxuICBjcmVhdGVEYXRhQ2hhbm5lbChsYWJlbDogc3RyaW5nKTogRmFrZURhdGFDaGFubmVsIHtcbiAgICByZWNvcmQoeyBraW5kOiBcImRjXCIsIGxhYmVsIH0pO1xuICAgIHJldHVybiB0aGlzLmRjO1xuICB9XG4gIGFkZFRyYWNrKCk6IHZvaWQge31cbiAgZ2V0U2VuZGVycygpOiB1bmtub3duW10ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBhc3luYyBjcmVhdGVPZmZlcihvcHRpb25zOiB1bmtub3duKTogUHJvbWlzZTx7IHNkcDogc3RyaW5nOyB0eXBlOiBzdHJpbmcgfT4ge1xuICAgIHJlY29yZCh7IGtpbmQ6IFwic2RwXCIsIG9wOiBcImNyZWF0ZU9mZmVyXCIsIG9wdGlvbnMgfSk7XG4gICAgcmV0dXJuIHsgc2RwOiBPRkZFUl9TRFAsIHR5cGU6IFwib2ZmZXJcIiB9O1xuICB9XG4gIGFzeW5jIHNldExvY2FsRGVzY3JpcHRpb24oZDogeyBzZHA6IHN0cmluZzsgdHlwZTogc3RyaW5nIH0pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZWNvcmQoeyBraW5kOiBcInNkcFwiLCBvcDogXCJzZXRMb2NhbERlc2NyaXB0aW9uXCIsIHR5cGU6IGQudHlwZSwgc2RwOiBkLnNkcCB9KTtcbiAgICB0aGlzLmxvY2FsRGVzY3JpcHRpb24gPSBkO1xuICB9XG4gIGFzeW5jIHNldFJlbW90ZURlc2NyaXB0aW9uKGQ6IHsgc2RwOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVjb3JkKHsga2luZDogXCJzZHBcIiwgb3A6IFwic2V0UmVtb3RlRGVzY3JpcHRpb25cIiwgdHlwZTogZC50eXBlLCBzZHA6IGQuc2RwIH0pO1xuICB9XG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIHRoaXMuY29ubmVjdGlvblN0YXRlID0gXCJjbG9zZWRcIjtcbiAgfVxufVxuXG5jb25zdCByZWFsU2V0VGltZW91dCA9IGdsb2JhbFRoaXMuc2V0VGltZW91dDtcbmNvbnN0IHBhdXNlID0gKG1zOiBudW1iZXIpID0+IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiByZWFsU2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xuXG5SZWZsZWN0LnNldChnbG9iYWxUaGlzLCBcIlJUQ1BlZXJDb25uZWN0aW9uXCIsIEZha2VQZWVyQ29ubmVjdGlvbik7XG5SZWZsZWN0LnNldChnbG9iYWxUaGlzLCBcInNldFRpbWVvdXRcIiwgKChmbjogKCkgPT4gdm9pZCwgZGVsYXk/OiBudW1iZXIsIC4uLnJlc3Q6IHVua25vd25bXSkgPT4ge1xuICBpZiAodHlwZW9mIGRlbGF5ID09PSBcIm51bWJlclwiICYmIGRlbGF5IDw9IDEwMDApIHJlY29yZCh7IGtpbmQ6IFwidGltZXJcIiwgZGVsYXkgfSk7XG4gIHJldHVybiByZWFsU2V0VGltZW91dChmbiwgZGVsYXksIC4uLnJlc3QpO1xufSkgYXMgdHlwZW9mIHNldFRpbWVvdXQpO1xubGV0IGZldGNoZXMgPSAwO1xuUmVmbGVjdC5zZXQoZ2xvYmFsVGhpcywgXCJmZXRjaFwiLCBhc3luYyAodXJsOiB1bmtub3duLCBpbml0PzogUmVxdWVzdEluaXQpID0+IHtcbiAgZmV0Y2hlcyArPSAxO1xuICByZWNvcmQoe1xuICAgIGtpbmQ6IFwiZmV0Y2hcIixcbiAgICB1cmw6IFN0cmluZyh1cmwpLFxuICAgIG1ldGhvZDogaW5pdD8ubWV0aG9kID8/IFwiR0VUXCIsXG4gICAgaGVhZGVyczogaW5pdD8uaGVhZGVycyA/PyB7fSxcbiAgICBib2R5OiB0eXBlb2YgaW5pdD8uYm9keSA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoaW5pdC5ib2R5KSA6IG51bGwsXG4gICAgLi4uKGluaXQ/LmtlZXBhbGl2ZSAhPT0gdW5kZWZpbmVkID8geyBrZWVwYWxpdmU6IGluaXQua2VlcGFsaXZlIH0gOiB7fSksXG4gIH0pO1xuICByZXR1cm4ge1xuICAgIG9rOiB0cnVlLFxuICAgIHN0YXR1czogMjAwLFxuICAgIGpzb246IGFzeW5jICgpID0+ICh7IHNkcDogXCJ2PTBcXHJcXG5hPWFuc3dlclxcclxcblwiLCB0eXBlOiBcImFuc3dlclwiLCBwY19pZDogYHBjLSR7ZmV0Y2hlc31gIH0pLFxuICB9O1xufSk7XG5PYmplY3QuZGVmaW5lUHJvcGVydHkoZ2xvYmFsVGhpcywgXCJuYXZpZ2F0b3JcIiwge1xuICBjb25maWd1cmFibGU6IHRydWUsXG4gIHZhbHVlOiB7XG4gICAgbWVkaWFEZXZpY2VzOiB7XG4gICAgICBnZXRVc2VyTWVkaWE6IGFzeW5jIChjb25zdHJhaW50czogdW5rbm93bikgPT4ge1xuICAgICAgICByZWNvcmQoeyBraW5kOiBcImd1bVwiLCBjb25zdHJhaW50cyB9KTtcbiAgICAgICAgY29uc3QgdHJhY2sgPSB7IGVuYWJsZWQ6IHRydWUsIHN0b3AoKSB7fSB9O1xuICAgICAgICByZXR1cm4geyBnZXRBdWRpb1RyYWNrczogKCkgPT4gW3RyYWNrXSwgZ2V0VHJhY2tzOiAoKSA9PiBbdHJhY2tdIH07XG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG59KTtcblxuZnVuY3Rpb24gbmV3Q2xpZW50KCk6IFZvaWNlQ2xpZW50IHtcbiAgcmV0dXJuIG5ldyBWb2ljZUNsaWVudChcbiAgICB7XG4gICAgICBzZXNzaW9uX2lkOiBcInNlc3NfZ29sZGVuXCIsXG4gICAgICBzZXNzaW9uX3Rva2VuOiBcInN0X2dvbGRlblwiLFxuICAgICAgY29udmVyc2F0aW9uX2lkOiBcImNvbnYtZ29sZGVuXCIsXG4gICAgICBzaWduYWxpbmdfdXJsOiBcImh0dHBzOi8vcHJldmlldy50ZXN0L2FwaS9vZmZlclwiLFxuICAgICAgdHJhY2VfY29udGV4dDogeyB0cmFjZXBhcmVudDogXCIwMC1hYWFhLWJiYmItMDFcIiwgdHJhY2VzdGF0ZTogXCJ2b3NvPTFcIiB9LFxuICAgIH0sXG4gICAgeyBvblN0YXRlQ2hhbmdlOiAoc3RhdGUpID0+IHJlY29yZCh7IGtpbmQ6IFwic3RhdGVcIiwgc3RhdGUgfSkgfSxcbiAgKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gd2FpdEZvckZldGNoZXMobjogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjAwICYmIGZldGNoZXMgPCBuOyBpICs9IDEpIGF3YWl0IHBhdXNlKDUpO1xuICBhc3NlcnQub2soZmV0Y2hlcyA+PSBuLCBgZXhwZWN0ZWQgJHtufSBmZXRjaGVzLCBzYXcgJHtmZXRjaGVzfWApO1xufVxuXG50ZXN0KFwiZ29sZGVuOiB0aGUgd2lkZ2V0IHZvaWNlIGNsaWVudCdzIGF1ZGlvIHBhdGggaXMgYnl0ZS1pZGVudGljYWxcIiwgYXN5bmMgKCkgPT4ge1xuICAvLyBTY2VuYXJpbyAxIFx1MjAxNCBhIGNhbGwgdGhlIGFnZW50IGVuZHM6IGNvbm5lY3QsIGNsaWVudC1yZWFkeSBsYXRjaCwgZXZlcnlcbiAgLy8gb3V0Ym91bmQgZW52ZWxvcGUsIGEgc2VydmVyIHJlbmVnb3RpYXRpb24sIHRoZSBzZXNzaW9uLWVuZGVkIGxhdGNoIChub1xuICAvLyBkaXNjb25uZWN0IFBPU1QgYWZ0ZXIgaXQpLlxuICByZWNvcmQoeyBraW5kOiBcInNjZW5hcmlvXCIsIG5hbWU6IFwiYWdlbnQtZW5kZWRcIiB9KTtcbiAgY29uc3QgY2xpZW50ID0gbmV3Q2xpZW50KCk7XG4gIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7XG4gIGNvbnN0IHBjID0gRmFrZVBlZXJDb25uZWN0aW9uLmxhc3QgPz8gYXNzZXJ0LmZhaWwoXCJjb25uZWN0KCkgYnVpbHQgYSBwZWVyIGNvbm5lY3Rpb25cIik7XG4gIHBjLmNvbm5lY3Rpb25TdGF0ZSA9IFwiY29ubmVjdGVkXCI7XG4gIHBjLmVtaXQoXCJjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIik7XG4gIHBjLmRjLmVtaXQoXCJvcGVuXCIpOyAvLyBsYXRjaDogY2hhbm5lbCBvcGVuLCBhdWRpbyBub3QgcmVuZGVyaW5nIFx1MjE5MiBubyBjbGllbnQtcmVhZHkgeWV0XG4gIGNsaWVudC5ub3RpZnlBdWRpb1JlbmRlcmluZygpOyAvLyBcdTIxOTIgY2xpZW50LXJlYWR5XG4gIGNsaWVudC5zZW5kVXNlclRleHQoXCJoaVwiKTtcbiAgY2xpZW50LnNlbmRDbGllbnRUb29sUmVzdWx0KFwidDFcIiwgXCJva1wiLCBmYWxzZSk7XG4gIGNsaWVudC5zZW5kTWNwVG9vbEFwcHJvdmFsKFwibTFcIiwgdHJ1ZSk7XG4gIGNsaWVudC5zZW5kQ29udGV4dHVhbFVwZGF0ZShcImN0eFwiLCBcImMxXCIpO1xuICBwYy5kYy5lbWl0KFwibWVzc2FnZVwiLCB7XG4gICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoeyBsYWJlbDogXCJydHZpLWFpXCIsIHR5cGU6IFwic2lnbmFsbGluZ1wiLCBtZXNzYWdlOiB7IHR5cGU6IFwicmVuZWdvdGlhdGVcIiB9IH0pLFxuICB9KTtcbiAgYXdhaXQgd2FpdEZvckZldGNoZXMoMik7XG4gIGF3YWl0IHBhdXNlKDUpO1xuICBwYy5kYy5lbWl0KFwibWVzc2FnZVwiLCB7XG4gICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgICAgdHlwZTogXCJzZXJ2ZXItbWVzc2FnZVwiLFxuICAgICAgZGF0YTogeyB0eXBlOiBcInNlc3Npb24tZW5kZWRcIiwgcmVhc29uOiBcImVuZF9jYWxsXCIgfSxcbiAgICB9KSxcbiAgfSk7XG4gIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0KCk7XG5cbiAgLy8gU2NlbmFyaW8gMiBcdTIwMTQgdGhlIHVzZXIgaGFuZ3MgdXA6IHRoZSBvd25lcnNoaXAtdG9rZW4gZGlzY29ubmVjdCBQT1NULlxuICByZWNvcmQoeyBraW5kOiBcInNjZW5hcmlvXCIsIG5hbWU6IFwidXNlci1lbmRlZFwiIH0pO1xuICBjb25zdCBzZWNvbmQgPSBuZXdDbGllbnQoKTtcbiAgYXdhaXQgc2Vjb25kLmNvbm5lY3QoKTtcbiAgYXdhaXQgc2Vjb25kLmRpc2Nvbm5lY3QoKTtcblxuICBjb25zdCBhY3R1YWwgPSBgJHtKU09OLnN0cmluZ2lmeShldmVudHMsIG51bGwsIDIpfVxcbmA7XG4gIGNvbnN0IGZpbGUgPSBuZXcgVVJMKFwiLi4vdGVzdC9nb2xkZW4vdm9pY2UtY2xpZW50Lmpzb25cIiwgaW1wb3J0Lm1ldGEudXJsKTtcbiAgaWYgKHByb2Nlc3MuZW52LkdPTERFTl9SRUNPUkQgPT09IFwiMVwiKSB3cml0ZUZpbGVTeW5jKGZpbGUsIGFjdHVhbCk7XG4gIGFzc2VydC5lcXVhbChhY3R1YWwsIHJlYWRGaWxlU3luYyhmaWxlLCBcInV0ZjhcIikpO1xufSk7XG4iLCAiLy8gUGx1Z2dhYmxlIHBsYXRmb3JtIGdsb2JhbHMgKEU0IHBsYW4gXHUwMEE3NC4zKS4gVGhlIGJyb3dzZXIgZGVmYXVsdHMgQVJFIHRoZVxuLy8gZ2xvYmFscywgcmVhZCBhdCBjYWxsIHRpbWUgKG5ldmVyIGNhcHR1cmVkIGF0IGltcG9ydCksIHNvIHRoZSBicm93c2VyXG4vLyBidWlsZCBpcyBiZWhhdmlvdXItaWRlbnRpY2FsIHRvIHRoZSB3aWRnZXQncyBvcmlnaW5hbCB2b2ljZS50czsgdGhlIFJlYWN0XG4vLyBOYXRpdmUgcGFja2FnZSBjYWxscyBgc2V0UGxhdGZvcm1gIHdpdGggcmVhY3QtbmF0aXZlLXdlYnJ0YydzIGNsYXNzZXMuXG5pbXBvcnQgdHlwZSB7IFZvbHVtZVByb3ZpZGVyIH0gZnJvbSBcIi4vdm9sdW1lLXByb3ZpZGVyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxhdGZvcm0ge1xuICBSVENQZWVyQ29ubmVjdGlvbjogdHlwZW9mIFJUQ1BlZXJDb25uZWN0aW9uO1xuICBSVENTZXNzaW9uRGVzY3JpcHRpb24/OiB0eXBlb2YgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uO1xuICBtZWRpYURldmljZXM6ICgpID0+IE1lZGlhRGV2aWNlcyB8IHVuZGVmaW5lZDtcbiAgZmV0Y2g6IHR5cGVvZiBmZXRjaDtcbiAgc2V0VGltZW91dDogKGhhbmRsZXI6ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIGdsb2JhbFRoaXMuc2V0VGltZW91dD47XG4gIC8qKiBgY2xpZW50LXJlYWR5LmFib3V0LnBsYXRmb3JtYCAoRTQgcGxhbiBcdTAwQTc0LjYpLiBEZWZhdWx0IGBcIndlYlwiYC4gKi9cbiAgbmFtZT86IFwid2ViXCIgfCBcInJlYWN0LW5hdGl2ZVwiIHwgXCJub2RlXCI7XG4gIC8qKiBWb2x1bWUgLyBmcmVxdWVuY3kgcmVhZHMgZm9yIGEgc3RyZWFtIChRMjApLiBEZWZhdWx0OiBhbiBBbmFseXNlck5vZGVcbiAgICogIHdoZXJlIFdlYiBBdWRpbyBleGlzdHM7IFJlYWN0IE5hdGl2ZSBwbHVncyBhIG5vLW9wIHByb3ZpZGVyLiAqL1xuICB2b2x1bWVQcm92aWRlcj86IChzdHJlYW06IE1lZGlhU3RyZWFtKSA9PiBWb2x1bWVQcm92aWRlcjtcbiAgLyoqIE5hdGl2ZSBhdWRpbyBzZXNzaW9uIGFyb3VuZCBhIHZvaWNlIHNlc3Npb24gKFJlYWN0IE5hdGl2ZTogc3BlYWtlclxuICAgKiAgcm91dGluZykuIGBzdGFydGAgYmVmb3JlIGNvbm5lY3Rpbmc7IGBzdG9wYCBvbiBldmVyeSBlbmQgQU5EIG9uIGFcbiAgICogIGZhaWxlZCBjb25uZWN0LiBEZWZhdWx0OiBub25lLiAqL1xuICBhdWRpb1Nlc3Npb24/OiB7IHN0YXJ0KCk6IHZvaWQ7IHN0b3AoKTogdm9pZCB9O1xufVxuXG5jb25zdCBicm93c2VyRGVmYXVsdHMgPSAoKTogUGxhdGZvcm0gPT4gKHtcbiAgUlRDUGVlckNvbm5lY3Rpb246IGdsb2JhbFRoaXMuUlRDUGVlckNvbm5lY3Rpb24sXG4gIFJUQ1Nlc3Npb25EZXNjcmlwdGlvbjogZ2xvYmFsVGhpcy5SVENTZXNzaW9uRGVzY3JpcHRpb24sXG4gIG1lZGlhRGV2aWNlczogKCkgPT4gZ2xvYmFsVGhpcy5uYXZpZ2F0b3I/Lm1lZGlhRGV2aWNlcyxcbiAgZmV0Y2g6ICguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBmZXRjaD4pID0+IGdsb2JhbFRoaXMuZmV0Y2goLi4uYXJncyksXG4gIHNldFRpbWVvdXQ6IChoYW5kbGVyLCBtcykgPT4gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KGhhbmRsZXIsIG1zKSxcbn0pO1xuXG5sZXQgb3ZlcnJpZGVzOiBQYXJ0aWFsPFBsYXRmb3JtPiA9IHt9O1xuXG4vKiogUmVwbGFjZSBzb21lIHBsYXRmb3JtIGdsb2JhbHMgKFJlYWN0IE5hdGl2ZTogcmVhY3QtbmF0aXZlLXdlYnJ0YykuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0UGxhdGZvcm0obmV4dDogUGFydGlhbDxQbGF0Zm9ybT4pOiB2b2lkIHtcbiAgb3ZlcnJpZGVzID0geyAuLi5vdmVycmlkZXMsIC4uLm5leHQgfTtcbn1cblxuLyoqIFRoZSBlZmZlY3RpdmUgcGxhdGZvcm06IGJyb3dzZXIgZ2xvYmFscyAocmVhZCBub3cpICsgYW55IG92ZXJyaWRlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF0Zm9ybSgpOiBQbGF0Zm9ybSB7XG4gIHJldHVybiB7IC4uLmJyb3dzZXJEZWZhdWx0cygpLCAuLi5vdmVycmlkZXMgfTtcbn1cblxuLyoqXG4gKiBNaWNyb3Bob25lIGNhcHR1cmUgcHJvZmlsZSAoUTIxLCBzdGF0ZWQgaW4gZXZlcnkgUkVBRE1FKTogZWNob1xuICogY2FuY2VsbGF0aW9uIE9OIChzdG9wcyBhZ2VudCBUVFMgZWNob2luZyBpbnRvIHRoZSBtaWMpOyBicm93c2VyIG5vaXNlXG4gKiBzdXBwcmVzc2lvbiBhbmQgYXV0b21hdGljIGdhaW4gY29udHJvbCBPRkYgXHUyMDE0IHRoZSBzYW1lIHByb2ZpbGUgYXMgdGhlXG4gKiBkYXNoYm9hcmQgcHJldmlldy5cbiAqL1xuZXhwb3J0IGNvbnN0IE1JQ19DT05TVFJBSU5UUyA9IHtcbiAgYXVkaW86IHsgZWNob0NhbmNlbGxhdGlvbjogdHJ1ZSwgbm9pc2VTdXBwcmVzc2lvbjogZmFsc2UsIGF1dG9HYWluQ29udHJvbDogZmFsc2UgfSxcbiAgdmlkZW86IGZhbHNlLFxufSBhcyBjb25zdDtcbiIsICIvLyBTbWFsbFdlYlJUQyB2b2ljZSBjbGllbnQgZm9yIHRoZSB3aWRnZXQgXHUyMDE0IGEgdHJpbW1lZCwgZGVwZW5kZW5jeS1mcmVlXG4vLyBhZGFwdGF0aW9uIG9mIHRoZSBkYXNoYm9hcmQncyBgZnJvbnRlbmQvc3JjL2xpYi9waXBlY2F0L2NsaWVudC50c2Bcbi8vIChzYW1lIHNpZ25hbGluZyBoYW5kc2hha2UsIE9wdXMgZm10cCB0dW5pbmcsIFJUVkkgY2xpZW50LXJlYWR5IGxhdGNoLFxuLy8gYW5kIHJlbmVnb3RpYXRpb24gaGFuZGxpbmcpLCBtaW51cyBkYXNoYm9hcmQgYXV0aC90ZW5hbnQgaGVhZGVyczogdGhlXG4vLyB3aWRnZXQncyBzaWduYWxpbmcgY2FwYWJpbGl0eSBJUyB0aGUgdW5ndWVzc2FibGUgYHNlc3Npb25faWRgIG1pbnRlZCBieVxuLy8gdGhlIHB1YmxpYyBzZXNzaW9uIGVuZHBvaW50LlxuXG5pbXBvcnQgdHlwZSB7IFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3IgfSBmcm9tIFwiLi93aWRnZXQtYXBpXCI7XG5pbXBvcnQgeyBNSUNfQ09OU1RSQUlOVFMsIHBsYXRmb3JtIH0gZnJvbSBcIi4vcGxhdGZvcm1cIjtcblxuZXhwb3J0IHR5cGUgVm9pY2VTdGF0ZSA9IFwiaWRsZVwiIHwgXCJjb25uZWN0aW5nXCIgfCBcImNvbm5lY3RlZFwiIHwgXCJkaXNjb25uZWN0ZWRcIiB8IFwiZXJyb3JcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSdHZpTWVzc2FnZSB7XG4gIGxhYmVsPzogc3RyaW5nO1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHtcbiAgICB0ZXh0Pzogc3RyaW5nO1xuICAgIGZpbmFsPzogYm9vbGVhbjtcbiAgICBzcG9rZW4/OiBib29sZWFuO1xuICAgIGFnZ3JlZ2F0ZWRfYnk/OiBzdHJpbmc7XG4gIH07XG4gIG1lc3NhZ2U/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHsgdHlwZT86IHN0cmluZyB9O1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xufVxuXG4vKiogUm9sZSBkZXJpdmVkIGZyb20gYW4gUlRWSSBtZXNzYWdlIHR5cGU7IG51bGwgZm9yIG5vbi10cmFuc2NyaXB0IGZyYW1lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmFuc2NyaXB0Um9sZShtc2c6IFJ0dmlNZXNzYWdlKTogXCJhZ2VudFwiIHwgXCJ1c2VyXCIgfCBudWxsIHtcbiAgc3dpdGNoIChtc2cudHlwZSkge1xuICAgIGNhc2UgXCJib3QtdHJhbnNjcmlwdGlvblwiOlxuICAgIGNhc2UgXCJib3QtbGxtLXRleHRcIjpcbiAgICBjYXNlIFwiYm90LXR0cy10ZXh0XCI6XG4gICAgY2FzZSBcImJvdC1vdXRwdXRcIjpcbiAgICAgIHJldHVybiBcImFnZW50XCI7XG4gICAgY2FzZSBcInVzZXItdHJhbnNjcmlwdGlvblwiOlxuICAgICAgcmV0dXJuIFwidXNlclwiO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBmcmFtZSBzaG91bGQgYXBwZW5kIHRvIHRoZSB2aXNpYmxlIHRyYW5zY3JpcHQuIE1pcnJvcnMgdGhlXG4gKiBkYXNoYm9hcmQncyBkZWR1cGUgcnVsZTogdGhlIGJhY2tlbmQgZW1pdHMgc2V2ZXJhbCBvdmVybGFwcGluZyBhZ2VudFxuICogc3RyZWFtcyBmb3Igb25lIHV0dGVyYW5jZTsgT05MWSB0aGUgc3Bva2VuIHNlbnRlbmNlLWFnZ3JlZ2F0ZWRcbiAqIGBib3Qtb3V0cHV0YCBmaXJlcyBleGFjdGx5IG9uY2UgcGVyIHNwb2tlbiBzZW50ZW5jZSAoZ3JlZXRpbmcgaW5jbHVkZWQpLlxuICogVXNlciBzaWRlOiBmaW5hbCB0cmFuc2NyaXB0aW9ucyBvbmx5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW5kZXJhYmxlVHJhbnNjcmlwdChtc2c6IFJ0dmlNZXNzYWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvbGUgPSB0cmFuc2NyaXB0Um9sZShtc2cpO1xuICBpZiAoIXJvbGUpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJvbGUgPT09IFwiYWdlbnRcIikge1xuICAgIHJldHVybiAoXG4gICAgICBtc2cudHlwZSA9PT0gXCJib3Qtb3V0cHV0XCIgJiZcbiAgICAgIG1zZy5kYXRhPy5zcG9rZW4gPT09IHRydWUgJiZcbiAgICAgIG1zZy5kYXRhPy5hZ2dyZWdhdGVkX2J5ID09PSBcInNlbnRlbmNlXCJcbiAgICApO1xuICB9XG4gIHJldHVybiBtc2cuZGF0YT8uZmluYWwgPT09IHRydWU7XG59XG5cbi8qKiBgZGF0YS50eXBlYCBvZiB0aGUgd29ya2VyJ3MgZW5kLW9mLXNlc3Npb24gYW5ub3VuY2VtZW50IChWT1NPLTY1OCkuICovXG5leHBvcnQgY29uc3QgU0VTU0lPTl9FTkRFRF9NRVNTQUdFX1RZUEUgPSBcInNlc3Npb24tZW5kZWRcIjtcblxuLyoqXG4gKiBUcnVlIHdoZW4gYG1zZ2AgaXMgdGhlIHdvcmtlciBhbm5vdW5jaW5nIHRoYXQgaXQgZW5kZWQgdGhlIHNlc3Npb24gb25cbiAqIHB1cnBvc2UgXHUyMDE0IHRoZSBSVFZJIGBzZXJ2ZXItbWVzc2FnZWAgaXQgd3JpdGVzIHJpZ2h0IGJlZm9yZSBpdCBjbG9zZXMgdGhlXG4gKiBwZWVyIG9uIGl0cyBncmFjZWZ1bCBlbmQgcGF0aCAoRW5kIG5vZGUsIGBlbmRfY2FsbGAsIGNhbGxlZSBzY3JlZW4pLlxuICogTWlycm9ycyBgZnJvbnRlbmQvc3JjL2xpYi9waXBlY2F0L3Nlc3Npb24tZW5kLnRzYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU2Vzc2lvbkVuZGVkTWVzc2FnZShtc2c6IHtcbiAgbGFiZWw/OiB1bmtub3duO1xuICB0eXBlPzogdW5rbm93bjtcbiAgZGF0YT86IHVua25vd247XG4gIFtrZXk6IHN0cmluZ106IHVua25vd247XG59KTogYm9vbGVhbiB7XG4gIC8vIFJUVkkgb25seTogYHZvc28tZGVidWdgIGVudmVsb3BlcyBzaGFyZSB0aGlzIGRhdGEgY2hhbm5lbCBhbmQgbXVzdFxuICAvLyBuZXZlciBsYXRjaCBhbiBlbmQgKHRoYXQgd291bGQgaGlkZSBhIGdlbnVpbmUgdHJhbnNwb3J0IGZhaWx1cmUpLlxuICBpZiAobXNnLmxhYmVsICE9PSBcInJ0dmktYWlcIiB8fCBtc2cudHlwZSAhPT0gXCJzZXJ2ZXItbWVzc2FnZVwiKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGRhdGEgPSBtc2cuZGF0YTtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIGRhdGEgIT09IG51bGwgJiZcbiAgICAoZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikudHlwZSA9PT0gU0VTU0lPTl9FTkRFRF9NRVNTQUdFX1RZUEVcbiAgKTtcbn1cblxuLyoqIGBkYXRhLnR5cGVgIG9mIHRoZSBSVFZJIGBzZXJ2ZXItbWVzc2FnZWAgdHdpbiBvZiB0aGUgdmVuZG9yJ3NcbiAqICBgcXVldWVfc3RhdHVzYCBldmVudCAoYWdlbnQtaW50ZWdyYXRpb24gRTcgXHUwMEE3NC4zKS4gKi9cbmV4cG9ydCBjb25zdCBRVUVVRV9TVEFUVVNfTUVTU0FHRV9UWVBFID0gXCJxdWV1ZV9zdGF0dXNcIjtcbi8qKiBgc2Vzc2lvbi1lbmRlZC5yZWFzb25gIGFmdGVyIGEgd2FpdCB0aGF0IHRpbWVkIG91dC4gKi9cbmV4cG9ydCBjb25zdCBRVUVVRV9USU1FT1VUX1JFQVNPTiA9IFwicXVldWVfdGltZW91dFwiO1xuXG4vKipcbiAqIFRoZSBxdWV1ZSB0cmFuc2l0aW9uIGFuIFJUVkkgZW52ZWxvcGUgY2FycmllcywgaWYgYW55OiBgXCJ3YWl0aW5nXCJgLFxuICogYFwiYWRtaXR0ZWRcImAgb3IgYFwidGltZWRfb3V0XCJgIGZyb20gYHNlcnZlci1tZXNzYWdlIHt0eXBlOiBcInF1ZXVlX3N0YXR1c1wiLFxuICogc3RhdHVzfWA7IGBcInRpbWVkX291dFwiYCBhbHNvIGZyb20gYHNlc3Npb24tZW5kZWQge3JlYXNvbjogXCJxdWV1ZV90aW1lb3V0XCJ9YC5cbiAqIEFueXRoaW5nIGVsc2UgKG90aGVyIGVudmVsb3BlcywgYSBmb3JlaWduIGxhYmVsKSBpcyBgbnVsbGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVRyYW5zaXRpb24obXNnOiB7XG4gIGxhYmVsPzogdW5rbm93bjtcbiAgdHlwZT86IHVua25vd247XG4gIGRhdGE/OiB1bmtub3duO1xufSk6IFwid2FpdGluZ1wiIHwgXCJhZG1pdHRlZFwiIHwgXCJ0aW1lZF9vdXRcIiB8IG51bGwge1xuICBpZiAobXNnLmxhYmVsICE9PSBcInJ0dmktYWlcIiB8fCBtc2cudHlwZSAhPT0gXCJzZXJ2ZXItbWVzc2FnZVwiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZGF0YSA9IG1zZy5kYXRhO1xuICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgZGF0YSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJlY29yZCA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmIChyZWNvcmQudHlwZSA9PT0gUVVFVUVfU1RBVFVTX01FU1NBR0VfVFlQRSkge1xuICAgIGNvbnN0IHN0YXR1cyA9IHJlY29yZC5zdGF0dXM7XG4gICAgaWYgKHN0YXR1cyA9PT0gXCJ3YWl0aW5nXCIgfHwgc3RhdHVzID09PSBcImFkbWl0dGVkXCIgfHwgc3RhdHVzID09PSBcInRpbWVkX291dFwiKSByZXR1cm4gc3RhdHVzO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmIChyZWNvcmQudHlwZSA9PT0gXCJzZXNzaW9uLWVuZGVkXCIgJiYgcmVjb3JkLnJlYXNvbiA9PT0gUVVFVUVfVElNRU9VVF9SRUFTT04pIHtcbiAgICByZXR1cm4gXCJ0aW1lZF9vdXRcIjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUZXJtaW5hbCBzdGF0ZSBmb3IgYW4gUlRDUGVlckNvbm5lY3Rpb24gYGZhaWxlZGA6IGFmdGVyIHRoZSB3b3JrZXIncyBvd25cbiAqIGVuZCBhbm5vdW5jZW1lbnQgaXQgaXMgdGhlIERUTFMgY2xvc2Ugb2YgYSBzZXNzaW9uIHRoYXQgZW5kZWQgb24gcHVycG9zZVxuICogKGFuIG9yZGluYXJ5IFwiZGlzY29ubmVjdGVkXCIpOyB3aXRoIG5vIGFubm91bmNlbWVudCBpdCBpcyBhIHJlYWwgZXJyb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZWVyRmFpbHVyZVN0YXRlKHNlcnZlckVuZGVkOiBib29sZWFuKTogXCJkaXNjb25uZWN0ZWRcIiB8IFwiZXJyb3JcIiB7XG4gIHJldHVybiBzZXJ2ZXJFbmRlZCA/IFwiZGlzY29ubmVjdGVkXCIgOiBcImVycm9yXCI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVm9pY2VDbGllbnRPcHRpb25zIHtcbiAgb25TdGF0ZUNoYW5nZT86IChzdGF0ZTogVm9pY2VTdGF0ZSkgPT4gdm9pZDtcbiAgb25SZW1vdGVBdWRpbz86IChzdHJlYW06IE1lZGlhU3RyZWFtKSA9PiB2b2lkO1xuICBvbkFwcE1lc3NhZ2U/OiAobXNnOiBSdHZpTWVzc2FnZSkgPT4gdm9pZDtcbiAgb25FcnJvcj86IChlcnI6IEVycm9yKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgY2xhc3MgVm9pY2VDbGllbnQge1xuICAvKiogVGhlIHdvcmtlciBhbm5vdW5jZWQgaXQgZW5kZWQgdGhlIHNlc3Npb24gb24gcHVycG9zZSAoc2VlIGBpc1Nlc3Npb25FbmRlZE1lc3NhZ2VgKS4gKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJFbmRlZCA9IGZhbHNlO1xuICBwcml2YXRlIHBjOiBSVENQZWVyQ29ubmVjdGlvbiB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGRjOiBSVENEYXRhQ2hhbm5lbCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxvY2FsU3RyZWFtOiBNZWRpYVN0cmVhbSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBjSWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBWb2ljZVN0YXRlID0gXCJpZGxlXCI7XG4gIHByaXZhdGUgZGlzcG9zZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBhdWRpb1JlbmRlcmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGNsaWVudFJlYWR5U2VudCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByb3RlY3RlZCByZWFkb25seSBzZXNzaW9uOiBWb2ljZVNlc3Npb25EZXNjcmlwdG9yLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0czogVm9pY2VDbGllbnRPcHRpb25zLFxuICApIHt9XG5cbiAgLyoqXG4gICAqIEEgY2xpZW50IHRoYXQgcmVkZWVtcyBhIGNvbnZlcnNhdGlvbiB0b2tlbiAoYEdFVFxuICAgKiAvdjEvY29udmFpL2NvbnZlcnNhdGlvbi90b2tlbmAsIEUyIEQtNCAvIEU0IFE2KSBpbnN0ZWFkIG9mIGEgbWludGVkXG4gICAqIHNlc3Npb246IHRoZSBmaXJzdCBvZmZlciBjYXJyaWVzIGBjb252ZXJzYXRpb25fdG9rZW5gLCBhbmQgdGhlIGFuc3dlcidzXG4gICAqIHNlc3Npb24gZGVzY3JpcHRvciAoYHNlc3Npb25faWRgLCB0aGUgZGlzY29ubmVjdCBwcm9vZiwgYGNvbnZlcnNhdGlvbl9pZGApXG4gICAqIGlzIGFkb3B0ZWQgYmVmb3JlIGFueXRoaW5nIGVsc2UgdXNlcyBpdC4gSW5zaWRlIDE1IG1pbnV0ZXMgdGhlIHNhbWUgdG9rZW5cbiAgICogcmUtam9pbnMgdGhlIHNhbWUgY29udmVyc2F0aW9uIChRMjkpLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db252ZXJzYXRpb25Ub2tlbjxUIGV4dGVuZHMgVm9pY2VDbGllbnQ+KFxuICAgIHRoaXM6IG5ldyAoc2Vzc2lvbjogVm9pY2VTZXNzaW9uRGVzY3JpcHRvciwgb3B0czogVm9pY2VDbGllbnRPcHRpb25zKSA9PiBULFxuICAgIHRva2VuOiBzdHJpbmcsXG4gICAgd2hlcmU6IHsgc2lnbmFsaW5nVXJsOiBzdHJpbmc7IGljZVNlcnZlcnM/OiBWb2ljZVNlc3Npb25EZXNjcmlwdG9yW1wiaWNlX3NlcnZlcnNcIl0gfSxcbiAgICBvcHRzOiBWb2ljZUNsaWVudE9wdGlvbnMsXG4gICk6IFQge1xuICAgIHJldHVybiBuZXcgdGhpcyhcbiAgICAgIHtcbiAgICAgICAgc2Vzc2lvbl9pZDogXCJcIixcbiAgICAgICAgY29udmVyc2F0aW9uX2lkOiBcIlwiLFxuICAgICAgICBzaWduYWxpbmdfdXJsOiB3aGVyZS5zaWduYWxpbmdVcmwsXG4gICAgICAgIGljZV9zZXJ2ZXJzOiB3aGVyZS5pY2VTZXJ2ZXJzLFxuICAgICAgICBjb252ZXJzYXRpb25fdG9rZW46IHRva2VuLFxuICAgICAgfSxcbiAgICAgIG9wdHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBQcm90ZWN0ZWQgZXh0ZW5zaW9uIHBvaW50cyAoRTQgUTEyKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgLy8gRXZlcnkgZGVmYXVsdCByZXByb2R1Y2VzIHRoZSB3aWRnZXQncyBiZWhhdmlvdXIgYnl0ZS1mb3ItYnl0ZSAodGhlXG4gIC8vIGdvbGRlbiBhdWRpby1wYXRoIHRlc3QpLiBTdGFmZi1vbmx5IGJlaGF2aW91ciAoZGFzaGJvYXJkIGF1dGggaGVhZGVycyxcbiAgLy8gcmVjZWl2ZS1vbmx5IGxpc3Rlbi1pbiwgXHUyMDI2KSBsaXZlcyBpbiBhIHN1YmNsYXNzIE9VVFNJREUgdGhpcyBwYWNrYWdlLlxuXG4gIC8qKiBIZWFkZXJzIGFkZGVkIHRvIHRoZSBvZmZlciBQT1NUIGFmdGVyIENvbnRlbnQtVHlwZSwgYmVmb3JlIHRoZSB0cmFjZSBoZWFkZXJzLiAqL1xuICBwcm90ZWN0ZWQgZXh0cmFPZmZlckhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgLyoqIEhlYWRlcnMgb2YgdGhlIGRpc2Nvbm5lY3QgUE9TVC4gKi9cbiAgcHJvdGVjdGVkIGRpc2Nvbm5lY3RIZWFkZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH07XG4gIH1cblxuICAvKiogV2hlcmUgdGhlIGRpc2Nvbm5lY3QgUE9TVCBnb2VzLiAqL1xuICBwcm90ZWN0ZWQgZGlzY29ubmVjdEVuZHBvaW50KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGRpc2Nvbm5lY3RVcmwodGhpcy5zZXNzaW9uLnNpZ25hbGluZ191cmwpO1xuICB9XG5cbiAgLyoqIEJvZHkgb2YgdGhlIGRpc2Nvbm5lY3QgUE9TVCBcdTIwMTQgdGhlIG93bmVyc2hpcCBwcm9vZiAoVk9TTy0xOTEpLiAqL1xuICBwcm90ZWN0ZWQgZGlzY29ubmVjdEJvZHkoKTogeyBzZXNzaW9uX2lkOiBzdHJpbmc7IHNlc3Npb25fdG9rZW4/OiBzdHJpbmcgfSB7XG4gICAgcmV0dXJuIHsgc2Vzc2lvbl9pZDogdGhpcy5zZXNzaW9uLnNlc3Npb25faWQsIHNlc3Npb25fdG9rZW46IHRoaXMuc2Vzc2lvbi5zZXNzaW9uX3Rva2VuIH07XG4gIH1cblxuICAvKiogQ29uc29sZSB0ZXh0IHdoZW4gdGhlIGRpc2Nvbm5lY3QgUE9TVCBpcyBza2lwcGVkIChubyB0b2tlbikgb3IgcmVqZWN0ZWQuICovXG4gIHByb3RlY3RlZCBkaXNjb25uZWN0V2FybmluZyhraW5kOiBcInNraXBwZWRcIiB8IFwicmVqZWN0ZWRcIiwgc3RhdHVzPzogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4ga2luZCA9PT0gXCJza2lwcGVkXCJcbiAgICAgID8gXCJXaWRnZXQgdm9pY2UgZGlzY29ubmVjdCBza2lwcGVkOiBubyBzZXNzaW9uX3Rva2VuXCJcbiAgICAgIDogYFdpZGdldCB2b2ljZSBkaXNjb25uZWN0IHJlamVjdGVkOiAke3N0YXR1c31gO1xuICB9XG5cbiAgLyoqIFRoZSBlcnJvciBhIG5vbi0yeHggc2lnbmFsaW5nIGFuc3dlciByYWlzZXMuICovXG4gIHByb3RlY3RlZCBzaWduYWxpbmdGYWlsdXJlKHN0YXR1czogbnVtYmVyLCBzdGF0dXNUZXh0OiBzdHJpbmcsIGJvZHk6IHVua25vd24pOiBFcnJvciB7XG4gICAgY29uc3QgZGV0YWlsID1cbiAgICAgIGJvZHkgJiYgdHlwZW9mIGJvZHkgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIChib2R5IGFzIHsgZGV0YWlsPzogdW5rbm93biB9KS5kZXRhaWwgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyAoYm9keSBhcyB7IGRldGFpbDogc3RyaW5nIH0pLmRldGFpbFxuICAgICAgICA6IHN0YXR1c1RleHQ7XG4gICAgcmV0dXJuIG5ldyBFcnJvcihgU2lnbmFsaW5nIGZhaWxlZCAoJHtzdGF0dXN9KTogJHtkZXRhaWx9YCk7XG4gIH1cblxuICAvKiogVGhlIGxvY2FsIGNhcHR1cmUgdG8gcHVibGlzaDsgYG51bGxgIHB1Ymxpc2hlcyBub3RoaW5nLiAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgbG9jYWxNZWRpYSgpOiBQcm9taXNlPE1lZGlhU3RyZWFtIHwgbnVsbD4ge1xuICAgIHJldHVybiAocGxhdGZvcm0oKS5tZWRpYURldmljZXMoKSBhcyBNZWRpYURldmljZXMpLmdldFVzZXJNZWRpYShNSUNfQ09OU1RSQUlOVFMpO1xuICB9XG5cbiAgLyoqIEF0dGFjaCB0aGUgbG9jYWwgY2FwdHVyZSAob3IgYSByZWNlaXZlIHBhdGgpIHRvIHRoZSBwZWVyIGJlZm9yZSB0aGUgb2ZmZXIuICovXG4gIHByb3RlY3RlZCBjb25maWd1cmVUcmFuc2NlaXZlcnMocGM6IFJUQ1BlZXJDb25uZWN0aW9uLCBzdHJlYW06IE1lZGlhU3RyZWFtIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmICghc3RyZWFtKSByZXR1cm47XG4gICAgZm9yIChjb25zdCB0cmFjayBvZiBzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKSkgcGMuYWRkVHJhY2sodHJhY2ssIHN0cmVhbSk7XG4gIH1cblxuICAvKiogYGRhdGFgIG9mIHRoZSBSVFZJIGBjbGllbnQtcmVhZHlgIGZyYW1lIChub25lIGJ5IGRlZmF1bHQgXHUyMDE0IHRoZSB3aWRnZXQncyBmcmFtZSkuICovXG4gIHByb3RlY3RlZCBjbGllbnRSZWFkeURhdGEoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKiogVGhlIHdvcmtlcidzIGBzZXNzaW9uLWVuZGVkYCBhbm5vdW5jZW1lbnQgYXJyaXZlZCAoYHJlYXNvbmAgd2hlbiBhIHN0cmluZykuICovXG4gIHByb3RlY3RlZCBvblNlc3Npb25FbmRlZEZyYW1lKF9yZWFzb246IHN0cmluZyB8IG51bGwpOiB2b2lkIHt9XG5cbiAgLyoqIFRoZSBwZWVyIGNsb3NlZCBhZnRlciB0aGF0IGFubm91bmNlbWVudDsgdGhlIGNsaWVudCBoYXMgcmVsZWFzZWQgaXQuICovXG4gIHByb3RlY3RlZCBvbkFubm91bmNlZEVuZENsb3NlZCgpOiB2b2lkIHt9XG5cbiAgLyoqIFRoZSBsaXZlIHBlZXIgY29ubmVjdGlvbiAoYG51bGxgIHdoZW4gbm90IGNvbm5lY3RlZCkuICovXG4gIHByb3RlY3RlZCBwZWVyKCk6IFJUQ1BlZXJDb25uZWN0aW9uIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMucGM7XG4gIH1cblxuICAvKiogVGhlIHB1Ymxpc2hlZCBsb2NhbCBjYXB0dXJlIChgbnVsbGAgd2hlbiBub25lKS4gKi9cbiAgcHJvdGVjdGVkIG1pYygpOiBNZWRpYVN0cmVhbSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmxvY2FsU3RyZWFtO1xuICB9XG5cbiAgLyoqIFNlbmQgb25lIEpTT04gZnJhbWUgb24gdGhlIGRhdGEgY2hhbm5lbDsgYGZhbHNlYCB3aGVuIGl0IGlzIG5vdCBvcGVuLiAqL1xuICBwcm90ZWN0ZWQgc2VuZEZyYW1lKGZyYW1lOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGZyYW1lKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBnZXRTdGF0ZSgpOiBWb2ljZVN0YXRlIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0U3RhdGUobmV4dDogVm9pY2VTdGF0ZSkge1xuICAgIGlmICh0aGlzLnN0YXRlID09PSBuZXh0KSByZXR1cm47XG4gICAgdGhpcy5zdGF0ZSA9IG5leHQ7XG4gICAgdGhpcy5vcHRzLm9uU3RhdGVDaGFuZ2U/LihuZXh0KTtcbiAgfVxuXG4gIGFzeW5jIGNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc3RhdGUgIT09IFwiaWRsZVwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjb25uZWN0IGZyb20gXCIke3RoaXMuc3RhdGV9XCJgKTtcbiAgICB0aGlzLnNldFN0YXRlKFwiY29ubmVjdGluZ1wiKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgaWNlU2VydmVycyA9ICh0aGlzLnNlc3Npb24uaWNlX3NlcnZlcnMgPz8gW10pLm1hcCgocykgPT4gKHtcbiAgICAgICAgdXJsczogcy51cmxzLFxuICAgICAgICB1c2VybmFtZTogcy51c2VybmFtZSxcbiAgICAgICAgY3JlZGVudGlhbDogcy5jcmVkZW50aWFsLFxuICAgICAgfSkpO1xuICAgICAgY29uc3QgcGMgPSBuZXcgKHBsYXRmb3JtKCkuUlRDUGVlckNvbm5lY3Rpb24pKHtcbiAgICAgICAgaWNlU2VydmVyczpcbiAgICAgICAgICBpY2VTZXJ2ZXJzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgID8gaWNlU2VydmVyc1xuICAgICAgICAgICAgOiBbeyB1cmxzOiBcInN0dW46c3R1bi5sLmdvb2dsZS5jb206MTkzMDJcIiB9XSxcbiAgICAgIH0pO1xuICAgICAgdGhpcy5wYyA9IHBjO1xuXG4gICAgICBwYy5hZGRFdmVudExpc3RlbmVyKFwiY29ubmVjdGlvbnN0YXRlY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZGlzcG9zZWQpIHJldHVybjtcbiAgICAgICAgY29uc3QgY3MgPSBwYy5jb25uZWN0aW9uU3RhdGU7XG4gICAgICAgIGlmIChjcyA9PT0gXCJjb25uZWN0ZWRcIikgdGhpcy5zZXRTdGF0ZShcImNvbm5lY3RlZFwiKTtcbiAgICAgICAgZWxzZSBpZiAoY3MgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgICAgICAvLyBBZnRlciB0aGUgd29ya2VyJ3MgYHNlc3Npb24tZW5kZWRgIGFubm91bmNlbWVudCB0aGlzIGlzIHRoZVxuICAgICAgICAgIC8vIGV4cGVjdGVkIGNsb3NlIG9mIGEgZmluaXNoZWQgY2FsbCwgbm90IGEgZmFpbHVyZSAoVk9TTy02NTgpLlxuICAgICAgICAgIGNvbnN0IG5leHQgPSBwZWVyRmFpbHVyZVN0YXRlKHRoaXMuc2VydmVyRW5kZWQpO1xuICAgICAgICAgIHRoaXMuc2V0U3RhdGUobmV4dCk7XG4gICAgICAgICAgaWYgKG5leHQgPT09IFwiZXJyb3JcIikgdGhpcy5vcHRzLm9uRXJyb3I/LihuZXcgRXJyb3IoXCJXZWJSVEMgY29ubmVjdGlvbiBmYWlsZWRcIikpO1xuICAgICAgICAgIC8vIEFubm91bmNlZCBlbmQ6IHRoZSBzZXNzaW9uIGlzIG92ZXIgb24gYm90aCBlbmRzIFx1MjAxNCByZWxlYXNlIHRoZVxuICAgICAgICAgIC8vIG1pYyBhbmQgdGhlIHBlZXIgbm93ICh0aGUgd2lkZ2V0J3MgZW5kQ2FsbCBydW5zIGxvY2FsIGNsZWFudXBcbiAgICAgICAgICAvLyB0b287IGJvdGggYXJlIGlkZW1wb3RlbnQpLlxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmNsZWFudXAoKTtcbiAgICAgICAgICAgIHRoaXMub25Bbm5vdW5jZWRFbmRDbG9zZWQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3MgPT09IFwiY2xvc2VkXCIgfHwgY3MgPT09IFwiZGlzY29ubmVjdGVkXCIpIHtcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiZGlzY29ubmVjdGVkXCIpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcGMuYWRkRXZlbnRMaXN0ZW5lcihcInRyYWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5kaXNwb3NlZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBbc3RyZWFtXSA9IGV2ZW50LnN0cmVhbXM7XG4gICAgICAgIGlmIChzdHJlYW0pIHRoaXMub3B0cy5vblJlbW90ZUF1ZGlvPy4oc3RyZWFtKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBkYyA9IHBjLmNyZWF0ZURhdGFDaGFubmVsKFwicGlwZWNhdFwiKTtcbiAgICAgIHRoaXMuZGMgPSBkYztcbiAgICAgIGRjLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLmRpc3Bvc2VkKSB0aGlzLm1heWJlU2VuZENsaWVudFJlYWR5KCk7XG4gICAgICB9KTtcbiAgICAgIGRjLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIChldmVudCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5kaXNwb3NlZCB8fCB0eXBlb2YgZXZlbnQuZGF0YSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoZXZlbnQuZGF0YSkgYXMgUnR2aU1lc3NhZ2U7XG4gICAgICAgICAgaWYgKGlzU2Vzc2lvbkVuZGVkTWVzc2FnZShwYXJzZWQpKSB7XG4gICAgICAgICAgICB0aGlzLnNlcnZlckVuZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHJlYXNvbiA9IChwYXJzZWQuZGF0YSBhcyB7IHJlYXNvbj86IHVua25vd24gfSB8IHVuZGVmaW5lZCk/LnJlYXNvbjtcbiAgICAgICAgICAgIHRoaXMub25TZXNzaW9uRW5kZWRGcmFtZSh0eXBlb2YgcmVhc29uID09PSBcInN0cmluZ1wiID8gcmVhc29uIDogbnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChwYXJzZWQudHlwZSA9PT0gXCJzaWduYWxsaW5nXCIgJiYgcGFyc2VkLm1lc3NhZ2U/LnR5cGUgPT09IFwicmVuZWdvdGlhdGVcIikge1xuICAgICAgICAgICAgdm9pZCB0aGlzLnJlbmVnb3RpYXRlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMub3B0cy5vbkFwcE1lc3NhZ2U/LihwYXJzZWQpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyByYXcga2VlcC1hbGl2ZXMgZXRjLlxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQUVDIG9uIChzdG9wcyBhZ2VudCBUVFMgZWNob2luZyBpbnRvIHRoZSBtaWMpOyBBR0MgKyBicm93c2VyIG5vaXNlXG4gICAgICAvLyBzdXBwcmVzc2lvbiBvZmYgXHUyMDE0IHNhbWUgY2FwdHVyZSBwcm9maWxlIGFzIHRoZSBkYXNoYm9hcmQgcHJldmlldyAoUTIxKS5cbiAgICAgIGNvbnN0IHN0cmVhbSA9IGF3YWl0IHRoaXMubG9jYWxNZWRpYSgpO1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbSA9IHN0cmVhbTtcbiAgICAgIHRoaXMuY29uZmlndXJlVHJhbnNjZWl2ZXJzKHBjLCBzdHJlYW0pO1xuXG4gICAgICBhd2FpdCB0aGlzLm5lZ290aWF0ZShmYWxzZSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnNldFN0YXRlKFwiZXJyb3JcIik7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAoKTtcbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoXCJXZWJSVEMgY29ubmVjdGlvbiBmYWlsZWRcIik7XG4gICAgICB0aGlzLm9wdHMub25FcnJvcj8uKGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbmVnb3RpYXRlKGlzUmVuZWdvdGlhdGlvbjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBjID0gdGhpcy5wYztcbiAgICBpZiAoIXBjKSB0aHJvdyBuZXcgRXJyb3IoXCJQZWVyQ29ubmVjdGlvbiBnb25lXCIpO1xuICAgIGNvbnN0IG9mZmVyID0gYXdhaXQgcGMuY3JlYXRlT2ZmZXIoe1xuICAgICAgdm9pY2VBY3Rpdml0eURldGVjdGlvbjogZmFsc2UsXG4gICAgfSBhcyBSVENPZmZlck9wdGlvbnMpO1xuICAgIGlmIChvZmZlci5zZHApIG9mZmVyLnNkcCA9IHR1bmVPcHVzRm10cChvZmZlci5zZHApO1xuICAgIGF3YWl0IHBjLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIGF3YWl0IHdhaXRGb3JJY2VHYXRoZXJpbmcocGMpO1xuICAgIGNvbnN0IGxvY2FsID0gcGMubG9jYWxEZXNjcmlwdGlvbjtcbiAgICBpZiAoIWxvY2FsKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBsb2NhbCBTRFBcIik7XG5cbiAgICBjb25zdCB0b2tlbiA9ICF0aGlzLnNlc3Npb24uc2Vzc2lvbl9pZCAmJiB0aGlzLnNlc3Npb24uY29udmVyc2F0aW9uX3Rva2VuO1xuICAgIGNvbnN0IGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0gdG9rZW5cbiAgICAgID8geyBjb252ZXJzYXRpb25fdG9rZW46IHRva2VuLCBzZHA6IGxvY2FsLnNkcCwgdHlwZTogbG9jYWwudHlwZSB9XG4gICAgICA6IHtcbiAgICAgICAgICBzZHA6IGxvY2FsLnNkcCxcbiAgICAgICAgICB0eXBlOiBsb2NhbC50eXBlLFxuICAgICAgICAgIHNlc3Npb25faWQ6IHRoaXMuc2Vzc2lvbi5zZXNzaW9uX2lkLFxuICAgICAgICAgIHJlcXVlc3RfZGF0YTogeyBzZXNzaW9uX2lkOiB0aGlzLnNlc3Npb24uc2Vzc2lvbl9pZCB9LFxuICAgICAgICB9O1xuICAgIGlmICh0aGlzLnBjSWQpIGJvZHkucGNfaWQgPSB0aGlzLnBjSWQ7XG4gICAgaWYgKGlzUmVuZWdvdGlhdGlvbikgYm9keS5yZXN0YXJ0X3BjID0gZmFsc2U7XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAuLi50aGlzLmV4dHJhT2ZmZXJIZWFkZXJzKCksXG4gICAgfTtcbiAgICBhZGRUcmFjZUhlYWRlcnMoaGVhZGVycywgdGhpcy5zZXNzaW9uLnRyYWNlX2NvbnRleHQpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHBsYXRmb3JtKCkuZmV0Y2godGhpcy5zZXNzaW9uLnNpZ25hbGluZ191cmwsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBoZWFkZXJzLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gICAgfSk7XG4gICAgaWYgKCFyZXMub2spIHtcbiAgICAgIGxldCBwYXJzZWQ6IHVua25vd24gPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcGFyc2VkID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBrZWVwIHN0YXR1c1RleHRcbiAgICAgIH1cbiAgICAgIHRocm93IHRoaXMuc2lnbmFsaW5nRmFpbHVyZShyZXMuc3RhdHVzLCByZXMuc3RhdHVzVGV4dCwgcGFyc2VkKTtcbiAgICB9XG4gICAgY29uc3QgYW5zd2VyID0gKGF3YWl0IHJlcy5qc29uKCkpIGFzIHtcbiAgICAgIHNkcDogc3RyaW5nO1xuICAgICAgdHlwZTogUlRDU2RwVHlwZTtcbiAgICAgIHBjX2lkOiBzdHJpbmc7XG4gICAgfSAmIFBhcnRpYWw8Vm9pY2VTZXNzaW9uRGVzY3JpcHRvcj47XG4gICAgdGhpcy5wY0lkID0gYW5zd2VyLnBjX2lkO1xuICAgIC8vIEEgdG9rZW4gb2ZmZXIncyBhbnN3ZXIgbmFtZXMgdGhlIHNlc3Npb24gaXQgcmVkZWVtZWQgaW50byAoRTQgUDEpLlxuICAgIGlmICh0b2tlbiAmJiBhbnN3ZXIuc2Vzc2lvbl9pZCkgT2JqZWN0LmFzc2lnbih0aGlzLnNlc3Npb24sIGFuc3dlckRlc2NyaXB0b3IoYW5zd2VyKSk7XG4gICAgYXdhaXQgcGMuc2V0UmVtb3RlRGVzY3JpcHRpb24oeyBzZHA6IGFuc3dlci5zZHAsIHR5cGU6IGFuc3dlci50eXBlIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5lZ290aWF0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMucGMgfHwgdGhpcy5kaXNwb3NlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm5lZ290aWF0ZSh0cnVlKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMub3B0cy5vbkVycm9yPy4oZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoXCJSZW5lZ290aWF0aW9uIGZhaWxlZFwiKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFJlcG9ydCB0aGF0IHRoZSByZW1vdGUgPGF1ZGlvPiBpcyBhY3R1YWxseSBwbGF5aW5nIFx1MjAxNCByZWxlYXNlcyB0aGVcbiAgICogIHNlcnZlci1oZWxkIGdyZWV0aW5nIHZpYSB0aGUgUlRWSSBjbGllbnQtcmVhZHkgaGFuZHNoYWtlLiAqL1xuICBub3RpZnlBdWRpb1JlbmRlcmluZygpOiB2b2lkIHtcbiAgICB0aGlzLmF1ZGlvUmVuZGVyaW5nID0gdHJ1ZTtcbiAgICB0aGlzLm1heWJlU2VuZENsaWVudFJlYWR5KCk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZCB0eXBlZCB0ZXh0IGFzIGEgUkVBTCB1c2VyIHR1cm4gb24gdGhlIGxpdmUgY2FsbCAoUlRWSVxuICAgKiBgc2VuZC10ZXh0YCBvdmVyIHRoZSBkYXRhIGNoYW5uZWwgXHUyMDE0IHRoZSBzZXJ2ZXIgaW5qZWN0cyBpdCBpbnRvIHRoZVxuICAgKiBwaXBlbGluZSdzIExMTSBjb250ZXh0IGFuZCBydW5zIGEgY29tcGxldGlvbiwgaW50ZXJydXB0aW5nIHRoZSBib3RcbiAgICogaWYgaXQgaXMgbWlkLXV0dGVyYW5jZSkuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdFxuICAgKiBvcGVuIG9yIHRoZSB0ZXh0IGlzIGJsYW5rOyB0aGUgY2FsbGVyIGtlZXBzIHRoZSBjb21wb3NlcidzIHRleHQuXG4gICAqL1xuICBzZW5kVXNlclRleHQodGV4dDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRleHQudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGJ1aWxkU2VuZFRleHRFbnZlbG9wZSh0cmltbWVkKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEFuc3dlciBhIGNsaWVudCB0b29sIGNhbGwgdGhlIGFnZW50IG1hZGUgb24gdGhpcyBjYWxsIChSVFZJXG4gICAqIGBsbG0tZnVuY3Rpb24tY2FsbC1yZXN1bHRgOyB0aGUgdmVuZG9yJ3MgYGNsaWVudF90b29sX3Jlc3VsdGApLiBMYXRlLFxuICAgKiBkdXBsaWNhdGUgb3IgdW5rbm93biBpZHMgYXJlIGlnbm9yZWQgc2VydmVyLXNpZGUuIFJldHVybnMgYGZhbHNlYCB3aGVuXG4gICAqIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZENsaWVudFRvb2xSZXN1bHQodG9vbENhbGxJZDogc3RyaW5nLCByZXN1bHQ6IHN0cmluZywgaXNFcnJvciA9IGZhbHNlKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmRjLnNlbmQoSlNPTi5zdHJpbmdpZnkoYnVpbGRGdW5jdGlvbkNhbGxSZXN1bHRFbnZlbG9wZSh0b29sQ2FsbElkLCByZXN1bHQsIGlzRXJyb3IpKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogQXBwcm92ZSBvciBkZW55IGFuIE1DUCB0b29sIGNhbGwgdGhlIGFnZW50IGlzIHdhaXRpbmcgb24gKFJUVklcbiAgICogYG1jcC10b29sLWFwcHJvdmFsLXJlc3VsdGA7IHRoZSB2ZW5kb3IncyBgbWNwX3Rvb2xfYXBwcm92YWxfcmVzdWx0YCxcbiAgICogRTMgXHUwMEE3NC42KS4gTGF0ZSAvIHVua25vd24gaWRzIGFyZSBpZ25vcmVkIHNlcnZlci1zaWRlLiBSZXR1cm5zIGBmYWxzZWBcbiAgICogd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRNY3BUb29sQXBwcm92YWwodG9vbENhbGxJZDogc3RyaW5nLCBpc0FwcHJvdmVkOiBib29sZWFuKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmRjLnNlbmQoSlNPTi5zdHJpbmdpZnkoYnVpbGRNY3BUb29sQXBwcm92YWxFbnZlbG9wZSh0b29sQ2FsbElkLCBpc0FwcHJvdmVkKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIFB1c2ggYmFja2dyb3VuZCBjb250ZXh0IGludG8gdGhlIGxpdmUgY29udmVyc2F0aW9uIHdpdGhvdXQgYSB0dXJuXG4gICAqIChSVFZJIGBhcHBlbmQtdG8tY29udGV4dGA7IHRoZSB2ZW5kb3IncyBgY29udGV4dHVhbF91cGRhdGVgKS4gVGhlIGFnZW50XG4gICAqIGRvZXMgbm90IHNwZWFrOyBpdCByZWFkcyB0aGUgbm90ZSBvbiBpdHMgbmV4dCByZXBseS4gQSBsYXRlciB1cGRhdGVcbiAgICogd2l0aCB0aGUgc2FtZSBgY29udGV4dElkYCByZXBsYWNlcyB0aGUgZWFybGllciBvbmUuIFJldHVybnMgYGZhbHNlYFxuICAgKiB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZENvbnRleHR1YWxVcGRhdGUodGV4dDogc3RyaW5nLCBjb250ZXh0SWQ/OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAoIXRoaXMuZGMgfHwgdGhpcy5kYy5yZWFkeVN0YXRlICE9PSBcIm9wZW5cIikgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuZGMuc2VuZChKU09OLnN0cmluZ2lmeShidWlsZEFwcGVuZFRvQ29udGV4dEVudmVsb3BlKHRleHQsIGNvbnRleHRJZCkpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBhZ2VudCB0aGUgdXNlciBpcyBhY3RpdmUgd2l0aG91dCBhIHR1cm4gKFJUVkkgYHVzZXItYWN0aXZpdHlgO1xuICAgKiB0aGUgdmVuZG9yJ3MgYHVzZXJfYWN0aXZpdHlgLCBFMiBELTkpOiByZXNldHMgdGhlIGlkbGUgY2xvY2suIFJldHVybnNcbiAgICogYGZhbHNlYCB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZFVzZXJBY3Rpdml0eSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zZW5kRnJhbWUoYnVpbGRVc2VyQWN0aXZpdHlFbnZlbG9wZSgpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXItcmVzcG9uc2UgZmVlZGJhY2sgKFJUVkkgYGZlZWRiYWNrIHtzY29yZSwgZXZlbnRfaWR9YDsgdGhlIHZlbmRvcidzXG4gICAqIGBmZWVkYmFja2AsIEU0IFExNik6IGBsaWtlYCAvIGBkaXNsaWtlYCwgYG51bGxgIGNsZWFycyBpdC4gU3RvcmVkIGluIHRoZVxuICAgKiBPTkUgZmVlZGJhY2sgc3RvcmUgKEUyIEQtMTApLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRGZWVkYmFjayhzY29yZTogXCJsaWtlXCIgfCBcImRpc2xpa2VcIiB8IG51bGwsIGV2ZW50SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnNlbmRGcmFtZShidWlsZEZlZWRiYWNrRW52ZWxvcGUoc2NvcmUsIGV2ZW50SWQpKTtcbiAgfVxuXG4gIHByaXZhdGUgbWF5YmVTZW5kQ2xpZW50UmVhZHkoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xpZW50UmVhZHlTZW50IHx8ICF0aGlzLmF1ZGlvUmVuZGVyaW5nKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybjtcbiAgICBjb25zdCBkYXRhID0gdGhpcy5jbGllbnRSZWFkeURhdGEoKTtcbiAgICB0aGlzLmRjLnNlbmQoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICAgICAgdHlwZTogXCJjbGllbnQtcmVhZHlcIixcbiAgICAgICAgaWQ6IGBjbGllbnQtcmVhZHktJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgICAgICAuLi4oZGF0YSA/IHsgZGF0YSB9IDoge30pLFxuICAgICAgfSksXG4gICAgKTtcbiAgICB0aGlzLmNsaWVudFJlYWR5U2VudCA9IHRydWU7XG4gIH1cblxuICBzZXRNaWNyb3Bob25lRW5hYmxlZChlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmxvY2FsU3RyZWFtKSByZXR1cm47XG4gICAgZm9yIChjb25zdCB0cmFjayBvZiB0aGlzLmxvY2FsU3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkpIHRyYWNrLmVuYWJsZWQgPSBlbmFibGVkO1xuICB9XG5cbiAgYXN5bmMgZGlzY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRpc3Bvc2VkID0gdHJ1ZTtcbiAgICAvLyBPd25lcnNoaXAgcHJvb2YgKFZPU08tMTkxKTogdGhlIHdvcmtlciByZWplY3RzIHRlYXJkb3duIHdpdGhvdXQgdGhlXG4gICAgLy8gdG9rZW4gbWludGVkIGFsb25nc2lkZSB0aGlzIHNlc3Npb24uIEEgdG9rZW4tbGVzcyBkZXNjcmlwdG9yIChvbGRlclxuICAgIC8vIEFQSSBkdXJpbmcgZGVwbG95IHNrZXcpIHdvdWxkIGJlIGEgZ3VhcmFudGVlZCA0MDEgXHUyMDE0IHNraXAgdGhlIHJlcXVlc3RcbiAgICAvLyBhbmQgbGV0IHRoZSBzZXJ2ZXIgc2lkZSBmYWxsIGJhY2sgdG8gSUNFLXRpbWVvdXQgdGVhcmRvd24uIEFmdGVyIHRoZVxuICAgIC8vIHdvcmtlcidzIG93biBlbmQgYW5ub3VuY2VtZW50IHRoZXJlIGlzIG5vdGhpbmcgbGVmdCB0byB0ZWFyIGRvd24uXG4gICAgY29uc3QgcHJvb2YgPSB0aGlzLmRpc2Nvbm5lY3RCb2R5KCk7XG4gICAgaWYgKHRoaXMuc2VydmVyRW5kZWQpIHtcbiAgICAgIC8vIFRoZSB3b3JrZXIgYW5ub3VuY2VkIHRoZSBlbmQgYW5kIHRvcmUgdGhlIHNlc3Npb24gZG93biBpdHNlbGY6XG4gICAgICAvLyBub3RoaW5nIHRvIHJlcXVlc3QsIG5vdGhpbmcgdG8gd2FybiBhYm91dC5cbiAgICB9IGVsc2UgaWYgKCFwcm9vZi5zZXNzaW9uX3Rva2VuKSB7XG4gICAgICBjb25zb2xlLndhcm4odGhpcy5kaXNjb25uZWN0V2FybmluZyhcInNraXBwZWRcIikpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXMgPSBhd2FpdCBwbGF0Zm9ybSgpLmZldGNoKHRoaXMuZGlzY29ubmVjdEVuZHBvaW50KCksIHtcbiAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIGhlYWRlcnM6IHRoaXMuZGlzY29ubmVjdEhlYWRlcnMoKSxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShwcm9vZiksXG4gICAgICAgICAga2VlcGFsaXZlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgICAvLyBBIHJlamVjdGVkIGRpc2Nvbm5lY3QgbGVhdmVzIHRoZSBzZXJ2ZXIgc2Vzc2lvbiB0byBJQ0UgdGltZW91dC5cbiAgICAgICAgICBjb25zb2xlLndhcm4odGhpcy5kaXNjb25uZWN0V2FybmluZyhcInJlamVjdGVkXCIsIHJlcy5zdGF0dXMpKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGJlc3QgZWZmb3J0XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpO1xuICAgIHRoaXMuc2V0U3RhdGUoXCJkaXNjb25uZWN0ZWRcIik7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNsZWFudXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGM/LmNsb3NlKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gICAgdGhpcy5kYyA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMucGM/LmNsb3NlKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gICAgdGhpcy5wYyA9IG51bGw7XG4gICAgaWYgKHRoaXMubG9jYWxTdHJlYW0pIHtcbiAgICAgIGZvciAoY29uc3QgdHJhY2sgb2YgdGhpcy5sb2NhbFN0cmVhbS5nZXRUcmFja3MoKSkgdHJhY2suc3RvcCgpO1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbSA9IG51bGw7XG4gICAgfVxuICB9XG59XG5cbi8qKiBSVFZJIGBzZW5kLXRleHRgIGVudmVsb3BlIGZvciBvbmUgdHlwZWQgdXNlciB0dXJuLiBFeHBvcnRlZCBmb3IgdGVzdHNcbiAqICAoYW5kIG1pcnJvcmVkIGJ5IHRoZSBkYXNoYm9hcmQgcHJldmlldydzIGNvbXBvc2VyIFx1MjAxNCB0aGUgdHdvIHNlbmRlcnNcbiAqICBtdXN0IGVtaXQgdGhlIHNhbWUgd2lyZSBzaGFwZSB0aGUgcHJldmlldyBwaXBlbGluZSBwYXJzZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VuZFRleHRFbnZlbG9wZShjb250ZW50OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwic2VuZC10ZXh0XCIsXG4gICAgaWQ6IGBzZW5kLXRleHQtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHtcbiAgICAgIGNvbnRlbnQsXG4gICAgICBvcHRpb25zOiB7IHJ1bl9pbW1lZGlhdGVseTogdHJ1ZSwgYXVkaW9fcmVzcG9uc2U6IHRydWUgfSxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogUlRWSSBgbGxtLWZ1bmN0aW9uLWNhbGwtcmVzdWx0YCBlbnZlbG9wZSBcdTIwMTQgdGhlIGFwcCdzIGFuc3dlciB0byBhblxuICogIGBsbG0tZnVuY3Rpb24tY2FsbGAgKEUzIFx1MDBBNzQuMS41KS4gVGhlIHZlbmRvcidzIHRocmVlIGZpZWxkcyBvbmx5OyB0aGVcbiAqICBzZXJ2ZXIgcmVzb2x2ZXMgdGhlIHBlbmRpbmcgY2FsbCBieSBgdG9vbF9jYWxsX2lkYC4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRnVuY3Rpb25DYWxsUmVzdWx0RW52ZWxvcGUoXG4gIHRvb2xDYWxsSWQ6IHN0cmluZyxcbiAgcmVzdWx0OiBzdHJpbmcsXG4gIGlzRXJyb3I6IGJvb2xlYW4sXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwibGxtLWZ1bmN0aW9uLWNhbGwtcmVzdWx0XCIsXG4gICAgaWQ6IGB0b29sLXJlc3VsdC0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfWAsXG4gICAgZGF0YTogeyB0b29sX2NhbGxfaWQ6IHRvb2xDYWxsSWQsIHJlc3VsdCwgaXNfZXJyb3I6IGlzRXJyb3IgfSxcbiAgfTtcbn1cblxuLyoqIFJUVkkgYG1jcC10b29sLWFwcHJvdmFsLXJlc3VsdGAgZW52ZWxvcGUgKEUzIFx1MDBBNzQuNikuIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1jcFRvb2xBcHByb3ZhbEVudmVsb3BlKFxuICB0b29sQ2FsbElkOiBzdHJpbmcsXG4gIGlzQXBwcm92ZWQ6IGJvb2xlYW4sXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwibWNwLXRvb2wtYXBwcm92YWwtcmVzdWx0XCIsXG4gICAgaWQ6IGBtY3AtYXBwcm92YWwtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHsgdG9vbF9jYWxsX2lkOiB0b29sQ2FsbElkLCBpc19hcHByb3ZlZDogaXNBcHByb3ZlZCB9LFxuICB9O1xufVxuXG4vKiogVGhlIGBkYXRhYCBvZiBhbiBSVFZJIGBtY3AtdG9vbC1jYWxsYCBtZXNzYWdlLCBvciBgbnVsbGAgZm9yIGFueSBvdGhlclxuICogIHR5cGUgKEUzIFx1MDBBNzQuNikuIFRoZSBjYWxsZXIgcGFyc2VzIGl0IHdpdGggYG1jcFRvb2xDYWxsRnJvbVJlY29yZGAuICovXG5leHBvcnQgZnVuY3Rpb24gbWNwVG9vbENhbGxEYXRhRnJvbVJ0dmkobXNnOiBSdHZpTWVzc2FnZSk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG4gIGlmIChtc2cudHlwZSAhPT0gXCJtY3AtdG9vbC1jYWxsXCIpIHJldHVybiBudWxsO1xuICBjb25zdCBkYXRhID0gbXNnLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIHJldHVybiBkYXRhID8/IG51bGw7XG59XG5cbi8qKiBSVFZJIGBhcHBlbmQtdG8tY29udGV4dGAgZW52ZWxvcGUgKEUzIFx1MDBBNzQuMikuIGBjb250ZXh0X2lkYCBvbmx5IHdoZW5cbiAqICBnaXZlbi4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXBwZW5kVG9Db250ZXh0RW52ZWxvcGUoXG4gIHRleHQ6IHN0cmluZyxcbiAgY29udGV4dElkPzogc3RyaW5nLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBjb25zdCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgdGV4dCB9O1xuICBpZiAoY29udGV4dElkICE9PSB1bmRlZmluZWQpIGRhdGEuY29udGV4dF9pZCA9IGNvbnRleHRJZDtcbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgdHlwZTogXCJhcHBlbmQtdG8tY29udGV4dFwiLFxuICAgIGlkOiBgY29udGV4dC0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfWAsXG4gICAgZGF0YSxcbiAgfTtcbn1cblxuLyoqIFRoZSBhZ2VudCdzIGNsaWVudCB0b29sIGNhbGwgb24gdGhlIGRhdGEgY2hhbm5lbCAoYGxsbS1mdW5jdGlvbi1jYWxsYCksXG4gKiAgZGVjb2RlZDsgYG51bGxgIGZvciBldmVyeSBvdGhlciBtZXNzYWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsaWVudFRvb2xDYWxsRnJvbVJ0dmkobXNnOiBSdHZpTWVzc2FnZSk6IHtcbiAgdG9vbE5hbWU6IHN0cmluZztcbiAgdG9vbENhbGxJZDogc3RyaW5nO1xuICBwYXJhbWV0ZXJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXhwZWN0c1Jlc3BvbnNlOiBib29sZWFuO1xuICByZXNwb25zZVRpbWVvdXRTZWNzPzogbnVtYmVyO1xufSB8IG51bGwge1xuICBpZiAobXNnLnR5cGUgIT09IFwibGxtLWZ1bmN0aW9uLWNhbGxcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRhdGEgPSBtc2cuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgY29uc3QgdG9vbE5hbWUgPSBkYXRhPy5mdW5jdGlvbl9uYW1lO1xuICBjb25zdCB0b29sQ2FsbElkID0gZGF0YT8udG9vbF9jYWxsX2lkO1xuICBpZiAodHlwZW9mIHRvb2xOYW1lICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB0b29sQ2FsbElkICE9PSBcInN0cmluZ1wiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXJncyA9IGRhdGE/LmFyZ3M7XG4gIGNvbnN0IHBhcmFtZXRlcnMgPVxuICAgIHR5cGVvZiBhcmdzID09PSBcIm9iamVjdFwiICYmIGFyZ3MgIT09IG51bGwgJiYgIUFycmF5LmlzQXJyYXkoYXJncylcbiAgICAgID8gKGFyZ3MgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICA6IHt9O1xuICBjb25zdCB0aW1lb3V0ID0gZGF0YT8ucmVzcG9uc2VfdGltZW91dF9zZWNzO1xuICByZXR1cm4ge1xuICAgIHRvb2xOYW1lLFxuICAgIHRvb2xDYWxsSWQsXG4gICAgcGFyYW1ldGVycyxcbiAgICAvLyBBYnNlbnQgb24gYSBwcmUtRTMgZW1pdHRlcjogYXNzdW1lIHRoZSBhZ2VudCB3YWl0cyAoc2FmZSBkZWZhdWx0IFx1MjAxNFxuICAgIC8vIGFuIGFuc3dlciBub2JvZHkgd2FpdHMgZm9yIGlzIGRyb3BwZWQgc2lsZW50bHkpLlxuICAgIGV4cGVjdHNSZXNwb25zZTogZGF0YT8uZXhwZWN0c19yZXNwb25zZSAhPT0gZmFsc2UsXG4gICAgLi4uKHR5cGVvZiB0aW1lb3V0ID09PSBcIm51bWJlclwiID8geyByZXNwb25zZVRpbWVvdXRTZWNzOiB0aW1lb3V0IH0gOiB7fSksXG4gIH07XG59XG5cbi8qKiBSVFZJIGB1c2VyLWFjdGl2aXR5YCBlbnZlbG9wZSAoRTIgRC05KS4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVXNlckFjdGl2aXR5RW52ZWxvcGUoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICB0eXBlOiBcInVzZXItYWN0aXZpdHlcIixcbiAgICBpZDogYHVzZXItYWN0aXZpdHktJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICB9O1xufVxuXG4vKiogUlRWSSBgZmVlZGJhY2tgIGVudmVsb3BlIChFNCBRMTYgXHUyMTkyIEUyIEQtMTAgc3RvcmUpLiBFeHBvcnRlZCBmb3IgdGVzdHMuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRGZWVkYmFja0VudmVsb3BlKFxuICBzY29yZTogXCJsaWtlXCIgfCBcImRpc2xpa2VcIiB8IG51bGwsXG4gIGV2ZW50SWQ6IG51bWJlcixcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgdHlwZTogXCJmZWVkYmFja1wiLFxuICAgIGlkOiBgZmVlZGJhY2stJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHsgc2NvcmUsIGV2ZW50X2lkOiBldmVudElkIH0sXG4gIH07XG59XG5cbi8qKiBUaGUgZGVzY3JpcHRvciBrZXlzIGEgdG9rZW4gb2ZmZXIncyBhbnN3ZXIgY2Fycmllcy4gKi9cbmZ1bmN0aW9uIGFuc3dlckRlc2NyaXB0b3IoYW5zd2VyOiBQYXJ0aWFsPFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3I+KTogUGFydGlhbDxWb2ljZVNlc3Npb25EZXNjcmlwdG9yPiB7XG4gIGNvbnN0IHsgc2Vzc2lvbl9pZCwgc2Vzc2lvbl90b2tlbiwgY29udmVyc2F0aW9uX2lkIH0gPSBhbnN3ZXI7XG4gIHJldHVybiB7IHNlc3Npb25faWQsIHNlc3Npb25fdG9rZW4sIGNvbnZlcnNhdGlvbl9pZDogY29udmVyc2F0aW9uX2lkID8/IFwiXCIgfTtcbn1cblxuZnVuY3Rpb24gYWRkVHJhY2VIZWFkZXJzKFxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkLFxuKTogdm9pZCB7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBbXCJ0cmFjZXBhcmVudFwiLCBcInRyYWNlc3RhdGVcIl0gYXMgY29uc3QpIHtcbiAgICBjb25zdCB2YWx1ZSA9IGNvbnRleHQ/LltuYW1lXTtcbiAgICBpZiAodmFsdWUpIGhlYWRlcnNbbmFtZV0gPSB2YWx1ZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkaXNjb25uZWN0VXJsKHNpZ25hbGluZ1VybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzaWduYWxpbmdVcmwpO1xuICB1cmwucGF0aG5hbWUgPSB1cmwucGF0aG5hbWUucmVwbGFjZSgvXFwvYXBpXFwvb2ZmZXJcXC8/JC8sIFwiL2FwaS9kaXNjb25uZWN0XCIpO1xuICB1cmwuc2VhcmNoID0gXCJcIjtcbiAgdXJsLmhhc2ggPSBcIlwiO1xuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbi8qKiBSZXNvbHZlIG9uY2UgSUNFIGdhdGhlcmluZyBjb21wbGV0ZXMsIG9yIGFmdGVyIGEgc2hvcnQgY2FwLiAqL1xuZnVuY3Rpb24gd2FpdEZvckljZUdhdGhlcmluZyhwYzogUlRDUGVlckNvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKHBjLmljZUdhdGhlcmluZ1N0YXRlID09PSBcImNvbXBsZXRlXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgdGltZW91dCA9IHBsYXRmb3JtKCkuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBwYy5yZW1vdmVFdmVudExpc3RlbmVyKFwiaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2VcIiwgY2hlY2spO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0sIDI1MCk7XG4gICAgY29uc3QgY2hlY2sgPSAoKSA9PiB7XG4gICAgICBpZiAocGMuaWNlR2F0aGVyaW5nU3RhdGUgPT09IFwiY29tcGxldGVcIikge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgIHBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZVwiLCBjaGVjayk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZVwiLCBjaGVjayk7XG4gIH0pO1xufVxuXG4vKiogRm9yY2UgYHVzZWR0eD0wO3VzZWluYmFuZGZlYz0xYCBvbnRvIGV2ZXJ5IE9wdXMgbS1saW5lIChzZWUgdGhlXG4gKiAgZGFzaGJvYXJkIGNsaWVudCBmb3IgdGhlIGZ1bGwgcmF0aW9uYWxlOiBEVFggY2xpcHMgcXVpZXQgd29yZCBvbnNldHM7XG4gKiAgRkVDIGxldHMgdGhlIGJyb3dzZXIgcmVjb25zdHJ1Y3QgZHJvcHBlZCBwYWNrZXRzKS4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHR1bmVPcHVzRm10cChzZHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG9wdXNQdHMgPSBbLi4uc2RwLm1hdGNoQWxsKC9eYT1ydHBtYXA6KFxcZCspXFxzK29wdXNcXC9cXGQrL2dpbSldLm1hcCgobSkgPT4gbVsxXSk7XG4gIGlmIChvcHVzUHRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHNkcDtcblxuICBjb25zdCBoYXZlRm10cCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBsaW5lcyA9IHNkcC5zcGxpdCgvXFxyXFxufFxcbi8pO1xuICBjb25zdCBvdXQgPSBsaW5lcy5tYXAoKGxpbmUpID0+IHtcbiAgICBjb25zdCBtID0gbGluZS5tYXRjaCgvXmE9Zm10cDooXFxkKylcXHMrKC4qKSQvaSk7XG4gICAgaWYgKCFtIHx8ICFvcHVzUHRzLmluY2x1ZGVzKG1bMV0pKSByZXR1cm4gbGluZTtcbiAgICBoYXZlRm10cC5hZGQobVsxXSEpO1xuICAgIHJldHVybiBgYT1mbXRwOiR7bVsxXX0gJHt3aXRoT3B1c0RpcmVjdGl2ZXMobVsyXSA/PyBcIlwiKX1gO1xuICB9KTtcblxuICBjb25zdCBtaXNzaW5nID0gb3B1c1B0cy5maWx0ZXIoKHB0KSA9PiBwdCAhPT0gdW5kZWZpbmVkICYmICFoYXZlRm10cC5oYXMocHQpKTtcbiAgaWYgKG1pc3NpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gb3V0LmpvaW4oXCJcXHJcXG5cIik7XG5cbiAgY29uc3Qgd2l0aEZtdHA6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBvdXQpIHtcbiAgICB3aXRoRm10cC5wdXNoKGxpbmUpO1xuICAgIGNvbnN0IHJtID0gbGluZS5tYXRjaCgvXmE9cnRwbWFwOihcXGQrKVxccytvcHVzXFwvXFxkKy9pKTtcbiAgICBpZiAocm0gJiYgbWlzc2luZy5pbmNsdWRlcyhybVsxXSkpIHtcbiAgICAgIHdpdGhGbXRwLnB1c2goYGE9Zm10cDoke3JtWzFdfSB1c2VkdHg9MDt1c2VpbmJhbmRmZWM9MWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gd2l0aEZtdHAuam9pbihcIlxcclxcblwiKTtcbn1cblxuZnVuY3Rpb24gd2l0aE9wdXNEaXJlY3RpdmVzKHBhcmFtczogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG5leHQgPSAvdXNlZHR4PS9pLnRlc3QocGFyYW1zKVxuICAgID8gcGFyYW1zLnJlcGxhY2UoL3VzZWR0eD1cXGQrL2ksIFwidXNlZHR4PTBcIilcbiAgICA6IGAke3BhcmFtc307dXNlZHR4PTBgO1xuICBuZXh0ID0gL3VzZWluYmFuZGZlYz0vaS50ZXN0KG5leHQpXG4gICAgPyBuZXh0LnJlcGxhY2UoL3VzZWluYmFuZGZlYz1cXGQrL2ksIFwidXNlaW5iYW5kZmVjPTFcIilcbiAgICA6IGAke25leHR9O3VzZWluYmFuZGZlYz0xYDtcbiAgcmV0dXJuIG5leHQ7XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsT0FBTyxVQUFVO0FBQ2pCLE9BQU8sWUFBWTtBQUNuQixTQUFTLGNBQWMscUJBQXFCOzs7QUNxQjVDLElBQU0sa0JBQWtCLE9BQWlCO0FBQUEsRUFDdkMsbUJBQW1CLFdBQVc7QUFBQSxFQUM5Qix1QkFBdUIsV0FBVztBQUFBLEVBQ2xDLGNBQWMsTUFBTSxXQUFXLFdBQVc7QUFBQSxFQUMxQyxPQUFPLElBQUksU0FBbUMsV0FBVyxNQUFNLEdBQUcsSUFBSTtBQUFBLEVBQ3RFLFlBQVksQ0FBQyxTQUFTLE9BQU8sV0FBVyxXQUFXLFNBQVMsRUFBRTtBQUNo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RDtBQUNGO0FBRUEsZUFBZSxlQUFlLEdBQTBCO0FBQ3RELFdBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxVQUFVLEdBQUcsS0FBSyxFQUFHLE9BQU0sTUFBTSxDQUFDO0FBQzdELFNBQU8sR0FBRyxXQUFXLEdBQUcsWUFBWSxDQUFDLGlCQUFpQixPQUFPLEVBQUU7QUFDakU7QUFFQSxLQUFLLGtFQUFrRSxZQUFZO0FBSWpGLFNBQU8sRUFBRSxNQUFNLFlBQVksTUFBTSxjQUFjLENBQUM7QUFDaEQsUUFBTSxTQUFTLFVBQVU7QUFDekIsUUFBTSxPQUFPLFFBQVE7QUFDckIsUUFBTSxLQUFLLG1CQUFtQixRQUFRLE9BQU8sS0FBSyxtQ0FBbUM7QUFDckYsS0FBRyxrQkFBa0I7QUFDckIsS0FBRyxLQUFLLHVCQUF1QjtBQUMvQixLQUFHLEdBQUcsS0FBSyxNQUFNO0FBQ2pCLFNBQU8scUJBQXFCO0FBQzVCLFNBQU8sYUFBYSxJQUFJO0FBQ3hCLFNBQU8scUJBQXFCLE1BQU0sTUFBTSxLQUFLO0FBQzdDLFNBQU8sb0JBQW9CLE1BQU0sSUFBSTtBQUNyQyxTQUFPLHFCQUFxQixPQUFPLElBQUk7QUFDdkMsS0FBRyxHQUFHLEtBQUssV0FBVztBQUFBLElBQ3BCLE1BQU0sS0FBSyxVQUFVLEVBQUUsT0FBTyxXQUFXLE1BQU0sY0FBYyxTQUFTLEVBQUUsTUFBTSxjQUFjLEVBQUUsQ0FBQztBQUFBLEVBQ2pHLENBQUM7QUFDRCxRQUFNLGVBQWUsQ0FBQztBQUN0QixRQUFNLE1BQU0sQ0FBQztBQUNiLEtBQUcsR0FBRyxLQUFLLFdBQVc7QUFBQSxJQUNwQixNQUFNLEtBQUssVUFBVTtBQUFBLE1BQ25CLE9BQU87QUFBQSxNQUNQLE1BQU07QUFBQSxNQUNOLE1BQU0sRUFBRSxNQUFNLGlCQUFpQixRQUFRLFdBQVc7QUFBQSxJQUNwRCxDQUFDO0FBQUEsRUFDSCxDQUFDO0FBQ0QsUUFBTSxPQUFPLFdBQVc7QUFHeEIsU0FBTyxFQUFFLE1BQU0sWUFBWSxNQUFNLGFBQWEsQ0FBQztBQUMvQyxRQUFNLFNBQVMsVUFBVTtBQUN6QixRQUFNLE9BQU8sUUFBUTtBQUNyQixRQUFNLE9BQU8sV0FBVztBQUV4QixRQUFNLFNBQVMsR0FBRyxLQUFLLFVBQVUsUUFBUSxNQUFNLENBQUMsQ0FBQztBQUFBO0FBQ2pELFFBQU0sT0FBTyxJQUFJLElBQUksb0NBQW9DLFlBQVksR0FBRztBQUN4RSxNQUFJLFFBQVEsSUFBSSxrQkFBa0IsSUFBSyxlQUFjLE1BQU0sTUFBTTtBQUNqRSxTQUFPLE1BQU0sUUFBUSxhQUFhLE1BQU0sTUFBTSxDQUFDO0FBQ2pELENBQUM7IiwKICAibmFtZXMiOiBbInN0cmVhbSJdCn0K

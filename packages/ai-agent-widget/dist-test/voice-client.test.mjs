// test/voice-client.test.ts
import test from "node:test";
import assert from "node:assert/strict";

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

// test/voice-client.test.ts
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
  send() {
  }
  close() {
    this.readyState = "closed";
  }
};
var FakePeerConnection = class _FakePeerConnection extends FakeTarget {
  constructor() {
    super();
    this.connectionState = "new";
    this.iceGatheringState = "complete";
    this.localDescription = null;
    this.dc = new FakeDataChannel();
    _FakePeerConnection.last = this;
  }
  static {
    this.last = null;
  }
  createDataChannel() {
    return this.dc;
  }
  addTrack() {
  }
  getSenders() {
    return [];
  }
  async createOffer() {
    return { sdp: "v=0\r\n", type: "offer" };
  }
  async setLocalDescription(d) {
    this.localDescription = d;
  }
  async setRemoteDescription() {
  }
  close() {
    this.connectionState = "closed";
  }
};
Reflect.set(globalThis, "RTCPeerConnection", FakePeerConnection);
var fetchCalls = [];
Reflect.set(globalThis, "fetch", async (url) => {
  fetchCalls.push(String(url));
  return {
    ok: true,
    json: async () => ({ sdp: "v=0\r\n", type: "answer", pc_id: "pc-1" })
  };
});
var lastTrack = { stopped: 0, enabled: true, stop() {
} };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async () => {
        const track = {
          stopped: 0,
          enabled: true,
          stop() {
            this.stopped += 1;
          }
        };
        lastTrack = track;
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      }
    }
  }
});
var ENDED = JSON.stringify({
  label: "rtvi-ai",
  type: "server-message",
  data: { type: "session-ended", reason: "end_node" }
});
async function connectedClient() {
  const states = [];
  const errors = [];
  const client = new VoiceClient(
    {
      session_id: "s-1",
      session_token: "tok-1",
      conversation_id: "c-1",
      signaling_url: "http://preview.test/api/offer"
    },
    { onStateChange: (s) => states.push(s), onError: (e) => errors.push(e.message) }
  );
  await client.connect();
  const pc = FakePeerConnection.last ?? assert.fail("connect() built a peer connection");
  pc.connectionState = "connected";
  pc.emit("connectionstatechange");
  return { client, pc, states, errors };
}
test("widget: a peer failure after session-ended is an ordinary end (no error line)", async () => {
  const { client, pc, states, errors } = await connectedClient();
  pc.dc.emit("message", { data: ENDED });
  pc.connectionState = "failed";
  pc.emit("connectionstatechange");
  assert.deepEqual(states, ["connecting", "connected", "disconnected"]);
  assert.deepEqual(errors, []);
  assert.equal(client.getState(), "disconnected");
  assert.equal(pc.connectionState, "closed");
  assert.equal(lastTrack.stopped, 1, "the mic track was stopped");
  const before = fetchCalls.filter((u) => u.includes("/api/disconnect")).length;
  await client.disconnect();
  assert.equal(fetchCalls.filter((u) => u.includes("/api/disconnect")).length, before);
  assert.equal(lastTrack.stopped, 1);
});
test("widget: a user-initiated disconnect without an announcement still POSTs /api/disconnect", async () => {
  const { client } = await connectedClient();
  const before = fetchCalls.filter((u) => u.includes("/api/disconnect")).length;
  await client.disconnect();
  assert.equal(fetchCalls.filter((u) => u.includes("/api/disconnect")).length, before + 1);
  assert.equal(lastTrack.stopped, 1);
});
test("widget: a peer failure with no announcement is still a WebRTC error", async () => {
  const { pc, states, errors } = await connectedClient();
  pc.connectionState = "failed";
  pc.emit("connectionstatechange");
  assert.deepEqual(states, ["connecting", "connected", "error"]);
  assert.deepEqual(errors, ["WebRTC connection failed"]);
});
test("widget: a voso-debug look-alike does not latch the end", async () => {
  const { pc, states, errors } = await connectedClient();
  pc.dc.emit("message", {
    data: JSON.stringify({ label: "voso-debug", type: "server-message", data: { type: "session-ended" } })
  });
  pc.connectionState = "failed";
  pc.emit("connectionstatechange");
  assert.equal(states.at(-1), "error");
  assert.deepEqual(errors, ["WebRTC connection failed"]);
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vdGVzdC92b2ljZS1jbGllbnQudGVzdC50cyIsICIuLi8uLi9haS1hZ2VudC9zcmMvaW50ZXJuYWwvcGxhdGZvcm0udHMiLCAiLi4vLi4vYWktYWdlbnQvc3JjL2ludGVybmFsL3ZvaWNlLWNsaWVudC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHRlc3QgZnJvbSBcIm5vZGU6dGVzdFwiO1xuaW1wb3J0IGFzc2VydCBmcm9tIFwibm9kZTphc3NlcnQvc3RyaWN0XCI7XG5pbXBvcnQgeyBWb2ljZUNsaWVudCB9IGZyb20gXCIuLi9zcmMvdm9pY2VcIjtcblxuLy8gVk9TTy02NTgsIGNsaWVudCBsZXZlbDogdGhlIHJlYWwgVm9pY2VDbGllbnQgd2lyaW5nIHRocm91Z2ggYSBtb2NrZWRcbi8vIFJUQ1BlZXJDb25uZWN0aW9uICsgZGF0YSBjaGFubmVsLiBBIGBzZXNzaW9uLWVuZGVkYCBhbm5vdW5jZW1lbnQgZm9sbG93ZWRcbi8vIGJ5IGEgcGVlciBgZmFpbGVkYCBtdXN0IGVuZCBxdWlldGx5OyBhIGBmYWlsZWRgIHdpdGggbm8gYW5ub3VuY2VtZW50IG11c3Rcbi8vIHN0aWxsIHN1cmZhY2UgXCJXZWJSVEMgY29ubmVjdGlvbiBmYWlsZWRcIi5cblxudHlwZSBMaXN0ZW5lciA9IChldmVudDogdW5rbm93bikgPT4gdm9pZDtcblxuY2xhc3MgRmFrZVRhcmdldCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgbGlzdGVuZXJzID0gbmV3IE1hcDxzdHJpbmcsIExpc3RlbmVyW10+KCk7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogc3RyaW5nLCBmbjogTGlzdGVuZXIpOiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5zZXQodHlwZSwgWy4uLih0aGlzLmxpc3RlbmVycy5nZXQodHlwZSkgPz8gW10pLCBmbl0pO1xuICB9XG4gIHJlbW92ZUV2ZW50TGlzdGVuZXIodHlwZTogc3RyaW5nLCBmbjogTGlzdGVuZXIpOiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlbmVycy5zZXQodHlwZSwgKHRoaXMubGlzdGVuZXJzLmdldCh0eXBlKSA/PyBbXSkuZmlsdGVyKChmKSA9PiBmICE9PSBmbikpO1xuICB9XG4gIGVtaXQodHlwZTogc3RyaW5nLCBldmVudDogdW5rbm93biA9IHt9KTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBmbiBvZiBbLi4uKHRoaXMubGlzdGVuZXJzLmdldCh0eXBlKSA/PyBbXSldKSBmbihldmVudCk7XG4gIH1cbn1cblxuY2xhc3MgRmFrZURhdGFDaGFubmVsIGV4dGVuZHMgRmFrZVRhcmdldCB7XG4gIHJlYWR5U3RhdGUgPSBcIm9wZW5cIjtcbiAgc2VuZCgpOiB2b2lkIHt9XG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwiY2xvc2VkXCI7XG4gIH1cbn1cblxuY2xhc3MgRmFrZVBlZXJDb25uZWN0aW9uIGV4dGVuZHMgRmFrZVRhcmdldCB7XG4gIHN0YXRpYyBsYXN0OiBGYWtlUGVlckNvbm5lY3Rpb24gfCBudWxsID0gbnVsbDtcbiAgY29ubmVjdGlvblN0YXRlID0gXCJuZXdcIjtcbiAgaWNlR2F0aGVyaW5nU3RhdGUgPSBcImNvbXBsZXRlXCI7XG4gIGxvY2FsRGVzY3JpcHRpb246IHsgc2RwOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9IHwgbnVsbCA9IG51bGw7XG4gIHJlYWRvbmx5IGRjID0gbmV3IEZha2VEYXRhQ2hhbm5lbCgpO1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcigpO1xuICAgIEZha2VQZWVyQ29ubmVjdGlvbi5sYXN0ID0gdGhpcztcbiAgfVxuICBjcmVhdGVEYXRhQ2hhbm5lbCgpOiBGYWtlRGF0YUNoYW5uZWwge1xuICAgIHJldHVybiB0aGlzLmRjO1xuICB9XG4gIGFkZFRyYWNrKCk6IHZvaWQge31cbiAgZ2V0U2VuZGVycygpOiB1bmtub3duW10ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuICBhc3luYyBjcmVhdGVPZmZlcigpOiBQcm9taXNlPHsgc2RwOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9PiB7XG4gICAgcmV0dXJuIHsgc2RwOiBcInY9MFxcclxcblwiLCB0eXBlOiBcIm9mZmVyXCIgfTtcbiAgfVxuICBhc3luYyBzZXRMb2NhbERlc2NyaXB0aW9uKGQ6IHsgc2RwOiBzdHJpbmc7IHR5cGU6IHN0cmluZyB9KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sb2NhbERlc2NyaXB0aW9uID0gZDtcbiAgfVxuICBhc3luYyBzZXRSZW1vdGVEZXNjcmlwdGlvbigpOiBQcm9taXNlPHZvaWQ+IHt9XG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIHRoaXMuY29ubmVjdGlvblN0YXRlID0gXCJjbG9zZWRcIjtcbiAgfVxufVxuXG5SZWZsZWN0LnNldChnbG9iYWxUaGlzLCBcIlJUQ1BlZXJDb25uZWN0aW9uXCIsIEZha2VQZWVyQ29ubmVjdGlvbik7XG5jb25zdCBmZXRjaENhbGxzOiBzdHJpbmdbXSA9IFtdO1xuUmVmbGVjdC5zZXQoZ2xvYmFsVGhpcywgXCJmZXRjaFwiLCBhc3luYyAodXJsOiB1bmtub3duKSA9PiB7XG4gIGZldGNoQ2FsbHMucHVzaChTdHJpbmcodXJsKSk7XG4gIHJldHVybiB7XG4gICAgb2s6IHRydWUsXG4gICAganNvbjogYXN5bmMgKCkgPT4gKHsgc2RwOiBcInY9MFxcclxcblwiLCB0eXBlOiBcImFuc3dlclwiLCBwY19pZDogXCJwYy0xXCIgfSksXG4gIH07XG59KTtcbi8qKiBUaGUgbWljIHRyYWNrIHRoZSBtb2NrZWQgZ2V0VXNlck1lZGlhIGhhbmRlZCBvdXQgbGFzdC4gKi9cbmxldCBsYXN0VHJhY2sgPSB7IHN0b3BwZWQ6IDAsIGVuYWJsZWQ6IHRydWUsIHN0b3AoKSB7fSB9O1xuT2JqZWN0LmRlZmluZVByb3BlcnR5KGdsb2JhbFRoaXMsIFwibmF2aWdhdG9yXCIsIHtcbiAgY29uZmlndXJhYmxlOiB0cnVlLFxuICB2YWx1ZToge1xuICAgIG1lZGlhRGV2aWNlczoge1xuICAgICAgZ2V0VXNlck1lZGlhOiBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHRyYWNrID0ge1xuICAgICAgICAgIHN0b3BwZWQ6IDAsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBzdG9wKCkge1xuICAgICAgICAgICAgdGhpcy5zdG9wcGVkICs9IDE7XG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgbGFzdFRyYWNrID0gdHJhY2s7XG4gICAgICAgIHJldHVybiB7IGdldEF1ZGlvVHJhY2tzOiAoKSA9PiBbdHJhY2tdLCBnZXRUcmFja3M6ICgpID0+IFt0cmFja10gfTtcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuXG5jb25zdCBFTkRFRCA9IEpTT04uc3RyaW5naWZ5KHtcbiAgbGFiZWw6IFwicnR2aS1haVwiLFxuICB0eXBlOiBcInNlcnZlci1tZXNzYWdlXCIsXG4gIGRhdGE6IHsgdHlwZTogXCJzZXNzaW9uLWVuZGVkXCIsIHJlYXNvbjogXCJlbmRfbm9kZVwiIH0sXG59KTtcblxuYXN5bmMgZnVuY3Rpb24gY29ubmVjdGVkQ2xpZW50KCkge1xuICBjb25zdCBzdGF0ZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgY2xpZW50ID0gbmV3IFZvaWNlQ2xpZW50KFxuICAgIHtcbiAgICAgIHNlc3Npb25faWQ6IFwicy0xXCIsXG4gICAgICBzZXNzaW9uX3Rva2VuOiBcInRvay0xXCIsXG4gICAgICBjb252ZXJzYXRpb25faWQ6IFwiYy0xXCIsXG4gICAgICBzaWduYWxpbmdfdXJsOiBcImh0dHA6Ly9wcmV2aWV3LnRlc3QvYXBpL29mZmVyXCIsXG4gICAgfSxcbiAgICB7IG9uU3RhdGVDaGFuZ2U6IChzKSA9PiBzdGF0ZXMucHVzaChzKSwgb25FcnJvcjogKGUpID0+IGVycm9ycy5wdXNoKGUubWVzc2FnZSkgfSxcbiAgKTtcbiAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKTtcbiAgY29uc3QgcGMgPSBGYWtlUGVlckNvbm5lY3Rpb24ubGFzdCA/PyBhc3NlcnQuZmFpbChcImNvbm5lY3QoKSBidWlsdCBhIHBlZXIgY29ubmVjdGlvblwiKTtcbiAgcGMuY29ubmVjdGlvblN0YXRlID0gXCJjb25uZWN0ZWRcIjtcbiAgcGMuZW1pdChcImNvbm5lY3Rpb25zdGF0ZWNoYW5nZVwiKTtcbiAgcmV0dXJuIHsgY2xpZW50LCBwYywgc3RhdGVzLCBlcnJvcnMgfTtcbn1cblxudGVzdChcIndpZGdldDogYSBwZWVyIGZhaWx1cmUgYWZ0ZXIgc2Vzc2lvbi1lbmRlZCBpcyBhbiBvcmRpbmFyeSBlbmQgKG5vIGVycm9yIGxpbmUpXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgeyBjbGllbnQsIHBjLCBzdGF0ZXMsIGVycm9ycyB9ID0gYXdhaXQgY29ubmVjdGVkQ2xpZW50KCk7XG4gIHBjLmRjLmVtaXQoXCJtZXNzYWdlXCIsIHsgZGF0YTogRU5ERUQgfSk7XG4gIHBjLmNvbm5lY3Rpb25TdGF0ZSA9IFwiZmFpbGVkXCI7XG4gIHBjLmVtaXQoXCJjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIik7XG4gIGFzc2VydC5kZWVwRXF1YWwoc3RhdGVzLCBbXCJjb25uZWN0aW5nXCIsIFwiY29ubmVjdGVkXCIsIFwiZGlzY29ubmVjdGVkXCJdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChlcnJvcnMsIFtdKTtcbiAgYXNzZXJ0LmVxdWFsKGNsaWVudC5nZXRTdGF0ZSgpLCBcImRpc2Nvbm5lY3RlZFwiKTtcbiAgLy8gUGVlciBBTkQgbWljcm9waG9uZSByZWxlYXNlZCBvbiB0aGUgYW5ub3VuY2VkIGVuZC5cbiAgYXNzZXJ0LmVxdWFsKHBjLmNvbm5lY3Rpb25TdGF0ZSwgXCJjbG9zZWRcIik7XG4gIGFzc2VydC5lcXVhbChsYXN0VHJhY2suc3RvcHBlZCwgMSwgXCJ0aGUgbWljIHRyYWNrIHdhcyBzdG9wcGVkXCIpO1xuICAvLyBUaGUgd2lkZ2V0J3MgZW5kQ2FsbCBzdGlsbCBjYWxscyBkaXNjb25uZWN0KCk6IG5vIC9hcGkvZGlzY29ubmVjdCBQT1NUXG4gIC8vIGFmdGVyIHRoZSB3b3JrZXIncyBvd24gYW5ub3VuY2VtZW50LCBhbmQgdGhlIG1pYyBpcyBub3Qgc3RvcHBlZCB0d2ljZS5cbiAgY29uc3QgYmVmb3JlID0gZmV0Y2hDYWxscy5maWx0ZXIoKHUpID0+IHUuaW5jbHVkZXMoXCIvYXBpL2Rpc2Nvbm5lY3RcIikpLmxlbmd0aDtcbiAgYXdhaXQgY2xpZW50LmRpc2Nvbm5lY3QoKTtcbiAgYXNzZXJ0LmVxdWFsKGZldGNoQ2FsbHMuZmlsdGVyKCh1KSA9PiB1LmluY2x1ZGVzKFwiL2FwaS9kaXNjb25uZWN0XCIpKS5sZW5ndGgsIGJlZm9yZSk7XG4gIGFzc2VydC5lcXVhbChsYXN0VHJhY2suc3RvcHBlZCwgMSk7XG59KTtcblxudGVzdChcIndpZGdldDogYSB1c2VyLWluaXRpYXRlZCBkaXNjb25uZWN0IHdpdGhvdXQgYW4gYW5ub3VuY2VtZW50IHN0aWxsIFBPU1RzIC9hcGkvZGlzY29ubmVjdFwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgY2xpZW50IH0gPSBhd2FpdCBjb25uZWN0ZWRDbGllbnQoKTtcbiAgY29uc3QgYmVmb3JlID0gZmV0Y2hDYWxscy5maWx0ZXIoKHUpID0+IHUuaW5jbHVkZXMoXCIvYXBpL2Rpc2Nvbm5lY3RcIikpLmxlbmd0aDtcbiAgYXdhaXQgY2xpZW50LmRpc2Nvbm5lY3QoKTtcbiAgYXNzZXJ0LmVxdWFsKGZldGNoQ2FsbHMuZmlsdGVyKCh1KSA9PiB1LmluY2x1ZGVzKFwiL2FwaS9kaXNjb25uZWN0XCIpKS5sZW5ndGgsIGJlZm9yZSArIDEpO1xuICBhc3NlcnQuZXF1YWwobGFzdFRyYWNrLnN0b3BwZWQsIDEpO1xufSk7XG5cbnRlc3QoXCJ3aWRnZXQ6IGEgcGVlciBmYWlsdXJlIHdpdGggbm8gYW5ub3VuY2VtZW50IGlzIHN0aWxsIGEgV2ViUlRDIGVycm9yXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgeyBwYywgc3RhdGVzLCBlcnJvcnMgfSA9IGF3YWl0IGNvbm5lY3RlZENsaWVudCgpO1xuICBwYy5jb25uZWN0aW9uU3RhdGUgPSBcImZhaWxlZFwiO1xuICBwYy5lbWl0KFwiY29ubmVjdGlvbnN0YXRlY2hhbmdlXCIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKHN0YXRlcywgW1wiY29ubmVjdGluZ1wiLCBcImNvbm5lY3RlZFwiLCBcImVycm9yXCJdKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChlcnJvcnMsIFtcIldlYlJUQyBjb25uZWN0aW9uIGZhaWxlZFwiXSk7XG59KTtcblxudGVzdChcIndpZGdldDogYSB2b3NvLWRlYnVnIGxvb2stYWxpa2UgZG9lcyBub3QgbGF0Y2ggdGhlIGVuZFwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgcGMsIHN0YXRlcywgZXJyb3JzIH0gPSBhd2FpdCBjb25uZWN0ZWRDbGllbnQoKTtcbiAgcGMuZGMuZW1pdChcIm1lc3NhZ2VcIiwge1xuICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHsgbGFiZWw6IFwidm9zby1kZWJ1Z1wiLCB0eXBlOiBcInNlcnZlci1tZXNzYWdlXCIsIGRhdGE6IHsgdHlwZTogXCJzZXNzaW9uLWVuZGVkXCIgfSB9KSxcbiAgfSk7XG4gIHBjLmNvbm5lY3Rpb25TdGF0ZSA9IFwiZmFpbGVkXCI7XG4gIHBjLmVtaXQoXCJjb25uZWN0aW9uc3RhdGVjaGFuZ2VcIik7XG4gIGFzc2VydC5lcXVhbChzdGF0ZXMuYXQoLTEpLCBcImVycm9yXCIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGVycm9ycywgW1wiV2ViUlRDIGNvbm5lY3Rpb24gZmFpbGVkXCJdKTtcbn0pO1xuIiwgIi8vIFBsdWdnYWJsZSBwbGF0Zm9ybSBnbG9iYWxzIChFNCBwbGFuIFx1MDBBNzQuMykuIFRoZSBicm93c2VyIGRlZmF1bHRzIEFSRSB0aGVcbi8vIGdsb2JhbHMsIHJlYWQgYXQgY2FsbCB0aW1lIChuZXZlciBjYXB0dXJlZCBhdCBpbXBvcnQpLCBzbyB0aGUgYnJvd3NlclxuLy8gYnVpbGQgaXMgYmVoYXZpb3VyLWlkZW50aWNhbCB0byB0aGUgd2lkZ2V0J3Mgb3JpZ2luYWwgdm9pY2UudHM7IHRoZSBSZWFjdFxuLy8gTmF0aXZlIHBhY2thZ2UgY2FsbHMgYHNldFBsYXRmb3JtYCB3aXRoIHJlYWN0LW5hdGl2ZS13ZWJydGMncyBjbGFzc2VzLlxuaW1wb3J0IHR5cGUgeyBWb2x1bWVQcm92aWRlciB9IGZyb20gXCIuL3ZvbHVtZS1wcm92aWRlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFBsYXRmb3JtIHtcbiAgUlRDUGVlckNvbm5lY3Rpb246IHR5cGVvZiBSVENQZWVyQ29ubmVjdGlvbjtcbiAgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uPzogdHlwZW9mIFJUQ1Nlc3Npb25EZXNjcmlwdGlvbjtcbiAgbWVkaWFEZXZpY2VzOiAoKSA9PiBNZWRpYURldmljZXMgfCB1bmRlZmluZWQ7XG4gIGZldGNoOiB0eXBlb2YgZmV0Y2g7XG4gIHNldFRpbWVvdXQ6IChoYW5kbGVyOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBnbG9iYWxUaGlzLnNldFRpbWVvdXQ+O1xuICAvKiogYGNsaWVudC1yZWFkeS5hYm91dC5wbGF0Zm9ybWAgKEU0IHBsYW4gXHUwMEE3NC42KS4gRGVmYXVsdCBgXCJ3ZWJcImAuICovXG4gIG5hbWU/OiBcIndlYlwiIHwgXCJyZWFjdC1uYXRpdmVcIiB8IFwibm9kZVwiO1xuICAvKiogVm9sdW1lIC8gZnJlcXVlbmN5IHJlYWRzIGZvciBhIHN0cmVhbSAoUTIwKS4gRGVmYXVsdDogYW4gQW5hbHlzZXJOb2RlXG4gICAqICB3aGVyZSBXZWIgQXVkaW8gZXhpc3RzOyBSZWFjdCBOYXRpdmUgcGx1Z3MgYSBuby1vcCBwcm92aWRlci4gKi9cbiAgdm9sdW1lUHJvdmlkZXI/OiAoc3RyZWFtOiBNZWRpYVN0cmVhbSkgPT4gVm9sdW1lUHJvdmlkZXI7XG4gIC8qKiBOYXRpdmUgYXVkaW8gc2Vzc2lvbiBhcm91bmQgYSB2b2ljZSBzZXNzaW9uIChSZWFjdCBOYXRpdmU6IHNwZWFrZXJcbiAgICogIHJvdXRpbmcpLiBgc3RhcnRgIGJlZm9yZSBjb25uZWN0aW5nOyBgc3RvcGAgb24gZXZlcnkgZW5kIEFORCBvbiBhXG4gICAqICBmYWlsZWQgY29ubmVjdC4gRGVmYXVsdDogbm9uZS4gKi9cbiAgYXVkaW9TZXNzaW9uPzogeyBzdGFydCgpOiB2b2lkOyBzdG9wKCk6IHZvaWQgfTtcbn1cblxuY29uc3QgYnJvd3NlckRlZmF1bHRzID0gKCk6IFBsYXRmb3JtID0+ICh7XG4gIFJUQ1BlZXJDb25uZWN0aW9uOiBnbG9iYWxUaGlzLlJUQ1BlZXJDb25uZWN0aW9uLFxuICBSVENTZXNzaW9uRGVzY3JpcHRpb246IGdsb2JhbFRoaXMuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uLFxuICBtZWRpYURldmljZXM6ICgpID0+IGdsb2JhbFRoaXMubmF2aWdhdG9yPy5tZWRpYURldmljZXMsXG4gIGZldGNoOiAoLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2YgZmV0Y2g+KSA9PiBnbG9iYWxUaGlzLmZldGNoKC4uLmFyZ3MpLFxuICBzZXRUaW1lb3V0OiAoaGFuZGxlciwgbXMpID0+IGdsb2JhbFRoaXMuc2V0VGltZW91dChoYW5kbGVyLCBtcyksXG59KTtcblxubGV0IG92ZXJyaWRlczogUGFydGlhbDxQbGF0Zm9ybT4gPSB7fTtcblxuLyoqIFJlcGxhY2Ugc29tZSBwbGF0Zm9ybSBnbG9iYWxzIChSZWFjdCBOYXRpdmU6IHJlYWN0LW5hdGl2ZS13ZWJydGMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldFBsYXRmb3JtKG5leHQ6IFBhcnRpYWw8UGxhdGZvcm0+KTogdm9pZCB7XG4gIG92ZXJyaWRlcyA9IHsgLi4ub3ZlcnJpZGVzLCAuLi5uZXh0IH07XG59XG5cbi8qKiBUaGUgZWZmZWN0aXZlIHBsYXRmb3JtOiBicm93c2VyIGdsb2JhbHMgKHJlYWQgbm93KSArIGFueSBvdmVycmlkZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcGxhdGZvcm0oKTogUGxhdGZvcm0ge1xuICByZXR1cm4geyAuLi5icm93c2VyRGVmYXVsdHMoKSwgLi4ub3ZlcnJpZGVzIH07XG59XG5cbi8qKlxuICogTWljcm9waG9uZSBjYXB0dXJlIHByb2ZpbGUgKFEyMSwgc3RhdGVkIGluIGV2ZXJ5IFJFQURNRSk6IGVjaG9cbiAqIGNhbmNlbGxhdGlvbiBPTiAoc3RvcHMgYWdlbnQgVFRTIGVjaG9pbmcgaW50byB0aGUgbWljKTsgYnJvd3NlciBub2lzZVxuICogc3VwcHJlc3Npb24gYW5kIGF1dG9tYXRpYyBnYWluIGNvbnRyb2wgT0ZGIFx1MjAxNCB0aGUgc2FtZSBwcm9maWxlIGFzIHRoZVxuICogZGFzaGJvYXJkIHByZXZpZXcuXG4gKi9cbmV4cG9ydCBjb25zdCBNSUNfQ09OU1RSQUlOVFMgPSB7XG4gIGF1ZGlvOiB7IGVjaG9DYW5jZWxsYXRpb246IHRydWUsIG5vaXNlU3VwcHJlc3Npb246IGZhbHNlLCBhdXRvR2FpbkNvbnRyb2w6IGZhbHNlIH0sXG4gIHZpZGVvOiBmYWxzZSxcbn0gYXMgY29uc3Q7XG4iLCAiLy8gU21hbGxXZWJSVEMgdm9pY2UgY2xpZW50IGZvciB0aGUgd2lkZ2V0IFx1MjAxNCBhIHRyaW1tZWQsIGRlcGVuZGVuY3ktZnJlZVxuLy8gYWRhcHRhdGlvbiBvZiB0aGUgZGFzaGJvYXJkJ3MgYGZyb250ZW5kL3NyYy9saWIvcGlwZWNhdC9jbGllbnQudHNgXG4vLyAoc2FtZSBzaWduYWxpbmcgaGFuZHNoYWtlLCBPcHVzIGZtdHAgdHVuaW5nLCBSVFZJIGNsaWVudC1yZWFkeSBsYXRjaCxcbi8vIGFuZCByZW5lZ290aWF0aW9uIGhhbmRsaW5nKSwgbWludXMgZGFzaGJvYXJkIGF1dGgvdGVuYW50IGhlYWRlcnM6IHRoZVxuLy8gd2lkZ2V0J3Mgc2lnbmFsaW5nIGNhcGFiaWxpdHkgSVMgdGhlIHVuZ3Vlc3NhYmxlIGBzZXNzaW9uX2lkYCBtaW50ZWQgYnlcbi8vIHRoZSBwdWJsaWMgc2Vzc2lvbiBlbmRwb2ludC5cblxuaW1wb3J0IHR5cGUgeyBWb2ljZVNlc3Npb25EZXNjcmlwdG9yIH0gZnJvbSBcIi4vd2lkZ2V0LWFwaVwiO1xuaW1wb3J0IHsgTUlDX0NPTlNUUkFJTlRTLCBwbGF0Zm9ybSB9IGZyb20gXCIuL3BsYXRmb3JtXCI7XG5cbmV4cG9ydCB0eXBlIFZvaWNlU3RhdGUgPSBcImlkbGVcIiB8IFwiY29ubmVjdGluZ1wiIHwgXCJjb25uZWN0ZWRcIiB8IFwiZGlzY29ubmVjdGVkXCIgfCBcImVycm9yXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnR2aU1lc3NhZ2Uge1xuICBsYWJlbD86IHN0cmluZztcbiAgdHlwZTogc3RyaW5nO1xuICBkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gJiB7XG4gICAgdGV4dD86IHN0cmluZztcbiAgICBmaW5hbD86IGJvb2xlYW47XG4gICAgc3Bva2VuPzogYm9vbGVhbjtcbiAgICBhZ2dyZWdhdGVkX2J5Pzogc3RyaW5nO1xuICB9O1xuICBtZXNzYWdlPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gJiB7IHR5cGU/OiBzdHJpbmcgfTtcbiAgW2tleTogc3RyaW5nXTogdW5rbm93bjtcbn1cblxuLyoqIFJvbGUgZGVyaXZlZCBmcm9tIGFuIFJUVkkgbWVzc2FnZSB0eXBlOyBudWxsIGZvciBub24tdHJhbnNjcmlwdCBmcmFtZXMuICovXG5leHBvcnQgZnVuY3Rpb24gdHJhbnNjcmlwdFJvbGUobXNnOiBSdHZpTWVzc2FnZSk6IFwiYWdlbnRcIiB8IFwidXNlclwiIHwgbnVsbCB7XG4gIHN3aXRjaCAobXNnLnR5cGUpIHtcbiAgICBjYXNlIFwiYm90LXRyYW5zY3JpcHRpb25cIjpcbiAgICBjYXNlIFwiYm90LWxsbS10ZXh0XCI6XG4gICAgY2FzZSBcImJvdC10dHMtdGV4dFwiOlxuICAgIGNhc2UgXCJib3Qtb3V0cHV0XCI6XG4gICAgICByZXR1cm4gXCJhZ2VudFwiO1xuICAgIGNhc2UgXCJ1c2VyLXRyYW5zY3JpcHRpb25cIjpcbiAgICAgIHJldHVybiBcInVzZXJcIjtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuLyoqXG4gKiBXaGV0aGVyIGEgZnJhbWUgc2hvdWxkIGFwcGVuZCB0byB0aGUgdmlzaWJsZSB0cmFuc2NyaXB0LiBNaXJyb3JzIHRoZVxuICogZGFzaGJvYXJkJ3MgZGVkdXBlIHJ1bGU6IHRoZSBiYWNrZW5kIGVtaXRzIHNldmVyYWwgb3ZlcmxhcHBpbmcgYWdlbnRcbiAqIHN0cmVhbXMgZm9yIG9uZSB1dHRlcmFuY2U7IE9OTFkgdGhlIHNwb2tlbiBzZW50ZW5jZS1hZ2dyZWdhdGVkXG4gKiBgYm90LW91dHB1dGAgZmlyZXMgZXhhY3RseSBvbmNlIHBlciBzcG9rZW4gc2VudGVuY2UgKGdyZWV0aW5nIGluY2x1ZGVkKS5cbiAqIFVzZXIgc2lkZTogZmluYWwgdHJhbnNjcmlwdGlvbnMgb25seS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUmVuZGVyYWJsZVRyYW5zY3JpcHQobXNnOiBSdHZpTWVzc2FnZSk6IGJvb2xlYW4ge1xuICBjb25zdCByb2xlID0gdHJhbnNjcmlwdFJvbGUobXNnKTtcbiAgaWYgKCFyb2xlKSByZXR1cm4gZmFsc2U7XG4gIGlmIChyb2xlID09PSBcImFnZW50XCIpIHtcbiAgICByZXR1cm4gKFxuICAgICAgbXNnLnR5cGUgPT09IFwiYm90LW91dHB1dFwiICYmXG4gICAgICBtc2cuZGF0YT8uc3Bva2VuID09PSB0cnVlICYmXG4gICAgICBtc2cuZGF0YT8uYWdncmVnYXRlZF9ieSA9PT0gXCJzZW50ZW5jZVwiXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbXNnLmRhdGE/LmZpbmFsID09PSB0cnVlO1xufVxuXG4vKiogYGRhdGEudHlwZWAgb2YgdGhlIHdvcmtlcidzIGVuZC1vZi1zZXNzaW9uIGFubm91bmNlbWVudCAoVk9TTy02NTgpLiAqL1xuZXhwb3J0IGNvbnN0IFNFU1NJT05fRU5ERURfTUVTU0FHRV9UWVBFID0gXCJzZXNzaW9uLWVuZGVkXCI7XG5cbi8qKlxuICogVHJ1ZSB3aGVuIGBtc2dgIGlzIHRoZSB3b3JrZXIgYW5ub3VuY2luZyB0aGF0IGl0IGVuZGVkIHRoZSBzZXNzaW9uIG9uXG4gKiBwdXJwb3NlIFx1MjAxNCB0aGUgUlRWSSBgc2VydmVyLW1lc3NhZ2VgIGl0IHdyaXRlcyByaWdodCBiZWZvcmUgaXQgY2xvc2VzIHRoZVxuICogcGVlciBvbiBpdHMgZ3JhY2VmdWwgZW5kIHBhdGggKEVuZCBub2RlLCBgZW5kX2NhbGxgLCBjYWxsZWUgc2NyZWVuKS5cbiAqIE1pcnJvcnMgYGZyb250ZW5kL3NyYy9saWIvcGlwZWNhdC9zZXNzaW9uLWVuZC50c2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1Nlc3Npb25FbmRlZE1lc3NhZ2UobXNnOiB7XG4gIGxhYmVsPzogdW5rbm93bjtcbiAgdHlwZT86IHVua25vd247XG4gIGRhdGE/OiB1bmtub3duO1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xufSk6IGJvb2xlYW4ge1xuICAvLyBSVFZJIG9ubHk6IGB2b3NvLWRlYnVnYCBlbnZlbG9wZXMgc2hhcmUgdGhpcyBkYXRhIGNoYW5uZWwgYW5kIG11c3RcbiAgLy8gbmV2ZXIgbGF0Y2ggYW4gZW5kICh0aGF0IHdvdWxkIGhpZGUgYSBnZW51aW5lIHRyYW5zcG9ydCBmYWlsdXJlKS5cbiAgaWYgKG1zZy5sYWJlbCAhPT0gXCJydHZpLWFpXCIgfHwgbXNnLnR5cGUgIT09IFwic2VydmVyLW1lc3NhZ2VcIikgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBkYXRhID0gbXNnLmRhdGE7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiZcbiAgICBkYXRhICE9PSBudWxsICYmXG4gICAgKGRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pLnR5cGUgPT09IFNFU1NJT05fRU5ERURfTUVTU0FHRV9UWVBFXG4gICk7XG59XG5cbi8qKiBgZGF0YS50eXBlYCBvZiB0aGUgUlRWSSBgc2VydmVyLW1lc3NhZ2VgIHR3aW4gb2YgdGhlIHZlbmRvcidzXG4gKiAgYHF1ZXVlX3N0YXR1c2AgZXZlbnQgKGFnZW50LWludGVncmF0aW9uIEU3IFx1MDBBNzQuMykuICovXG5leHBvcnQgY29uc3QgUVVFVUVfU1RBVFVTX01FU1NBR0VfVFlQRSA9IFwicXVldWVfc3RhdHVzXCI7XG4vKiogYHNlc3Npb24tZW5kZWQucmVhc29uYCBhZnRlciBhIHdhaXQgdGhhdCB0aW1lZCBvdXQuICovXG5leHBvcnQgY29uc3QgUVVFVUVfVElNRU9VVF9SRUFTT04gPSBcInF1ZXVlX3RpbWVvdXRcIjtcblxuLyoqXG4gKiBUaGUgcXVldWUgdHJhbnNpdGlvbiBhbiBSVFZJIGVudmVsb3BlIGNhcnJpZXMsIGlmIGFueTogYFwid2FpdGluZ1wiYCxcbiAqIGBcImFkbWl0dGVkXCJgIG9yIGBcInRpbWVkX291dFwiYCBmcm9tIGBzZXJ2ZXItbWVzc2FnZSB7dHlwZTogXCJxdWV1ZV9zdGF0dXNcIixcbiAqIHN0YXR1c31gOyBgXCJ0aW1lZF9vdXRcImAgYWxzbyBmcm9tIGBzZXNzaW9uLWVuZGVkIHtyZWFzb246IFwicXVldWVfdGltZW91dFwifWAuXG4gKiBBbnl0aGluZyBlbHNlIChvdGhlciBlbnZlbG9wZXMsIGEgZm9yZWlnbiBsYWJlbCkgaXMgYG51bGxgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcXVldWVUcmFuc2l0aW9uKG1zZzoge1xuICBsYWJlbD86IHVua25vd247XG4gIHR5cGU/OiB1bmtub3duO1xuICBkYXRhPzogdW5rbm93bjtcbn0pOiBcIndhaXRpbmdcIiB8IFwiYWRtaXR0ZWRcIiB8IFwidGltZWRfb3V0XCIgfCBudWxsIHtcbiAgaWYgKG1zZy5sYWJlbCAhPT0gXCJydHZpLWFpXCIgfHwgbXNnLnR5cGUgIT09IFwic2VydmVyLW1lc3NhZ2VcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRhdGEgPSBtc2cuZGF0YTtcbiAgaWYgKHR5cGVvZiBkYXRhICE9PSBcIm9iamVjdFwiIHx8IGRhdGEgPT09IG51bGwpIHJldHVybiBudWxsO1xuICBjb25zdCByZWNvcmQgPSBkYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAocmVjb3JkLnR5cGUgPT09IFFVRVVFX1NUQVRVU19NRVNTQUdFX1RZUEUpIHtcbiAgICBjb25zdCBzdGF0dXMgPSByZWNvcmQuc3RhdHVzO1xuICAgIGlmIChzdGF0dXMgPT09IFwid2FpdGluZ1wiIHx8IHN0YXR1cyA9PT0gXCJhZG1pdHRlZFwiIHx8IHN0YXR1cyA9PT0gXCJ0aW1lZF9vdXRcIikgcmV0dXJuIHN0YXR1cztcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAocmVjb3JkLnR5cGUgPT09IFwic2Vzc2lvbi1lbmRlZFwiICYmIHJlY29yZC5yZWFzb24gPT09IFFVRVVFX1RJTUVPVVRfUkVBU09OKSB7XG4gICAgcmV0dXJuIFwidGltZWRfb3V0XCI7XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKlxuICogVGVybWluYWwgc3RhdGUgZm9yIGFuIFJUQ1BlZXJDb25uZWN0aW9uIGBmYWlsZWRgOiBhZnRlciB0aGUgd29ya2VyJ3Mgb3duXG4gKiBlbmQgYW5ub3VuY2VtZW50IGl0IGlzIHRoZSBEVExTIGNsb3NlIG9mIGEgc2Vzc2lvbiB0aGF0IGVuZGVkIG9uIHB1cnBvc2VcbiAqIChhbiBvcmRpbmFyeSBcImRpc2Nvbm5lY3RlZFwiKTsgd2l0aCBubyBhbm5vdW5jZW1lbnQgaXQgaXMgYSByZWFsIGVycm9yLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGVlckZhaWx1cmVTdGF0ZShzZXJ2ZXJFbmRlZDogYm9vbGVhbik6IFwiZGlzY29ubmVjdGVkXCIgfCBcImVycm9yXCIge1xuICByZXR1cm4gc2VydmVyRW5kZWQgPyBcImRpc2Nvbm5lY3RlZFwiIDogXCJlcnJvclwiO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFZvaWNlQ2xpZW50T3B0aW9ucyB7XG4gIG9uU3RhdGVDaGFuZ2U/OiAoc3RhdGU6IFZvaWNlU3RhdGUpID0+IHZvaWQ7XG4gIG9uUmVtb3RlQXVkaW8/OiAoc3RyZWFtOiBNZWRpYVN0cmVhbSkgPT4gdm9pZDtcbiAgb25BcHBNZXNzYWdlPzogKG1zZzogUnR2aU1lc3NhZ2UpID0+IHZvaWQ7XG4gIG9uRXJyb3I/OiAoZXJyOiBFcnJvcikgPT4gdm9pZDtcbn1cblxuZXhwb3J0IGNsYXNzIFZvaWNlQ2xpZW50IHtcbiAgLyoqIFRoZSB3b3JrZXIgYW5ub3VuY2VkIGl0IGVuZGVkIHRoZSBzZXNzaW9uIG9uIHB1cnBvc2UgKHNlZSBgaXNTZXNzaW9uRW5kZWRNZXNzYWdlYCkuICovXG4gIHByaXZhdGUgc2VydmVyRW5kZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBwYzogUlRDUGVlckNvbm5lY3Rpb24gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBkYzogUlRDRGF0YUNoYW5uZWwgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsb2NhbFN0cmVhbTogTWVkaWFTdHJlYW0gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwY0lkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0ZTogVm9pY2VTdGF0ZSA9IFwiaWRsZVwiO1xuICBwcml2YXRlIGRpc3Bvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgYXVkaW9SZW5kZXJpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBjbGllbnRSZWFkeVNlbnQgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcm90ZWN0ZWQgcmVhZG9ubHkgc2Vzc2lvbjogVm9pY2VTZXNzaW9uRGVzY3JpcHRvcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdHM6IFZvaWNlQ2xpZW50T3B0aW9ucyxcbiAgKSB7fVxuXG4gIC8qKlxuICAgKiBBIGNsaWVudCB0aGF0IHJlZGVlbXMgYSBjb252ZXJzYXRpb24gdG9rZW4gKGBHRVRcbiAgICogL3YxL2NvbnZhaS9jb252ZXJzYXRpb24vdG9rZW5gLCBFMiBELTQgLyBFNCBRNikgaW5zdGVhZCBvZiBhIG1pbnRlZFxuICAgKiBzZXNzaW9uOiB0aGUgZmlyc3Qgb2ZmZXIgY2FycmllcyBgY29udmVyc2F0aW9uX3Rva2VuYCwgYW5kIHRoZSBhbnN3ZXInc1xuICAgKiBzZXNzaW9uIGRlc2NyaXB0b3IgKGBzZXNzaW9uX2lkYCwgdGhlIGRpc2Nvbm5lY3QgcHJvb2YsIGBjb252ZXJzYXRpb25faWRgKVxuICAgKiBpcyBhZG9wdGVkIGJlZm9yZSBhbnl0aGluZyBlbHNlIHVzZXMgaXQuIEluc2lkZSAxNSBtaW51dGVzIHRoZSBzYW1lIHRva2VuXG4gICAqIHJlLWpvaW5zIHRoZSBzYW1lIGNvbnZlcnNhdGlvbiAoUTI5KS5cbiAgICovXG4gIHN0YXRpYyBmcm9tQ29udmVyc2F0aW9uVG9rZW48VCBleHRlbmRzIFZvaWNlQ2xpZW50PihcbiAgICB0aGlzOiBuZXcgKHNlc3Npb246IFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3IsIG9wdHM6IFZvaWNlQ2xpZW50T3B0aW9ucykgPT4gVCxcbiAgICB0b2tlbjogc3RyaW5nLFxuICAgIHdoZXJlOiB7IHNpZ25hbGluZ1VybDogc3RyaW5nOyBpY2VTZXJ2ZXJzPzogVm9pY2VTZXNzaW9uRGVzY3JpcHRvcltcImljZV9zZXJ2ZXJzXCJdIH0sXG4gICAgb3B0czogVm9pY2VDbGllbnRPcHRpb25zLFxuICApOiBUIHtcbiAgICByZXR1cm4gbmV3IHRoaXMoXG4gICAgICB7XG4gICAgICAgIHNlc3Npb25faWQ6IFwiXCIsXG4gICAgICAgIGNvbnZlcnNhdGlvbl9pZDogXCJcIixcbiAgICAgICAgc2lnbmFsaW5nX3VybDogd2hlcmUuc2lnbmFsaW5nVXJsLFxuICAgICAgICBpY2Vfc2VydmVyczogd2hlcmUuaWNlU2VydmVycyxcbiAgICAgICAgY29udmVyc2F0aW9uX3Rva2VuOiB0b2tlbixcbiAgICAgIH0sXG4gICAgICBvcHRzLFxuICAgICk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgUHJvdGVjdGVkIGV4dGVuc2lvbiBwb2ludHMgKEU0IFExMikgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gIC8vIEV2ZXJ5IGRlZmF1bHQgcmVwcm9kdWNlcyB0aGUgd2lkZ2V0J3MgYmVoYXZpb3VyIGJ5dGUtZm9yLWJ5dGUgKHRoZVxuICAvLyBnb2xkZW4gYXVkaW8tcGF0aCB0ZXN0KS4gU3RhZmYtb25seSBiZWhhdmlvdXIgKGRhc2hib2FyZCBhdXRoIGhlYWRlcnMsXG4gIC8vIHJlY2VpdmUtb25seSBsaXN0ZW4taW4sIFx1MjAyNikgbGl2ZXMgaW4gYSBzdWJjbGFzcyBPVVRTSURFIHRoaXMgcGFja2FnZS5cblxuICAvKiogSGVhZGVycyBhZGRlZCB0byB0aGUgb2ZmZXIgUE9TVCBhZnRlciBDb250ZW50LVR5cGUsIGJlZm9yZSB0aGUgdHJhY2UgaGVhZGVycy4gKi9cbiAgcHJvdGVjdGVkIGV4dHJhT2ZmZXJIZWFkZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIC8qKiBIZWFkZXJzIG9mIHRoZSBkaXNjb25uZWN0IFBPU1QuICovXG4gIHByb3RlY3RlZCBkaXNjb25uZWN0SGVhZGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICByZXR1cm4geyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9O1xuICB9XG5cbiAgLyoqIFdoZXJlIHRoZSBkaXNjb25uZWN0IFBPU1QgZ29lcy4gKi9cbiAgcHJvdGVjdGVkIGRpc2Nvbm5lY3RFbmRwb2ludCgpOiBzdHJpbmcge1xuICAgIHJldHVybiBkaXNjb25uZWN0VXJsKHRoaXMuc2Vzc2lvbi5zaWduYWxpbmdfdXJsKTtcbiAgfVxuXG4gIC8qKiBCb2R5IG9mIHRoZSBkaXNjb25uZWN0IFBPU1QgXHUyMDE0IHRoZSBvd25lcnNoaXAgcHJvb2YgKFZPU08tMTkxKS4gKi9cbiAgcHJvdGVjdGVkIGRpc2Nvbm5lY3RCb2R5KCk6IHsgc2Vzc2lvbl9pZDogc3RyaW5nOyBzZXNzaW9uX3Rva2VuPzogc3RyaW5nIH0ge1xuICAgIHJldHVybiB7IHNlc3Npb25faWQ6IHRoaXMuc2Vzc2lvbi5zZXNzaW9uX2lkLCBzZXNzaW9uX3Rva2VuOiB0aGlzLnNlc3Npb24uc2Vzc2lvbl90b2tlbiB9O1xuICB9XG5cbiAgLyoqIENvbnNvbGUgdGV4dCB3aGVuIHRoZSBkaXNjb25uZWN0IFBPU1QgaXMgc2tpcHBlZCAobm8gdG9rZW4pIG9yIHJlamVjdGVkLiAqL1xuICBwcm90ZWN0ZWQgZGlzY29ubmVjdFdhcm5pbmcoa2luZDogXCJza2lwcGVkXCIgfCBcInJlamVjdGVkXCIsIHN0YXR1cz86IG51bWJlcik6IHN0cmluZyB7XG4gICAgcmV0dXJuIGtpbmQgPT09IFwic2tpcHBlZFwiXG4gICAgICA/IFwiV2lkZ2V0IHZvaWNlIGRpc2Nvbm5lY3Qgc2tpcHBlZDogbm8gc2Vzc2lvbl90b2tlblwiXG4gICAgICA6IGBXaWRnZXQgdm9pY2UgZGlzY29ubmVjdCByZWplY3RlZDogJHtzdGF0dXN9YDtcbiAgfVxuXG4gIC8qKiBUaGUgZXJyb3IgYSBub24tMnh4IHNpZ25hbGluZyBhbnN3ZXIgcmFpc2VzLiAqL1xuICBwcm90ZWN0ZWQgc2lnbmFsaW5nRmFpbHVyZShzdGF0dXM6IG51bWJlciwgc3RhdHVzVGV4dDogc3RyaW5nLCBib2R5OiB1bmtub3duKTogRXJyb3Ige1xuICAgIGNvbnN0IGRldGFpbCA9XG4gICAgICBib2R5ICYmIHR5cGVvZiBib2R5ID09PSBcIm9iamVjdFwiICYmIHR5cGVvZiAoYm9keSBhcyB7IGRldGFpbD86IHVua25vd24gfSkuZGV0YWlsID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gKGJvZHkgYXMgeyBkZXRhaWw6IHN0cmluZyB9KS5kZXRhaWxcbiAgICAgICAgOiBzdGF0dXNUZXh0O1xuICAgIHJldHVybiBuZXcgRXJyb3IoYFNpZ25hbGluZyBmYWlsZWQgKCR7c3RhdHVzfSk6ICR7ZGV0YWlsfWApO1xuICB9XG5cbiAgLyoqIFRoZSBsb2NhbCBjYXB0dXJlIHRvIHB1Ymxpc2g7IGBudWxsYCBwdWJsaXNoZXMgbm90aGluZy4gKi9cbiAgcHJvdGVjdGVkIGFzeW5jIGxvY2FsTWVkaWEoKTogUHJvbWlzZTxNZWRpYVN0cmVhbSB8IG51bGw+IHtcbiAgICByZXR1cm4gKHBsYXRmb3JtKCkubWVkaWFEZXZpY2VzKCkgYXMgTWVkaWFEZXZpY2VzKS5nZXRVc2VyTWVkaWEoTUlDX0NPTlNUUkFJTlRTKTtcbiAgfVxuXG4gIC8qKiBBdHRhY2ggdGhlIGxvY2FsIGNhcHR1cmUgKG9yIGEgcmVjZWl2ZSBwYXRoKSB0byB0aGUgcGVlciBiZWZvcmUgdGhlIG9mZmVyLiAqL1xuICBwcm90ZWN0ZWQgY29uZmlndXJlVHJhbnNjZWl2ZXJzKHBjOiBSVENQZWVyQ29ubmVjdGlvbiwgc3RyZWFtOiBNZWRpYVN0cmVhbSB8IG51bGwpOiB2b2lkIHtcbiAgICBpZiAoIXN0cmVhbSkgcmV0dXJuO1xuICAgIGZvciAoY29uc3QgdHJhY2sgb2Ygc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkpIHBjLmFkZFRyYWNrKHRyYWNrLCBzdHJlYW0pO1xuICB9XG5cbiAgLyoqIGBkYXRhYCBvZiB0aGUgUlRWSSBgY2xpZW50LXJlYWR5YCBmcmFtZSAobm9uZSBieSBkZWZhdWx0IFx1MjAxNCB0aGUgd2lkZ2V0J3MgZnJhbWUpLiAqL1xuICBwcm90ZWN0ZWQgY2xpZW50UmVhZHlEYXRhKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgLyoqIFRoZSB3b3JrZXIncyBgc2Vzc2lvbi1lbmRlZGAgYW5ub3VuY2VtZW50IGFycml2ZWQgKGByZWFzb25gIHdoZW4gYSBzdHJpbmcpLiAqL1xuICBwcm90ZWN0ZWQgb25TZXNzaW9uRW5kZWRGcmFtZShfcmVhc29uOiBzdHJpbmcgfCBudWxsKTogdm9pZCB7fVxuXG4gIC8qKiBUaGUgcGVlciBjbG9zZWQgYWZ0ZXIgdGhhdCBhbm5vdW5jZW1lbnQ7IHRoZSBjbGllbnQgaGFzIHJlbGVhc2VkIGl0LiAqL1xuICBwcm90ZWN0ZWQgb25Bbm5vdW5jZWRFbmRDbG9zZWQoKTogdm9pZCB7fVxuXG4gIC8qKiBUaGUgbGl2ZSBwZWVyIGNvbm5lY3Rpb24gKGBudWxsYCB3aGVuIG5vdCBjb25uZWN0ZWQpLiAqL1xuICBwcm90ZWN0ZWQgcGVlcigpOiBSVENQZWVyQ29ubmVjdGlvbiB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnBjO1xuICB9XG5cbiAgLyoqIFRoZSBwdWJsaXNoZWQgbG9jYWwgY2FwdHVyZSAoYG51bGxgIHdoZW4gbm9uZSkuICovXG4gIHByb3RlY3RlZCBtaWMoKTogTWVkaWFTdHJlYW0gfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5sb2NhbFN0cmVhbTtcbiAgfVxuXG4gIC8qKiBTZW5kIG9uZSBKU09OIGZyYW1lIG9uIHRoZSBkYXRhIGNoYW5uZWw7IGBmYWxzZWAgd2hlbiBpdCBpcyBub3Qgb3Blbi4gKi9cbiAgcHJvdGVjdGVkIHNlbmRGcmFtZShmcmFtZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBib29sZWFuIHtcbiAgICBpZiAoIXRoaXMuZGMgfHwgdGhpcy5kYy5yZWFkeVN0YXRlICE9PSBcIm9wZW5cIikgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuZGMuc2VuZChKU09OLnN0cmluZ2lmeShmcmFtZSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgZ2V0U3RhdGUoKTogVm9pY2VTdGF0ZSB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGU7XG4gIH1cblxuICBwcml2YXRlIHNldFN0YXRlKG5leHQ6IFZvaWNlU3RhdGUpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gbmV4dCkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSBuZXh0O1xuICAgIHRoaXMub3B0cy5vblN0YXRlQ2hhbmdlPy4obmV4dCk7XG4gIH1cblxuICBhc3luYyBjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnN0YXRlICE9PSBcImlkbGVcIikgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY29ubmVjdCBmcm9tIFwiJHt0aGlzLnN0YXRlfVwiYCk7XG4gICAgdGhpcy5zZXRTdGF0ZShcImNvbm5lY3RpbmdcIik7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGljZVNlcnZlcnMgPSAodGhpcy5zZXNzaW9uLmljZV9zZXJ2ZXJzID8/IFtdKS5tYXAoKHMpID0+ICh7XG4gICAgICAgIHVybHM6IHMudXJscyxcbiAgICAgICAgdXNlcm5hbWU6IHMudXNlcm5hbWUsXG4gICAgICAgIGNyZWRlbnRpYWw6IHMuY3JlZGVudGlhbCxcbiAgICAgIH0pKTtcbiAgICAgIGNvbnN0IHBjID0gbmV3IChwbGF0Zm9ybSgpLlJUQ1BlZXJDb25uZWN0aW9uKSh7XG4gICAgICAgIGljZVNlcnZlcnM6XG4gICAgICAgICAgaWNlU2VydmVycy5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IGljZVNlcnZlcnNcbiAgICAgICAgICAgIDogW3sgdXJsczogXCJzdHVuOnN0dW4ubC5nb29nbGUuY29tOjE5MzAyXCIgfV0sXG4gICAgICB9KTtcbiAgICAgIHRoaXMucGMgPSBwYztcblxuICAgICAgcGMuYWRkRXZlbnRMaXN0ZW5lcihcImNvbm5lY3Rpb25zdGF0ZWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmRpc3Bvc2VkKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGNzID0gcGMuY29ubmVjdGlvblN0YXRlO1xuICAgICAgICBpZiAoY3MgPT09IFwiY29ubmVjdGVkXCIpIHRoaXMuc2V0U3RhdGUoXCJjb25uZWN0ZWRcIik7XG4gICAgICAgIGVsc2UgaWYgKGNzID09PSBcImZhaWxlZFwiKSB7XG4gICAgICAgICAgLy8gQWZ0ZXIgdGhlIHdvcmtlcidzIGBzZXNzaW9uLWVuZGVkYCBhbm5vdW5jZW1lbnQgdGhpcyBpcyB0aGVcbiAgICAgICAgICAvLyBleHBlY3RlZCBjbG9zZSBvZiBhIGZpbmlzaGVkIGNhbGwsIG5vdCBhIGZhaWx1cmUgKFZPU08tNjU4KS5cbiAgICAgICAgICBjb25zdCBuZXh0ID0gcGVlckZhaWx1cmVTdGF0ZSh0aGlzLnNlcnZlckVuZGVkKTtcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKG5leHQpO1xuICAgICAgICAgIGlmIChuZXh0ID09PSBcImVycm9yXCIpIHRoaXMub3B0cy5vbkVycm9yPy4obmV3IEVycm9yKFwiV2ViUlRDIGNvbm5lY3Rpb24gZmFpbGVkXCIpKTtcbiAgICAgICAgICAvLyBBbm5vdW5jZWQgZW5kOiB0aGUgc2Vzc2lvbiBpcyBvdmVyIG9uIGJvdGggZW5kcyBcdTIwMTQgcmVsZWFzZSB0aGVcbiAgICAgICAgICAvLyBtaWMgYW5kIHRoZSBwZWVyIG5vdyAodGhlIHdpZGdldCdzIGVuZENhbGwgcnVucyBsb2NhbCBjbGVhbnVwXG4gICAgICAgICAgLy8gdG9vOyBib3RoIGFyZSBpZGVtcG90ZW50KS5cbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5jbGVhbnVwKCk7XG4gICAgICAgICAgICB0aGlzLm9uQW5ub3VuY2VkRW5kQ2xvc2VkKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKGNzID09PSBcImNsb3NlZFwiIHx8IGNzID09PSBcImRpc2Nvbm5lY3RlZFwiKSB7XG4gICAgICAgICAgdGhpcy5zZXRTdGF0ZShcImRpc2Nvbm5lY3RlZFwiKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoXCJ0cmFja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZGlzcG9zZWQpIHJldHVybjtcbiAgICAgICAgY29uc3QgW3N0cmVhbV0gPSBldmVudC5zdHJlYW1zO1xuICAgICAgICBpZiAoc3RyZWFtKSB0aGlzLm9wdHMub25SZW1vdGVBdWRpbz8uKHN0cmVhbSk7XG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZGMgPSBwYy5jcmVhdGVEYXRhQ2hhbm5lbChcInBpcGVjYXRcIik7XG4gICAgICB0aGlzLmRjID0gZGM7XG4gICAgICBkYy5hZGRFdmVudExpc3RlbmVyKFwib3BlblwiLCAoKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5kaXNwb3NlZCkgdGhpcy5tYXliZVNlbmRDbGllbnRSZWFkeSgpO1xuICAgICAgfSk7XG4gICAgICBkYy5hZGRFdmVudExpc3RlbmVyKFwibWVzc2FnZVwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZGlzcG9zZWQgfHwgdHlwZW9mIGV2ZW50LmRhdGEgIT09IFwic3RyaW5nXCIpIHJldHVybjtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGV2ZW50LmRhdGEpIGFzIFJ0dmlNZXNzYWdlO1xuICAgICAgICAgIGlmIChpc1Nlc3Npb25FbmRlZE1lc3NhZ2UocGFyc2VkKSkge1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXJFbmRlZCA9IHRydWU7XG4gICAgICAgICAgICBjb25zdCByZWFzb24gPSAocGFyc2VkLmRhdGEgYXMgeyByZWFzb24/OiB1bmtub3duIH0gfCB1bmRlZmluZWQpPy5yZWFzb247XG4gICAgICAgICAgICB0aGlzLm9uU2Vzc2lvbkVuZGVkRnJhbWUodHlwZW9mIHJlYXNvbiA9PT0gXCJzdHJpbmdcIiA/IHJlYXNvbiA6IG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAocGFyc2VkLnR5cGUgPT09IFwic2lnbmFsbGluZ1wiICYmIHBhcnNlZC5tZXNzYWdlPy50eXBlID09PSBcInJlbmVnb3RpYXRlXCIpIHtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5yZW5lZ290aWF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLm9wdHMub25BcHBNZXNzYWdlPy4ocGFyc2VkKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gcmF3IGtlZXAtYWxpdmVzIGV0Yy5cbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFFQyBvbiAoc3RvcHMgYWdlbnQgVFRTIGVjaG9pbmcgaW50byB0aGUgbWljKTsgQUdDICsgYnJvd3NlciBub2lzZVxuICAgICAgLy8gc3VwcHJlc3Npb24gb2ZmIFx1MjAxNCBzYW1lIGNhcHR1cmUgcHJvZmlsZSBhcyB0aGUgZGFzaGJvYXJkIHByZXZpZXcgKFEyMSkuXG4gICAgICBjb25zdCBzdHJlYW0gPSBhd2FpdCB0aGlzLmxvY2FsTWVkaWEoKTtcbiAgICAgIHRoaXMubG9jYWxTdHJlYW0gPSBzdHJlYW07XG4gICAgICB0aGlzLmNvbmZpZ3VyZVRyYW5zY2VpdmVycyhwYywgc3RyZWFtKTtcblxuICAgICAgYXdhaXQgdGhpcy5uZWdvdGlhdGUoZmFsc2UpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgdGhpcy5zZXRTdGF0ZShcImVycm9yXCIpO1xuICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwKCk7XG4gICAgICBjb25zdCBlcnJvciA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFwiV2ViUlRDIGNvbm5lY3Rpb24gZmFpbGVkXCIpO1xuICAgICAgdGhpcy5vcHRzLm9uRXJyb3I/LihlcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIG5lZ290aWF0ZShpc1JlbmVnb3RpYXRpb246IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYyA9IHRoaXMucGM7XG4gICAgaWYgKCFwYykgdGhyb3cgbmV3IEVycm9yKFwiUGVlckNvbm5lY3Rpb24gZ29uZVwiKTtcbiAgICBjb25zdCBvZmZlciA9IGF3YWl0IHBjLmNyZWF0ZU9mZmVyKHtcbiAgICAgIHZvaWNlQWN0aXZpdHlEZXRlY3Rpb246IGZhbHNlLFxuICAgIH0gYXMgUlRDT2ZmZXJPcHRpb25zKTtcbiAgICBpZiAob2ZmZXIuc2RwKSBvZmZlci5zZHAgPSB0dW5lT3B1c0ZtdHAob2ZmZXIuc2RwKTtcbiAgICBhd2FpdCBwYy5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICBhd2FpdCB3YWl0Rm9ySWNlR2F0aGVyaW5nKHBjKTtcbiAgICBjb25zdCBsb2NhbCA9IHBjLmxvY2FsRGVzY3JpcHRpb247XG4gICAgaWYgKCFsb2NhbCkgdGhyb3cgbmV3IEVycm9yKFwiTm8gbG9jYWwgU0RQXCIpO1xuXG4gICAgY29uc3QgdG9rZW4gPSAhdGhpcy5zZXNzaW9uLnNlc3Npb25faWQgJiYgdGhpcy5zZXNzaW9uLmNvbnZlcnNhdGlvbl90b2tlbjtcbiAgICBjb25zdCBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHRva2VuXG4gICAgICA/IHsgY29udmVyc2F0aW9uX3Rva2VuOiB0b2tlbiwgc2RwOiBsb2NhbC5zZHAsIHR5cGU6IGxvY2FsLnR5cGUgfVxuICAgICAgOiB7XG4gICAgICAgICAgc2RwOiBsb2NhbC5zZHAsXG4gICAgICAgICAgdHlwZTogbG9jYWwudHlwZSxcbiAgICAgICAgICBzZXNzaW9uX2lkOiB0aGlzLnNlc3Npb24uc2Vzc2lvbl9pZCxcbiAgICAgICAgICByZXF1ZXN0X2RhdGE6IHsgc2Vzc2lvbl9pZDogdGhpcy5zZXNzaW9uLnNlc3Npb25faWQgfSxcbiAgICAgICAgfTtcbiAgICBpZiAodGhpcy5wY0lkKSBib2R5LnBjX2lkID0gdGhpcy5wY0lkO1xuICAgIGlmIChpc1JlbmVnb3RpYXRpb24pIGJvZHkucmVzdGFydF9wYyA9IGZhbHNlO1xuXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgLi4udGhpcy5leHRyYU9mZmVySGVhZGVycygpLFxuICAgIH07XG4gICAgYWRkVHJhY2VIZWFkZXJzKGhlYWRlcnMsIHRoaXMuc2Vzc2lvbi50cmFjZV9jb250ZXh0KTtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBwbGF0Zm9ybSgpLmZldGNoKHRoaXMuc2Vzc2lvbi5zaWduYWxpbmdfdXJsLCB7XG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgaGVhZGVycyxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgIH0pO1xuICAgIGlmICghcmVzLm9rKSB7XG4gICAgICBsZXQgcGFyc2VkOiB1bmtub3duID0gbnVsbDtcbiAgICAgIHRyeSB7XG4gICAgICAgIHBhcnNlZCA9IGF3YWl0IHJlcy5qc29uKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8ga2VlcCBzdGF0dXNUZXh0XG4gICAgICB9XG4gICAgICB0aHJvdyB0aGlzLnNpZ25hbGluZ0ZhaWx1cmUocmVzLnN0YXR1cywgcmVzLnN0YXR1c1RleHQsIHBhcnNlZCk7XG4gICAgfVxuICAgIGNvbnN0IGFuc3dlciA9IChhd2FpdCByZXMuanNvbigpKSBhcyB7XG4gICAgICBzZHA6IHN0cmluZztcbiAgICAgIHR5cGU6IFJUQ1NkcFR5cGU7XG4gICAgICBwY19pZDogc3RyaW5nO1xuICAgIH0gJiBQYXJ0aWFsPFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3I+O1xuICAgIHRoaXMucGNJZCA9IGFuc3dlci5wY19pZDtcbiAgICAvLyBBIHRva2VuIG9mZmVyJ3MgYW5zd2VyIG5hbWVzIHRoZSBzZXNzaW9uIGl0IHJlZGVlbWVkIGludG8gKEU0IFAxKS5cbiAgICBpZiAodG9rZW4gJiYgYW5zd2VyLnNlc3Npb25faWQpIE9iamVjdC5hc3NpZ24odGhpcy5zZXNzaW9uLCBhbnN3ZXJEZXNjcmlwdG9yKGFuc3dlcikpO1xuICAgIGF3YWl0IHBjLnNldFJlbW90ZURlc2NyaXB0aW9uKHsgc2RwOiBhbnN3ZXIuc2RwLCB0eXBlOiBhbnN3ZXIudHlwZSB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVuZWdvdGlhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnBjIHx8IHRoaXMuZGlzcG9zZWQpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5uZWdvdGlhdGUodHJ1ZSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLm9wdHMub25FcnJvcj8uKGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyIDogbmV3IEVycm9yKFwiUmVuZWdvdGlhdGlvbiBmYWlsZWRcIikpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBSZXBvcnQgdGhhdCB0aGUgcmVtb3RlIDxhdWRpbz4gaXMgYWN0dWFsbHkgcGxheWluZyBcdTIwMTQgcmVsZWFzZXMgdGhlXG4gICAqICBzZXJ2ZXItaGVsZCBncmVldGluZyB2aWEgdGhlIFJUVkkgY2xpZW50LXJlYWR5IGhhbmRzaGFrZS4gKi9cbiAgbm90aWZ5QXVkaW9SZW5kZXJpbmcoKTogdm9pZCB7XG4gICAgdGhpcy5hdWRpb1JlbmRlcmluZyA9IHRydWU7XG4gICAgdGhpcy5tYXliZVNlbmRDbGllbnRSZWFkeSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFNlbmQgdHlwZWQgdGV4dCBhcyBhIFJFQUwgdXNlciB0dXJuIG9uIHRoZSBsaXZlIGNhbGwgKFJUVklcbiAgICogYHNlbmQtdGV4dGAgb3ZlciB0aGUgZGF0YSBjaGFubmVsIFx1MjAxNCB0aGUgc2VydmVyIGluamVjdHMgaXQgaW50byB0aGVcbiAgICogcGlwZWxpbmUncyBMTE0gY29udGV4dCBhbmQgcnVucyBhIGNvbXBsZXRpb24sIGludGVycnVwdGluZyB0aGUgYm90XG4gICAqIGlmIGl0IGlzIG1pZC11dHRlcmFuY2UpLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgY2hhbm5lbCBpcyBub3RcbiAgICogb3BlbiBvciB0aGUgdGV4dCBpcyBibGFuazsgdGhlIGNhbGxlciBrZWVwcyB0aGUgY29tcG9zZXIncyB0ZXh0LlxuICAgKi9cbiAgc2VuZFVzZXJUZXh0KHRleHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHRyaW1tZWQgPSB0ZXh0LnRyaW0oKTtcbiAgICBpZiAoIXRyaW1tZWQpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIXRoaXMuZGMgfHwgdGhpcy5kYy5yZWFkeVN0YXRlICE9PSBcIm9wZW5cIikgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuZGMuc2VuZChKU09OLnN0cmluZ2lmeShidWlsZFNlbmRUZXh0RW52ZWxvcGUodHJpbW1lZCkpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBbnN3ZXIgYSBjbGllbnQgdG9vbCBjYWxsIHRoZSBhZ2VudCBtYWRlIG9uIHRoaXMgY2FsbCAoUlRWSVxuICAgKiBgbGxtLWZ1bmN0aW9uLWNhbGwtcmVzdWx0YDsgdGhlIHZlbmRvcidzIGBjbGllbnRfdG9vbF9yZXN1bHRgKS4gTGF0ZSxcbiAgICogZHVwbGljYXRlIG9yIHVua25vd24gaWRzIGFyZSBpZ25vcmVkIHNlcnZlci1zaWRlLiBSZXR1cm5zIGBmYWxzZWAgd2hlblxuICAgKiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRDbGllbnRUb29sUmVzdWx0KHRvb2xDYWxsSWQ6IHN0cmluZywgcmVzdWx0OiBzdHJpbmcsIGlzRXJyb3IgPSBmYWxzZSk6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGJ1aWxkRnVuY3Rpb25DYWxsUmVzdWx0RW52ZWxvcGUodG9vbENhbGxJZCwgcmVzdWx0LCBpc0Vycm9yKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEFwcHJvdmUgb3IgZGVueSBhbiBNQ1AgdG9vbCBjYWxsIHRoZSBhZ2VudCBpcyB3YWl0aW5nIG9uIChSVFZJXG4gICAqIGBtY3AtdG9vbC1hcHByb3ZhbC1yZXN1bHRgOyB0aGUgdmVuZG9yJ3MgYG1jcF90b29sX2FwcHJvdmFsX3Jlc3VsdGAsXG4gICAqIEUzIFx1MDBBNzQuNikuIExhdGUgLyB1bmtub3duIGlkcyBhcmUgaWdub3JlZCBzZXJ2ZXItc2lkZS4gUmV0dXJucyBgZmFsc2VgXG4gICAqIHdoZW4gdGhlIGNoYW5uZWwgaXMgbm90IG9wZW4uXG4gICAqL1xuICBzZW5kTWNwVG9vbEFwcHJvdmFsKHRvb2xDYWxsSWQ6IHN0cmluZywgaXNBcHByb3ZlZDogYm9vbGVhbik6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGJ1aWxkTWNwVG9vbEFwcHJvdmFsRW52ZWxvcGUodG9vbENhbGxJZCwgaXNBcHByb3ZlZCkpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQdXNoIGJhY2tncm91bmQgY29udGV4dCBpbnRvIHRoZSBsaXZlIGNvbnZlcnNhdGlvbiB3aXRob3V0IGEgdHVyblxuICAgKiAoUlRWSSBgYXBwZW5kLXRvLWNvbnRleHRgOyB0aGUgdmVuZG9yJ3MgYGNvbnRleHR1YWxfdXBkYXRlYCkuIFRoZSBhZ2VudFxuICAgKiBkb2VzIG5vdCBzcGVhazsgaXQgcmVhZHMgdGhlIG5vdGUgb24gaXRzIG5leHQgcmVwbHkuIEEgbGF0ZXIgdXBkYXRlXG4gICAqIHdpdGggdGhlIHNhbWUgYGNvbnRleHRJZGAgcmVwbGFjZXMgdGhlIGVhcmxpZXIgb25lLiBSZXR1cm5zIGBmYWxzZWBcbiAgICogd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRDb250ZXh0dWFsVXBkYXRlKHRleHQ6IHN0cmluZywgY29udGV4dElkPzogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmRjLnNlbmQoSlNPTi5zdHJpbmdpZnkoYnVpbGRBcHBlbmRUb0NvbnRleHRFbnZlbG9wZSh0ZXh0LCBjb250ZXh0SWQpKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogVGVsbCB0aGUgYWdlbnQgdGhlIHVzZXIgaXMgYWN0aXZlIHdpdGhvdXQgYSB0dXJuIChSVFZJIGB1c2VyLWFjdGl2aXR5YDtcbiAgICogdGhlIHZlbmRvcidzIGB1c2VyX2FjdGl2aXR5YCwgRTIgRC05KTogcmVzZXRzIHRoZSBpZGxlIGNsb2NrLiBSZXR1cm5zXG4gICAqIGBmYWxzZWAgd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRVc2VyQWN0aXZpdHkoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuc2VuZEZyYW1lKGJ1aWxkVXNlckFjdGl2aXR5RW52ZWxvcGUoKSk7XG4gIH1cblxuICAvKipcbiAgICogUGVyLXJlc3BvbnNlIGZlZWRiYWNrIChSVFZJIGBmZWVkYmFjayB7c2NvcmUsIGV2ZW50X2lkfWA7IHRoZSB2ZW5kb3Inc1xuICAgKiBgZmVlZGJhY2tgLCBFNCBRMTYpOiBgbGlrZWAgLyBgZGlzbGlrZWAsIGBudWxsYCBjbGVhcnMgaXQuIFN0b3JlZCBpbiB0aGVcbiAgICogT05FIGZlZWRiYWNrIHN0b3JlIChFMiBELTEwKS4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGNoYW5uZWwgaXMgbm90IG9wZW4uXG4gICAqL1xuICBzZW5kRmVlZGJhY2soc2NvcmU6IFwibGlrZVwiIHwgXCJkaXNsaWtlXCIgfCBudWxsLCBldmVudElkOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zZW5kRnJhbWUoYnVpbGRGZWVkYmFja0VudmVsb3BlKHNjb3JlLCBldmVudElkKSk7XG4gIH1cblxuICBwcml2YXRlIG1heWJlU2VuZENsaWVudFJlYWR5KCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmNsaWVudFJlYWR5U2VudCB8fCAhdGhpcy5hdWRpb1JlbmRlcmluZykgcmV0dXJuO1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm47XG4gICAgY29uc3QgZGF0YSA9IHRoaXMuY2xpZW50UmVhZHlEYXRhKCk7XG4gICAgdGhpcy5kYy5zZW5kKFxuICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgICAgIHR5cGU6IFwiY2xpZW50LXJlYWR5XCIsXG4gICAgICAgIGlkOiBgY2xpZW50LXJlYWR5LSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9YCxcbiAgICAgICAgLi4uKGRhdGEgPyB7IGRhdGEgfSA6IHt9KSxcbiAgICAgIH0pLFxuICAgICk7XG4gICAgdGhpcy5jbGllbnRSZWFkeVNlbnQgPSB0cnVlO1xuICB9XG5cbiAgc2V0TWljcm9waG9uZUVuYWJsZWQoZW5hYmxlZDogYm9vbGVhbik6IHZvaWQge1xuICAgIGlmICghdGhpcy5sb2NhbFN0cmVhbSkgcmV0dXJuO1xuICAgIGZvciAoY29uc3QgdHJhY2sgb2YgdGhpcy5sb2NhbFN0cmVhbS5nZXRBdWRpb1RyYWNrcygpKSB0cmFjay5lbmFibGVkID0gZW5hYmxlZDtcbiAgfVxuXG4gIGFzeW5jIGRpc2Nvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kaXNwb3NlZCA9IHRydWU7XG4gICAgLy8gT3duZXJzaGlwIHByb29mIChWT1NPLTE5MSk6IHRoZSB3b3JrZXIgcmVqZWN0cyB0ZWFyZG93biB3aXRob3V0IHRoZVxuICAgIC8vIHRva2VuIG1pbnRlZCBhbG9uZ3NpZGUgdGhpcyBzZXNzaW9uLiBBIHRva2VuLWxlc3MgZGVzY3JpcHRvciAob2xkZXJcbiAgICAvLyBBUEkgZHVyaW5nIGRlcGxveSBza2V3KSB3b3VsZCBiZSBhIGd1YXJhbnRlZWQgNDAxIFx1MjAxNCBza2lwIHRoZSByZXF1ZXN0XG4gICAgLy8gYW5kIGxldCB0aGUgc2VydmVyIHNpZGUgZmFsbCBiYWNrIHRvIElDRS10aW1lb3V0IHRlYXJkb3duLiBBZnRlciB0aGVcbiAgICAvLyB3b3JrZXIncyBvd24gZW5kIGFubm91bmNlbWVudCB0aGVyZSBpcyBub3RoaW5nIGxlZnQgdG8gdGVhciBkb3duLlxuICAgIGNvbnN0IHByb29mID0gdGhpcy5kaXNjb25uZWN0Qm9keSgpO1xuICAgIGlmICh0aGlzLnNlcnZlckVuZGVkKSB7XG4gICAgICAvLyBUaGUgd29ya2VyIGFubm91bmNlZCB0aGUgZW5kIGFuZCB0b3JlIHRoZSBzZXNzaW9uIGRvd24gaXRzZWxmOlxuICAgICAgLy8gbm90aGluZyB0byByZXF1ZXN0LCBub3RoaW5nIHRvIHdhcm4gYWJvdXQuXG4gICAgfSBlbHNlIGlmICghcHJvb2Yuc2Vzc2lvbl90b2tlbikge1xuICAgICAgY29uc29sZS53YXJuKHRoaXMuZGlzY29ubmVjdFdhcm5pbmcoXCJza2lwcGVkXCIpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgcGxhdGZvcm0oKS5mZXRjaCh0aGlzLmRpc2Nvbm5lY3RFbmRwb2ludCgpLCB7XG4gICAgICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgICAgICBoZWFkZXJzOiB0aGlzLmRpc2Nvbm5lY3RIZWFkZXJzKCksXG4gICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocHJvb2YpLFxuICAgICAgICAgIGtlZXBhbGl2ZTogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGlmICghcmVzLm9rKSB7XG4gICAgICAgICAgLy8gQSByZWplY3RlZCBkaXNjb25uZWN0IGxlYXZlcyB0aGUgc2VydmVyIHNlc3Npb24gdG8gSUNFIHRpbWVvdXQuXG4gICAgICAgICAgY29uc29sZS53YXJuKHRoaXMuZGlzY29ubmVjdFdhcm5pbmcoXCJyZWplY3RlZFwiLCByZXMuc3RhdHVzKSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBiZXN0IGVmZm9ydFxuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLmNsZWFudXAoKTtcbiAgICB0aGlzLnNldFN0YXRlKFwiZGlzY29ubmVjdGVkXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjbGVhbnVwKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmRjPy5jbG9zZSgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuICAgIHRoaXMuZGMgPSBudWxsO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnBjPy5jbG9zZSgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLyogaWdub3JlICovXG4gICAgfVxuICAgIHRoaXMucGMgPSBudWxsO1xuICAgIGlmICh0aGlzLmxvY2FsU3RyZWFtKSB7XG4gICAgICBmb3IgKGNvbnN0IHRyYWNrIG9mIHRoaXMubG9jYWxTdHJlYW0uZ2V0VHJhY2tzKCkpIHRyYWNrLnN0b3AoKTtcbiAgICAgIHRoaXMubG9jYWxTdHJlYW0gPSBudWxsO1xuICAgIH1cbiAgfVxufVxuXG4vKiogUlRWSSBgc2VuZC10ZXh0YCBlbnZlbG9wZSBmb3Igb25lIHR5cGVkIHVzZXIgdHVybi4gRXhwb3J0ZWQgZm9yIHRlc3RzXG4gKiAgKGFuZCBtaXJyb3JlZCBieSB0aGUgZGFzaGJvYXJkIHByZXZpZXcncyBjb21wb3NlciBcdTIwMTQgdGhlIHR3byBzZW5kZXJzXG4gKiAgbXVzdCBlbWl0IHRoZSBzYW1lIHdpcmUgc2hhcGUgdGhlIHByZXZpZXcgcGlwZWxpbmUgcGFyc2VzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFNlbmRUZXh0RW52ZWxvcGUoY29udGVudDogc3RyaW5nKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICB0eXBlOiBcInNlbmQtdGV4dFwiLFxuICAgIGlkOiBgc2VuZC10ZXh0LSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9YCxcbiAgICBkYXRhOiB7XG4gICAgICBjb250ZW50LFxuICAgICAgb3B0aW9uczogeyBydW5faW1tZWRpYXRlbHk6IHRydWUsIGF1ZGlvX3Jlc3BvbnNlOiB0cnVlIH0sXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIFJUVkkgYGxsbS1mdW5jdGlvbi1jYWxsLXJlc3VsdGAgZW52ZWxvcGUgXHUyMDE0IHRoZSBhcHAncyBhbnN3ZXIgdG8gYW5cbiAqICBgbGxtLWZ1bmN0aW9uLWNhbGxgIChFMyBcdTAwQTc0LjEuNSkuIFRoZSB2ZW5kb3IncyB0aHJlZSBmaWVsZHMgb25seTsgdGhlXG4gKiAgc2VydmVyIHJlc29sdmVzIHRoZSBwZW5kaW5nIGNhbGwgYnkgYHRvb2xfY2FsbF9pZGAuIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEZ1bmN0aW9uQ2FsbFJlc3VsdEVudmVsb3BlKFxuICB0b29sQ2FsbElkOiBzdHJpbmcsXG4gIHJlc3VsdDogc3RyaW5nLFxuICBpc0Vycm9yOiBib29sZWFuLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICB0eXBlOiBcImxsbS1mdW5jdGlvbi1jYWxsLXJlc3VsdFwiLFxuICAgIGlkOiBgdG9vbC1yZXN1bHQtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHsgdG9vbF9jYWxsX2lkOiB0b29sQ2FsbElkLCByZXN1bHQsIGlzX2Vycm9yOiBpc0Vycm9yIH0sXG4gIH07XG59XG5cbi8qKiBSVFZJIGBtY3AtdG9vbC1hcHByb3ZhbC1yZXN1bHRgIGVudmVsb3BlIChFMyBcdTAwQTc0LjYpLiBFeHBvcnRlZCBmb3IgdGVzdHMuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRNY3BUb29sQXBwcm92YWxFbnZlbG9wZShcbiAgdG9vbENhbGxJZDogc3RyaW5nLFxuICBpc0FwcHJvdmVkOiBib29sZWFuLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICB0eXBlOiBcIm1jcC10b29sLWFwcHJvdmFsLXJlc3VsdFwiLFxuICAgIGlkOiBgbWNwLWFwcHJvdmFsLSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9YCxcbiAgICBkYXRhOiB7IHRvb2xfY2FsbF9pZDogdG9vbENhbGxJZCwgaXNfYXBwcm92ZWQ6IGlzQXBwcm92ZWQgfSxcbiAgfTtcbn1cblxuLyoqIFRoZSBgZGF0YWAgb2YgYW4gUlRWSSBgbWNwLXRvb2wtY2FsbGAgbWVzc2FnZSwgb3IgYG51bGxgIGZvciBhbnkgb3RoZXJcbiAqICB0eXBlIChFMyBcdTAwQTc0LjYpLiBUaGUgY2FsbGVyIHBhcnNlcyBpdCB3aXRoIGBtY3BUb29sQ2FsbEZyb21SZWNvcmRgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1jcFRvb2xDYWxsRGF0YUZyb21SdHZpKG1zZzogUnR2aU1lc3NhZ2UpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwge1xuICBpZiAobXNnLnR5cGUgIT09IFwibWNwLXRvb2wtY2FsbFwiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZGF0YSA9IG1zZy5kYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xuICByZXR1cm4gZGF0YSA/PyBudWxsO1xufVxuXG4vKiogUlRWSSBgYXBwZW5kLXRvLWNvbnRleHRgIGVudmVsb3BlIChFMyBcdTAwQTc0LjIpLiBgY29udGV4dF9pZGAgb25seSB3aGVuXG4gKiAgZ2l2ZW4uIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEFwcGVuZFRvQ29udGV4dEVudmVsb3BlKFxuICB0ZXh0OiBzdHJpbmcsXG4gIGNvbnRleHRJZD86IHN0cmluZyxcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgY29uc3QgZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7IHRleHQgfTtcbiAgaWYgKGNvbnRleHRJZCAhPT0gdW5kZWZpbmVkKSBkYXRhLmNvbnRleHRfaWQgPSBjb250ZXh0SWQ7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwiYXBwZW5kLXRvLWNvbnRleHRcIixcbiAgICBpZDogYGNvbnRleHQtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGEsXG4gIH07XG59XG5cbi8qKiBUaGUgYWdlbnQncyBjbGllbnQgdG9vbCBjYWxsIG9uIHRoZSBkYXRhIGNoYW5uZWwgKGBsbG0tZnVuY3Rpb24tY2FsbGApLFxuICogIGRlY29kZWQ7IGBudWxsYCBmb3IgZXZlcnkgb3RoZXIgbWVzc2FnZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGllbnRUb29sQ2FsbEZyb21SdHZpKG1zZzogUnR2aU1lc3NhZ2UpOiB7XG4gIHRvb2xOYW1lOiBzdHJpbmc7XG4gIHRvb2xDYWxsSWQ6IHN0cmluZztcbiAgcGFyYW1ldGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGV4cGVjdHNSZXNwb25zZTogYm9vbGVhbjtcbiAgcmVzcG9uc2VUaW1lb3V0U2Vjcz86IG51bWJlcjtcbn0gfCBudWxsIHtcbiAgaWYgKG1zZy50eXBlICE9PSBcImxsbS1mdW5jdGlvbi1jYWxsXCIpIHJldHVybiBudWxsO1xuICBjb25zdCBkYXRhID0gbXNnLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIGNvbnN0IHRvb2xOYW1lID0gZGF0YT8uZnVuY3Rpb25fbmFtZTtcbiAgY29uc3QgdG9vbENhbGxJZCA9IGRhdGE/LnRvb2xfY2FsbF9pZDtcbiAgaWYgKHR5cGVvZiB0b29sTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgdG9vbENhbGxJZCAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGFyZ3MgPSBkYXRhPy5hcmdzO1xuICBjb25zdCBwYXJhbWV0ZXJzID1cbiAgICB0eXBlb2YgYXJncyA9PT0gXCJvYmplY3RcIiAmJiBhcmdzICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KGFyZ3MpXG4gICAgICA/IChhcmdzIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KVxuICAgICAgOiB7fTtcbiAgY29uc3QgdGltZW91dCA9IGRhdGE/LnJlc3BvbnNlX3RpbWVvdXRfc2VjcztcbiAgcmV0dXJuIHtcbiAgICB0b29sTmFtZSxcbiAgICB0b29sQ2FsbElkLFxuICAgIHBhcmFtZXRlcnMsXG4gICAgLy8gQWJzZW50IG9uIGEgcHJlLUUzIGVtaXR0ZXI6IGFzc3VtZSB0aGUgYWdlbnQgd2FpdHMgKHNhZmUgZGVmYXVsdCBcdTIwMTRcbiAgICAvLyBhbiBhbnN3ZXIgbm9ib2R5IHdhaXRzIGZvciBpcyBkcm9wcGVkIHNpbGVudGx5KS5cbiAgICBleHBlY3RzUmVzcG9uc2U6IGRhdGE/LmV4cGVjdHNfcmVzcG9uc2UgIT09IGZhbHNlLFxuICAgIC4uLih0eXBlb2YgdGltZW91dCA9PT0gXCJudW1iZXJcIiA/IHsgcmVzcG9uc2VUaW1lb3V0U2VjczogdGltZW91dCB9IDoge30pLFxuICB9O1xufVxuXG4vKiogUlRWSSBgdXNlci1hY3Rpdml0eWAgZW52ZWxvcGUgKEUyIEQtOSkuIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFVzZXJBY3Rpdml0eUVudmVsb3BlKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgdHlwZTogXCJ1c2VyLWFjdGl2aXR5XCIsXG4gICAgaWQ6IGB1c2VyLWFjdGl2aXR5LSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9YCxcbiAgfTtcbn1cblxuLyoqIFJUVkkgYGZlZWRiYWNrYCBlbnZlbG9wZSAoRTQgUTE2IFx1MjE5MiBFMiBELTEwIHN0b3JlKS4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRmVlZGJhY2tFbnZlbG9wZShcbiAgc2NvcmU6IFwibGlrZVwiIHwgXCJkaXNsaWtlXCIgfCBudWxsLFxuICBldmVudElkOiBudW1iZXIsXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwiZmVlZGJhY2tcIixcbiAgICBpZDogYGZlZWRiYWNrLSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9YCxcbiAgICBkYXRhOiB7IHNjb3JlLCBldmVudF9pZDogZXZlbnRJZCB9LFxuICB9O1xufVxuXG4vKiogVGhlIGRlc2NyaXB0b3Iga2V5cyBhIHRva2VuIG9mZmVyJ3MgYW5zd2VyIGNhcnJpZXMuICovXG5mdW5jdGlvbiBhbnN3ZXJEZXNjcmlwdG9yKGFuc3dlcjogUGFydGlhbDxWb2ljZVNlc3Npb25EZXNjcmlwdG9yPik6IFBhcnRpYWw8Vm9pY2VTZXNzaW9uRGVzY3JpcHRvcj4ge1xuICBjb25zdCB7IHNlc3Npb25faWQsIHNlc3Npb25fdG9rZW4sIGNvbnZlcnNhdGlvbl9pZCB9ID0gYW5zd2VyO1xuICByZXR1cm4geyBzZXNzaW9uX2lkLCBzZXNzaW9uX3Rva2VuLCBjb252ZXJzYXRpb25faWQ6IGNvbnZlcnNhdGlvbl9pZCA/PyBcIlwiIH07XG59XG5cbmZ1bmN0aW9uIGFkZFRyYWNlSGVhZGVycyhcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgY29udGV4dDogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCxcbik6IHZvaWQge1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgW1widHJhY2VwYXJlbnRcIiwgXCJ0cmFjZXN0YXRlXCJdIGFzIGNvbnN0KSB7XG4gICAgY29uc3QgdmFsdWUgPSBjb250ZXh0Py5bbmFtZV07XG4gICAgaWYgKHZhbHVlKSBoZWFkZXJzW25hbWVdID0gdmFsdWU7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGlzY29ubmVjdFVybChzaWduYWxpbmdVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoc2lnbmFsaW5nVXJsKTtcbiAgdXJsLnBhdGhuYW1lID0gdXJsLnBhdGhuYW1lLnJlcGxhY2UoL1xcL2FwaVxcL29mZmVyXFwvPyQvLCBcIi9hcGkvZGlzY29ubmVjdFwiKTtcbiAgdXJsLnNlYXJjaCA9IFwiXCI7XG4gIHVybC5oYXNoID0gXCJcIjtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG4vKiogUmVzb2x2ZSBvbmNlIElDRSBnYXRoZXJpbmcgY29tcGxldGVzLCBvciBhZnRlciBhIHNob3J0IGNhcC4gKi9cbmZ1bmN0aW9uIHdhaXRGb3JJY2VHYXRoZXJpbmcocGM6IFJUQ1BlZXJDb25uZWN0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmIChwYy5pY2VHYXRoZXJpbmdTdGF0ZSA9PT0gXCJjb21wbGV0ZVwiKSByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IHRpbWVvdXQgPSBwbGF0Zm9ybSgpLnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgcGMucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImljZWdhdGhlcmluZ3N0YXRlY2hhbmdlXCIsIGNoZWNrKTtcbiAgICAgIHJlc29sdmUoKTtcbiAgICB9LCAyNTApO1xuICAgIGNvbnN0IGNoZWNrID0gKCkgPT4ge1xuICAgICAgaWYgKHBjLmljZUdhdGhlcmluZ1N0YXRlID09PSBcImNvbXBsZXRlXCIpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICBwYy5yZW1vdmVFdmVudExpc3RlbmVyKFwiaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2VcIiwgY2hlY2spO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBwYy5hZGRFdmVudExpc3RlbmVyKFwiaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2VcIiwgY2hlY2spO1xuICB9KTtcbn1cblxuLyoqIEZvcmNlIGB1c2VkdHg9MDt1c2VpbmJhbmRmZWM9MWAgb250byBldmVyeSBPcHVzIG0tbGluZSAoc2VlIHRoZVxuICogIGRhc2hib2FyZCBjbGllbnQgZm9yIHRoZSBmdWxsIHJhdGlvbmFsZTogRFRYIGNsaXBzIHF1aWV0IHdvcmQgb25zZXRzO1xuICogIEZFQyBsZXRzIHRoZSBicm93c2VyIHJlY29uc3RydWN0IGRyb3BwZWQgcGFja2V0cykuIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0dW5lT3B1c0ZtdHAoc2RwOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBvcHVzUHRzID0gWy4uLnNkcC5tYXRjaEFsbCgvXmE9cnRwbWFwOihcXGQrKVxccytvcHVzXFwvXFxkKy9naW0pXS5tYXAoKG0pID0+IG1bMV0pO1xuICBpZiAob3B1c1B0cy5sZW5ndGggPT09IDApIHJldHVybiBzZHA7XG5cbiAgY29uc3QgaGF2ZUZtdHAgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgY29uc3QgbGluZXMgPSBzZHAuc3BsaXQoL1xcclxcbnxcXG4vKTtcbiAgY29uc3Qgb3V0ID0gbGluZXMubWFwKChsaW5lKSA9PiB7XG4gICAgY29uc3QgbSA9IGxpbmUubWF0Y2goL15hPWZtdHA6KFxcZCspXFxzKyguKikkL2kpO1xuICAgIGlmICghbSB8fCAhb3B1c1B0cy5pbmNsdWRlcyhtWzFdKSkgcmV0dXJuIGxpbmU7XG4gICAgaGF2ZUZtdHAuYWRkKG1bMV0hKTtcbiAgICByZXR1cm4gYGE9Zm10cDoke21bMV19ICR7d2l0aE9wdXNEaXJlY3RpdmVzKG1bMl0gPz8gXCJcIil9YDtcbiAgfSk7XG5cbiAgY29uc3QgbWlzc2luZyA9IG9wdXNQdHMuZmlsdGVyKChwdCkgPT4gcHQgIT09IHVuZGVmaW5lZCAmJiAhaGF2ZUZtdHAuaGFzKHB0KSk7XG4gIGlmIChtaXNzaW5nLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG91dC5qb2luKFwiXFxyXFxuXCIpO1xuXG4gIGNvbnN0IHdpdGhGbXRwOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGxpbmUgb2Ygb3V0KSB7XG4gICAgd2l0aEZtdHAucHVzaChsaW5lKTtcbiAgICBjb25zdCBybSA9IGxpbmUubWF0Y2goL15hPXJ0cG1hcDooXFxkKylcXHMrb3B1c1xcL1xcZCsvaSk7XG4gICAgaWYgKHJtICYmIG1pc3NpbmcuaW5jbHVkZXMocm1bMV0pKSB7XG4gICAgICB3aXRoRm10cC5wdXNoKGBhPWZtdHA6JHtybVsxXX0gdXNlZHR4PTA7dXNlaW5iYW5kZmVjPTFgKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHdpdGhGbXRwLmpvaW4oXCJcXHJcXG5cIik7XG59XG5cbmZ1bmN0aW9uIHdpdGhPcHVzRGlyZWN0aXZlcyhwYXJhbXM6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBuZXh0ID0gL3VzZWR0eD0vaS50ZXN0KHBhcmFtcylcbiAgICA/IHBhcmFtcy5yZXBsYWNlKC91c2VkdHg9XFxkKy9pLCBcInVzZWR0eD0wXCIpXG4gICAgOiBgJHtwYXJhbXN9O3VzZWR0eD0wYDtcbiAgbmV4dCA9IC91c2VpbmJhbmRmZWM9L2kudGVzdChuZXh0KVxuICAgID8gbmV4dC5yZXBsYWNlKC91c2VpbmJhbmRmZWM9XFxkKy9pLCBcInVzZWluYmFuZGZlYz0xXCIpXG4gICAgOiBgJHtuZXh0fTt1c2VpbmJhbmRmZWM9MWA7XG4gIHJldHVybiBuZXh0O1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU8sVUFBVTtBQUNqQixPQUFPLFlBQVk7OztBQ3NCbkIsSUFBTSxrQkFBa0IsT0FBaUI7QUFBQSxFQUN2QyxtQkFBbUIsV0FBVztBQUFBLEVBQzlCLHVCQUF1QixXQUFXO0FBQUEsRUFDbEMsY0FBYyxNQUFNLFdBQVcsV0FBVztBQUFBLEVBQzFDLE9BQU8sSUFBSSxTQUFtQyxXQUFXLE1BQU0sR0FBRyxJQUFJO0FBQUEsRUFDdEUsWUFBWSxDQUFDLFNBQVMsT0FBTyxXQUFXLFdBQVcsU0FBUyxFQUFFO0FBQ2hFO0FBRUEsSUFBSSxZQUErQixDQUFDO0FBUTdCLFNBQVMsV0FBcUI7QUFDbkMsU0FBTyxFQUFFLEdBQUcsZ0JBQWdCLEdBQUcsR0FBRyxVQUFVO0FBQzlDO0FBUU8sSUFBTSxrQkFBa0I7QUFBQSxFQUM3QixPQUFPLEVBQUUsa0JBQWtCLE1BQU0sa0JBQWtCLE9BQU8saUJBQWlCLE1BQU07QUFBQSxFQUNqRixPQUFPO0FBQ1Q7OztBQ1NPLElBQU0sNkJBQTZCO0FBUW5DLFNBQVMsc0JBQXNCLEtBSzFCO0FBR1YsTUFBSSxJQUFJLFVBQVUsYUFBYSxJQUFJLFNBQVMsaUJBQWtCLFFBQU87QUFDckUsUUFBTSxPQUFPLElBQUk7QUFDakIsU0FDRSxPQUFPLFNBQVMsWUFDaEIsU0FBUyxRQUNSLEtBQWlDLFNBQVM7QUFFL0M7QUF1Q08sU0FBUyxpQkFBaUIsYUFBZ0Q7QUFDL0UsU0FBTyxjQUFjLGlCQUFpQjtBQUN4QztBQVNPLElBQU0sY0FBTixNQUFrQjtBQUFBLEVBWXZCLFlBQ3FCLFNBQ0YsTUFDakI7QUFGbUI7QUFDRjtBQVpuQjtBQUFBLFNBQVEsY0FBYztBQUN0QixTQUFRLEtBQStCO0FBQ3ZDLFNBQVEsS0FBNEI7QUFDcEMsU0FBUSxjQUFrQztBQUMxQyxTQUFRLE9BQXNCO0FBQzlCLFNBQVEsUUFBb0I7QUFDNUIsU0FBUSxXQUFXO0FBQ25CLFNBQVEsaUJBQWlCO0FBQ3pCLFNBQVEsa0JBQWtCO0FBQUEsRUFLdkI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFVSCxPQUFPLHNCQUVMLE9BQ0EsT0FDQSxNQUNHO0FBQ0gsV0FBTyxJQUFJO0FBQUEsTUFDVDtBQUFBLFFBQ0UsWUFBWTtBQUFBLFFBQ1osaUJBQWlCO0FBQUEsUUFDakIsZUFBZSxNQUFNO0FBQUEsUUFDckIsYUFBYSxNQUFNO0FBQUEsUUFDbkIsb0JBQW9CO0FBQUEsTUFDdEI7QUFBQSxNQUNBO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRVSxvQkFBNEM7QUFDcEQsV0FBTyxDQUFDO0FBQUEsRUFDVjtBQUFBO0FBQUEsRUFHVSxvQkFBNEM7QUFDcEQsV0FBTyxFQUFFLGdCQUFnQixtQkFBbUI7QUFBQSxFQUM5QztBQUFBO0FBQUEsRUFHVSxxQkFBNkI7QUFDckMsV0FBTyxjQUFjLEtBQUssUUFBUSxhQUFhO0FBQUEsRUFDakQ7QUFBQTtBQUFBLEVBR1UsaUJBQWlFO0FBQ3pFLFdBQU8sRUFBRSxZQUFZLEtBQUssUUFBUSxZQUFZLGVBQWUsS0FBSyxRQUFRLGNBQWM7QUFBQSxFQUMxRjtBQUFBO0FBQUEsRUFHVSxrQkFBa0IsTUFBOEIsUUFBeUI7QUFDakYsV0FBTyxTQUFTLFlBQ1osc0RBQ0EscUNBQXFDLE1BQU07QUFBQSxFQUNqRDtBQUFBO0FBQUEsRUFHVSxpQkFBaUIsUUFBZ0IsWUFBb0IsTUFBc0I7QUFDbkYsVUFBTSxTQUNKLFFBQVEsT0FBTyxTQUFTLFlBQVksT0FBUSxLQUE4QixXQUFXLFdBQ2hGLEtBQTRCLFNBQzdCO0FBQ04sV0FBTyxJQUFJLE1BQU0scUJBQXFCLE1BQU0sTUFBTSxNQUFNLEVBQUU7QUFBQSxFQUM1RDtBQUFBO0FBQUEsRUFHQSxNQUFnQixhQUEwQztBQUN4RCxXQUFRLFNBQVMsRUFBRSxhQUFhLEVBQW1CLGFBQWEsZUFBZTtBQUFBLEVBQ2pGO0FBQUE7QUFBQSxFQUdVLHNCQUFzQixJQUF1QixRQUFrQztBQUN2RixRQUFJLENBQUMsT0FBUTtBQUNiLGVBQVcsU0FBUyxPQUFPLGVBQWUsRUFBRyxJQUFHLFNBQVMsT0FBTyxNQUFNO0FBQUEsRUFDeEU7QUFBQTtBQUFBLEVBR1Usa0JBQXVEO0FBQy9ELFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUdVLG9CQUFvQixTQUE4QjtBQUFBLEVBQUM7QUFBQTtBQUFBLEVBR25ELHVCQUE2QjtBQUFBLEVBQUM7QUFBQTtBQUFBLEVBRzlCLE9BQWlDO0FBQ3pDLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQTtBQUFBLEVBR1UsTUFBMEI7QUFDbEMsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBO0FBQUEsRUFHVSxVQUFVLE9BQXlDO0FBQzNELFFBQUksQ0FBQyxLQUFLLE1BQU0sS0FBSyxHQUFHLGVBQWUsT0FBUSxRQUFPO0FBQ3RELFNBQUssR0FBRyxLQUFLLEtBQUssVUFBVSxLQUFLLENBQUM7QUFDbEMsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLFdBQXVCO0FBQ3JCLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQSxFQUVRLFNBQVMsTUFBa0I7QUFDakMsUUFBSSxLQUFLLFVBQVUsS0FBTTtBQUN6QixTQUFLLFFBQVE7QUFDYixTQUFLLEtBQUssZ0JBQWdCLElBQUk7QUFBQSxFQUNoQztBQUFBLEVBRUEsTUFBTSxVQUF5QjtBQUM3QixRQUFJLEtBQUssVUFBVSxPQUFRLE9BQU0sSUFBSSxNQUFNLHdCQUF3QixLQUFLLEtBQUssR0FBRztBQUNoRixTQUFLLFNBQVMsWUFBWTtBQUMxQixRQUFJO0FBQ0YsWUFBTSxjQUFjLEtBQUssUUFBUSxlQUFlLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTztBQUFBLFFBQzlELE1BQU0sRUFBRTtBQUFBLFFBQ1IsVUFBVSxFQUFFO0FBQUEsUUFDWixZQUFZLEVBQUU7QUFBQSxNQUNoQixFQUFFO0FBQ0YsWUFBTSxLQUFLLEtBQUssU0FBUyxHQUFFLGtCQUFtQjtBQUFBLFFBQzVDLFlBQ0UsV0FBVyxTQUFTLElBQ2hCLGFBQ0EsQ0FBQyxFQUFFLE1BQU0sK0JBQStCLENBQUM7QUFBQSxNQUNqRCxDQUFDO0FBQ0QsV0FBSyxLQUFLO0FBRVYsU0FBRyxpQkFBaUIseUJBQXlCLE1BQU07QUFDakQsWUFBSSxLQUFLLFNBQVU7QUFDbkIsY0FBTSxLQUFLLEdBQUc7QUFDZCxZQUFJLE9BQU8sWUFBYSxNQUFLLFNBQVMsV0FBVztBQUFBLGlCQUN4QyxPQUFPLFVBQVU7QUFHeEIsZ0JBQU0sT0FBTyxpQkFBaUIsS0FBSyxXQUFXO0FBQzlDLGVBQUssU0FBUyxJQUFJO0FBQ2xCLGNBQUksU0FBUyxRQUFTLE1BQUssS0FBSyxVQUFVLElBQUksTUFBTSwwQkFBMEIsQ0FBQztBQUFBLGVBSTFFO0FBQ0gsaUJBQUssS0FBSyxRQUFRO0FBQ2xCLGlCQUFLLHFCQUFxQjtBQUFBLFVBQzVCO0FBQUEsUUFDRixXQUFXLE9BQU8sWUFBWSxPQUFPLGdCQUFnQjtBQUNuRCxlQUFLLFNBQVMsY0FBYztBQUFBLFFBQzlCO0FBQUEsTUFDRixDQUFDO0FBRUQsU0FBRyxpQkFBaUIsU0FBUyxDQUFDLFVBQVU7QUFDdEMsWUFBSSxLQUFLLFNBQVU7QUFDbkIsY0FBTSxDQUFDQSxPQUFNLElBQUksTUFBTTtBQUN2QixZQUFJQSxRQUFRLE1BQUssS0FBSyxnQkFBZ0JBLE9BQU07QUFBQSxNQUM5QyxDQUFDO0FBRUQsWUFBTSxLQUFLLEdBQUcsa0JBQWtCLFNBQVM7QUFDekMsV0FBSyxLQUFLO0FBQ1YsU0FBRyxpQkFBaUIsUUFBUSxNQUFNO0FBQ2hDLFlBQUksQ0FBQyxLQUFLLFNBQVUsTUFBSyxxQkFBcUI7QUFBQSxNQUNoRCxDQUFDO0FBQ0QsU0FBRyxpQkFBaUIsV0FBVyxDQUFDLFVBQVU7QUFDeEMsWUFBSSxLQUFLLFlBQVksT0FBTyxNQUFNLFNBQVMsU0FBVTtBQUNyRCxZQUFJO0FBQ0YsZ0JBQU0sU0FBUyxLQUFLLE1BQU0sTUFBTSxJQUFJO0FBQ3BDLGNBQUksc0JBQXNCLE1BQU0sR0FBRztBQUNqQyxpQkFBSyxjQUFjO0FBQ25CLGtCQUFNLFNBQVUsT0FBTyxNQUEyQztBQUNsRSxpQkFBSyxvQkFBb0IsT0FBTyxXQUFXLFdBQVcsU0FBUyxJQUFJO0FBQUEsVUFDckU7QUFDQSxjQUFJLE9BQU8sU0FBUyxnQkFBZ0IsT0FBTyxTQUFTLFNBQVMsZUFBZTtBQUMxRSxpQkFBSyxLQUFLLFlBQVk7QUFDdEI7QUFBQSxVQUNGO0FBQ0EsZUFBSyxLQUFLLGVBQWUsTUFBTTtBQUFBLFFBQ2pDLFFBQVE7QUFBQSxRQUVSO0FBQUEsTUFDRixDQUFDO0FBSUQsWUFBTSxTQUFTLE1BQU0sS0FBSyxXQUFXO0FBQ3JDLFdBQUssY0FBYztBQUNuQixXQUFLLHNCQUFzQixJQUFJLE1BQU07QUFFckMsWUFBTSxLQUFLLFVBQVUsS0FBSztBQUFBLElBQzVCLFNBQVMsS0FBSztBQUNaLFdBQUssU0FBUyxPQUFPO0FBQ3JCLFlBQU0sS0FBSyxRQUFRO0FBQ25CLFlBQU0sUUFBUSxlQUFlLFFBQVEsTUFBTSxJQUFJLE1BQU0sMEJBQTBCO0FBQy9FLFdBQUssS0FBSyxVQUFVLEtBQUs7QUFDekIsWUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFVBQVUsaUJBQXlDO0FBQy9ELFVBQU0sS0FBSyxLQUFLO0FBQ2hCLFFBQUksQ0FBQyxHQUFJLE9BQU0sSUFBSSxNQUFNLHFCQUFxQjtBQUM5QyxVQUFNLFFBQVEsTUFBTSxHQUFHLFlBQVk7QUFBQSxNQUNqQyx3QkFBd0I7QUFBQSxJQUMxQixDQUFvQjtBQUNwQixRQUFJLE1BQU0sSUFBSyxPQUFNLE1BQU0sYUFBYSxNQUFNLEdBQUc7QUFDakQsVUFBTSxHQUFHLG9CQUFvQixLQUFLO0FBQ2xDLFVBQU0sb0JBQW9CLEVBQUU7QUFDNUIsVUFBTSxRQUFRLEdBQUc7QUFDakIsUUFBSSxDQUFDLE1BQU8sT0FBTSxJQUFJLE1BQU0sY0FBYztBQUUxQyxVQUFNLFFBQVEsQ0FBQyxLQUFLLFFBQVEsY0FBYyxLQUFLLFFBQVE7QUFDdkQsVUFBTSxPQUFnQyxRQUNsQyxFQUFFLG9CQUFvQixPQUFPLEtBQUssTUFBTSxLQUFLLE1BQU0sTUFBTSxLQUFLLElBQzlEO0FBQUEsTUFDRSxLQUFLLE1BQU07QUFBQSxNQUNYLE1BQU0sTUFBTTtBQUFBLE1BQ1osWUFBWSxLQUFLLFFBQVE7QUFBQSxNQUN6QixjQUFjLEVBQUUsWUFBWSxLQUFLLFFBQVEsV0FBVztBQUFBLElBQ3REO0FBQ0osUUFBSSxLQUFLLEtBQU0sTUFBSyxRQUFRLEtBQUs7QUFDakMsUUFBSSxnQkFBaUIsTUFBSyxhQUFhO0FBRXZDLFVBQU0sVUFBa0M7QUFBQSxNQUN0QyxnQkFBZ0I7QUFBQSxNQUNoQixHQUFHLEtBQUssa0JBQWtCO0FBQUEsSUFDNUI7QUFDQSxvQkFBZ0IsU0FBUyxLQUFLLFFBQVEsYUFBYTtBQUNuRCxVQUFNLE1BQU0sTUFBTSxTQUFTLEVBQUUsTUFBTSxLQUFLLFFBQVEsZUFBZTtBQUFBLE1BQzdELFFBQVE7QUFBQSxNQUNSO0FBQUEsTUFDQSxNQUFNLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDM0IsQ0FBQztBQUNELFFBQUksQ0FBQyxJQUFJLElBQUk7QUFDWCxVQUFJLFNBQWtCO0FBQ3RCLFVBQUk7QUFDRixpQkFBUyxNQUFNLElBQUksS0FBSztBQUFBLE1BQzFCLFFBQVE7QUFBQSxNQUVSO0FBQ0EsWUFBTSxLQUFLLGlCQUFpQixJQUFJLFFBQVEsSUFBSSxZQUFZLE1BQU07QUFBQSxJQUNoRTtBQUNBLFVBQU0sU0FBVSxNQUFNLElBQUksS0FBSztBQUsvQixTQUFLLE9BQU8sT0FBTztBQUVuQixRQUFJLFNBQVMsT0FBTyxXQUFZLFFBQU8sT0FBTyxLQUFLLFNBQVMsaUJBQWlCLE1BQU0sQ0FBQztBQUNwRixVQUFNLEdBQUcscUJBQXFCLEVBQUUsS0FBSyxPQUFPLEtBQUssTUFBTSxPQUFPLEtBQUssQ0FBQztBQUFBLEVBQ3RFO0FBQUEsRUFFQSxNQUFjLGNBQTZCO0FBQ3pDLFFBQUksQ0FBQyxLQUFLLE1BQU0sS0FBSyxTQUFVO0FBQy9CLFFBQUk7QUFDRixZQUFNLEtBQUssVUFBVSxJQUFJO0FBQUEsSUFDM0IsU0FBUyxLQUFLO0FBQ1osV0FBSyxLQUFLLFVBQVUsZUFBZSxRQUFRLE1BQU0sSUFBSSxNQUFNLHNCQUFzQixDQUFDO0FBQUEsSUFDcEY7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBLEVBSUEsdUJBQTZCO0FBQzNCLFNBQUssaUJBQWlCO0FBQ3RCLFNBQUsscUJBQXFCO0FBQUEsRUFDNUI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBU0EsYUFBYSxNQUF1QjtBQUNsQyxVQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFFBQUksQ0FBQyxRQUFTLFFBQU87QUFDckIsUUFBSSxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsZUFBZSxPQUFRLFFBQU87QUFDdEQsU0FBSyxHQUFHLEtBQUssS0FBSyxVQUFVLHNCQUFzQixPQUFPLENBQUMsQ0FBQztBQUMzRCxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBUUEscUJBQXFCLFlBQW9CLFFBQWdCLFVBQVUsT0FBZ0I7QUFDakYsUUFBSSxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsZUFBZSxPQUFRLFFBQU87QUFDdEQsU0FBSyxHQUFHLEtBQUssS0FBSyxVQUFVLGdDQUFnQyxZQUFZLFFBQVEsT0FBTyxDQUFDLENBQUM7QUFDekYsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVFBLG9CQUFvQixZQUFvQixZQUE4QjtBQUNwRSxRQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxlQUFlLE9BQVEsUUFBTztBQUN0RCxTQUFLLEdBQUcsS0FBSyxLQUFLLFVBQVUsNkJBQTZCLFlBQVksVUFBVSxDQUFDLENBQUM7QUFDakYsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBU0EscUJBQXFCLE1BQWMsV0FBNkI7QUFDOUQsUUFBSSxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsZUFBZSxPQUFRLFFBQU87QUFDdEQsU0FBSyxHQUFHLEtBQUssS0FBSyxVQUFVLDZCQUE2QixNQUFNLFNBQVMsQ0FBQyxDQUFDO0FBQzFFLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsbUJBQTRCO0FBQzFCLFdBQU8sS0FBSyxVQUFVLDBCQUEwQixDQUFDO0FBQUEsRUFDbkQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxhQUFhLE9BQWtDLFNBQTBCO0FBQ3ZFLFdBQU8sS0FBSyxVQUFVLHNCQUFzQixPQUFPLE9BQU8sQ0FBQztBQUFBLEVBQzdEO0FBQUEsRUFFUSx1QkFBNkI7QUFDbkMsUUFBSSxLQUFLLG1CQUFtQixDQUFDLEtBQUssZUFBZ0I7QUFDbEQsUUFBSSxDQUFDLEtBQUssTUFBTSxLQUFLLEdBQUcsZUFBZSxPQUFRO0FBQy9DLFVBQU0sT0FBTyxLQUFLLGdCQUFnQjtBQUNsQyxTQUFLLEdBQUc7QUFBQSxNQUNOLEtBQUssVUFBVTtBQUFBLFFBQ2IsT0FBTztBQUFBLFFBQ1AsTUFBTTtBQUFBLFFBQ04sSUFBSSxnQkFBZ0IsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxRQUMzQyxHQUFJLE9BQU8sRUFBRSxLQUFLLElBQUksQ0FBQztBQUFBLE1BQ3pCLENBQUM7QUFBQSxJQUNIO0FBQ0EsU0FBSyxrQkFBa0I7QUFBQSxFQUN6QjtBQUFBLEVBRUEscUJBQXFCLFNBQXdCO0FBQzNDLFFBQUksQ0FBQyxLQUFLLFlBQWE7QUFDdkIsZUFBVyxTQUFTLEtBQUssWUFBWSxlQUFlLEVBQUcsT0FBTSxVQUFVO0FBQUEsRUFDekU7QUFBQSxFQUVBLE1BQU0sYUFBNEI7QUFDaEMsU0FBSyxXQUFXO0FBTWhCLFVBQU0sUUFBUSxLQUFLLGVBQWU7QUFDbEMsUUFBSSxLQUFLLGFBQWE7QUFBQSxJQUd0QixXQUFXLENBQUMsTUFBTSxlQUFlO0FBQy9CLGNBQVEsS0FBSyxLQUFLLGtCQUFrQixTQUFTLENBQUM7QUFBQSxJQUNoRCxPQUFPO0FBQ0wsVUFBSTtBQUNGLGNBQU0sTUFBTSxNQUFNLFNBQVMsRUFBRSxNQUFNLEtBQUssbUJBQW1CLEdBQUc7QUFBQSxVQUM1RCxRQUFRO0FBQUEsVUFDUixTQUFTLEtBQUssa0JBQWtCO0FBQUEsVUFDaEMsTUFBTSxLQUFLLFVBQVUsS0FBSztBQUFBLFVBQzFCLFdBQVc7QUFBQSxRQUNiLENBQUM7QUFDRCxZQUFJLENBQUMsSUFBSSxJQUFJO0FBRVgsa0JBQVEsS0FBSyxLQUFLLGtCQUFrQixZQUFZLElBQUksTUFBTSxDQUFDO0FBQUEsUUFDN0Q7QUFBQSxNQUNGLFFBQVE7QUFBQSxNQUVSO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSyxRQUFRO0FBQ25CLFNBQUssU0FBUyxjQUFjO0FBQUEsRUFDOUI7QUFBQSxFQUVBLE1BQWMsVUFBeUI7QUFDckMsUUFBSTtBQUNGLFdBQUssSUFBSSxNQUFNO0FBQUEsSUFDakIsUUFBUTtBQUFBLElBRVI7QUFDQSxTQUFLLEtBQUs7QUFDVixRQUFJO0FBQ0YsV0FBSyxJQUFJLE1BQU07QUFBQSxJQUNqQixRQUFRO0FBQUEsSUFFUjtBQUNBLFNBQUssS0FBSztBQUNWLFFBQUksS0FBSyxhQUFhO0FBQ3BCLGlCQUFXLFNBQVMsS0FBSyxZQUFZLFVBQVUsRUFBRyxPQUFNLEtBQUs7QUFDN0QsV0FBSyxjQUFjO0FBQUEsSUFDckI7QUFBQSxFQUNGO0FBQ0Y7QUFLTyxTQUFTLHNCQUFzQixTQUEwQztBQUM5RSxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGFBQWEsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxJQUN4QyxNQUFNO0FBQUEsTUFDSjtBQUFBLE1BQ0EsU0FBUyxFQUFFLGlCQUFpQixNQUFNLGdCQUFnQixLQUFLO0FBQUEsSUFDekQ7QUFBQSxFQUNGO0FBQ0Y7QUFLTyxTQUFTLGdDQUNkLFlBQ0EsUUFDQSxTQUN5QjtBQUN6QixTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGVBQWUsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxJQUMxQyxNQUFNLEVBQUUsY0FBYyxZQUFZLFFBQVEsVUFBVSxRQUFRO0FBQUEsRUFDOUQ7QUFDRjtBQUdPLFNBQVMsNkJBQ2QsWUFDQSxZQUN5QjtBQUN6QixTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGdCQUFnQixLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUFBLElBQzNDLE1BQU0sRUFBRSxjQUFjLFlBQVksYUFBYSxXQUFXO0FBQUEsRUFDNUQ7QUFDRjtBQVlPLFNBQVMsNkJBQ2QsTUFDQSxXQUN5QjtBQUN6QixRQUFNLE9BQWdDLEVBQUUsS0FBSztBQUM3QyxNQUFJLGNBQWMsT0FBVyxNQUFLLGFBQWE7QUFDL0MsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sSUFBSSxXQUFXLEtBQUssSUFBSSxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQ0Y7QUFrQ08sU0FBUyw0QkFBcUQ7QUFDbkUsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sSUFBSSxpQkFBaUIsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxFQUM5QztBQUNGO0FBR08sU0FBUyxzQkFDZCxPQUNBLFNBQ3lCO0FBQ3pCLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLElBQUksWUFBWSxLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUFBLElBQ3ZDLE1BQU0sRUFBRSxPQUFPLFVBQVUsUUFBUTtBQUFBLEVBQ25DO0FBQ0Y7QUFHQSxTQUFTLGlCQUFpQixRQUEwRTtBQUNsRyxRQUFNLEVBQUUsWUFBWSxlQUFlLGdCQUFnQixJQUFJO0FBQ3ZELFNBQU8sRUFBRSxZQUFZLGVBQWUsaUJBQWlCLG1CQUFtQixHQUFHO0FBQzdFO0FBRUEsU0FBUyxnQkFDUCxTQUNBLFNBQ007QUFDTixhQUFXLFFBQVEsQ0FBQyxlQUFlLFlBQVksR0FBWTtBQUN6RCxVQUFNLFFBQVEsVUFBVSxJQUFJO0FBQzVCLFFBQUksTUFBTyxTQUFRLElBQUksSUFBSTtBQUFBLEVBQzdCO0FBQ0Y7QUFFQSxTQUFTLGNBQWMsY0FBOEI7QUFDbkQsUUFBTSxNQUFNLElBQUksSUFBSSxZQUFZO0FBQ2hDLE1BQUksV0FBVyxJQUFJLFNBQVMsUUFBUSxvQkFBb0IsaUJBQWlCO0FBQ3pFLE1BQUksU0FBUztBQUNiLE1BQUksT0FBTztBQUNYLFNBQU8sSUFBSSxTQUFTO0FBQ3RCO0FBR0EsU0FBUyxvQkFBb0IsSUFBc0M7QUFDakUsTUFBSSxHQUFHLHNCQUFzQixXQUFZLFFBQU8sUUFBUSxRQUFRO0FBQ2hFLFNBQU8sSUFBSSxRQUFRLENBQUMsWUFBWTtBQUM5QixVQUFNLFVBQVUsU0FBUyxFQUFFLFdBQVcsTUFBTTtBQUMxQyxTQUFHLG9CQUFvQiwyQkFBMkIsS0FBSztBQUN2RCxjQUFRO0FBQUEsSUFDVixHQUFHLEdBQUc7QUFDTixVQUFNLFFBQVEsTUFBTTtBQUNsQixVQUFJLEdBQUcsc0JBQXNCLFlBQVk7QUFDdkMscUJBQWEsT0FBTztBQUNwQixXQUFHLG9CQUFvQiwyQkFBMkIsS0FBSztBQUN2RCxnQkFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQ0EsT0FBRyxpQkFBaUIsMkJBQTJCLEtBQUs7QUFBQSxFQUN0RCxDQUFDO0FBQ0g7QUFLTyxTQUFTLGFBQWEsS0FBcUI7QUFDaEQsUUFBTSxVQUFVLENBQUMsR0FBRyxJQUFJLFNBQVMsZ0NBQWdDLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztBQUNuRixNQUFJLFFBQVEsV0FBVyxFQUFHLFFBQU87QUFFakMsUUFBTSxXQUFXLG9CQUFJLElBQVk7QUFDakMsUUFBTSxRQUFRLElBQUksTUFBTSxTQUFTO0FBQ2pDLFFBQU0sTUFBTSxNQUFNLElBQUksQ0FBQyxTQUFTO0FBQzlCLFVBQU0sSUFBSSxLQUFLLE1BQU0sd0JBQXdCO0FBQzdDLFFBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUcsUUFBTztBQUMxQyxhQUFTLElBQUksRUFBRSxDQUFDLENBQUU7QUFDbEIsV0FBTyxVQUFVLEVBQUUsQ0FBQyxDQUFDLElBQUksbUJBQW1CLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUFBLEVBQ3pELENBQUM7QUFFRCxRQUFNLFVBQVUsUUFBUSxPQUFPLENBQUMsT0FBTyxPQUFPLFVBQWEsQ0FBQyxTQUFTLElBQUksRUFBRSxDQUFDO0FBQzVFLE1BQUksUUFBUSxXQUFXLEVBQUcsUUFBTyxJQUFJLEtBQUssTUFBTTtBQUVoRCxRQUFNLFdBQXFCLENBQUM7QUFDNUIsYUFBVyxRQUFRLEtBQUs7QUFDdEIsYUFBUyxLQUFLLElBQUk7QUFDbEIsVUFBTSxLQUFLLEtBQUssTUFBTSw4QkFBOEI7QUFDcEQsUUFBSSxNQUFNLFFBQVEsU0FBUyxHQUFHLENBQUMsQ0FBQyxHQUFHO0FBQ2pDLGVBQVMsS0FBSyxVQUFVLEdBQUcsQ0FBQyxDQUFDLDBCQUEwQjtBQUFBLElBQ3pEO0FBQUEsRUFDRjtBQUNBLFNBQU8sU0FBUyxLQUFLLE1BQU07QUFDN0I7QUFFQSxTQUFTLG1CQUFtQixRQUF3QjtBQUNsRCxNQUFJLE9BQU8sV0FBVyxLQUFLLE1BQU0sSUFDN0IsT0FBTyxRQUFRLGVBQWUsVUFBVSxJQUN4QyxHQUFHLE1BQU07QUFDYixTQUFPLGlCQUFpQixLQUFLLElBQUksSUFDN0IsS0FBSyxRQUFRLHFCQUFxQixnQkFBZ0IsSUFDbEQsR0FBRyxJQUFJO0FBQ1gsU0FBTztBQUNUOzs7QUZwdkJBLElBQU0sYUFBTixNQUFpQjtBQUFBLEVBQWpCO0FBQ0UsU0FBaUIsWUFBWSxvQkFBSSxJQUF3QjtBQUFBO0FBQUEsRUFDekQsaUJBQWlCLE1BQWMsSUFBb0I7QUFDakQsU0FBSyxVQUFVLElBQUksTUFBTSxDQUFDLEdBQUksS0FBSyxVQUFVLElBQUksSUFBSSxLQUFLLENBQUMsR0FBSSxFQUFFLENBQUM7QUFBQSxFQUNwRTtBQUFBLEVBQ0Esb0JBQW9CLE1BQWMsSUFBb0I7QUFDcEQsU0FBSyxVQUFVLElBQUksT0FBTyxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssQ0FBQyxHQUFHLE9BQU8sQ0FBQyxNQUFNLE1BQU0sRUFBRSxDQUFDO0FBQUEsRUFDbkY7QUFBQSxFQUNBLEtBQUssTUFBYyxRQUFpQixDQUFDLEdBQVM7QUFDNUMsZUFBVyxNQUFNLENBQUMsR0FBSSxLQUFLLFVBQVUsSUFBSSxJQUFJLEtBQUssQ0FBQyxDQUFFLEVBQUcsSUFBRyxLQUFLO0FBQUEsRUFDbEU7QUFDRjtBQUVBLElBQU0sa0JBQU4sY0FBOEIsV0FBVztBQUFBLEVBQXpDO0FBQUE7QUFDRSxzQkFBYTtBQUFBO0FBQUEsRUFDYixPQUFhO0FBQUEsRUFBQztBQUFBLEVBQ2QsUUFBYztBQUNaLFNBQUssYUFBYTtBQUFBLEVBQ3BCO0FBQ0Y7QUFFQSxJQUFNLHFCQUFOLE1BQU0sNEJBQTJCLFdBQVc7QUFBQSxFQU0xQyxjQUFjO0FBQ1osVUFBTTtBQUxSLDJCQUFrQjtBQUNsQiw2QkFBb0I7QUFDcEIsNEJBQXlEO0FBQ3pELFNBQVMsS0FBSyxJQUFJLGdCQUFnQjtBQUdoQyx3QkFBbUIsT0FBTztBQUFBLEVBQzVCO0FBQUEsRUFSQTtBQUFBLFNBQU8sT0FBa0M7QUFBQTtBQUFBLEVBU3pDLG9CQUFxQztBQUNuQyxXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFDQSxXQUFpQjtBQUFBLEVBQUM7QUFBQSxFQUNsQixhQUF3QjtBQUN0QixXQUFPLENBQUM7QUFBQSxFQUNWO0FBQUEsRUFDQSxNQUFNLGNBQXNEO0FBQzFELFdBQU8sRUFBRSxLQUFLLFdBQVcsTUFBTSxRQUFRO0FBQUEsRUFDekM7QUFBQSxFQUNBLE1BQU0sb0JBQW9CLEdBQWlEO0FBQ3pFLFNBQUssbUJBQW1CO0FBQUEsRUFDMUI7QUFBQSxFQUNBLE1BQU0sdUJBQXNDO0FBQUEsRUFBQztBQUFBLEVBQzdDLFFBQWM7QUFDWixTQUFLLGtCQUFrQjtBQUFBLEVBQ3pCO0FBQ0Y7QUFFQSxRQUFRLElBQUksWUFBWSxxQkFBcUIsa0JBQWtCO0FBQy9ELElBQU0sYUFBdUIsQ0FBQztBQUM5QixRQUFRLElBQUksWUFBWSxTQUFTLE9BQU8sUUFBaUI7QUFDdkQsYUFBVyxLQUFLLE9BQU8sR0FBRyxDQUFDO0FBQzNCLFNBQU87QUFBQSxJQUNMLElBQUk7QUFBQSxJQUNKLE1BQU0sYUFBYSxFQUFFLEtBQUssV0FBVyxNQUFNLFVBQVUsT0FBTyxPQUFPO0FBQUEsRUFDckU7QUFDRixDQUFDO0FBRUQsSUFBSSxZQUFZLEVBQUUsU0FBUyxHQUFHLFNBQVMsTUFBTSxPQUFPO0FBQUMsRUFBRTtBQUN2RCxPQUFPLGVBQWUsWUFBWSxhQUFhO0FBQUEsRUFDN0MsY0FBYztBQUFBLEVBQ2QsT0FBTztBQUFBLElBQ0wsY0FBYztBQUFBLE1BQ1osY0FBYyxZQUFZO0FBQ3hCLGNBQU0sUUFBUTtBQUFBLFVBQ1osU0FBUztBQUFBLFVBQ1QsU0FBUztBQUFBLFVBQ1QsT0FBTztBQUNMLGlCQUFLLFdBQVc7QUFBQSxVQUNsQjtBQUFBLFFBQ0Y7QUFDQSxvQkFBWTtBQUNaLGVBQU8sRUFBRSxnQkFBZ0IsTUFBTSxDQUFDLEtBQUssR0FBRyxXQUFXLE1BQU0sQ0FBQyxLQUFLLEVBQUU7QUFBQSxNQUNuRTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQztBQUVELElBQU0sUUFBUSxLQUFLLFVBQVU7QUFBQSxFQUMzQixPQUFPO0FBQUEsRUFDUCxNQUFNO0FBQUEsRUFDTixNQUFNLEVBQUUsTUFBTSxpQkFBaUIsUUFBUSxXQUFXO0FBQ3BELENBQUM7QUFFRCxlQUFlLGtCQUFrQjtBQUMvQixRQUFNLFNBQW1CLENBQUM7QUFDMUIsUUFBTSxTQUFtQixDQUFDO0FBQzFCLFFBQU0sU0FBUyxJQUFJO0FBQUEsSUFDakI7QUFBQSxNQUNFLFlBQVk7QUFBQSxNQUNaLGVBQWU7QUFBQSxNQUNmLGlCQUFpQjtBQUFBLE1BQ2pCLGVBQWU7QUFBQSxJQUNqQjtBQUFBLElBQ0EsRUFBRSxlQUFlLENBQUMsTUFBTSxPQUFPLEtBQUssQ0FBQyxHQUFHLFNBQVMsQ0FBQyxNQUFNLE9BQU8sS0FBSyxFQUFFLE9BQU8sRUFBRTtBQUFBLEVBQ2pGO0FBQ0EsUUFBTSxPQUFPLFFBQVE7QUFDckIsUUFBTSxLQUFLLG1CQUFtQixRQUFRLE9BQU8sS0FBSyxtQ0FBbUM7QUFDckYsS0FBRyxrQkFBa0I7QUFDckIsS0FBRyxLQUFLLHVCQUF1QjtBQUMvQixTQUFPLEVBQUUsUUFBUSxJQUFJLFFBQVEsT0FBTztBQUN0QztBQUVBLEtBQUssaUZBQWlGLFlBQVk7QUFDaEcsUUFBTSxFQUFFLFFBQVEsSUFBSSxRQUFRLE9BQU8sSUFBSSxNQUFNLGdCQUFnQjtBQUM3RCxLQUFHLEdBQUcsS0FBSyxXQUFXLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDckMsS0FBRyxrQkFBa0I7QUFDckIsS0FBRyxLQUFLLHVCQUF1QjtBQUMvQixTQUFPLFVBQVUsUUFBUSxDQUFDLGNBQWMsYUFBYSxjQUFjLENBQUM7QUFDcEUsU0FBTyxVQUFVLFFBQVEsQ0FBQyxDQUFDO0FBQzNCLFNBQU8sTUFBTSxPQUFPLFNBQVMsR0FBRyxjQUFjO0FBRTlDLFNBQU8sTUFBTSxHQUFHLGlCQUFpQixRQUFRO0FBQ3pDLFNBQU8sTUFBTSxVQUFVLFNBQVMsR0FBRywyQkFBMkI7QUFHOUQsUUFBTSxTQUFTLFdBQVcsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLGlCQUFpQixDQUFDLEVBQUU7QUFDdkUsUUFBTSxPQUFPLFdBQVc7QUFDeEIsU0FBTyxNQUFNLFdBQVcsT0FBTyxDQUFDLE1BQU0sRUFBRSxTQUFTLGlCQUFpQixDQUFDLEVBQUUsUUFBUSxNQUFNO0FBQ25GLFNBQU8sTUFBTSxVQUFVLFNBQVMsQ0FBQztBQUNuQyxDQUFDO0FBRUQsS0FBSywyRkFBMkYsWUFBWTtBQUMxRyxRQUFNLEVBQUUsT0FBTyxJQUFJLE1BQU0sZ0JBQWdCO0FBQ3pDLFFBQU0sU0FBUyxXQUFXLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxpQkFBaUIsQ0FBQyxFQUFFO0FBQ3ZFLFFBQU0sT0FBTyxXQUFXO0FBQ3hCLFNBQU8sTUFBTSxXQUFXLE9BQU8sQ0FBQyxNQUFNLEVBQUUsU0FBUyxpQkFBaUIsQ0FBQyxFQUFFLFFBQVEsU0FBUyxDQUFDO0FBQ3ZGLFNBQU8sTUFBTSxVQUFVLFNBQVMsQ0FBQztBQUNuQyxDQUFDO0FBRUQsS0FBSyx1RUFBdUUsWUFBWTtBQUN0RixRQUFNLEVBQUUsSUFBSSxRQUFRLE9BQU8sSUFBSSxNQUFNLGdCQUFnQjtBQUNyRCxLQUFHLGtCQUFrQjtBQUNyQixLQUFHLEtBQUssdUJBQXVCO0FBQy9CLFNBQU8sVUFBVSxRQUFRLENBQUMsY0FBYyxhQUFhLE9BQU8sQ0FBQztBQUM3RCxTQUFPLFVBQVUsUUFBUSxDQUFDLDBCQUEwQixDQUFDO0FBQ3ZELENBQUM7QUFFRCxLQUFLLDBEQUEwRCxZQUFZO0FBQ3pFLFFBQU0sRUFBRSxJQUFJLFFBQVEsT0FBTyxJQUFJLE1BQU0sZ0JBQWdCO0FBQ3JELEtBQUcsR0FBRyxLQUFLLFdBQVc7QUFBQSxJQUNwQixNQUFNLEtBQUssVUFBVSxFQUFFLE9BQU8sY0FBYyxNQUFNLGtCQUFrQixNQUFNLEVBQUUsTUFBTSxnQkFBZ0IsRUFBRSxDQUFDO0FBQUEsRUFDdkcsQ0FBQztBQUNELEtBQUcsa0JBQWtCO0FBQ3JCLEtBQUcsS0FBSyx1QkFBdUI7QUFDL0IsU0FBTyxNQUFNLE9BQU8sR0FBRyxFQUFFLEdBQUcsT0FBTztBQUNuQyxTQUFPLFVBQVUsUUFBUSxDQUFDLDBCQUEwQixDQUFDO0FBQ3ZELENBQUM7IiwKICAibmFtZXMiOiBbInN0cmVhbSJdCn0K

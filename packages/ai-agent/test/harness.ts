// Shared fakes for the façade tests: a peer connection + data channel, a
// fetch router (token GET, offer POST, disconnect POST) and a recording
// getUserMedia. The server side is scripted: after the offer is answered the
// data channel opens, the agent's track arrives, then `bot-ready`.
import assert from "node:assert/strict";

type Listener = (event: unknown) => void;

export class FakeTarget {
  private readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  emit(type: string, event: unknown = {}): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
}

export class FakeDataChannel extends FakeTarget {
  readyState = "connecting";
  readonly sent: Array<Record<string, unknown>> = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = "closed";
  }
  /** Deliver one server → client RTVI envelope. */
  deliver(message: Record<string, unknown>): void {
    this.emit("message", { data: JSON.stringify({ label: "rtvi-ai", ...message }) });
  }
}

export class FakePeerConnection extends FakeTarget {
  static last: FakePeerConnection | null = null;
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription: { sdp: string; type: string } | null = null;
  readonly dc = new FakeDataChannel();
  readonly transceivers: Array<{ kind: string; init: unknown }> = [];
  tracks = 0;
  constructor(readonly config?: { iceServers?: unknown }) {
    super();
    FakePeerConnection.last = this;
  }
  createDataChannel(): FakeDataChannel {
    return this.dc;
  }
  addTransceiver(kind: string, init: unknown): void {
    this.transceivers.push({ kind, init });
  }
  addTrack(): void {
    this.tracks += 1;
  }
  async createOffer(): Promise<{ sdp: string; type: string }> {
    return { sdp: "v=0\r\na=rtpmap:111 opus/48000/2\r\n", type: "offer" };
  }
  async setLocalDescription(d: { sdp: string; type: string }): Promise<void> {
    this.localDescription = d;
  }
  async setRemoteDescription(): Promise<void> {}
  close(): void {
    this.connectionState = "closed";
  }
  /** Drive a connection-state transition. */
  moveTo(state: string): void {
    this.connectionState = state;
    this.emit("connectionstatechange");
  }
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

export const server = {
  calls: [] as FetchCall[],
  gum: 0,
  tokenStatus: 200,
  /** Emit `bot-ready` once the offer is answered. */
  autoReady: true,
  token: {
    token: "cvsig_0123456789abcdef0123456789abcdef",
    conversation_id: "conv_11111111111111111111111111111111",
    signaling_url: "https://preview.test/api/offer",
    ice_servers: [{ urls: ["stun:stun.test:3478"] }],
  },
  answer: {
    sdp: "v=0\r\na=answer\r\n",
    type: "answer",
    pc_id: "pc-1",
    session_id: "sess_redeemed",
    session_token: "st_redeemed",
    conversation_id: "22222222-2222-2222-2222-222222222222",
  },
  reset(): void {
    this.calls = [];
    this.gum = 0;
    this.tokenStatus = 200;
    this.autoReady = true;
  },
};

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

Reflect.set(globalThis, "RTCPeerConnection", FakePeerConnection);
Reflect.set(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
  const call: FetchCall = {
    url: String(url),
    method: init?.method ?? "GET",
    headers: (init?.headers as Record<string, string>) ?? {},
    body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
  };
  server.calls.push(call);
  if (call.url.includes("/v1/convai/conversation/token")) {
    return {
      ok: server.tokenStatus < 300,
      status: server.tokenStatus,
      statusText: "refused",
      json: async () => (server.tokenStatus < 300 ? server.token : { detail: { message: "nope" } }),
    };
  }
  if (call.url.endsWith("/api/offer")) {
    const pc = FakePeerConnection.last!;
    setTimeout(() => {
      pc.dc.readyState = "open";
      pc.dc.emit("open");
      pc.emit("track", { streams: [{ id: "agent-audio", getTracks: () => [] }] });
      pc.moveTo("connected");
      if (server.autoReady) pc.dc.deliver({ type: "bot-ready", data: { version: "1.0.0" } });
    }, 1);
    return { ok: true, status: 200, json: async () => server.answer };
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async () => {
        server.gum += 1;
        const track = { enabled: true, stop() {} };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  },
});

export function peer(): FakePeerConnection {
  return FakePeerConnection.last ?? assert.fail("no peer connection was built");
}

/** Every callback name → the ordered log of (name, payload). */
export function recorder() {
  const log: Array<[string, unknown]> = [];
  const on = (name: string) => (...args: unknown[]) => log.push([name, args.length > 1 ? args : args[0]]);
  const callbacks = Object.fromEntries(
    [
      "onConnect", "onDisconnect", "onError", "onMessage", "onModeChange", "onStatusChange",
      "onCanSendFeedbackChange", "onUnhandledClientToolCall", "onMCPToolCall", "onMCPConnectionStatus",
      "onConversationMetadata", "onInterruption", "onAgentResponseCorrection", "onAgentChatResponsePart",
      "onAudioAlignment", "onDebug", "onConversationCreated",
    ].map((name) => [name, on(name)]),
  );
  return { log, callbacks, names: () => log.map(([name]) => name) };
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { VoiceClient } from "../src/voice";

// Golden audio-path envelope (E4 plan §5, A1 — VOSO-757). Records the FULL
// ordered sequence the widget's VoiceClient produces against a fake peer —
// peer config (fallback STUN), data-channel label, mic constraints (Q21: NS
// and AGC off), createOffer options, the Opus fmtp the offer is tuned to,
// the ICE-gather cap, every fetch (URL, method, headers, body), every
// data-channel frame and every state — and compares it byte-for-byte with
// test/golden/voice-client.json, recorded from the widget's voice.ts BEFORE
// it moved into @convoso/ai-agent. `GOLDEN_RECORD=1 npm test` rewrites the
// file; never re-record to make a change pass.

type Listener = (event: unknown) => void;
type Event = Record<string, unknown> & { kind: string };

const events: Event[] = [];
const record = (event: Event) => events.push(event);

/** `"<prefix>-<base36 clock>"` ids → `"<prefix>-ID"` (the clock is not the contract). */
function normalizeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] =
      key === "id" && typeof inner === "string"
        ? inner.replace(/^(.*)-[0-9a-z]+$/, "$1-ID")
        : normalizeIds(inner);
  }
  return out;
}

class FakeTarget {
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

class FakeDataChannel extends FakeTarget {
  readyState = "open";
  send(payload: string): void {
    record({ kind: "send", frame: normalizeIds(JSON.parse(payload)) });
  }
  close(): void {
    this.readyState = "closed";
  }
}

/** An offer with one Opus payload type and NO fmtp line, so the tuner's
 *  insertion is what the golden captures. */
const OFFER_SDP = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=sendrecv",
  "",
].join("\r\n");

class FakePeerConnection extends FakeTarget {
  static last: FakePeerConnection | null = null;
  connectionState = "new";
  // Never "complete": the ICE-gather cap's timer is what ends the wait.
  iceGatheringState = "gathering";
  localDescription: { sdp: string; type: string } | null = null;
  readonly dc = new FakeDataChannel();
  constructor(config: unknown) {
    super();
    FakePeerConnection.last = this;
    record({ kind: "pc", config });
  }
  createDataChannel(label: string): FakeDataChannel {
    record({ kind: "dc", label });
    return this.dc;
  }
  addTrack(): void {}
  getSenders(): unknown[] {
    return [];
  }
  async createOffer(options: unknown): Promise<{ sdp: string; type: string }> {
    record({ kind: "sdp", op: "createOffer", options });
    return { sdp: OFFER_SDP, type: "offer" };
  }
  async setLocalDescription(d: { sdp: string; type: string }): Promise<void> {
    record({ kind: "sdp", op: "setLocalDescription", type: d.type, sdp: d.sdp });
    this.localDescription = d;
  }
  async setRemoteDescription(d: { sdp: string; type: string }): Promise<void> {
    record({ kind: "sdp", op: "setRemoteDescription", type: d.type, sdp: d.sdp });
  }
  close(): void {
    this.connectionState = "closed";
  }
}

const realSetTimeout = globalThis.setTimeout;
const pause = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));

Reflect.set(globalThis, "RTCPeerConnection", FakePeerConnection);
Reflect.set(globalThis, "setTimeout", ((fn: () => void, delay?: number, ...rest: unknown[]) => {
  if (typeof delay === "number" && delay <= 1000) record({ kind: "timer", delay });
  return realSetTimeout(fn, delay, ...rest);
}) as typeof setTimeout);
let fetches = 0;
Reflect.set(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
  fetches += 1;
  record({
    kind: "fetch",
    url: String(url),
    method: init?.method ?? "GET",
    headers: init?.headers ?? {},
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    ...(init?.keepalive !== undefined ? { keepalive: init.keepalive } : {}),
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({ sdp: "v=0\r\na=answer\r\n", type: "answer", pc_id: `pc-${fetches}` }),
  };
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async (constraints: unknown) => {
        record({ kind: "gum", constraints });
        const track = { enabled: true, stop() {} };
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  },
});

function newClient(): VoiceClient {
  return new VoiceClient(
    {
      session_id: "sess_golden",
      session_token: "st_golden",
      conversation_id: "conv-golden",
      signaling_url: "https://preview.test/api/offer",
      trace_context: { traceparent: "00-aaaa-bbbb-01", tracestate: "voso=1" },
    },
    { onStateChange: (state) => record({ kind: "state", state }) },
  );
}

async function waitForFetches(n: number): Promise<void> {
  for (let i = 0; i < 200 && fetches < n; i += 1) await pause(5);
  assert.ok(fetches >= n, `expected ${n} fetches, saw ${fetches}`);
}

test("golden: the widget voice client's audio path is byte-identical", async () => {
  // Scenario 1 — a call the agent ends: connect, client-ready latch, every
  // outbound envelope, a server renegotiation, the session-ended latch (no
  // disconnect POST after it).
  record({ kind: "scenario", name: "agent-ended" });
  const client = newClient();
  await client.connect();
  const pc = FakePeerConnection.last ?? assert.fail("connect() built a peer connection");
  pc.connectionState = "connected";
  pc.emit("connectionstatechange");
  pc.dc.emit("open"); // latch: channel open, audio not rendering → no client-ready yet
  client.notifyAudioRendering(); // → client-ready
  client.sendUserText("hi");
  client.sendClientToolResult("t1", "ok", false);
  client.sendMcpToolApproval("m1", true);
  client.sendContextualUpdate("ctx", "c1");
  pc.dc.emit("message", {
    data: JSON.stringify({ label: "rtvi-ai", type: "signalling", message: { type: "renegotiate" } }),
  });
  await waitForFetches(2);
  await pause(5);
  pc.dc.emit("message", {
    data: JSON.stringify({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: "session-ended", reason: "end_call" },
    }),
  });
  await client.disconnect();

  // Scenario 2 — the user hangs up: the ownership-token disconnect POST.
  record({ kind: "scenario", name: "user-ended" });
  const second = newClient();
  await second.connect();
  await second.disconnect();

  const actual = `${JSON.stringify(events, null, 2)}\n`;
  const file = new URL("../test/golden/voice-client.json", import.meta.url);
  if (process.env.GOLDEN_RECORD === "1") writeFileSync(file, actual);
  assert.equal(actual, readFileSync(file, "utf8"));
});

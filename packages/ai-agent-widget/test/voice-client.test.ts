import test from "node:test";
import assert from "node:assert/strict";
import { VoiceClient } from "../src/voice";

// VOSO-658, client level: the real VoiceClient wiring through a mocked
// RTCPeerConnection + data channel. A `session-ended` announcement followed
// by a peer `failed` must end quietly; a `failed` with no announcement must
// still surface "WebRTC connection failed".

type Listener = (event: unknown) => void;

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
  send(): void {}
  close(): void {
    this.readyState = "closed";
  }
}

class FakePeerConnection extends FakeTarget {
  static last: FakePeerConnection | null = null;
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription: { sdp: string; type: string } | null = null;
  readonly dc = new FakeDataChannel();
  constructor() {
    super();
    FakePeerConnection.last = this;
  }
  createDataChannel(): FakeDataChannel {
    return this.dc;
  }
  addTrack(): void {}
  getSenders(): unknown[] {
    return [];
  }
  async createOffer(): Promise<{ sdp: string; type: string }> {
    return { sdp: "v=0\r\n", type: "offer" };
  }
  async setLocalDescription(d: { sdp: string; type: string }): Promise<void> {
    this.localDescription = d;
  }
  async setRemoteDescription(): Promise<void> {}
  close(): void {
    this.connectionState = "closed";
  }
}

Reflect.set(globalThis, "RTCPeerConnection", FakePeerConnection);
const fetchCalls: string[] = [];
Reflect.set(globalThis, "fetch", async (url: unknown) => {
  fetchCalls.push(String(url));
  return {
    ok: true,
    json: async () => ({ sdp: "v=0\r\n", type: "answer", pc_id: "pc-1" }),
  };
});
/** The mic track the mocked getUserMedia handed out last. */
let lastTrack = { stopped: 0, enabled: true, stop() {} };
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
          },
        };
        lastTrack = track;
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  },
});

const ENDED = JSON.stringify({
  label: "rtvi-ai",
  type: "server-message",
  data: { type: "session-ended", reason: "end_node" },
});

async function connectedClient() {
  const states: string[] = [];
  const errors: string[] = [];
  const client = new VoiceClient(
    {
      session_id: "s-1",
      session_token: "tok-1",
      conversation_id: "c-1",
      signaling_url: "http://preview.test/api/offer",
    },
    { onStateChange: (s) => states.push(s), onError: (e) => errors.push(e.message) },
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
  // Peer AND microphone released on the announced end.
  assert.equal(pc.connectionState, "closed");
  assert.equal(lastTrack.stopped, 1, "the mic track was stopped");
  // The widget's endCall still calls disconnect(): no /api/disconnect POST
  // after the worker's own announcement, and the mic is not stopped twice.
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
    data: JSON.stringify({ label: "voso-debug", type: "server-message", data: { type: "session-ended" } }),
  });
  pc.connectionState = "failed";
  pc.emit("connectionstatechange");
  assert.equal(states.at(-1), "error");
  assert.deepEqual(errors, ["WebRTC connection failed"]);
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, server } from "./harness";
import { Conversation, NO_VOLUME, SessionConnectionError } from "../src/index";
import { setPlatform } from "../src/internal";
import { RN_WEBSOCKET_REJECTION } from "../src/internal/session-resolver";

// E4 P2 — the seams @convoso/ai-agent-react-native plugs (§4.3, Q20):
// `name` (client-ready.about.platform), `volumeProvider` (0 on RN) and the
// native `audioSession` (started before connecting, stopped on end AND on a
// failed connect). The web defaults stay byte-identical (golden test).

const AGENT = "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6";
const events: string[] = [];

beforeEach(() => {
  server.reset();
  events.length = 0;
  setPlatform({
    name: "react-native",
    volumeProvider: () => NO_VOLUME,
    audioSession: { start: () => events.push("start"), stop: () => events.push("stop") },
  });
});

test("platform: about.platform follows the platform name; volume reads are 0 (Q20)", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  const ready = peer().dc.sent.find((frame) => frame.type === "client-ready")!;
  assert.equal((ready.data as { about: { platform: string } }).about.platform, "react-native");
  assert.equal(conversation.getInputVolume(), 0);
  assert.equal(conversation.getOutputVolume(), 0);
  assert.equal(conversation.getOutputByteFrequencyData().length, 0);
  await conversation.endSession();
  assert.deepEqual(events, ["start", "stop"]);
});

test("platform: a failed connect stops the audio session (§11 T26)", async () => {
  server.tokenStatus = 404;
  await assert.rejects(Conversation.startSession({ agentId: AGENT, origin: "https://api.test" }), SessionConnectionError);
  assert.deepEqual(events, ["start", "stop"]);
});

test("platform: text sessions never touch the audio session", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test", textOnly: true });
  await conversation.endSession();
  assert.deepEqual(events, []);
});

test("platform: React Native refuses a WebSocket session with the vendor's sentence", async () => {
  await assert.rejects(
    Conversation.startSession({ signedUrl: "wss://api.test/v1/convai/conversation?x=1" }),
    (err: Error) => err.message === RN_WEBSOCKET_REJECTION,
  );
  assert.deepEqual(events, ["start", "stop"]);
});

test("platform: both volume providers are closed when the session ends (no AudioContext leak)", async () => {
  let opened = 0;
  let closed = 0;
  setPlatform({
    name: "web",
    volumeProvider: () => {
      opened += 1;
      return { ...NO_VOLUME, close: () => void (closed += 1) };
    },
  });
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  assert.equal(opened, 2, "one provider for the mic, one for the agent's audio");
  assert.equal(closed, 0);
  await conversation.endSession();
  assert.equal(closed, 2);
});

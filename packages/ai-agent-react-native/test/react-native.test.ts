import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, server } from "../../ai-agent/test/harness";
import { calls } from "./stubs/react-native-incall-manager";
import {
  Conversation,
  ConversationProvider,
  useConversation,
  useConversationClientTool,
  SessionConnectionError,
} from "../src/index";
import { sourceInfo } from "../../ai-agent/src/internal/source-info";
import { platform } from "../../ai-agent/src/internal/platform";
import { RN_WEBSOCKET_REJECTION } from "../../ai-agent/src/internal/session-resolver";

// E4 P2 (Q5 / Q20 / §4.7): what importing @convoso/ai-agent-react-native does
// to the ONE core, over react-native-webrtc / incall-manager stand-ins.

const AGENT = "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6";

beforeEach(() => {
  server.reset();
  calls.length = 0;
});

test("rn: importing plugs react-native-webrtc and marks the source", () => {
  assert.equal(platform().name, "react-native");
  assert.equal(sourceInfo().source, "react_native_sdk");
  assert.equal(typeof ConversationProvider, "function");
  assert.equal(typeof useConversation, "function");
  assert.equal(typeof useConversationClientTool, "function");
});

test("rn: a voice session publishes the mic through the RN peer; about.platform is react-native", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  assert.equal(server.gum, 1, "the mic came from react-native-webrtc's mediaDevices");
  const ready = peer().dc.sent.find((f) => f.type === "client-ready")!;
  assert.equal((ready.data as { about: { platform: string } }).about.platform, "react-native");
  await conversation.endSession();
});

test("rn (Q20): volume and frequency reads are 0 / empty", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  assert.equal(conversation.getInputVolume(), 0);
  assert.equal(conversation.getOutputVolume(), 0);
  assert.equal(conversation.getInputByteFrequencyData().length, 0);
  assert.equal(conversation.getOutputByteFrequencyData().length, 0);
  await conversation.endSession();
});

test("rn: speaker routing starts before connecting and stops on end", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  assert.deepEqual(calls, ["start:audio", "speaker:true"]);
  await conversation.endSession();
  assert.deepEqual(calls, ["start:audio", "speaker:true", "stop"]);
});

test("rn: a failed connect releases the audio session (the vendor leaks it, §11 T26)", async () => {
  server.tokenStatus = 404;
  await assert.rejects(Conversation.startSession({ agentId: AGENT, origin: "https://api.test" }), SessionConnectionError);
  assert.deepEqual(calls, ["start:audio", "speaker:true", "stop"]);
});

test("rn: a WebSocket session is refused with the vendor's sentence", async () => {
  await assert.rejects(
    Conversation.startSession({ agentId: AGENT, connectionType: "websocket" }),
    (err: Error) => err.message === RN_WEBSOCKET_REJECTION,
  );
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, server } from "./harness";
import { Conversation, TextConversation } from "../src/index";

beforeEach(() => server.reset());

test("text (Q19): no microphone, a receive-only audio transceiver, client-ready on channel open", async () => {
  server.autoReady = true;
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    textOnly: true,
  });
  assert.ok(conversation instanceof TextConversation);
  assert.equal(server.gum, 0, "getUserMedia was never called");
  const pc = peer();
  assert.equal(pc.tracks, 0);
  assert.deepEqual(pc.transceivers, [{ kind: "audio", init: { direction: "recvonly" } }]);
  assert.equal(pc.dc.sent[0]?.type, "client-ready", "client-ready on data-channel open");
  conversation.sendUserMessage("hello");
  assert.deepEqual(pc.dc.sent.at(-1)?.data, {
    content: "hello",
    options: { run_immediately: true, audio_response: true },
  });
  assert.throws(() => conversation.setVolume({ volume: 0.5 }), /not supported in text conversations/);
  assert.throws(() => conversation.setMicMuted(true), /not supported in text conversations/);
  assert.equal(conversation.getOutputVolume(), 0);
  assert.equal(conversation.getInputByteFrequencyData().length, 0);
  await conversation.endSession();
});

test("text (Q26): root-level textOnly is honoured and wins over overrides", async () => {
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    const conversation = await Conversation.startSession({
      agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
      origin: "https://api.test",
      textOnly: true,
      overrides: { conversation: { textOnly: false } },
    });
    assert.ok(conversation instanceof TextConversation);
    assert.equal(warnings.length, 1);
    await conversation.endSession();
  } finally {
    console.warn = warn;
  }
});

test("text: overrides.conversation.textOnly alone selects the text transport", async () => {
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    overrides: { conversation: { textOnly: true } },
  });
  assert.ok(conversation instanceof TextConversation);
  await conversation.endSession();
});

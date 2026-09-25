import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, recorder, server, tick } from "./harness";
import { Conversation } from "../src/index";
import { PASSTHROUGH, RTVI_TO_CALLBACK } from "../src/internal/rtvi-events";

beforeEach(() => server.reset());

async function connected() {
  const rec = recorder();
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    ...rec.callbacks,
  });
  await tick(2);
  rec.log.length = 0;
  return { conversation, ...rec, dc: peer().dc };
}

test("rtvi: bot-ready follows the vendor's WebRTC order, metadata after startSession resolves", async () => {
  const rec = recorder();
  const started = Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    ...rec.callbacks,
  });
  const conversation = await started;
  assert.deepEqual(rec.names(), [
    "onStatusChange",
    "onCanSendFeedbackChange",
    "onConversationCreated",
    "onStatusChange",
    "onCanSendFeedbackChange",
    "onConnect",
  ]);
  assert.deepEqual(rec.log[3]![1], { status: "connected" });
  await tick(2);
  assert.equal(rec.names().at(-1), "onConversationMetadata");
  await conversation.endSession();
});

/** One representative envelope per mapped type → the callback it must fire. */
const SAMPLES: Record<keyof typeof RTVI_TO_CALLBACK, [Record<string, unknown>, string]> = {
  "bot-ready": [{ type: "bot-ready", data: { version: "1.0.0" } }, "onDebug"], // already connected: ignored
  "bot-started-speaking": [{ type: "bot-started-speaking" }, "onModeChange"],
  "bot-stopped-speaking": [{ type: "bot-stopped-speaking" }, "onModeChange"],
  "bot-output": [{ type: "bot-output", data: { text: "Hello.", spoken: true, aggregated_by: "sentence" } }, "onMessage"],
  "bot-output-correction": [{ type: "bot-output-correction", data: { original: "Hello there.", corrected: "Hello" } }, "onAgentResponseCorrection"],
  "user-transcription": [{ type: "user-transcription", data: { text: "hi", final: true } }, "onMessage"],
  "bot-llm-started": [{ type: "bot-llm-started" }, "onAgentChatResponsePart"],
  "bot-llm-text": [{ type: "bot-llm-text", data: { text: "Hel" } }, "onAgentChatResponsePart"],
  "bot-llm-stopped": [{ type: "bot-llm-stopped" }, "onAgentChatResponsePart"],
  "llm-function-call": [{ type: "llm-function-call", data: { function_name: "lookup", tool_call_id: "t1", args: {} } }, "onUnhandledClientToolCall"],
  "mcp-tool-call": [{ type: "mcp-tool-call", data: { service_id: "s", tool_call_id: "m1", tool_name: "x", parameters: {}, state: "loading" } }, "onMCPToolCall"],
  "mcp-connection-status": [{ type: "mcp-connection-status", data: { integrations: [] } }, "onMCPConnectionStatus"],
  "server-message": [{ type: "server-message", data: { type: "queue_status", status: "admitted" } }, "onDebug"],
  error: [{ type: "error", data: { error: "boom", fatal: false } }, "onError"],
  "error-response": [{ type: "error-response", data: { error: "bad" } }, "onError"],
};

test("rtvi: every table row fires its callback", async () => {
  for (const [type, [message, expected]] of Object.entries(SAMPLES)) {
    if (type === "bot-ready") continue;
    const { conversation, dc, names } = await connected();
    if (type === "bot-stopped-speaking") dc.deliver({ type: "bot-started-speaking" });
    dc.deliver(message);
    await tick(1);
    assert.ok(names().includes(expected), `${type} → ${expected}; saw ${names().join(", ")}`);
    assert.ok(
      (RTVI_TO_CALLBACK[type as keyof typeof RTVI_TO_CALLBACK] as readonly string[]).includes(expected),
      `${expected} is listed for ${type}`,
    );
    await conversation.endSession();
  }
});

test("rtvi: messages carry the vendor's roles and a growing event id", async () => {
  const { conversation, dc, log } = await connected();
  dc.deliver({ type: "user-transcription", data: { text: "hi", final: true } });
  dc.deliver({ type: "bot-output", data: { text: "Hello.", spoken: true, aggregated_by: "sentence" } });
  dc.deliver({ type: "bot-output", data: { text: "Hello.", spoken: false, aggregated_by: "sentence" } });
  const messages = log.filter(([name]) => name === "onMessage").map(([, payload]) => payload);
  assert.deepEqual(messages, [
    { message: "hi", role: "user", source: "user", event_id: 1 },
    { message: "Hello.", role: "agent", source: "ai", event_id: 2 },
  ]);
  await conversation.endSession();
});

test("rtvi: onAudioAlignment is approximate — each word's characters spread across its timing (Q18)", async () => {
  const { conversation, dc, log } = await connected();
  dc.deliver({ type: "bot-output", data: { text: "Hi", spoken: true, aggregated_by: "word", tts_offset_ms: 0 } });
  dc.deliver({ type: "bot-output", data: { text: "you", spoken: true, aggregated_by: "word", tts_offset_ms: 200 } });
  dc.deliver({ type: "bot-stopped-speaking" });
  const alignments = log.filter(([name]) => name === "onAudioAlignment").map(([, a]) => a);
  assert.deepEqual(alignments, [
    { chars: ["H", "i"], char_start_times_ms: [0, 100], char_durations_ms: [100, 100] },
    { chars: ["y", "o", "u"], char_start_times_ms: [200, 260, 320], char_durations_ms: [60, 60, 60] },
  ]);
  await conversation.endSession();
});

test("rtvi: passthrough events reach onIncomingEvent only; unknown ones reach onDebug", async () => {
  const incoming: unknown[] = [];
  const debug: unknown[] = [];
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    onIncomingEvent: (e) => incoming.push(e),
    onDebug: (d) => debug.push(d),
  });
  const dc = peer().dc;
  const before = debug.length;
  for (const type of PASSTHROUGH) dc.deliver({ type });
  assert.equal(debug.length, before, "no passthrough reached onDebug");
  dc.deliver({ type: "brand-new-event" });
  assert.equal(debug.length, before + 1);
  assert.ok(incoming.length >= PASSTHROUGH.size + 1);
  await conversation.endSession();
});

test("rtvi: a client tool runs and answers with the vendor's result rules", async () => {
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    // An object result is JSON-stringified at runtime (the vendor's rule; its type says string | number | void).
    clientTools: { lookup: (async ({ id }: { id: string }) => ({ id, ok: true })) as never },
  });
  const dc = peer().dc;
  dc.deliver({ type: "llm-function-call", data: { function_name: "lookup", tool_call_id: "t9", args: { id: "7" } } });
  await tick(2);
  const result = dc.sent.find((frame) => frame.type === "llm-function-call-result");
  assert.deepEqual(result?.data, { tool_call_id: "t9", result: '{"id":"7","ok":true}', is_error: false });
  await conversation.endSession();
});

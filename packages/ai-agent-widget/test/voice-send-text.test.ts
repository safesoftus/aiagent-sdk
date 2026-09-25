import test from "node:test";
import assert from "node:assert/strict";
import { buildSendTextEnvelope } from "../src/voice";

test("send-text envelope matches the wire shape the pipeline parses", () => {
  const envelope = buildSendTextEnvelope("What are your hours?");
  // The preview pipeline's `frame_as_send_text` matches on label + type
  // and reads data.content / data.options.run_immediately — keep these
  // stable (the dashboard preview composer emits the same shape).
  assert.equal(envelope.label, "rtvi-ai");
  assert.equal(envelope.type, "send-text");
  assert.ok(String(envelope.id).startsWith("send-text-"));
  const data = envelope.data as {
    content: string;
    options: { run_immediately: boolean; audio_response: boolean };
  };
  assert.equal(data.content, "What are your hours?");
  assert.equal(data.options.run_immediately, true);
  assert.equal(data.options.audio_response, true);
});

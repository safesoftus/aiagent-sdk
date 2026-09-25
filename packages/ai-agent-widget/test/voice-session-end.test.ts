import test from "node:test";
import assert from "node:assert/strict";
import { isSessionEndedMessage, peerFailureState } from "../src/voice";

// VOSO-658: the worker writes this server-message right before it closes the
// peer on its graceful end path; the client must not report the close that
// follows as "WebRTC connection failed".
test("the worker's session-ended server-message is recognised, nothing else is", () => {
  assert.equal(
    isSessionEndedMessage({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: "session-ended", reason: "end_node" },
    }),
    true,
  );
  assert.equal(
    isSessionEndedMessage({ label: "rtvi-ai", type: "server-message", data: { type: "other" } }),
    false,
  );
  assert.equal(isSessionEndedMessage({ label: "rtvi-ai", type: "server-message" }), false);
  assert.equal(isSessionEndedMessage({ label: "rtvi-ai", type: "bot-ready" }), false);
  assert.equal(
    isSessionEndedMessage({ label: "rtvi-ai", type: "error", data: { type: "session-ended" } }),
    false,
  );
});

test("a voso-debug envelope on the shared channel never announces the end", () => {
  const data = { type: "session-ended", reason: "end_node" };
  assert.equal(isSessionEndedMessage({ label: "voso-debug", type: "server-message", data }), false);
  assert.equal(isSessionEndedMessage({ type: "server-message", data }), false);
});

test("a peer failure after the announcement is an ordinary end; before it, an error", () => {
  assert.equal(peerFailureState(true), "disconnected");
  assert.equal(peerFailureState(false), "error");
});

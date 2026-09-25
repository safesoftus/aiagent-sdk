import test from "node:test";
import assert from "node:assert/strict";
import { queueTransition, QUEUE_STATUS_MESSAGE_TYPE, QUEUE_TIMEOUT_REASON } from "../src/voice";

// Agent-integration E7 §4.3 (VOSO-760): the RTVI twin of the vendor's
// `queue_status` event drives the widget's waiting state; nothing else does.
test("queue_status server-messages map to the three transitions", () => {
  for (const status of ["waiting", "admitted", "timed_out"] as const) {
    assert.equal(
      queueTransition({
        label: "rtvi-ai",
        type: "server-message",
        data: { type: QUEUE_STATUS_MESSAGE_TYPE, status },
      }),
      status,
    );
  }
});

test("a queue timeout announced by session-ended is a timed_out transition", () => {
  assert.equal(
    queueTransition({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: "session-ended", reason: QUEUE_TIMEOUT_REASON },
    }),
    "timed_out",
  );
  // Any other end reason is the ordinary end path, not a queue transition.
  assert.equal(
    queueTransition({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: "session-ended", reason: "end_call" },
    }),
    null,
  );
});

test("foreign labels, other envelopes and unknown statuses never transition", () => {
  assert.equal(
    queueTransition({
      label: "voso-debug",
      type: "server-message",
      data: { type: QUEUE_STATUS_MESSAGE_TYPE, status: "waiting" },
    }),
    null,
  );
  assert.equal(queueTransition({ label: "rtvi-ai", type: "bot-ready" }), null);
  assert.equal(
    queueTransition({
      label: "rtvi-ai",
      type: "server-message",
      data: { type: QUEUE_STATUS_MESSAGE_TYPE, status: "bogus" },
    }),
    null,
  );
  assert.equal(queueTransition({ label: "rtvi-ai", type: "server-message" }), null);
});

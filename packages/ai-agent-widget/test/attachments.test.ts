import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_ALLOWED_TYPES,
  ATTACHMENT_MAX_PER_CONVERSATION,
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentAcceptAttribute,
  validateAttachment,
} from "../src/attachments";

test("caps mirror the backend contract (5 MiB, 5 per conversation)", () => {
  // These values are the CLIENT mirror of the backend's authoritative
  // caps in vosopulse-api routes/workflow_chat.rs — change together.
  assert.equal(ATTACHMENT_MAX_SIZE_BYTES, 5 * 1024 * 1024);
  assert.equal(ATTACHMENT_MAX_PER_CONVERSATION, 5);
  assert.equal(ATTACHMENT_ALLOWED_TYPES.length, 8);
});

test("accepts every allowlisted type at or under the size cap", () => {
  for (const type of ATTACHMENT_ALLOWED_TYPES) {
    assert.equal(
      validateAttachment({ type, size: ATTACHMENT_MAX_SIZE_BYTES }, 0),
      null,
      type,
    );
  }
});

test("rejects unsupported types with the file_type_unsupported key", () => {
  for (const type of ["application/zip", "video/mp4", "text/html", ""]) {
    assert.equal(
      validateAttachment({ type, size: 10 }, 0),
      "file_type_unsupported",
      type,
    );
  }
});

test("rejects oversized files with the file_too_large key", () => {
  assert.equal(
    validateAttachment({ type: "image/png", size: ATTACHMENT_MAX_SIZE_BYTES + 1 }, 0),
    "file_too_large",
  );
});

test("rejects picks past the per-conversation cap with file_limit_reached", () => {
  assert.equal(
    validateAttachment(
      { type: "image/png", size: 10 },
      ATTACHMENT_MAX_PER_CONVERSATION,
    ),
    "file_limit_reached",
  );
  // The limit check wins even when the file itself would also be invalid —
  // the conversation is full regardless of what was picked.
  assert.equal(
    validateAttachment(
      { type: "application/zip", size: ATTACHMENT_MAX_SIZE_BYTES + 1 },
      ATTACHMENT_MAX_PER_CONVERSATION,
    ),
    "file_limit_reached",
  );
});

test("accept attribute lists every allowed MIME type", () => {
  const accept = attachmentAcceptAttribute();
  for (const type of ATTACHMENT_ALLOWED_TYPES) {
    assert.ok(accept.includes(type), type);
  }
  assert.equal(accept.split(",").length, ATTACHMENT_ALLOWED_TYPES.length);
});

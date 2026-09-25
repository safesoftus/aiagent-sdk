// Client-side mirror of the backend chat-attachment caps — UX only; the
// backend (`vosopulse-api routes/workflow_chat.rs`) is authoritative and
// enforces the same allowlist / size cap / per-conversation count cap.

/** MIME types the backend accepts (images are vision-capable). */
export const ATTACHMENT_ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
] as const;

/** Per-file size cap (5 MiB) — mirrors MAX_CHAT_ATTACHMENT_SIZE_BYTES. */
export const ATTACHMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/** Uploads per conversation — mirrors MAX_CHAT_ATTACHMENTS_PER_CONVERSATION. */
export const ATTACHMENT_MAX_PER_CONVERSATION = 5;

/** Text key of the message shown when a pick is rejected. */
export type AttachmentRejection =
  | "file_type_unsupported"
  | "file_too_large"
  | "file_limit_reached";

/**
 * Pre-flight check for one picked file. `uploadedCount` counts every
 * upload already made this conversation (sent or pending). Returns the
 * text key of the rejection, or `null` when the pick may be uploaded.
 */
export function validateAttachment(
  file: { type: string; size: number },
  uploadedCount: number,
): AttachmentRejection | null {
  if (uploadedCount >= ATTACHMENT_MAX_PER_CONVERSATION) return "file_limit_reached";
  if (!(ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return "file_type_unsupported";
  }
  if (file.size > ATTACHMENT_MAX_SIZE_BYTES) return "file_too_large";
  return null;
}

/** `accept` attribute value for the hidden file input. */
export function attachmentAcceptAttribute(): string {
  return ATTACHMENT_ALLOWED_TYPES.join(",");
}

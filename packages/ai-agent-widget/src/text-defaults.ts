// Canonical widget text keys + English defaults.
//
// SINGLE SOURCE OF TRUTH for the overridable UI strings. Three consumers:
//   1. the widget runtime (this package) — falls back to these defaults,
//   2. the dashboard settings UI (frontend/src/.../widget tab) — imports this
//      file directly and renders the defaults as placeholders,
//   3. backend validation — vosopulse/bin/vosopulse-api/src/routes/widget.rs
//      mirrors the KEY SET as `WIDGET_TEXT_KEYS`; a unit test there pins the
//      count. Changing keys here requires changing the Rust list in the same
//      change-set.
//
// Keys and defaults mirror the the vendor convai widget's text_contents map.

export const WIDGET_TEXT_DEFAULTS = {
  main_label: "Need help?",
  start_call: "Start a call",
  start_chat: "Start a chat",
  new_call: "New call",
  end_call: "End",
  mute_microphone: "Mute microphone",
  change_language: "Change language",
  collapse: "Collapse",
  expand: "Expand",
  copied: "Copied!",
  accept_terms: "Accept",
  dismiss_terms: "Cancel",
  listening_status: "Listening",
  speaking_status: "Talk to interrupt",
  connecting_status: "Connecting",
  chatting_status: "Chatting with AI Agent",
  input_label: "Text message input",
  input_placeholder: "Send a message",
  input_placeholder_text_only: "Send a message",
  input_placeholder_new_conversation: "Start a new conversation",
  user_ended_conversation: "You ended the conversation",
  agent_ended_conversation: "The agent ended the conversation",
  conversation_id: "Conversation ID",
  error_occurred: "An error occurred",
  copy_id: "Copy ID",
  initiate_feedback: "How was this conversation?",
  request_follow_up_feedback: "Tell us more",
  thanks_for_feedback: "Thank you for your feedback!",
  thanks_for_feedback_details:
    "Your feedback helps us improve our service and better assist you.",
  follow_up_feedback_placeholder: "Tell us more about your experience...",
  submit: "Submit",
  go_back: "Go back",
  send_message: "Send",
  text_mode: "Switch to text mode",
  voice_mode: "Switch to voice mode",
  switched_to_text_mode: "Switched to text mode",
  switched_to_voice_mode: "Switched to voice mode",
  copy: "Copy",
  download: "Download",
  wrap: "Wrap",
  agent_working: "Working...",
  agent_done: "Completed",
  agent_error: "Error occurred",
  attach_file: "Attach file",
  remove_file: "Remove file",
  file_upload_error: "Failed to upload file.",
  file_type_unsupported: "Unsupported file type. Accepted types:",
  file_too_large: "File size exceeds the maximum limit.",
  file_limit_reached: "Maximum number of files for this conversation reached.",
  typing_indicator: "Agent is typing ...",
  // Agent-integration E7 §4.3 (VOSO-760): the caller waits in the agent's
  // queue (vendor widget ≥ 0.17.0 shows a waiting line and disables input).
  queued_status: "Waiting for an available agent…",
  queue_timed_out: "No agent became available — please try again later",
} as const;

export type WidgetTextKey = keyof typeof WIDGET_TEXT_DEFAULTS;

export const WIDGET_TEXT_KEYS = Object.keys(
  WIDGET_TEXT_DEFAULTS,
) as WidgetTextKey[];

/** Resolve a text key against per-agent overrides, falling back to defaults. */
export function resolveText(
  overrides: Partial<Record<WidgetTextKey, string>> | undefined,
  key: WidgetTextKey,
): string {
  const v = overrides?.[key];
  return v !== undefined && v !== "" ? v : WIDGET_TEXT_DEFAULTS[key];
}

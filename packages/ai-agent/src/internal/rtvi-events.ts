// RTVI (server → client) → vendor callbacks: the ONE table (E4 plan §4.6).
// test/rtvi-drift.test.ts holds it against processors-rtvi's `type_tag`, so a
// new server event is either mapped here or listed as passthrough — never
// silently dropped. Every event also reaches `onIncomingEvent` first.

/** RTVI type → the callbacks it drives, in the vendor's order. */
export const RTVI_TO_CALLBACK = {
  "bot-ready": ["onConversationCreated", "onStatusChange", "onCanSendFeedbackChange", "onConnect", "onConversationMetadata"],
  "bot-started-speaking": ["onModeChange"],
  "bot-stopped-speaking": ["onModeChange"],
  "bot-output": ["onMessage", "onInterruption", "onAudioAlignment"],
  "bot-output-correction": ["onAgentResponseCorrection"],
  "user-transcription": ["onMessage", "onDebug"],
  "bot-llm-started": ["onAgentChatResponsePart"],
  "bot-llm-text": ["onAgentChatResponsePart"],
  "bot-llm-stopped": ["onAgentChatResponsePart"],
  "llm-function-call": ["onUnhandledClientToolCall", "onError"],
  "mcp-tool-call": ["onMCPToolCall"],
  "mcp-connection-status": ["onMCPConnectionStatus"],
  "server-message": ["onStatusChange", "onCanSendFeedbackChange", "onDisconnect", "onDebug"],
  error: ["onError", "onDisconnect"],
  "error-response": ["onError"],
} as const satisfies Record<string, readonly string[]>;

export type MappedRtviType = keyof typeof RTVI_TO_CALLBACK;

/** Server events surfaced through `onIncomingEvent` only. */
export const PASSTHROUGH: ReadonlySet<string> = new Set([
  "server-response",
  "bot-transcription",
  "bot-tts-started",
  "bot-tts-stopped",
  "bot-tts-text",
  "bot-tts-audio",
  "user-llm-text",
  "user-started-speaking",
  "user-stopped-speaking",
  "user-mute-started",
  "user-mute-stopped",
  "user-audio-level",
  "bot-audio-level",
  "user-turn-probability",
  "metrics",
  "system-log",
  "llm-function-call-started",
  "llm-function-call-in-progress",
  "llm-function-call-stopped",
]);

/** Envelope types the client sends (each must be dispatched by the server). */
export const OUTBOUND_TYPES = [
  "client-ready",
  "send-text",
  "llm-function-call-result",
  "mcp-tool-approval-result",
  "append-to-context",
  "user-activity",
  "feedback",
] as const;

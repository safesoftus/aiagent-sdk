// @convoso/ai-agent — public entry. The customer-safe surface only (E4 Q12):
// every runtime export is pinned by test/surface-drift.test.ts.
export { Conversation } from "./conversation/start";
export { VoiceConversation } from "./conversation/voice";
export { TextConversation } from "./conversation/text";
export { SessionConnectionError } from "./errors";
export { postOverallFeedback, type OverallFeedback } from "./feedback";
export { setSourceInfo } from "./internal/source-info";
export { NO_VOLUME } from "./internal/volume-provider";
export type {
  Callbacks,
  ClientToolsConfig,
  ConversationOverrides,
  DisconnectionDetails,
  DynamicVariables,
  McpToolCall,
  MessagePayload,
  Mode,
  Role,
  SessionConfig,
  Status,
  VolumeProvider,
} from "./types";
export type { AudioAlignment } from "./internal/alignment";

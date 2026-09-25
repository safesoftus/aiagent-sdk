// @convoso/ai-agent/internal — the low-level WebRTC transport the widget
// builds on (moved from the widget's voice.ts / api.ts, E4). An explicit
// list, never `export *`: test/surface-drift.test.ts pins it (Q12) so a
// staff-only capability can never ride into the published package.
export {
  VoiceClient,
  transcriptRole,
  isRenderableTranscript,
  isSessionEndedMessage,
  queueTransition,
  peerFailureState,
  buildSendTextEnvelope,
  buildFunctionCallResultEnvelope,
  buildMcpToolApprovalEnvelope,
  buildAppendToContextEnvelope,
  mcpToolCallDataFromRtvi,
  clientToolCallFromRtvi,
  tuneOpusFmtp,
  SESSION_ENDED_MESSAGE_TYPE,
  QUEUE_STATUS_MESSAGE_TYPE,
  QUEUE_TIMEOUT_REASON,
} from "./internal/voice-client";
export type { RtviMessage, VoiceClientOptions, VoiceState } from "./internal/voice-client";
export { WidgetApi, WidgetApiError, sessionStartBody } from "./internal/widget-api";
export type {
  ChatEvent,
  ConversationOverrides,
  DynamicVariables,
  PublicWidgetConfig,
  UploadedAttachment,
  VoiceSessionDescriptor,
} from "./internal/widget-api";
export { MIC_CONSTRAINTS, platform, setPlatform } from "./internal/platform";
export type { Platform } from "./internal/platform";

// Public types — the vendor's names and payloads (E4 plan §1.1), for the
// WebRTC transport this package ships today.
import type { AudioAlignment } from "./internal/alignment";
import type { ConversationOverrides } from "./internal/overrides";
import type { VolumeProvider } from "./internal/volume-provider";

export type { ConversationOverrides, VolumeProvider };

export type Role = "user" | "agent";
export type Mode = "speaking" | "listening";
export type Status = "disconnected" | "connecting" | "connected" | "disconnecting";
export type DynamicVariables = Record<string, string | number | boolean>;

export type DisconnectionDetails =
  | {
      reason: "error";
      message: string;
      context: { type: string; reason?: string; code?: number };
      closeCode?: number;
      closeReason?: string;
    }
  | {
      reason: "agent";
      context?: { type: string; reason?: string; code?: number };
      closeCode?: number;
      closeReason?: string;
    }
  | { reason: "user" };

export interface MessagePayload {
  message: string;
  event_id?: number;
  /** @deprecated use `role`. */
  source: "user" | "ai";
  role: Role;
}

export interface McpToolCall {
  service_id: string;
  tool_call_id: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  state: "loading" | "awaiting_approval" | "success" | "failure";
  approval_timeout_secs?: number;
  result?: string;
  error_message?: string;
}

/** The vendor's callbacks. Ones this transport cannot produce yet never fire. */
export interface Callbacks {
  onConnect?: (props: { conversationId: string }) => void;
  onDisconnect?: (details: DisconnectionDetails) => void;
  onError?: (message: string, context?: unknown) => void;
  onMessage?: (props: MessagePayload) => void;
  onAudio?: (base64Audio: string) => void;
  onModeChange?: (props: { mode: Mode }) => void;
  onStatusChange?: (props: { status: Status }) => void;
  onCanSendFeedbackChange?: (props: { canSendFeedback: boolean }) => void;
  onUnhandledClientToolCall?: (call: {
    tool_name: string;
    tool_call_id: string;
    parameters: unknown;
    event_id: number;
  }) => void;
  onVadScore?: (props: { vadScore: number }) => void;
  onMCPToolCall?: (call: McpToolCall) => void;
  onMCPConnectionStatus?: (status: {
    integrations: Array<{ integration_id: string; integration_type: string; is_connected: boolean; tool_count: number }>;
  }) => void;
  onConversationMetadata?: (metadata: {
    conversation_id: string;
    agent_output_audio_format: string;
    user_input_audio_format: string;
  }) => void;
  onInterruption?: (props: { event_id: number }) => void;
  onAgentResponseCorrection?: (props: {
    original_agent_response: string;
    corrected_agent_response: string;
    event_id: number;
  }) => void;
  onAgentChatResponsePart?: (part: { text: string; type: "start" | "delta" | "stop"; event_id: number }) => void;
  /** APPROXIMATE (Q18): characters spread evenly across each spoken word's timing. */
  onAudioAlignment?: (alignment: AudioAlignment) => void;
  onDebug?: (props: unknown) => void;
  onIncomingEvent?: (event: unknown) => void;
  onOutgoingEvent?: (event: unknown) => void;
}

export interface ClientToolsConfig {
  clientTools: Record<
    string,
    (parameters: any) => Promise<string | number | void> | string | number | void // eslint-disable-line @typescript-eslint/no-explicit-any
  >;
}

interface BaseSessionConfig extends Callbacks, Partial<ClientToolsConfig> {
  /** API origin for the token request. Default `https://aiagent-api.convoso.com`. */
  origin?: string;
  /** Your bearer for a private agent's token request. */
  authorization?: string;
  /** Where to POST the offer (overrides the token response's `signaling_url`). */
  signalingUrl?: string;
  /**
   * ICE servers for the offer (overrides the token response's `ice_servers`).
   * A `conversationToken` session passes the `ice_servers` your server received
   * with the token, so TURN relays work.
   */
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  overrides?: ConversationOverrides;
  dynamicVariables?: DynamicVariables;
  customLlmExtraBody?: unknown;
  toolMockConfig?: unknown;
  /** Text-only session (Q19/Q26): wins over `overrides.conversation.textOnly`. */
  textOnly?: boolean;
  userId?: string;
  environment?: string;
  connectionType?: "webrtc" | "websocket";
  onConversationCreated?: (conversation: unknown) => void;
  /** Approve (`true`) or deny an MCP tool call; a throw or a non-boolean denies (fail closed). */
  onMCPToolApprovalRequest?: (call: McpToolCall, ctx: { signal: AbortSignal }) => Promise<boolean> | boolean;
}

export type SessionConfig = BaseSessionConfig &
  (
    | { agentId: string; conversationToken?: never; signedUrl?: never }
    | { conversationToken: string; agentId?: never; signedUrl?: never }
    | { signedUrl: string; agentId?: never; conversationToken?: never }
  );

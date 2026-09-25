// SessionConfig → the WebRTC target (E4 plan §4.4, owner rulings Q6/Q15/Q29):
//   {agentId: <agent uuid>}  → GET {origin}/v1/convai/conversation/token → token
//   {conversationToken}      → used as is (minted by the customer's server)
//   {signedUrl}              → the WebSocket transport (E4-b) — refused here
import { SessionConnectionError } from "../errors";
import type { SessionConfig } from "../types";
import { platform } from "./platform";
import { sourceInfo } from "./source-info";

export const DEFAULT_ORIGIN = "https://aiagent-api.convoso.com";

/** The vendor's React Native refusal of a WebSocket session, verbatim (plan §1.3). */
export const RN_WEBSOCKET_REJECTION =
  "WebSocket connections are not supported on React Native. Only WebRTC connections are available. Remove the connectionType/signedUrl option or use connectionType: 'webrtc'.";

export interface WebRtcTarget {
  token: string;
  /** `conv_…` when the token response named it (the agentId path). */
  conversationId: string | null;
  signalingUrl: string;
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const AGENT_WIRE = /^agent_[0-9a-f]{32}$/;

/** The agent uuid (dashed or not, or its `agent_…` wire form) → `agent_<32 hex>` (Q15). */
export function agentWireId(agentId: string): string {
  const raw = agentId.trim();
  if (raw.startsWith("wgt_")) {
    throw new SessionConnectionError(
      "agentId is the agent uuid; the widget public id (wgt_…) is only for <voso-widget> — see the migration note",
      "widget_public_id",
    );
  }
  if (AGENT_WIRE.test(raw)) return raw;
  if (UUID.test(raw)) return `agent_${raw.replace(/-/g, "").toLowerCase()}`;
  throw new SessionConnectionError(`agentId must be the agent uuid, got "${agentId}"`, "invalid_agent_id");
}

/** A raw conversation uuid (an offer answer) → the `conv_…` form the token response uses. */
export function conversationWireId(id: string): string {
  return UUID.test(id) ? `conv_${id.replace(/-/g, "").toLowerCase()}` : id;
}

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export async function resolveWebRtcTarget(config: SessionConfig): Promise<WebRtcTarget> {
  if (config.connectionType === "websocket" || config.signedUrl !== undefined) {
    // React Native: the vendor's exact sentence (§1.3); the web: E4-b.
    throw new SessionConnectionError(
      platform().name === "react-native"
        ? RN_WEBSOCKET_REJECTION
        : "signedUrl needs the WebSocket transport (E4-b)",
      "websocket_unavailable",
    );
  }
  const origin = trimOrigin(config.origin ?? DEFAULT_ORIGIN);
  if (config.conversationToken !== undefined) {
    return {
      token: config.conversationToken,
      conversationId: null,
      signalingUrl: config.signalingUrl ?? `${origin}/api/offer`,
      iceServers: config.iceServers ?? [],
    };
  }
  const wire = agentWireId(config.agentId);
  const { source, version } = sourceInfo();
  const query = new URLSearchParams({ agent_id: wire, source, version });
  if (config.environment) query.set("environment", config.environment);
  const headers: Record<string, string> = {};
  if (config.authorization) headers["Authorization"] = `Bearer ${config.authorization}`;
  const res = await platform().fetch(`${origin}/v1/convai/conversation/token?${query}`, { headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: { message?: string } | string };
      detail = typeof body.detail === "string" ? body.detail : body.detail?.message ?? detail;
    } catch {
      // keep statusText
    }
    throw new SessionConnectionError(
      res.status === 401
        ? "Your agent has authentication enabled, but no signed URL or conversation token was provided."
        : `Failed to fetch conversation token for agent ${wire}: ${detail}`,
      res.status === 401 ? "authorization_required" : "token_request_failed",
      res.status,
    );
  }
  const body = (await res.json()) as {
    token: string;
    conversation_id?: string;
    signaling_url?: string;
    ice_servers?: WebRtcTarget["iceServers"];
  };
  const signalingUrl = config.signalingUrl ?? body.signaling_url;
  if (!signalingUrl) {
    throw new SessionConnectionError("The token response carries no signaling_url", "no_signaling_url");
  }
  return {
    token: body.token,
    conversationId: body.conversation_id ?? null,
    signalingUrl,
    iceServers: config.iceServers ?? body.ice_servers ?? [],
  };
}

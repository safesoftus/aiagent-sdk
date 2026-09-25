// Widget → vosopulse-api client (public, unauthenticated surface).
//
// The API origin is derived from the embed script's own src
// (`https://HOST/widget.js` → `https://HOST`), overridable via the
// element's `server-url` attribute (used by the dashboard's live preview,
// which imports the element instead of loading the script tag).

/** Server payload of GET /api/widget/{public_id}/config. */
export interface PublicWidgetConfig {
  agent_name: string;
  languages: string[];
  /** The widget's appearance config; the widget package narrows it to its
   *  `WidgetRuntimeConfig` (the core does not know the widget's schema). */
  config: Record<string, unknown>;
  avatar_url?: string | null;
}

/** Voice session bootstrap response (PreviewSession shape). */
export interface VoiceSessionDescriptor {
  session_id: string;
  /** Ownership token required by the preview worker's POST /api/disconnect
   *  (VOSO-191). Treat as a secret — never log it. */
  session_token?: string;
  conversation_id: string;
  signaling_url: string;
  /** A conversation token redeemed on the first offer instead of
   *  `session_id` (E4 P1; set by `VoiceClient.fromConversationToken`). */
  conversation_token?: string;
  ice_servers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  trace_context?: Record<string, string>;
  /** Present when the caller was placed in the agent's wait queue
   *  (agent-integration E7 §4.2): the session exists, the worker admits it
   *  when a slot frees or ends it after `timeout_s`. Absent = admitted. */
  queue?: { status: string; timeout_s: number; enqueued_at_ms?: number } | null;
}

/** One SSE chat event (workflow ChatTurnEvent + the leading session frame). */
export interface ChatEvent {
  type: string;
  session_id?: string;
  /** Durable conversation id (`calls.call_id`) on the leading `session`
   *  frame — same identity voice sessions carry. */
  conversation_id?: string;
  delta?: string;
  text?: string;
  message?: string;
  /** Machine class on an `error` frame (`llm_unavailable`, `llm_interrupted`,
   *  `tool_mock_missing`, `session_config`, `internal`); absent on frames
   *  from an older server. */
  code?: string;
  reason?: string;
  name?: string;
  mocked?: boolean;
  current_node_id?: string | null;
  /** `client_tool_call` (E3 §4.1.7): the id the page's answer must carry. */
  tool_call_id?: string;
  /** `client_tool_call`: the agent's arguments. */
  args?: Record<string, unknown>;
  /** `client_tool_call`: whether the agent waits for the answer. */
  expects_response?: boolean;
  /** `client_tool_call`: the wait budget in seconds. */
  timeout_secs?: number;
  /** `mcp_tool_call` (E3 §4.6): the server id, tool name, arguments, state
   *  (`awaiting_approval` | `loading` | `success` | `failure`) and the
   *  approval budget in seconds. */
  service_id?: string;
  tool_name?: string;
  parameters?: Record<string, unknown>;
  state?: string;
  approval_timeout_secs?: number;
  error_message?: string;
  /** Leading `session` frame: how agent replies render in THIS session —
   *  the agent behavior panel's Widget row (`channel_catalog::text::TextOutputFormat`).
   *  Missing on older APIs ⇒ the widget keeps markdown. */
  output_format?: "plain_text" | "markdown";
  [key: string]: unknown;
}

export class WidgetApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function throwHttpError(res: Response): Promise<never> {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as {
      error?: string;
      detail?: Array<{ msg?: string }> | string;
    };
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    else if (body.error) detail = body.error;
  } catch {
    // keep statusText
  }
  throw new WidgetApiError(res.status, detail);
}

/** One uploaded attachment, as returned by the upload endpoint. */
export interface UploadedAttachment {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/**
 * Per-call conversation overrides (`first_message`, `language`,
 * `system_prompt`, `llm`, `voice_id`, `voice_speed`, …). The API gates every
 * key against the agent's Guardrails "Conversation overrides" toggles: a
 * disabled key fails the session start (403), an unknown key or wrong-typed
 * value 400. Voice keys are accepted on chat too and are inert there.
 */
export type ConversationOverrides = Record<string, unknown>;

/**
 * Per-session `{{name}}` values the page supplies (the vendor JS SDK's
 * `dynamicVariables`): string, number or boolean values, at most 200 names.
 * Gated server-side by the agent's Security → Overrides "Dynamic variables"
 * toggle (a non-empty map with the toggle off fails the start with 403; an
 * empty map is never refused). Reserved names (`system__…`, `secret__…`,
 * `sip_…`, `convoso.…`) fail with 400 naming the key.
 */
export type DynamicVariables = Record<string, string | number | boolean>;

/** `POST …/session` and `…/chat` body: only the keys the embed set. */
export function sessionStartBody(
  language: string | null,
  overrides: ConversationOverrides | null,
  dynamicVariables: DynamicVariables | null = null,
): { language?: string; overrides?: ConversationOverrides; dynamic_variables?: DynamicVariables } {
  const body: {
    language?: string;
    overrides?: ConversationOverrides;
    dynamic_variables?: DynamicVariables;
  } = {};
  if (language) body.language = language;
  if (overrides && Object.keys(overrides).length > 0) body.overrides = overrides;
  if (dynamicVariables && Object.keys(dynamicVariables).length > 0) {
    body.dynamic_variables = dynamicVariables;
  }
  return body;
}

export class WidgetApi {
  constructor(
    private readonly origin: string,
    private readonly publicId: string,
    /** Dashboard access token — set ONLY by the settings page's live
     *  preview (the element's `auth-token` attribute) so a DISABLED
     *  widget still previews for authenticated tenant members. Customer
     *  embeds never carry it. */
    private readonly authToken: string | null = null,
  ) {}

  private url(path: string): string {
    return `${this.origin}/api/widget/${encodeURIComponent(this.publicId)}${path}`;
  }

  /** Base headers for every call — the preview's Authorization only. */
  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...(extra ?? {}) };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    return headers;
  }

  async fetchConfig(): Promise<PublicWidgetConfig> {
    const res = await fetch(this.url("/config"), { headers: this.headers() });
    if (!res.ok) await throwHttpError(res);
    return (await res.json()) as PublicWidgetConfig;
  }

  /** Resolve a config-relative avatar path against the API origin. */
  resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
    return `${this.origin}${pathOrUrl}`;
  }

  async startVoiceSession(
    language: string | null,
    overrides: ConversationOverrides | null = null,
    dynamicVariables: DynamicVariables | null = null,
  ): Promise<VoiceSessionDescriptor> {
    const res = await fetch(this.url("/session"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(sessionStartBody(language, overrides, dynamicVariables)),
    });
    if (!res.ok) await throwHttpError(res);
    const session = (await res.json()) as VoiceSessionDescriptor;
    if (!session.session_id || !session.signaling_url) {
      throw new WidgetApiError(500, "Malformed session response");
    }
    return session;
  }

  /** Open a chat session; yields parsed SSE events (first: `session`). */
  openChat(
    language: string | null,
    overrides: ConversationOverrides | null = null,
    dynamicVariables: DynamicVariables | null = null,
  ): AsyncGenerator<ChatEvent, void, undefined> {
    return this.sse(
      this.url("/chat"),
      JSON.stringify(sessionStartBody(language, overrides, dynamicVariables)),
    );
  }

  /** Send one chat turn; yields that turn's events. */
  sendChatMessage(
    sessionId: string,
    text: string,
    attachmentIds: string[] = [],
  ): AsyncGenerator<ChatEvent, void, undefined> {
    const body: Record<string, unknown> = { text };
    if (attachmentIds.length > 0) body.attachment_ids = attachmentIds;
    return this.sse(
      this.url(`/chat/${encodeURIComponent(sessionId)}/message`),
      JSON.stringify(body),
    );
  }

  /** Upload one file for the conversation (multipart `file` part). */
  async uploadAttachment(sessionId: string, file: File): Promise<UploadedAttachment> {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch(
      this.url(`/chat/${encodeURIComponent(sessionId)}/attachments`),
      {
        method: "POST",
        headers: this.headers(),
        body: form,
      },
    );
    if (!res.ok) await throwHttpError(res);
    return (await res.json()) as UploadedAttachment;
  }

  /** Answer a `client_tool_call` frame of an open chat session (E3 §4.1.7). */
  async postChatToolResult(
    sessionId: string,
    toolCallId: string,
    result: string,
    isError: boolean,
  ): Promise<void> {
    const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/tool-result`), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tool_call_id: toolCallId, result, is_error: isError }),
    });
    if (!res.ok) await throwHttpError(res);
  }

  /** Approve or deny an `mcp_tool_call {state:"awaiting_approval"}` frame (E3 §4.6). */
  async postChatToolApproval(
    sessionId: string,
    toolCallId: string,
    isApproved: boolean,
  ): Promise<void> {
    const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/tool-approval`), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tool_call_id: toolCallId, is_approved: isApproved }),
    });
    if (!res.ok) await throwHttpError(res);
  }

  /** Append background context to an open chat session without a turn (E3 §4.2). */
  async postChatContext(sessionId: string, text: string, contextId?: string): Promise<void> {
    const body: Record<string, unknown> = { text };
    if (contextId !== undefined) body.context_id = contextId;
    const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/context`), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) await throwHttpError(res);
  }

  async closeChat(sessionId: string): Promise<void> {
    try {
      await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}`), {
        method: "DELETE",
        headers: this.headers(),
        keepalive: true,
      });
    } catch {
      // best effort — the server reaps sessions anyway
    }
  }

  async submitFeedback(
    conversationId: string,
    rating: number,
    comment: string | null,
  ): Promise<void> {
    const res = await fetch(this.url("/feedback"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        conversation_id: conversationId,
        rating,
        comment: comment || undefined,
      }),
    });
    if (!res.ok) await throwHttpError(res);
  }

  /**
   * POST + parse a Server-Sent-Events response. EventSource is GET-only,
   * so this reads the body stream and splits `data:` frames manually —
   * the same approach the dashboard's use-workflow-chat hook takes.
   */
  private async *sse(
    url: string,
    body: string,
  ): AsyncGenerator<ChatEvent, void, undefined> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      }),
      body,
    });
    if (!res.ok) await throwHttpError(res);
    const reader = res.body?.getReader();
    if (!reader) throw new WidgetApiError(500, "Streaming not supported");

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line.
        for (;;) {
          const sep = buffer.indexOf("\n\n");
          if (sep < 0) break;
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              yield JSON.parse(payload) as ChatEvent;
            } catch {
              // ignore malformed frames (keep-alives etc.)
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

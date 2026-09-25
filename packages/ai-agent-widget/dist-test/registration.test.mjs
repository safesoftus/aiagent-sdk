var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../ai-agent/src/internal/widget-api.ts
async function throwHttpError(res) {
  let detail = res.statusText || `HTTP ${res.status}`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    else if (body.error) detail = body.error;
  } catch {
  }
  throw new WidgetApiError(res.status, detail);
}
function sessionStartBody(language, overrides2, dynamicVariables = null) {
  const body = {};
  if (language) body.language = language;
  if (overrides2 && Object.keys(overrides2).length > 0) body.overrides = overrides2;
  if (dynamicVariables && Object.keys(dynamicVariables).length > 0) {
    body.dynamic_variables = dynamicVariables;
  }
  return body;
}
var WidgetApiError, WidgetApi;
var init_widget_api = __esm({
  "../ai-agent/src/internal/widget-api.ts"() {
    "use strict";
    WidgetApiError = class extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    };
    WidgetApi = class {
      constructor(origin, publicId, authToken = null) {
        this.origin = origin;
        this.publicId = publicId;
        this.authToken = authToken;
      }
      url(path) {
        return `${this.origin}/api/widget/${encodeURIComponent(this.publicId)}${path}`;
      }
      /** Base headers for every call — the preview's Authorization only. */
      headers(extra) {
        const headers = { ...extra ?? {} };
        if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
        return headers;
      }
      async fetchConfig() {
        const res = await fetch(this.url("/config"), { headers: this.headers() });
        if (!res.ok) await throwHttpError(res);
        return await res.json();
      }
      /** Resolve a config-relative avatar path against the API origin. */
      resolveUrl(pathOrUrl) {
        if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
        return `${this.origin}${pathOrUrl}`;
      }
      async startVoiceSession(language, overrides2 = null, dynamicVariables = null) {
        const res = await fetch(this.url("/session"), {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(sessionStartBody(language, overrides2, dynamicVariables))
        });
        if (!res.ok) await throwHttpError(res);
        const session = await res.json();
        if (!session.session_id || !session.signaling_url) {
          throw new WidgetApiError(500, "Malformed session response");
        }
        return session;
      }
      /** Open a chat session; yields parsed SSE events (first: `session`). */
      openChat(language, overrides2 = null, dynamicVariables = null) {
        return this.sse(
          this.url("/chat"),
          JSON.stringify(sessionStartBody(language, overrides2, dynamicVariables))
        );
      }
      /** Send one chat turn; yields that turn's events. */
      sendChatMessage(sessionId, text, attachmentIds = []) {
        const body = { text };
        if (attachmentIds.length > 0) body.attachment_ids = attachmentIds;
        return this.sse(
          this.url(`/chat/${encodeURIComponent(sessionId)}/message`),
          JSON.stringify(body)
        );
      }
      /** Upload one file for the conversation (multipart `file` part). */
      async uploadAttachment(sessionId, file) {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch(
          this.url(`/chat/${encodeURIComponent(sessionId)}/attachments`),
          {
            method: "POST",
            headers: this.headers(),
            body: form
          }
        );
        if (!res.ok) await throwHttpError(res);
        return await res.json();
      }
      /** Answer a `client_tool_call` frame of an open chat session (E3 §4.1.7). */
      async postChatToolResult(sessionId, toolCallId, result, isError) {
        const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/tool-result`), {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ tool_call_id: toolCallId, result, is_error: isError })
        });
        if (!res.ok) await throwHttpError(res);
      }
      /** Approve or deny an `mcp_tool_call {state:"awaiting_approval"}` frame (E3 §4.6). */
      async postChatToolApproval(sessionId, toolCallId, isApproved) {
        const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/tool-approval`), {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({ tool_call_id: toolCallId, is_approved: isApproved })
        });
        if (!res.ok) await throwHttpError(res);
      }
      /** Append background context to an open chat session without a turn (E3 §4.2). */
      async postChatContext(sessionId, text, contextId) {
        const body = { text };
        if (contextId !== void 0) body.context_id = contextId;
        const res = await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}/context`), {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(body)
        });
        if (!res.ok) await throwHttpError(res);
      }
      async closeChat(sessionId) {
        try {
          await fetch(this.url(`/chat/${encodeURIComponent(sessionId)}`), {
            method: "DELETE",
            headers: this.headers(),
            keepalive: true
          });
        } catch {
        }
      }
      async submitFeedback(conversationId, rating, comment) {
        const res = await fetch(this.url("/feedback"), {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            conversation_id: conversationId,
            rating,
            comment: comment || void 0
          })
        });
        if (!res.ok) await throwHttpError(res);
      }
      /**
       * POST + parse a Server-Sent-Events response. EventSource is GET-only,
       * so this reads the body stream and splits `data:` frames manually —
       * the same approach the dashboard's use-workflow-chat hook takes.
       */
      async *sse(url, body) {
        const res = await fetch(url, {
          method: "POST",
          headers: this.headers({
            "Content-Type": "application/json",
            Accept: "text/event-stream"
          }),
          body
        });
        if (!res.ok) await throwHttpError(res);
        const reader = res.body?.getReader();
        if (!reader) throw new WidgetApiError(500, "Streaming not supported");
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            for (; ; ) {
              const sep = buffer.indexOf("\n\n");
              if (sep < 0) break;
              const frame = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              for (const line of frame.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload) continue;
                try {
                  yield JSON.parse(payload);
                } catch {
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
    };
  }
});

// src/api.ts
var init_api = __esm({
  "src/api.ts"() {
    "use strict";
    init_widget_api();
  }
});

// src/attachments.ts
function validateAttachment(file, uploadedCount) {
  if (uploadedCount >= ATTACHMENT_MAX_PER_CONVERSATION) return "file_limit_reached";
  if (!ATTACHMENT_ALLOWED_TYPES.includes(file.type)) {
    return "file_type_unsupported";
  }
  if (file.size > ATTACHMENT_MAX_SIZE_BYTES) return "file_too_large";
  return null;
}
function attachmentAcceptAttribute() {
  return ATTACHMENT_ALLOWED_TYPES.join(",");
}
var ATTACHMENT_ALLOWED_TYPES, ATTACHMENT_MAX_SIZE_BYTES, ATTACHMENT_MAX_PER_CONVERSATION;
var init_attachments = __esm({
  "src/attachments.ts"() {
    "use strict";
    ATTACHMENT_ALLOWED_TYPES = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
      "text/plain",
      "text/csv",
      "text/markdown"
    ];
    ATTACHMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
    ATTACHMENT_MAX_PER_CONVERSATION = 5;
  }
});

// src/link-policy.ts
function splitHostPort(entry) {
  const idx = entry.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(entry.slice(idx + 1))) {
    return { host: entry.slice(0, idx).toLowerCase(), port: entry.slice(idx + 1) };
  }
  return { host: entry.toLowerCase(), port: null };
}
function hostMatches(urlHost, entryHost, includeWww) {
  if (urlHost === entryHost) return true;
  if (!includeWww) return false;
  const strip = (h) => h.startsWith("www.") ? h.slice(4) : h;
  return strip(urlHost) === strip(entryHost);
}
function isLinkAllowed(href, policy) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const scheme = url.protocol;
  if (scheme === "javascript:") return false;
  if (scheme !== "https:" && scheme !== "http:") return false;
  if (scheme === "http:" && !policy.allow_http) return false;
  if (policy.allow_all) return true;
  const urlHost = url.hostname.toLowerCase();
  const urlPort = url.port;
  for (const raw of policy.allowed_hosts) {
    const entry = raw.trim();
    if (!entry) continue;
    const { host, port } = splitHostPort(entry);
    if (!hostMatches(urlHost, host, policy.include_www_variants)) continue;
    if (port === null) return true;
    const effectivePort = urlPort || (scheme === "https:" ? "443" : "80");
    if (effectivePort === port) return true;
  }
  return false;
}
var DEFAULT_LINK_POLICY;
var init_link_policy = __esm({
  "src/link-policy.ts"() {
    "use strict";
    DEFAULT_LINK_POLICY = {
      allow_all: false,
      allowed_hosts: [],
      include_www_variants: true,
      allow_http: false
    };
  }
});

// src/config.ts
function mergeConfig(partial) {
  if (!partial) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    text_enabled: true,
    avatar: partial.avatar ?? DEFAULT_CONFIG.avatar,
    colors: { ...DEFAULT_COLORS, ...partial.colors ?? {} },
    radii: { ...DEFAULT_RADII, ...partial.radii ?? {} },
    terms: { ...DEFAULT_CONFIG.terms, ...partial.terms ?? {} },
    link_policy: { ...DEFAULT_LINK_POLICY, ...partial.link_policy ?? {} },
    languages: partial.languages ?? [],
    text: partial.text ?? {}
  };
}
function buildCssVars(cfg) {
  const c = cfg.colors;
  const r = cfg.radii;
  return {
    "--vw-base": c.base,
    "--vw-base-hover": c.base_hover,
    "--vw-base-active": c.base_active,
    "--vw-base-border": c.base_border,
    "--vw-base-subtle": c.base_subtle,
    "--vw-base-primary": c.base_primary,
    "--vw-base-error": c.base_error,
    "--vw-accent": c.accent,
    "--vw-accent-hover": c.accent_hover,
    "--vw-accent-active": c.accent_active,
    "--vw-accent-border": c.accent_border,
    "--vw-accent-subtle": c.accent_subtle,
    "--vw-accent-primary": c.accent_primary,
    "--vw-overlay-padding": `${r.overlay_padding}px`,
    "--vw-button-radius": `${r.button_radius}px`,
    "--vw-input-radius": `${r.input_radius}px`,
    "--vw-bubble-radius": `${r.bubble_radius}px`,
    "--vw-sheet-radius": `${r.sheet_radius}px`,
    "--vw-compact-sheet-radius": `${r.compact_sheet_radius}px`,
    "--vw-dropdown-sheet-radius": `${r.dropdown_sheet_radius}px`
  };
}
var DEFAULT_COLORS, DEFAULT_RADII, DEFAULT_CONFIG;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    init_link_policy();
    DEFAULT_COLORS = {
      base: "#ffffff",
      base_hover: "#f9fafb",
      base_active: "#f3f4f6",
      base_border: "#e5e7eb",
      base_subtle: "#6b7280",
      base_primary: "#000000",
      base_error: "#ef4444",
      accent: "#000000",
      accent_hover: "#1f2937",
      accent_active: "#374151",
      accent_border: "#4b5563",
      accent_subtle: "#6b7280",
      accent_primary: "#ffffff"
    };
    DEFAULT_RADII = {
      overlay_padding: 32,
      button_radius: 18,
      input_radius: 18,
      bubble_radius: 15,
      sheet_radius: 24,
      compact_sheet_radius: 30,
      dropdown_sheet_radius: 24
    };
    DEFAULT_CONFIG = {
      agent_name: "AI Agent",
      variant: "compact",
      placement: "bottom-right",
      expanded_behavior: "starts_collapsed",
      collapsible: true,
      syntax_theme: "auto",
      avatar: { kind: "orb", color_1: "#7959ff", color_2: "#9b7aff" },
      colors: DEFAULT_COLORS,
      radii: DEFAULT_RADII,
      terms: { enabled: false, content: "", local_storage_key: "" },
      link_policy: DEFAULT_LINK_POLICY,
      languages: [],
      text: {},
      voice_enabled: true,
      text_enabled: true,
      send_text_while_on_call: true,
      transcript_enabled: true,
      language_dropdown_enabled: true,
      mute_button_enabled: true,
      show_conversation_id: true,
      hide_audio_tags: false,
      action_indicator_enabled: true,
      resize_button_enabled: true,
      feedback_enabled: true,
      show_agent_status: true,
      show_language_selector_on_trigger: false,
      show_avatar_when_collapsed: true
    };
  }
});

// src/icons.ts
var svg, ICONS;
var init_icons = __esm({
  "src/icons.ts"() {
    "use strict";
    svg = (body, size = 16) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    ICONS = {
      phone: svg(
        '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'
      ),
      phoneOff: svg(
        '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" x2="2" y1="2" y2="22"/>'
      ),
      chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
      send: svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
      mic: svg(
        '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>'
      ),
      micOff: svg(
        '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>'
      ),
      x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
      chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
      chevronUp: svg('<path d="m18 15-6-6-6 6"/>'),
      copy: svg(
        '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
      ),
      check: svg('<path d="M20 6 9 17l-5-5"/>'),
      download: svg(
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'
      ),
      wrap: svg('<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="10" y1="18" y2="18"/>'),
      expand: svg(
        '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>'
      ),
      shrink: svg(
        '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>'
      ),
      link: svg(
        '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
      ),
      image: svg(
        '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'
      ),
      globe: svg(
        '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'
      ),
      paperclip: svg(
        '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'
      ),
      keyboard: svg(
        '<rect width="20" height="16" x="2" y="4" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/>'
      ),
      star: svg(
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
        20
      ),
      spinner: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="vw-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
    };
  }
});

// src/orb.ts
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) % 1024 / 1024;
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);
  let v = 0;
  for (let dx = 0; dx <= 1; dx += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dz = 0; dz <= 1; dz += 1) {
        const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        v += w * hash3(xi + dx, yi + dy, zi + dz);
      }
    }
  }
  return v * 2 - 1;
}
function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function icosphere(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ].map(normalize);
  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];
  for (let d = 0; d < detail; d += 1) {
    const midCache = /* @__PURE__ */ new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      const hit = midCache.get(key);
      if (hit !== void 0) return hit;
      const va = verts[a];
      const vb = verts[b];
      const idx = verts.length;
      verts.push(
        normalize([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2])
      );
      midCache.set(key, idx);
      return idx;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const edgeSet = /* @__PURE__ */ new Set();
  const edges = [];
  const addEdge = (a, b) => {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([a, b]);
  };
  for (const [a, b, c] of faces) {
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return { verts, edges };
}
function createOrb(size, color1, color2) {
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  let state = "idle";
  let raf = 0;
  let running = true;
  const half = size * dpr / 2;
  const baseRadius = half * 0.86;
  const { verts, edges } = icosphere(size >= 56 ? 3 : 2);
  const projected = verts.map(() => [0, 0, 0]);
  function amplitude(now) {
    switch (state) {
      case "idle":
        return 0.03 + Math.sin(now * 2e-3) * 0.02;
      case "connecting":
        return 0.08 + Math.sin(now * 4e-3) * 0.06;
      case "speaking":
        return 0.22 + Math.sin(now * 6e-3) * 0.12;
      case "listening":
      default:
        return 0.06 + Math.sin(now * 3e-3) * 0.03;
    }
  }
  function render(now) {
    if (!running || !ctx) return;
    const amp = amplitude(now);
    const rot = now * 3e-4;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    ctx.clearRect(0, 0, size * dpr, size * dpr);
    const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, `${color2}55`);
    glow.addColorStop(0.75, `${color2}18`);
    glow.addColorStop(1, `${color2}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size * dpr, size * dpr);
    for (let i = 0; i < verts.length; i += 1) {
      const [nx0, ny, nz0] = verts[i];
      const n = noise3(
        nx0 * 1.4 + now * 35e-5,
        ny * 1.4 + now * 4e-4,
        nz0 * 1.4 + now * 45e-5
      );
      const r = 1 + n * amp * 1.4 + amp * 0.35;
      const nx = nx0 * cosR + nz0 * sinR;
      const nz = -nx0 * sinR + nz0 * cosR;
      const persp = 1 / (1.6 - 0.6 * nz);
      projected[i] = [
        half + nx * r * baseRadius * persp,
        half + ny * r * baseRadius * persp,
        nz
      ];
    }
    ctx.lineWidth = Math.max(0.6, size * dpr * 6e-3);
    ctx.strokeStyle = color1;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const [a, b] of edges) {
      const pa = projected[a];
      const pb = projected[b];
      if (pa[2] < -0.55 && pb[2] < -0.55) continue;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(render);
  }
  raf = requestAnimationFrame(render);
  return {
    el: canvas,
    setState(next) {
      state = next;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
    }
  };
}
var init_orb = __esm({
  "src/orb.ts"() {
    "use strict";
  }
});

// src/markdown.ts
function parseMarkdown(src, policy) {
  const blocks = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = line.match(/^```([A-Za-z0-9+#._-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] ?? "").toLowerCase();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code_block", lang, text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        children: parseInline(heading[2] ?? "", policy)
      });
      i += 1;
      continue;
    }
    const listItem = matchListItem(line);
    if (listItem) {
      const ordered = listItem.ordered;
      const items = [];
      while (i < lines.length) {
        const m = matchListItem(lines[i] ?? "");
        if (!m || m.ordered !== ordered) break;
        items.push(parseInline(m.text, policy));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "" || /^```/.test(next) || /^#{1,4}\s/.test(next) || matchListItem(next)) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(para.join("\n"), policy) });
  }
  return blocks;
}
function matchListItem(line) {
  const ul = line.match(/^\s{0,3}[-*+]\s+(.*)$/);
  if (ul) return { ordered: false, text: ul[1] ?? "" };
  const ol = line.match(/^\s{0,3}\d{1,9}[.)]\s+(.*)$/);
  if (ol) return { ordered: true, text: ol[1] ?? "" };
  return null;
}
function parseInline(src, policy) {
  const out = [];
  let rest = src;
  const pushText = (t) => {
    if (t === "") return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  while (rest.length > 0) {
    const patterns = [];
    const code = rest.match(/`([^`\n]+)`/);
    if (code && code.index !== void 0) {
      patterns.push({
        index: code.index,
        len: code[0].length,
        run: () => out.push({ kind: "code", text: code[1] ?? "" })
      });
    }
    const link = rest.match(/\[([^\]\n]*)\]\(([^)\s]+)\)/);
    if (link && link.index !== void 0) {
      const href = link[2] ?? "";
      const label = link[1] ?? "";
      patterns.push({
        index: link.index,
        len: link[0].length,
        run: () => {
          const allowed = isLinkAllowed(href, policy);
          out.push({
            kind: "link",
            href,
            children: parseInline(label, policy),
            allowed
          });
        }
      });
    }
    const strong = rest.match(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/);
    if (strong && strong.index !== void 0) {
      const inner = strong[1] ?? strong[2] ?? "";
      patterns.push({
        index: strong.index,
        len: strong[0].length,
        run: () => out.push({ kind: "strong", children: parseInline(inner, policy) })
      });
    }
    const em = rest.match(/(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/);
    if (em && em.index !== void 0) {
      const inner = em[1] ?? em[2] ?? "";
      patterns.push({
        index: em.index,
        len: em[0].length,
        run: () => out.push({ kind: "em", children: parseInline(inner, policy) })
      });
    }
    const del = rest.match(/~~([^~\n]+)~~/);
    if (del && del.index !== void 0) {
      patterns.push({
        index: del.index,
        len: del[0].length,
        run: () => out.push({ kind: "del", children: parseInline(del[1] ?? "", policy) })
      });
    }
    if (patterns.length === 0) {
      pushText(rest);
      break;
    }
    patterns.sort((a, b) => a.index - b.index);
    const first = patterns[0];
    pushText(rest.slice(0, first.index));
    first.run();
    rest = rest.slice(first.index + first.len);
  }
  return out;
}
function stripAudioTags(text) {
  return text.replace(/\[[^\][\n]{1,60}\](?!\()/g, "").replace(/ {2,}/g, " ").replace(/^ +| +$/gm, "");
}
var init_markdown = __esm({
  "src/markdown.ts"() {
    "use strict";
    init_link_policy();
  }
});

// src/highlight.ts
function jsKeywords() {
  return ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of", "class", "extends", "super", "this", "import", "export", "from", "as", "async", "await", "yield", "try", "catch", "finally", "throw", "true", "false", "null", "undefined", "void", "static", "get", "set"];
}
function highlightCode(code, lang) {
  const kw = new Set(KEYWORDS[lang] ?? []);
  const caseInsensitive = lang === "sql";
  const tokens = [];
  const push = (cls, text) => {
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls) last.text += text;
    else tokens.push({ cls, text });
  };
  const hashComment = lang === "python" || lang === "py" || lang === "bash" || lang === "sh";
  const dashComment = lang === "sql";
  const slashComment = !hashComment && !dashComment && lang !== "css" && lang !== "html";
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    const [full, com, str, num, word, other] = m;
    if (com !== void 0) {
      const isComment = com.startsWith("#") && hashComment || com.startsWith("--") && dashComment || (com.startsWith("//") || com.startsWith("/*")) && slashComment;
      push(isComment ? "com" : "pln", com);
    } else if (str !== void 0) {
      push("str", str);
    } else if (num !== void 0) {
      push("num", num);
    } else if (word !== void 0) {
      const probe = caseInsensitive ? word.toLowerCase() : word;
      push(kw.has(probe) ? "kw" : "pln", word);
    } else if (other !== void 0) {
      push("pln", other);
    } else {
      push("pln", full);
    }
  }
  return tokens;
}
var KEYWORDS, TOKEN_RE;
var init_highlight = __esm({
  "src/highlight.ts"() {
    "use strict";
    KEYWORDS = {
      javascript: jsKeywords(),
      typescript: [...jsKeywords(), "type", "interface", "enum", "namespace", "declare", "readonly", "keyof", "infer", "is", "asserts", "satisfies"],
      js: jsKeywords(),
      ts: [...jsKeywords(), "type", "interface", "enum", "readonly"],
      jsx: jsKeywords(),
      tsx: [...jsKeywords(), "type", "interface", "enum", "readonly"],
      python: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "with", "lambda", "pass", "break", "continue", "raise", "yield", "global", "nonlocal", "assert", "del", "True", "False", "None", "async", "await", "match", "case"],
      py: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "with", "lambda", "True", "False", "None", "async", "await"],
      rust: ["fn", "let", "mut", "const", "static", "if", "else", "match", "loop", "while", "for", "in", "return", "break", "continue", "struct", "enum", "trait", "impl", "pub", "use", "mod", "crate", "self", "Self", "super", "where", "async", "await", "move", "ref", "type", "unsafe", "dyn", "as", "true", "false"],
      go: ["func", "return", "if", "else", "for", "range", "switch", "case", "default", "break", "continue", "type", "struct", "interface", "map", "chan", "go", "defer", "select", "package", "import", "var", "const", "nil", "true", "false"],
      java: ["public", "private", "protected", "class", "interface", "extends", "implements", "return", "if", "else", "for", "while", "switch", "case", "new", "static", "final", "void", "int", "long", "double", "boolean", "String", "true", "false", "null", "import", "package", "try", "catch", "finally", "throw", "throws"],
      sql: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit", "offset", "and", "or", "not", "null", "as", "distinct", "union", "all", "exists", "in", "like", "between", "primary", "key", "foreign", "references", "index"],
      bash: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "exit", "in"],
      sh: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "exit", "in"],
      json: ["true", "false", "null"],
      css: [],
      html: []
    };
    TOKEN_RE = /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+|[^\sA-Za-z0-9_$]+)/g;
  }
});

// src/md-dom.ts
function renderMarkdown(blocks, opts) {
  const frag = document.createDocumentFragment();
  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph": {
        const p = document.createElement("p");
        p.append(renderInline(block.children));
        frag.append(p);
        break;
      }
      case "heading": {
        const h = document.createElement(`h${Math.min(block.level, 4)}`);
        h.append(renderInline(block.children));
        frag.append(h);
        break;
      }
      case "list": {
        const list = document.createElement(block.ordered ? "ol" : "ul");
        for (const item of block.items) {
          const li = document.createElement("li");
          li.append(renderInline(item));
          list.append(li);
        }
        frag.append(list);
        break;
      }
      case "code_block":
        frag.append(renderCodeBlock(block.lang, block.text, opts));
        break;
    }
  }
  return frag;
}
function renderInline(nodes) {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        frag.append(document.createTextNode(node.text));
        break;
      case "strong": {
        const el = document.createElement("strong");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "em": {
        const el = document.createElement("em");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "del": {
        const el = document.createElement("del");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "code": {
        const el = document.createElement("code");
        el.textContent = node.text;
        frag.append(el);
        break;
      }
      case "link": {
        if (node.allowed) {
          const a = document.createElement("a");
          a.href = node.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.append(renderInline(node.children));
          frag.append(a);
        } else {
          frag.append(renderInline(node.children));
        }
        break;
      }
    }
  }
  return frag;
}
function renderCodeBlock(lang, code, opts) {
  const wrap = document.createElement("div");
  wrap.className = "vw-codeblock";
  wrap.dataset.theme = opts.syntaxTheme;
  const bar = document.createElement("div");
  bar.className = "vw-codeblock-bar";
  const label = document.createElement("span");
  label.textContent = lang || "text";
  bar.append(label);
  const actions = document.createElement("div");
  actions.className = "vw-codeblock-actions";
  actions.append(
    toolButton(ICONS.copy, opts.text.copy, (btn) => {
      const p = navigator.clipboard?.writeText(code);
      if (!p) return;
      void p.then(() => {
        btn.title = opts.text.copied;
        btn.innerHTML = ICONS.check;
        setTimeout(() => {
          btn.title = opts.text.copy;
          btn.innerHTML = ICONS.copy;
        }, 1500);
      }).catch(() => {
      });
    }),
    toolButton(ICONS.download, opts.text.download, () => {
      const blob = new Blob([code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snippet.${lang || "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    }),
    toolButton(ICONS.wrap, opts.text.wrap, () => {
      if (wrap.hasAttribute("data-wrap")) wrap.removeAttribute("data-wrap");
      else wrap.setAttribute("data-wrap", "");
    })
  );
  bar.append(actions);
  wrap.append(bar);
  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  for (const token of highlightCode(code, lang)) {
    if (token.cls === "pln") {
      codeEl.append(document.createTextNode(token.text));
    } else {
      const span = document.createElement("span");
      span.className = `hl-${token.cls}`;
      span.textContent = token.text;
      codeEl.append(span);
    }
  }
  pre.append(codeEl);
  wrap.append(pre);
  return wrap;
}
function toolButton(icon, title, onClick) {
  const btn = document.createElement("button");
  btn.className = "vw-iconbtn";
  btn.style.width = "22px";
  btn.style.height = "22px";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = icon;
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}
var init_md_dom = __esm({
  "src/md-dom.ts"() {
    "use strict";
    init_highlight();
    init_icons();
  }
});

// src/output-format.ts
function outputFormatFromFrame(value) {
  return value === "plain_text" ? "plain_text" : DEFAULT_OUTPUT_FORMAT;
}
function renderAgentText(bubble, text, format, markdown) {
  if (format === "plain_text") {
    bubble.textContent = text;
    return;
  }
  bubble.append(markdown(text));
}
var DEFAULT_OUTPUT_FORMAT;
var init_output_format = __esm({
  "src/output-format.ts"() {
    "use strict";
    DEFAULT_OUTPUT_FORMAT = "markdown";
  }
});

// src/styles.ts
var WIDGET_CSS;
var init_styles = __esm({
  "src/styles.ts"() {
    "use strict";
    WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; background: none; border: none; cursor: pointer; color: inherit; }
input, textarea { font: inherit; color: inherit; }

.vw-root {
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--vw-base-primary);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
/* Preview mode (dashboard settings page): fill the preview container and
   size the sheet to IT, not the viewport \u2014 otherwise the sheet clips.
   The [data-placement] compound outranks the corner-placement rules below
   regardless of source order. */
.vw-root[data-preview],
.vw-root[data-preview][data-placement] {
  position: absolute;
  inset: 0;
  padding: var(--vw-overlay-padding);
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  transform: none;
}
.vw-root[data-preview] .vw-sheet,
.vw-root[data-preview] .vw-sheet[data-large] {
  max-height: 100%;
  max-width: 100%;
  min-height: 0;
}
.vw-root[data-placement="bottom-right"] { right: var(--vw-overlay-padding); bottom: var(--vw-overlay-padding); }
.vw-root[data-placement="bottom-left"]  { left: var(--vw-overlay-padding); bottom: var(--vw-overlay-padding); align-items: flex-start; }
.vw-root[data-placement="bottom"]       { left: 50%; transform: translateX(-50%); bottom: var(--vw-overlay-padding); align-items: center; }
.vw-root[data-placement="top-right"]    { right: var(--vw-overlay-padding); top: var(--vw-overlay-padding); flex-direction: column-reverse; }
.vw-root[data-placement="top-left"]     { left: var(--vw-overlay-padding); top: var(--vw-overlay-padding); align-items: flex-start; flex-direction: column-reverse; }
.vw-root[data-placement="top"]          { left: 50%; transform: translateX(-50%); top: var(--vw-overlay-padding); align-items: center; flex-direction: column-reverse; }

/* \u2500\u2500 Launcher \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-launcher {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
  padding: 12px 18px;
  box-shadow: 0 8px 28px rgba(0,0,0,.22);
  transition: background .15s ease, transform .1s ease;
}
.vw-launcher:hover { background: var(--vw-accent-hover); }
.vw-launcher:active { background: var(--vw-accent-active); transform: scale(.98); }
.vw-launcher .vw-avatar { width: 26px; height: 26px; }
.vw-launcher-label { font-weight: 600; white-space: nowrap; }
.vw-launcher[data-variant="tiny"] { padding: 5px; border-radius: 50%; }
.vw-launcher[data-variant="tiny"] .vw-avatar { width: 44px; height: 44px; }
.vw-launcher[data-variant="tiny"] .vw-launcher-label { display: none; }
.vw-launcher[data-variant="full"] { flex-direction: column; padding: 16px 22px; gap: 8px; }
.vw-launcher[data-variant="full"] .vw-avatar { width: 40px; height: 40px; }

/* \u2500\u2500 Avatar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-avatar {
  width: 34px; height: 34px;
  border-radius: 50%;
  flex: none;
  background: radial-gradient(circle at 30% 30%, var(--vw-orb-1, #7959ff), var(--vw-orb-2, #9b7aff));
  overflow: hidden;
}
.vw-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vw-avatar-glyph { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: #fff; }
.vw-avatar-glyph svg { width: 55%; height: 55%; }
.vw-avatar canvas { width: 100% !important; height: 100% !important; }
.vw-avatar[data-speaking] { animation: vw-pulse 1.6s ease-in-out infinite; }
@keyframes vw-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,.45); }
  50% { box-shadow: 0 0 0 7px rgba(99,102,241,0); }
}

/* \u2500\u2500 Sheet \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-sheet {
  width: 360px;
  height: 540px;
  max-height: calc(100vh - 2 * var(--vw-overlay-padding));
  max-width: calc(100vw - 2 * var(--vw-overlay-padding));
  display: flex;
  flex-direction: column;
  background: var(--vw-base);
  color: var(--vw-base-primary);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-sheet-radius);
  box-shadow: 0 18px 50px rgba(0,0,0,.28);
  overflow: hidden;
}
.vw-sheet[data-large] { width: 460px; height: 660px; }

.vw-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--vw-base-border);
  flex: none;
}
.vw-header-meta { flex: 1; min-width: 0; }
.vw-header-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vw-header-status { font-size: 12px; color: var(--vw-base-subtle); display: flex; align-items: center; gap: 5px; }
.vw-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vw-base-subtle); flex: none; }
.vw-status-dot[data-live] { background: #22c55e; }
.vw-header-actions { display: flex; align-items: center; gap: 2px; }
.vw-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border-radius: 8px;
  color: var(--vw-base-subtle);
}
.vw-iconbtn:hover { background: var(--vw-base-hover); color: var(--vw-base-primary); }
.vw-iconbtn:active { background: var(--vw-base-active); }
.vw-iconbtn[data-active] { color: var(--vw-base-primary); background: var(--vw-base-active); }

.vw-lang {
  font-size: 12px;
  color: var(--vw-base-subtle);
  background: var(--vw-base);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-dropdown-sheet-radius);
  padding: 3px 8px;
  max-width: 90px;
}

/* \u2500\u2500 Body \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.vw-body[data-hidden] { display: none; }

.vw-intro {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 20px;
}
.vw-intro .vw-avatar { width: 64px; height: 64px; }
.vw-intro-title { font-weight: 600; font-size: 16px; }
.vw-cta {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
  padding: 10px 18px;
  font-weight: 600;
}
.vw-cta:hover { background: var(--vw-accent-hover); }
.vw-cta:active { background: var(--vw-accent-active); }
.vw-cta-secondary {
  background: var(--vw-base);
  color: var(--vw-base-primary);
  border: 1px solid var(--vw-base-border);
}
.vw-cta-secondary:hover { background: var(--vw-base-hover); }

.vw-msg { max-width: 85%; }
.vw-msg-agent { align-self: flex-start; }
.vw-msg-user { align-self: flex-end; }
.vw-bubble {
  padding: 8px 12px;
  border-radius: var(--vw-bubble-radius);
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.vw-msg-agent .vw-bubble { background: var(--vw-base-hover); border: 1px solid var(--vw-base-border); }
.vw-msg-user .vw-bubble { background: var(--vw-accent); color: var(--vw-accent-primary); }
.vw-system { align-self: center; font-size: 12px; color: var(--vw-base-subtle); text-align: center; }
.vw-error { color: var(--vw-base-error); font-size: 12px; align-self: center; text-align: center; }

.vw-typing { display: inline-flex; align-items: center; gap: 6px; color: var(--vw-base-subtle); font-size: 12px; }
.vw-typing-dots { display: inline-flex; gap: 3px; }
.vw-typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--vw-base-subtle); animation: vw-blink 1.2s infinite; }
.vw-typing-dots span:nth-child(2) { animation-delay: .2s; }
.vw-typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes vw-blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.vw-action { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vw-base-subtle); border: 1px solid var(--vw-base-border); border-radius: 999px; padding: 3px 10px; }
.vw-action[data-state="error"] { color: var(--vw-base-error); border-color: var(--vw-base-error); }
.vw-spin { animation: vw-rotate 1s linear infinite; }
@keyframes vw-rotate { to { transform: rotate(360deg); } }

/* Markdown */
.vw-bubble p + p, .vw-bubble ul, .vw-bubble ol, .vw-bubble h1, .vw-bubble h2, .vw-bubble h3, .vw-bubble h4 { margin-top: 6px; }
.vw-bubble h1 { font-size: 17px; } .vw-bubble h2 { font-size: 16px; } .vw-bubble h3, .vw-bubble h4 { font-size: 15px; }
.vw-bubble ul, .vw-bubble ol { padding-left: 18px; }
.vw-bubble a { color: inherit; text-decoration: underline; }
.vw-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--vw-base-active); border-radius: 4px; padding: 1px 4px; }
.vw-codeblock { margin-top: 6px; border: 1px solid var(--vw-base-border); border-radius: 8px; overflow: hidden; font-size: 12px; }
.vw-codeblock-bar { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: var(--vw-base-hover); border-bottom: 1px solid var(--vw-base-border); color: var(--vw-base-subtle); font-size: 11px; }
.vw-codeblock-actions { display: inline-flex; gap: 2px; }
.vw-codeblock pre { padding: 8px; overflow-x: auto; background: var(--vw-base); }
.vw-codeblock[data-wrap] pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.vw-codeblock pre code { background: none; padding: 0; }
/* highlight themes */
.vw-codeblock[data-theme="light"] pre { background: #f8fafc; color: #0f172a; }
.vw-codeblock[data-theme="light"] .hl-kw { color: #7c3aed; }
.vw-codeblock[data-theme="light"] .hl-str { color: #16a34a; }
.vw-codeblock[data-theme="light"] .hl-com { color: #94a3b8; font-style: italic; }
.vw-codeblock[data-theme="light"] .hl-num { color: #ea580c; }
.vw-codeblock[data-theme="dark"] pre { background: #0f172a; color: #e2e8f0; }
.vw-codeblock[data-theme="dark"] .hl-kw { color: #c4b5fd; }
.vw-codeblock[data-theme="dark"] .hl-str { color: #86efac; }
.vw-codeblock[data-theme="dark"] .hl-com { color: #64748b; font-style: italic; }
.vw-codeblock[data-theme="dark"] .hl-num { color: #fdba74; }
@media (prefers-color-scheme: light) {
  .vw-codeblock[data-theme="auto"] pre { background: #f8fafc; color: #0f172a; }
  .vw-codeblock[data-theme="auto"] .hl-kw { color: #7c3aed; }
  .vw-codeblock[data-theme="auto"] .hl-str { color: #16a34a; }
  .vw-codeblock[data-theme="auto"] .hl-com { color: #94a3b8; font-style: italic; }
  .vw-codeblock[data-theme="auto"] .hl-num { color: #ea580c; }
}
@media (prefers-color-scheme: dark) {
  .vw-codeblock[data-theme="auto"] pre { background: #0f172a; color: #e2e8f0; }
  .vw-codeblock[data-theme="auto"] .hl-kw { color: #c4b5fd; }
  .vw-codeblock[data-theme="auto"] .hl-str { color: #86efac; }
  .vw-codeblock[data-theme="auto"] .hl-com { color: #64748b; font-style: italic; }
  .vw-codeblock[data-theme="auto"] .hl-num { color: #fdba74; }
}

/* \u2500\u2500 Footer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-footer { flex: none; border-top: 1px solid var(--vw-base-border); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.vw-inputrow { display: flex; align-items: center; gap: 8px; }
.vw-input {
  flex: 1;
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-input-radius);
  background: var(--vw-base);
  padding: 8px 12px;
  outline: none;
  min-width: 0;
}
.vw-input:focus { border-color: var(--vw-accent-border); }
.vw-sendbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex: none;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
}
.vw-sendbtn:hover { background: var(--vw-accent-hover); }
.vw-sendbtn:disabled { opacity: .5; cursor: default; }
.vw-attachbtn {
  background: var(--vw-base);
  color: var(--vw-base-subtle);
  border: 1px solid var(--vw-base-border);
}
.vw-attachbtn:hover { background: var(--vw-base-hover); color: var(--vw-base-primary); }
.vw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vw-chip {
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 100%;
  padding: 3px 6px 3px 10px;
  font-size: 12px;
  color: var(--vw-base-primary);
  background: var(--vw-base-hover);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-button-radius);
}
.vw-chip-name {
  max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vw-chip-remove {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex: none;
  color: var(--vw-base-subtle);
  border-radius: 50%;
}
.vw-chip-remove:hover { color: var(--vw-base-primary); background: var(--vw-base-active); }
.vw-callrow { display: flex; align-items: center; justify-content: center; gap: 10px; }
.vw-callbtn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px;
  border-radius: var(--vw-button-radius);
  font-weight: 600;
  border: 1px solid var(--vw-base-border);
  background: var(--vw-base);
  color: var(--vw-base-primary);
}
.vw-callbtn:hover { background: var(--vw-base-hover); }
.vw-callbtn[data-danger] { background: var(--vw-base-error); border-color: var(--vw-base-error); color: #ffffff; }
.vw-callbtn[data-accent] { background: var(--vw-accent); border-color: var(--vw-accent); color: var(--vw-accent-primary); }
.vw-callbtn[data-accent]:hover { background: var(--vw-accent-hover); }
.vw-footer-note { font-size: 11px; color: var(--vw-base-subtle); text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }
.vw-footer-note button { text-decoration: underline; color: inherit; }

/* \u2500\u2500 Overlays (terms / feedback) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
.vw-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--vw-base) 55%, transparent);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-end;
  z-index: 5;
}
.vw-overlay-card {
  width: 100%;
  max-height: 85%;
  overflow-y: auto;
  background: var(--vw-base);
  border-top: 1px solid var(--vw-base-border);
  border-radius: var(--vw-compact-sheet-radius) var(--vw-compact-sheet-radius) 0 0;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vw-overlay-title { font-weight: 600; font-size: 15px; }
.vw-overlay-body { font-size: 13px; color: var(--vw-base-subtle); max-height: 240px; overflow-y: auto; }
.vw-overlay-actions { display: flex; gap: 8px; justify-content: flex-end; }
.vw-stars { display: flex; gap: 6px; justify-content: center; }
.vw-star { color: var(--vw-base-subtle); padding: 3px; }
.vw-star[data-on] { color: #f59e0b; }
.vw-star :is(svg) { fill: none; }
.vw-star[data-on] :is(svg) { fill: currentColor; }
.vw-textarea {
  width: 100%;
  min-height: 72px;
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-input-radius);
  background: var(--vw-base);
  padding: 8px 12px;
  resize: vertical;
  outline: none;
}
.vw-convo-id { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--vw-base-subtle); }
.vw-convo-id code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.vw-sheet-container { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.vw-hidden { display: none !important; }
`;
  }
});

// src/text-defaults.ts
function resolveText(overrides2, key) {
  const v = overrides2?.[key];
  return v !== void 0 && v !== "" ? v : WIDGET_TEXT_DEFAULTS[key];
}
var WIDGET_TEXT_DEFAULTS, WIDGET_TEXT_KEYS;
var init_text_defaults = __esm({
  "src/text-defaults.ts"() {
    "use strict";
    WIDGET_TEXT_DEFAULTS = {
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
      thanks_for_feedback_details: "Your feedback helps us improve our service and better assist you.",
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
      queued_status: "Waiting for an available agent\u2026",
      queue_timed_out: "No agent became available \u2014 please try again later"
    };
    WIDGET_TEXT_KEYS = Object.keys(
      WIDGET_TEXT_DEFAULTS
    );
  }
});

// ../ai-agent/src/internal/platform.ts
function platform() {
  return { ...browserDefaults(), ...overrides };
}
var browserDefaults, overrides, MIC_CONSTRAINTS;
var init_platform = __esm({
  "../ai-agent/src/internal/platform.ts"() {
    "use strict";
    browserDefaults = () => ({
      RTCPeerConnection: globalThis.RTCPeerConnection,
      RTCSessionDescription: globalThis.RTCSessionDescription,
      mediaDevices: () => globalThis.navigator?.mediaDevices,
      fetch: (...args) => globalThis.fetch(...args),
      setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms)
    });
    overrides = {};
    MIC_CONSTRAINTS = {
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      video: false
    };
  }
});

// ../ai-agent/src/internal/voice-client.ts
function transcriptRole(msg) {
  switch (msg.type) {
    case "bot-transcription":
    case "bot-llm-text":
    case "bot-tts-text":
    case "bot-output":
      return "agent";
    case "user-transcription":
      return "user";
    default:
      return null;
  }
}
function isRenderableTranscript(msg) {
  const role = transcriptRole(msg);
  if (!role) return false;
  if (role === "agent") {
    return msg.type === "bot-output" && msg.data?.spoken === true && msg.data?.aggregated_by === "sentence";
  }
  return msg.data?.final === true;
}
function isSessionEndedMessage(msg) {
  if (msg.label !== "rtvi-ai" || msg.type !== "server-message") return false;
  const data = msg.data;
  return typeof data === "object" && data !== null && data.type === SESSION_ENDED_MESSAGE_TYPE;
}
function queueTransition(msg) {
  if (msg.label !== "rtvi-ai" || msg.type !== "server-message") return null;
  const data = msg.data;
  if (typeof data !== "object" || data === null) return null;
  const record = data;
  if (record.type === QUEUE_STATUS_MESSAGE_TYPE) {
    const status = record.status;
    if (status === "waiting" || status === "admitted" || status === "timed_out") return status;
    return null;
  }
  if (record.type === "session-ended" && record.reason === QUEUE_TIMEOUT_REASON) {
    return "timed_out";
  }
  return null;
}
function peerFailureState(serverEnded) {
  return serverEnded ? "disconnected" : "error";
}
function buildSendTextEnvelope(content) {
  return {
    label: "rtvi-ai",
    type: "send-text",
    id: `send-text-${Date.now().toString(36)}`,
    data: {
      content,
      options: { run_immediately: true, audio_response: true }
    }
  };
}
function buildFunctionCallResultEnvelope(toolCallId, result, isError) {
  return {
    label: "rtvi-ai",
    type: "llm-function-call-result",
    id: `tool-result-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, result, is_error: isError }
  };
}
function buildMcpToolApprovalEnvelope(toolCallId, isApproved) {
  return {
    label: "rtvi-ai",
    type: "mcp-tool-approval-result",
    id: `mcp-approval-${Date.now().toString(36)}`,
    data: { tool_call_id: toolCallId, is_approved: isApproved }
  };
}
function mcpToolCallDataFromRtvi(msg) {
  if (msg.type !== "mcp-tool-call") return null;
  const data = msg.data;
  return data ?? null;
}
function buildAppendToContextEnvelope(text, contextId) {
  const data = { text };
  if (contextId !== void 0) data.context_id = contextId;
  return {
    label: "rtvi-ai",
    type: "append-to-context",
    id: `context-${Date.now().toString(36)}`,
    data
  };
}
function clientToolCallFromRtvi(msg) {
  if (msg.type !== "llm-function-call") return null;
  const data = msg.data;
  const toolName = data?.function_name;
  const toolCallId = data?.tool_call_id;
  if (typeof toolName !== "string" || typeof toolCallId !== "string") return null;
  const args = data?.args;
  const parameters = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
  const timeout = data?.response_timeout_secs;
  return {
    toolName,
    toolCallId,
    parameters,
    // Absent on a pre-E3 emitter: assume the agent waits (safe default —
    // an answer nobody waits for is dropped silently).
    expectsResponse: data?.expects_response !== false,
    ...typeof timeout === "number" ? { responseTimeoutSecs: timeout } : {}
  };
}
function buildUserActivityEnvelope() {
  return {
    label: "rtvi-ai",
    type: "user-activity",
    id: `user-activity-${Date.now().toString(36)}`
  };
}
function buildFeedbackEnvelope(score, eventId) {
  return {
    label: "rtvi-ai",
    type: "feedback",
    id: `feedback-${Date.now().toString(36)}`,
    data: { score, event_id: eventId }
  };
}
function answerDescriptor(answer) {
  const { session_id, session_token, conversation_id } = answer;
  return { session_id, session_token, conversation_id: conversation_id ?? "" };
}
function addTraceHeaders(headers, context) {
  for (const name of ["traceparent", "tracestate"]) {
    const value = context?.[name];
    if (value) headers[name] = value;
  }
}
function disconnectUrl(signalingUrl) {
  const url = new URL(signalingUrl);
  url.pathname = url.pathname.replace(/\/api\/offer\/?$/, "/api/disconnect");
  url.search = "";
  url.hash = "";
  return url.toString();
}
function waitForIceGathering(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = platform().setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 250);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}
function tuneOpusFmtp(sdp) {
  const opusPts = [...sdp.matchAll(/^a=rtpmap:(\d+)\s+opus\/\d+/gim)].map((m) => m[1]);
  if (opusPts.length === 0) return sdp;
  const haveFmtp = /* @__PURE__ */ new Set();
  const lines = sdp.split(/\r\n|\n/);
  const out = lines.map((line) => {
    const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/i);
    if (!m || !opusPts.includes(m[1])) return line;
    haveFmtp.add(m[1]);
    return `a=fmtp:${m[1]} ${withOpusDirectives(m[2] ?? "")}`;
  });
  const missing = opusPts.filter((pt) => pt !== void 0 && !haveFmtp.has(pt));
  if (missing.length === 0) return out.join("\r\n");
  const withFmtp = [];
  for (const line of out) {
    withFmtp.push(line);
    const rm = line.match(/^a=rtpmap:(\d+)\s+opus\/\d+/i);
    if (rm && missing.includes(rm[1])) {
      withFmtp.push(`a=fmtp:${rm[1]} usedtx=0;useinbandfec=1`);
    }
  }
  return withFmtp.join("\r\n");
}
function withOpusDirectives(params) {
  let next = /usedtx=/i.test(params) ? params.replace(/usedtx=\d+/i, "usedtx=0") : `${params};usedtx=0`;
  next = /useinbandfec=/i.test(next) ? next.replace(/useinbandfec=\d+/i, "useinbandfec=1") : `${next};useinbandfec=1`;
  return next;
}
var SESSION_ENDED_MESSAGE_TYPE, QUEUE_STATUS_MESSAGE_TYPE, QUEUE_TIMEOUT_REASON, VoiceClient;
var init_voice_client = __esm({
  "../ai-agent/src/internal/voice-client.ts"() {
    "use strict";
    init_platform();
    SESSION_ENDED_MESSAGE_TYPE = "session-ended";
    QUEUE_STATUS_MESSAGE_TYPE = "queue_status";
    QUEUE_TIMEOUT_REASON = "queue_timeout";
    VoiceClient = class {
      constructor(session, opts) {
        this.session = session;
        this.opts = opts;
        /** The worker announced it ended the session on purpose (see `isSessionEndedMessage`). */
        this.serverEnded = false;
        this.pc = null;
        this.dc = null;
        this.localStream = null;
        this.pcId = null;
        this.state = "idle";
        this.disposed = false;
        this.audioRendering = false;
        this.clientReadySent = false;
      }
      /**
       * A client that redeems a conversation token (`GET
       * /v1/convai/conversation/token`, E2 D-4 / E4 Q6) instead of a minted
       * session: the first offer carries `conversation_token`, and the answer's
       * session descriptor (`session_id`, the disconnect proof, `conversation_id`)
       * is adopted before anything else uses it. Inside 15 minutes the same token
       * re-joins the same conversation (Q29).
       */
      static fromConversationToken(token, where, opts) {
        return new this(
          {
            session_id: "",
            conversation_id: "",
            signaling_url: where.signalingUrl,
            ice_servers: where.iceServers,
            conversation_token: token
          },
          opts
        );
      }
      // ── Protected extension points (E4 Q12) ───────────────────────────────
      // Every default reproduces the widget's behaviour byte-for-byte (the
      // golden audio-path test). Staff-only behaviour (dashboard auth headers,
      // receive-only listen-in, …) lives in a subclass OUTSIDE this package.
      /** Headers added to the offer POST after Content-Type, before the trace headers. */
      extraOfferHeaders() {
        return {};
      }
      /** Headers of the disconnect POST. */
      disconnectHeaders() {
        return { "Content-Type": "application/json" };
      }
      /** Where the disconnect POST goes. */
      disconnectEndpoint() {
        return disconnectUrl(this.session.signaling_url);
      }
      /** Body of the disconnect POST — the ownership proof (VOSO-191). */
      disconnectBody() {
        return { session_id: this.session.session_id, session_token: this.session.session_token };
      }
      /** Console text when the disconnect POST is skipped (no token) or rejected. */
      disconnectWarning(kind, status) {
        return kind === "skipped" ? "Widget voice disconnect skipped: no session_token" : `Widget voice disconnect rejected: ${status}`;
      }
      /** The error a non-2xx signaling answer raises. */
      signalingFailure(status, statusText, body) {
        const detail = body && typeof body === "object" && typeof body.detail === "string" ? body.detail : statusText;
        return new Error(`Signaling failed (${status}): ${detail}`);
      }
      /** The local capture to publish; `null` publishes nothing. */
      async localMedia() {
        return platform().mediaDevices().getUserMedia(MIC_CONSTRAINTS);
      }
      /** Attach the local capture (or a receive path) to the peer before the offer. */
      configureTransceivers(pc, stream) {
        if (!stream) return;
        for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
      }
      /** `data` of the RTVI `client-ready` frame (none by default — the widget's frame). */
      clientReadyData() {
        return void 0;
      }
      /** The worker's `session-ended` announcement arrived (`reason` when a string). */
      onSessionEndedFrame(_reason) {
      }
      /** The peer closed after that announcement; the client has released it. */
      onAnnouncedEndClosed() {
      }
      /** The live peer connection (`null` when not connected). */
      peer() {
        return this.pc;
      }
      /** The published local capture (`null` when none). */
      mic() {
        return this.localStream;
      }
      /** Send one JSON frame on the data channel; `false` when it is not open. */
      sendFrame(frame) {
        if (!this.dc || this.dc.readyState !== "open") return false;
        this.dc.send(JSON.stringify(frame));
        return true;
      }
      getState() {
        return this.state;
      }
      setState(next) {
        if (this.state === next) return;
        this.state = next;
        this.opts.onStateChange?.(next);
      }
      async connect() {
        if (this.state !== "idle") throw new Error(`Cannot connect from "${this.state}"`);
        this.setState("connecting");
        try {
          const iceServers = (this.session.ice_servers ?? []).map((s) => ({
            urls: s.urls,
            username: s.username,
            credential: s.credential
          }));
          const pc = new (platform()).RTCPeerConnection({
            iceServers: iceServers.length > 0 ? iceServers : [{ urls: "stun:stun.l.google.com:19302" }]
          });
          this.pc = pc;
          pc.addEventListener("connectionstatechange", () => {
            if (this.disposed) return;
            const cs = pc.connectionState;
            if (cs === "connected") this.setState("connected");
            else if (cs === "failed") {
              const next = peerFailureState(this.serverEnded);
              this.setState(next);
              if (next === "error") this.opts.onError?.(new Error("WebRTC connection failed"));
              else {
                void this.cleanup();
                this.onAnnouncedEndClosed();
              }
            } else if (cs === "closed" || cs === "disconnected") {
              this.setState("disconnected");
            }
          });
          pc.addEventListener("track", (event) => {
            if (this.disposed) return;
            const [stream2] = event.streams;
            if (stream2) this.opts.onRemoteAudio?.(stream2);
          });
          const dc = pc.createDataChannel("pipecat");
          this.dc = dc;
          dc.addEventListener("open", () => {
            if (!this.disposed) this.maybeSendClientReady();
          });
          dc.addEventListener("message", (event) => {
            if (this.disposed || typeof event.data !== "string") return;
            try {
              const parsed = JSON.parse(event.data);
              if (isSessionEndedMessage(parsed)) {
                this.serverEnded = true;
                const reason = parsed.data?.reason;
                this.onSessionEndedFrame(typeof reason === "string" ? reason : null);
              }
              if (parsed.type === "signalling" && parsed.message?.type === "renegotiate") {
                void this.renegotiate();
                return;
              }
              this.opts.onAppMessage?.(parsed);
            } catch {
            }
          });
          const stream = await this.localMedia();
          this.localStream = stream;
          this.configureTransceivers(pc, stream);
          await this.negotiate(false);
        } catch (err) {
          this.setState("error");
          await this.cleanup();
          const error = err instanceof Error ? err : new Error("WebRTC connection failed");
          this.opts.onError?.(error);
          throw error;
        }
      }
      async negotiate(isRenegotiation) {
        const pc = this.pc;
        if (!pc) throw new Error("PeerConnection gone");
        const offer = await pc.createOffer({
          voiceActivityDetection: false
        });
        if (offer.sdp) offer.sdp = tuneOpusFmtp(offer.sdp);
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);
        const local = pc.localDescription;
        if (!local) throw new Error("No local SDP");
        const token = !this.session.session_id && this.session.conversation_token;
        const body = token ? { conversation_token: token, sdp: local.sdp, type: local.type } : {
          sdp: local.sdp,
          type: local.type,
          session_id: this.session.session_id,
          request_data: { session_id: this.session.session_id }
        };
        if (this.pcId) body.pc_id = this.pcId;
        if (isRenegotiation) body.restart_pc = false;
        const headers = {
          "Content-Type": "application/json",
          ...this.extraOfferHeaders()
        };
        addTraceHeaders(headers, this.session.trace_context);
        const res = await platform().fetch(this.session.signaling_url, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          let parsed = null;
          try {
            parsed = await res.json();
          } catch {
          }
          throw this.signalingFailure(res.status, res.statusText, parsed);
        }
        const answer = await res.json();
        this.pcId = answer.pc_id;
        if (token && answer.session_id) Object.assign(this.session, answerDescriptor(answer));
        await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
      }
      async renegotiate() {
        if (!this.pc || this.disposed) return;
        try {
          await this.negotiate(true);
        } catch (err) {
          this.opts.onError?.(err instanceof Error ? err : new Error("Renegotiation failed"));
        }
      }
      /** Report that the remote <audio> is actually playing — releases the
       *  server-held greeting via the RTVI client-ready handshake. */
      notifyAudioRendering() {
        this.audioRendering = true;
        this.maybeSendClientReady();
      }
      /**
       * Send typed text as a REAL user turn on the live call (RTVI
       * `send-text` over the data channel — the server injects it into the
       * pipeline's LLM context and runs a completion, interrupting the bot
       * if it is mid-utterance). Returns `false` when the channel is not
       * open or the text is blank; the caller keeps the composer's text.
       */
      sendUserText(text) {
        const trimmed = text.trim();
        if (!trimmed) return false;
        if (!this.dc || this.dc.readyState !== "open") return false;
        this.dc.send(JSON.stringify(buildSendTextEnvelope(trimmed)));
        return true;
      }
      /**
       * Answer a client tool call the agent made on this call (RTVI
       * `llm-function-call-result`; the vendor's `client_tool_result`). Late,
       * duplicate or unknown ids are ignored server-side. Returns `false` when
       * the channel is not open.
       */
      sendClientToolResult(toolCallId, result, isError = false) {
        if (!this.dc || this.dc.readyState !== "open") return false;
        this.dc.send(JSON.stringify(buildFunctionCallResultEnvelope(toolCallId, result, isError)));
        return true;
      }
      /**
       * Approve or deny an MCP tool call the agent is waiting on (RTVI
       * `mcp-tool-approval-result`; the vendor's `mcp_tool_approval_result`,
       * E3 §4.6). Late / unknown ids are ignored server-side. Returns `false`
       * when the channel is not open.
       */
      sendMcpToolApproval(toolCallId, isApproved) {
        if (!this.dc || this.dc.readyState !== "open") return false;
        this.dc.send(JSON.stringify(buildMcpToolApprovalEnvelope(toolCallId, isApproved)));
        return true;
      }
      /**
       * Push background context into the live conversation without a turn
       * (RTVI `append-to-context`; the vendor's `contextual_update`). The agent
       * does not speak; it reads the note on its next reply. A later update
       * with the same `contextId` replaces the earlier one. Returns `false`
       * when the channel is not open.
       */
      sendContextualUpdate(text, contextId) {
        if (!this.dc || this.dc.readyState !== "open") return false;
        this.dc.send(JSON.stringify(buildAppendToContextEnvelope(text, contextId)));
        return true;
      }
      /**
       * Tell the agent the user is active without a turn (RTVI `user-activity`;
       * the vendor's `user_activity`, E2 D-9): resets the idle clock. Returns
       * `false` when the channel is not open.
       */
      sendUserActivity() {
        return this.sendFrame(buildUserActivityEnvelope());
      }
      /**
       * Per-response feedback (RTVI `feedback {score, event_id}`; the vendor's
       * `feedback`, E4 Q16): `like` / `dislike`, `null` clears it. Stored in the
       * ONE feedback store (E2 D-10). Returns `false` when the channel is not open.
       */
      sendFeedback(score, eventId) {
        return this.sendFrame(buildFeedbackEnvelope(score, eventId));
      }
      maybeSendClientReady() {
        if (this.clientReadySent || !this.audioRendering) return;
        if (!this.dc || this.dc.readyState !== "open") return;
        const data = this.clientReadyData();
        this.dc.send(
          JSON.stringify({
            label: "rtvi-ai",
            type: "client-ready",
            id: `client-ready-${Date.now().toString(36)}`,
            ...data ? { data } : {}
          })
        );
        this.clientReadySent = true;
      }
      setMicrophoneEnabled(enabled) {
        if (!this.localStream) return;
        for (const track of this.localStream.getAudioTracks()) track.enabled = enabled;
      }
      async disconnect() {
        this.disposed = true;
        const proof = this.disconnectBody();
        if (this.serverEnded) {
        } else if (!proof.session_token) {
          console.warn(this.disconnectWarning("skipped"));
        } else {
          try {
            const res = await platform().fetch(this.disconnectEndpoint(), {
              method: "POST",
              headers: this.disconnectHeaders(),
              body: JSON.stringify(proof),
              keepalive: true
            });
            if (!res.ok) {
              console.warn(this.disconnectWarning("rejected", res.status));
            }
          } catch {
          }
        }
        await this.cleanup();
        this.setState("disconnected");
      }
      async cleanup() {
        try {
          this.dc?.close();
        } catch {
        }
        this.dc = null;
        try {
          this.pc?.close();
        } catch {
        }
        this.pc = null;
        if (this.localStream) {
          for (const track of this.localStream.getTracks()) track.stop();
          this.localStream = null;
        }
      }
    };
  }
});

// src/voice.ts
var init_voice = __esm({
  "src/voice.ts"() {
    "use strict";
    init_voice_client();
  }
});

// src/client-tools.ts
function mcpToolCallFromRecord(data) {
  const toolCallId = data?.tool_call_id;
  const toolName = data?.tool_name;
  const state = data?.state;
  if (typeof toolCallId !== "string" || typeof toolName !== "string" || typeof state !== "string") {
    return null;
  }
  const params = data?.parameters;
  const parameters = typeof params === "object" && params !== null && !Array.isArray(params) ? params : {};
  return {
    serviceId: typeof data?.service_id === "string" ? data.service_id : "",
    toolCallId,
    toolName,
    parameters,
    state,
    ...typeof data?.approval_timeout_secs === "number" ? { approvalTimeoutSecs: data.approval_timeout_secs } : {},
    ...typeof data?.result === "string" ? { result: data.result } : {},
    ...typeof data?.error_message === "string" ? { errorMessage: data.error_message } : {}
  };
}
function undefinedClientToolLiteral(name) {
  return `Client tool with name ${name} is not defined on client`;
}
function stringifyClientToolResult(value) {
  if (value === void 0) return CLIENT_TOOL_SUCCESS_LITERAL;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
async function runClientTool(handlers, call, onUnhandled) {
  const handler = handlers[call.toolName];
  if (typeof handler !== "function") {
    if (onUnhandled) {
      try {
        onUnhandled(call);
      } catch {
      }
      return null;
    }
    return { result: undefinedClientToolLiteral(call.toolName), isError: true };
  }
  try {
    const value = await handler(call.parameters);
    return { result: stringifyClientToolResult(value), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: `Client tool execution failed: ${message}`, isError: true };
  }
}
var CLIENT_TOOL_SUCCESS_LITERAL;
var init_client_tools = __esm({
  "src/client-tools.ts"() {
    "use strict";
    CLIENT_TOOL_SUCCESS_LITERAL = "Client tool execution successful.";
  }
});

// src/attributes.ts
function parseBool(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return void 0;
}
function mapTextContents(raw, debug) {
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    debug({ type: "invalid_text_contents" });
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    debug({ type: "invalid_text_contents" });
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") continue;
    const target = OUR_TEXT_KEYS.has(key) ? key : VENDOR_TEXT_RENAMES[key];
    if (target) out[target] = value;
    else debug({ type: "unmapped_text_contents_key", key });
  }
  return out;
}
function overlayAttributes(cfg, attr, debug) {
  const out = { ...cfg };
  for (const [name, key] of DISPLAY_ATTRIBUTES) {
    const value = parseBool(attr(name));
    if (value !== void 0) out[key] = value;
  }
  const variant = attr("variant");
  if (variant && VARIANTS.includes(variant)) out.variant = variant;
  const placement = attr("placement");
  if (placement && PLACEMENTS.includes(placement)) {
    out.placement = placement;
  }
  const termsKey = attr("terms-key");
  if (termsKey) out.terms = { ...out.terms, local_storage_key: termsKey };
  const text = mapTextContents(attr("text-contents"), debug);
  if (Object.keys(text).length > 0) out.text = { ...out.text, ...text };
  return out;
}
function attributeOverrides(attr) {
  const out = {};
  for (const [name, key, kind] of OVERRIDE_ATTRIBUTES) {
    const raw = attr(name);
    if (raw === null || raw === "") continue;
    if (kind === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) out[key] = value;
    } else if (kind === "boolean") {
      const value = parseBool(raw);
      if (value !== void 0) out[key] = value;
    } else {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
function expandAction(action, expanded, collapsible) {
  if (action === "expand") return true;
  if (action === "collapse") return collapsible ? false : null;
  if (action === "toggle") return expanded ? collapsible ? false : null : true;
  return null;
}
function inboundAction(type, allowEvents, detail) {
  if (allowEvents !== "true") return null;
  const raw = detail?.message;
  const message = typeof raw === "string" ? raw.trim() : "";
  switch (type) {
    case "voso-widget:user-message":
      return message ? { kind: "user-message", message } : null;
    case "voso-widget:user-activity":
      return { kind: "user-activity" };
    case "voso-widget:contextual-update":
      return message ? { kind: "contextual-update", message } : null;
    default:
      return null;
  }
}
var DISPLAY_ATTRIBUTES, VARIANTS, PLACEMENTS, VENDOR_TEXT_RENAMES, OUR_TEXT_KEYS, OVERRIDE_ATTRIBUTES, GATED_INBOUND_EVENTS, EXPAND_EVENT, CALL_EVENT;
var init_attributes = __esm({
  "src/attributes.ts"() {
    "use strict";
    init_text_defaults();
    DISPLAY_ATTRIBUTES = [
      ["show-agent-status", "show_agent_status"],
      ["show-resize-button", "resize_button_enabled"],
      ["show-language-selector-on-trigger", "show_language_selector_on_trigger"],
      ["show-avatar-when-collapsed", "show_avatar_when_collapsed"]
    ];
    VARIANTS = ["tiny", "compact", "full"];
    PLACEMENTS = [
      "top-left",
      "top",
      "top-right",
      "bottom-left",
      "bottom",
      "bottom-right"
    ];
    VENDOR_TEXT_RENAMES = {
      queue_waiting_status: "queued_status"
    };
    OUR_TEXT_KEYS = new Set(WIDGET_TEXT_KEYS);
    OVERRIDE_ATTRIBUTES = [
      ["override-prompt", "system_prompt", "string"],
      ["override-llm", "llm", "string"],
      ["override-first-message", "first_message", "string"],
      ["override-language", "language", "string"],
      ["override-voice-id", "voice", "string"],
      ["override-speed", "voice_speed", "number"],
      ["override-stability", "voice_stability", "number"],
      ["override-similarity-boost", "voice_similarity", "number"],
      ["override-text-only", "text_only", "boolean"]
    ];
    GATED_INBOUND_EVENTS = [
      "voso-widget:user-message",
      "voso-widget:user-activity",
      "voso-widget:contextual-update"
    ];
    EXPAND_EVENT = "voso-widget:expand";
    CALL_EVENT = "voso-widget:call";
  }
});

// src/widget.ts
function billingHoldSentence(err) {
  if (!(err instanceof WidgetApiError) || err.status !== 402) return null;
  return err.message.trim() || null;
}
var VosoWidgetElement, BUILD_DEFAULT_ORIGIN, SCRIPT_ORIGIN;
var init_widget = __esm({
  "src/widget.ts"() {
    "use strict";
    init_api();
    init_attachments();
    init_config();
    init_icons();
    init_orb();
    init_markdown();
    init_md_dom();
    init_output_format();
    init_styles();
    init_text_defaults();
    init_voice();
    init_client_tools();
    init_attributes();
    VosoWidgetElement = class extends HTMLElement {
      constructor() {
        super();
        this.api = null;
        /**
         * Per-call conversation overrides sent on every session/chat start. Set
         * via the `overrides` attribute (a JSON object string) or the `overrides`
         * JS property (`el.overrides = { first_message: "…" }`); the property
         * wins. Gated server-side by the agent's Guardrails override toggles.
         */
        this.overrides = null;
        /**
         * Per-session `{{name}}` values sent on every session/chat start (the
         * vendor JS SDK's `dynamicVariables`, E3 §4.3). Set via the
         * `dynamic-variables` attribute (a JSON object string) or the
         * `dynamicVariables` JS property (`el.dynamicVariables = { customer_name:
         * "Dana" }`); the property wins. Gated server-side by the agent's
         * Security → Overrides "Dynamic variables" toggle.
         */
        this.dynamicVariables = null;
        /**
         * The page's implementations of the agent's **client** tools, keyed by
         * tool name (E3 §4.1.8): `el.clientTools = { lookup_policy: async (p) =>
         * crm.lookup(p.policy_number) }`. Served on voice (RTVI) and chat (SSE +
         * HTTP) alike. An unregistered tool is answered at once with an error
         * unless `onUnhandledClientToolCall` is set.
         */
        this.clientTools = {};
        /** Take over calls for tools not in `clientTools` (nothing is sent; the
         *  agent's Response timeout applies). */
        this.onUnhandledClientToolCall = null;
        /**
         * Every state of an MCP tool call the agent makes through an **Ask**
         * server or tool (E3 §4.6): `awaiting_approval` first — answer it with
         * `el.approveMcpTool(call.toolCallId, true | false)` within
         * `call.approvalTimeoutSecs` (30 s) — then `loading` and `success` /
         * `failure`. Without a handler the page **denies** every ask at once
         * (fail closed: a stranger's embed never runs an approval-gated tool).
         */
        this.onMcpToolCall = null;
        /** Diagnostics the element reports instead of failing (an unmapped
         *  `text-contents` key, an event with no live session, …). Default: the
         *  console's debug level. */
        this.onDebug = null;
        /** The vendor's `userId` (also the `user-id` attribute; the property wins).
         *  Carried on `voso-widget:call` `detail.config`; the widget mint does not
         *  take a user id yet, so it is not sent. */
        this.userId = null;
        this.cfg = mergeConfig(void 0);
        this.agentName = "";
        this.languages = [];
        this.avatarUrl = null;
        this.loaded = false;
        // UI state
        this.expanded = false;
        /** First-render latch — UI state follows config only before this is set. */
        this.everRendered = false;
        this.large = false;
        this.mode = "idle";
        this.voiceStatus = "connecting";
        /** The queue-timeout line is shown once per call (the `queue_status` and
         *  the `session-ended` announcements both name it). */
        this.queueTimedOutShown = false;
        this.muted = false;
        this.transcriptVisible = true;
        this.selectedLanguage = null;
        this.ended = null;
        this.termsAcceptedThisSession = false;
        this.pendingAfterTerms = null;
        // Sessions
        this.voice = null;
        this.voiceConversationId = null;
        this.chatSessionId = null;
        this.chatConversationId = null;
        /** Agent-bubble rendering for the CURRENT chat session — the leading
         *  `session` frame's `output_format` (agent behavior panel, Widget row).
         *  Markdown until the frame arrives (today's behaviour). Voice transcripts
         *  never read it: they pass `"markdown"` explicitly. */
        this.chatOutputFormat = DEFAULT_OUTPUT_FORMAT;
        this.chatBusy = false;
        this.streamEl = null;
        this.streamText = "";
        /** Uploads staged for the NEXT chat message (chips in the composer). */
        this.pendingAttachments = [];
        /** Every upload made this conversation — mirrors the backend cap. */
        this.uploadsThisConversation = 0;
        this.typingEl = null;
        this.orbs = [];
        /** Q22: `allow-events="true"` forwards a page's message / activity / context into the live session. */
        this.onInboundEvent = (event) => {
          const action = inboundAction(event.type, this.getAttribute("allow-events"), event.detail);
          if (!action) return;
          if (action.kind === "contextual-update") {
            void this.sendContextualUpdate(action.message).then((sent) => {
              if (!sent) this.debug({ type: "no_live_session", event: event.type });
            });
            return;
          }
          if (action.kind === "user-activity") {
            if (this.voice) this.voice.sendUserActivity();
            else this.debug({ type: this.chatSessionId ? "user_activity_text_session" : "no_live_session", event: event.type });
            return;
          }
          if (this.voice) {
            if (this.voice.sendUserText(action.message)) this.appendMessage("user", action.message);
          } else if (this.chatSessionId && !this.chatBusy) {
            void this.sendChat(action.message);
          } else {
            this.debug({ type: this.chatBusy ? "session_busy" : "no_live_session", event: event.type });
          }
        };
        /** Q30: expand / collapse / toggle, once per event (`_vosoEventHandled`). */
        this.onExpandEvent = (event) => {
          const detail = event.detail;
          if (!detail || typeof detail !== "object" || detail._vosoEventHandled) return;
          detail._vosoEventHandled = true;
          if (!this.everRendered) return;
          const next = expandAction(detail.action, this.expanded, this.collapsible);
          if (next === null || next === this.expanded) return;
          this.expanded = next;
          this.updateChrome();
        };
        this.langSelect = null;
        this.triggerLangSelect = null;
        this.modeBtn = null;
        this.resizeBtn = null;
        this.shadow = this.attachShadow({ mode: "open" });
        for (const type of GATED_INBOUND_EVENTS) this.addEventListener(type, this.onInboundEvent);
        this.addEventListener(EXPAND_EVENT, this.onExpandEvent);
      }
      static {
        this.observedAttributes = [
          "agent-id",
          "config-json",
          // E4 §4.8 display attributes (re-render on change).
          "show-agent-status",
          "show-resize-button",
          "show-language-selector-on-trigger",
          "show-avatar-when-collapsed",
          "variant",
          "placement",
          "language",
          "terms-key",
          "text-contents"
        ];
      }
      connectedCallback() {
        document.addEventListener(EXPAND_EVENT, this.onExpandEvent);
        if (!this.loaded) {
          this.loaded = true;
          void this.bootstrap();
        }
      }
      disconnectedCallback() {
        document.removeEventListener(EXPAND_EVENT, this.onExpandEvent);
        this.destroyOrbs();
        void this.teardownSessions("user");
      }
      debug(event) {
        if (this.onDebug) this.onDebug(event);
        else console.debug("[voso-widget]", event);
      }
      /**
       * The vendor's call hook: dispatch `voso-widget:call` (bubbling, composed)
       * with the config the session is about to start with; listeners may mutate
       * `detail.config` in place (e.g. `clientTools`), and the start uses it.
       */
      dispatchCall(textOnly) {
        const config = {
          agentId: this.getAttribute("agent-id") ?? "",
          language: this.selectedLanguage,
          overrides: this.resolveOverrides(),
          dynamicVariables: this.resolveDynamicVariables(),
          clientTools: this.clientTools,
          userId: this.userId ?? this.getAttribute("user-id"),
          textOnly
        };
        this.dispatchEvent(new CustomEvent(CALL_EVENT, { bubbles: true, composed: true, detail: { config } }));
        if (config.clientTools && typeof config.clientTools === "object") this.clientTools = config.clientTools;
        return config;
      }
      attributeChangedCallback() {
        if (!this.loaded) return;
        void this.bootstrap();
      }
      // ── bootstrap ────────────────────────────────────────────────
      /** The dynamic variables to send: the JS property, else the parsed attribute. */
      resolveDynamicVariables() {
        if (this.dynamicVariables) return this.dynamicVariables;
        const attr = this.getAttribute("dynamic-variables");
        if (!attr) return null;
        try {
          const parsed = JSON.parse(attr);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      /** The overrides to send: the JS property, else the parsed attribute —
       *  laid over the per-key `override-*` attributes (E4 §4.8; the explicit
       *  object wins on a conflict). */
      resolveOverrides() {
        const perKey = attributeOverrides((name) => this.getAttribute(name));
        const explicit = this.explicitOverrides();
        if (!perKey) return explicit;
        return { ...perKey, ...explicit ?? {} };
      }
      explicitOverrides() {
        if (this.overrides) return this.overrides;
        const attr = this.getAttribute("overrides");
        if (!attr) return null;
        try {
          const parsed = JSON.parse(attr);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
      resolveOrigin() {
        const attr = this.getAttribute("server-url");
        if (attr) return attr.replace(/\/$/, "");
        if (BUILD_DEFAULT_ORIGIN) return BUILD_DEFAULT_ORIGIN;
        if (SCRIPT_ORIGIN) return SCRIPT_ORIGIN;
        return window.location.origin;
      }
      async bootstrap() {
        const publicId = this.getAttribute("agent-id") ?? "";
        const authToken = this.getAttribute("auth-token");
        this.api = publicId ? new WidgetApi(this.resolveOrigin(), publicId, authToken) : null;
        const inline = this.getAttribute("config-json");
        let server = null;
        if (inline) {
          try {
            server = JSON.parse(inline);
          } catch {
            server = null;
          }
        }
        if (!server && this.api) {
          try {
            server = await this.api.fetchConfig();
          } catch (err) {
            if (err instanceof WidgetApiError && err.status === 404) return;
            return;
          }
        }
        if (!server) return;
        const nextCfg = overlayAttributes(
          mergeConfig(server.config),
          (name) => this.getAttribute(name),
          (event) => this.debug(event)
        );
        if (this.everRendered && this.rootEl) {
          const structural = (c) => JSON.stringify({ ...c, colors: null, radii: null });
          const orbUnchanged = JSON.stringify(nextCfg.avatar) === JSON.stringify(this.cfg.avatar);
          if (structural(nextCfg) === structural(this.cfg) && orbUnchanged && (server.agent_name || "AI Agent") === this.agentName && JSON.stringify(server.languages ?? []) === JSON.stringify(this.languages)) {
            this.cfg = nextCfg;
            for (const [name, value] of Object.entries(buildCssVars(nextCfg))) {
              this.rootEl.style.setProperty(name, value);
            }
            return;
          }
        }
        this.cfg = nextCfg;
        this.agentName = server.agent_name || "AI Agent";
        this.languages = server.languages ?? [];
        this.avatarUrl = server.avatar_url && this.api ? this.api.resolveUrl(server.avatar_url) : server.avatar_url ?? null;
        const preferred = this.getAttribute("language");
        this.selectedLanguage = preferred && this.languages.includes(preferred) ? preferred : this.languages[0] ?? null;
        if (!this.everRendered) {
          this.expanded = this.cfg.expanded_behavior === "starts_expanded" || this.cfg.expanded_behavior === "always_expanded";
          this.transcriptVisible = this.cfg.transcript_enabled;
        } else if (this.cfg.expanded_behavior === "always_expanded") {
          this.expanded = true;
        }
        this.everRendered = true;
        this.renderSkeleton();
        this.updateChrome();
      }
      text(key) {
        return resolveText(this.cfg.text, key);
      }
      get collapsible() {
        return this.cfg.collapsible && this.cfg.expanded_behavior !== "always_expanded";
      }
      get canSwitchModes() {
        return this.cfg.voice_enabled;
      }
      // ── skeleton ─────────────────────────────────────────────────
      renderSkeleton() {
        this.destroyOrbs();
        this.shadow.textContent = "";
        const style = document.createElement("style");
        style.textContent = WIDGET_CSS;
        this.shadow.append(style);
        this.rootEl = document.createElement("div");
        this.rootEl.className = "vw-root";
        const preview = this.getAttribute("preview") === "true";
        if (preview) {
          this.rootEl.setAttribute("data-preview", "");
          this.rootEl.dataset.placement = "bottom-right";
        } else {
          this.rootEl.dataset.placement = this.cfg.placement;
        }
        const vars = buildCssVars(this.cfg);
        for (const [name, value] of Object.entries(vars)) {
          this.rootEl.style.setProperty(name, value);
        }
        if (this.cfg.avatar.kind === "orb") {
          this.rootEl.style.setProperty("--vw-orb-1", this.cfg.avatar.color_1);
          this.rootEl.style.setProperty("--vw-orb-2", this.cfg.avatar.color_2);
        }
        this.launcherEl = document.createElement("button");
        this.launcherEl.className = "vw-launcher";
        this.launcherEl.dataset.variant = this.cfg.variant;
        this.launcherEl.setAttribute("aria-label", this.text("expand"));
        if (this.cfg.show_avatar_when_collapsed || this.cfg.variant === "tiny") {
          this.launcherEl.append(
            this.buildAvatar(
              this.cfg.variant === "full" ? 40 : this.cfg.variant === "tiny" ? 44 : 26
            )
          );
        }
        const label = document.createElement("span");
        label.className = "vw-launcher-label";
        label.textContent = this.text("main_label");
        this.launcherEl.append(label);
        if (this.cfg.variant !== "tiny") {
          const icon = document.createElement("span");
          icon.innerHTML = ICONS.phone;
          icon.style.display = "inline-flex";
          this.launcherEl.append(icon);
        }
        this.launcherEl.addEventListener("click", () => {
          this.expanded = true;
          this.updateChrome();
        });
        this.sheetEl = document.createElement("div");
        this.sheetEl.className = "vw-sheet";
        const header = document.createElement("div");
        header.className = "vw-header";
        this.headerAvatarEl = this.buildAvatar(34);
        header.append(this.headerAvatarEl);
        const meta = document.createElement("div");
        meta.className = "vw-header-meta";
        this.headerNameEl = document.createElement("div");
        this.headerNameEl.className = "vw-header-name";
        this.headerNameEl.textContent = this.agentName;
        this.headerStatusEl = document.createElement("div");
        this.headerStatusEl.className = "vw-header-status";
        meta.append(this.headerNameEl, this.headerStatusEl);
        header.append(meta);
        header.append(this.buildHeaderActions());
        this.sheetEl.append(header);
        const container = document.createElement("div");
        container.className = "vw-sheet-container";
        this.introEl = document.createElement("div");
        this.introEl.className = "vw-intro";
        container.append(this.introEl);
        this.bodyEl = document.createElement("div");
        this.bodyEl.className = "vw-body";
        container.append(this.bodyEl);
        this.overlayHost = document.createElement("div");
        container.append(this.overlayHost);
        this.sheetEl.append(container);
        this.footerEl = document.createElement("div");
        this.footerEl.className = "vw-footer";
        this.sheetEl.append(this.footerEl);
        this.audioEl = document.createElement("audio");
        this.audioEl.autoplay = true;
        this.audioEl.style.display = "none";
        this.sheetEl.append(this.audioEl);
        this.triggerLangSelect = this.cfg.show_language_selector_on_trigger && this.cfg.language_dropdown_enabled && this.languages.length > 1 ? this.buildLanguageSelect() : null;
        if (this.triggerLangSelect) {
          this.triggerLangSelect.classList.add("vw-lang-trigger");
          this.rootEl.append(this.sheetEl, this.triggerLangSelect, this.launcherEl);
        } else {
          this.rootEl.append(this.sheetEl, this.launcherEl);
        }
        this.shadow.append(this.rootEl);
      }
      buildAvatar(size = 34) {
        const el = document.createElement("div");
        el.className = "vw-avatar";
        const kind = this.cfg.avatar.kind;
        const src = kind === "url" ? this.cfg.avatar.url || null : kind === "image" ? this.avatarUrl : null;
        if (src) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = "";
          el.append(img);
          return el;
        }
        if (kind === "url" || kind === "image") {
          const glyph = document.createElement("span");
          glyph.className = "vw-avatar-glyph";
          glyph.innerHTML = kind === "url" ? ICONS.link : ICONS.image;
          el.append(glyph);
          return el;
        }
        el.style.background = "none";
        const colors = this.cfg.avatar;
        const orb = createOrb(size, colors.color_1, colors.color_2);
        this.orbs.push(orb);
        el.append(orb.el);
        return el;
      }
      setOrbState(state) {
        for (const orb of this.orbs) orb.setState(state);
      }
      destroyOrbs() {
        for (const orb of this.orbs) orb.destroy();
        this.orbs = [];
      }
      buildHeaderActions() {
        const actions = document.createElement("div");
        actions.className = "vw-header-actions";
        this.langSelect = null;
        if (this.cfg.language_dropdown_enabled && this.languages.length > 1) {
          const select = this.buildLanguageSelect();
          actions.append(select);
          this.langSelect = select;
        }
        if (this.canSwitchModes) {
          this.modeBtn = this.iconButton(ICONS.keyboard, this.text("text_mode"), () => {
            void this.toggleMode();
          });
          actions.append(this.modeBtn);
        }
        if (this.cfg.resize_button_enabled) {
          this.resizeBtn = this.iconButton(ICONS.expand, this.text("expand"), () => {
            this.large = !this.large;
            if (this.large) this.sheetEl.setAttribute("data-large", "");
            else this.sheetEl.removeAttribute("data-large");
            this.resizeBtn.innerHTML = this.large ? ICONS.shrink : ICONS.expand;
          });
          actions.append(this.resizeBtn);
        }
        if (this.collapsible) {
          actions.append(
            this.iconButton(ICONS.chevronDown, this.text("collapse"), () => {
              this.expanded = false;
              this.updateChrome();
            })
          );
        }
        return actions;
      }
      /** The language dropdown (header and, with Q9, the collapsed trigger) — both stay in sync. */
      buildLanguageSelect() {
        const select = document.createElement("select");
        select.className = "vw-lang";
        select.title = this.text("change_language");
        select.setAttribute("aria-label", this.text("change_language"));
        for (const lang of this.languages) {
          const opt = document.createElement("option");
          opt.value = lang;
          opt.textContent = lang;
          select.append(opt);
        }
        if (this.selectedLanguage) select.value = this.selectedLanguage;
        select.addEventListener("change", () => {
          this.selectedLanguage = select.value;
          for (const other of [this.langSelect, this.triggerLangSelect]) {
            if (other && other !== select) other.value = select.value;
          }
        });
        return select;
      }
      iconButton(icon, title, onClick) {
        const btn = document.createElement("button");
        btn.className = "vw-iconbtn";
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.innerHTML = icon;
        btn.addEventListener("click", onClick);
        return btn;
      }
      // ── chrome updates ───────────────────────────────────────────
      updateChrome() {
        this.launcherEl.classList.toggle("vw-hidden", this.expanded);
        this.sheetEl.classList.toggle("vw-hidden", !this.expanded);
        this.headerStatusEl.textContent = "";
        const dot = document.createElement("span");
        dot.className = "vw-status-dot";
        const statusText = document.createElement("span");
        if (this.mode === "voice") {
          dot.setAttribute("data-live", "");
          statusText.textContent = this.voiceStatus === "connecting" ? this.text("connecting_status") : this.voiceStatus === "queued" ? this.text("queued_status") : this.voiceStatus === "speaking" ? this.text("speaking_status") : this.text("listening_status");
        } else if (this.mode === "chat") {
          dot.setAttribute("data-live", "");
          statusText.textContent = this.text("chatting_status");
        } else {
          statusText.textContent = this.agentName;
        }
        this.headerStatusEl.append(dot, statusText);
        this.headerStatusEl.classList.toggle("vw-hidden", !this.cfg.show_agent_status);
        this.headerAvatarEl.toggleAttribute(
          "data-speaking",
          this.mode === "voice" && this.voiceStatus === "speaking"
        );
        this.setOrbState(
          this.mode === "voice" ? this.voiceStatus === "queued" ? "connecting" : this.voiceStatus : this.mode === "chat" ? "listening" : "idle"
        );
        this.setAttribute("data-vw-mode", this.mode);
        if (this.mode === "voice") {
          this.setAttribute("data-vw-voice-status", this.voiceStatus);
        } else {
          this.removeAttribute("data-vw-voice-status");
        }
        const inConversation = this.mode !== "idle" || this.bodyEl.childNodes.length > 0;
        this.introEl.classList.toggle("vw-hidden", inConversation);
        const bodyHidden = this.mode === "voice" && !this.transcriptVisible ? true : !inConversation;
        this.bodyEl.classList.toggle("vw-hidden", bodyHidden);
        if (!inConversation) this.renderIntro();
        if (this.langSelect) {
          this.langSelect.disabled = this.mode !== "idle";
        }
        if (this.triggerLangSelect) {
          this.triggerLangSelect.classList.toggle("vw-hidden", this.expanded);
          this.triggerLangSelect.disabled = this.mode !== "idle";
        }
        if (this.modeBtn) {
          this.modeBtn.title = this.mode === "voice" ? this.text("text_mode") : this.text("voice_mode");
          this.modeBtn.innerHTML = this.mode === "voice" ? ICONS.keyboard : ICONS.phone;
          this.modeBtn.classList.toggle("vw-hidden", this.mode === "idle");
        }
        this.renderFooter();
      }
      renderIntro() {
        this.introEl.textContent = "";
        const avatar = this.buildAvatar(64);
        const title = document.createElement("div");
        title.className = "vw-intro-title";
        title.textContent = this.text("main_label");
        this.introEl.append(avatar, title);
        if (this.cfg.voice_enabled) {
          const call = document.createElement("button");
          call.className = "vw-cta";
          call.innerHTML = `${ICONS.phone}<span></span>`;
          call.lastElementChild.textContent = this.text("start_call");
          call.addEventListener("click", () => this.guardTerms(() => void this.startCall()));
          this.introEl.append(call);
        }
        if (this.cfg.text_enabled) {
          const chat = document.createElement("button");
          chat.className = `vw-cta${this.cfg.voice_enabled ? " vw-cta-secondary" : ""}`;
          chat.innerHTML = `${ICONS.chat}<span></span>`;
          chat.lastElementChild.textContent = this.text("start_chat");
          chat.addEventListener("click", () => this.guardTerms(() => void this.startChat()));
          this.introEl.append(chat);
        }
      }
      renderFooter() {
        this.footerEl.textContent = "";
        if (this.mode === "voice") {
          const row = document.createElement("div");
          row.className = "vw-callrow";
          if (this.cfg.mute_button_enabled) {
            const mute = document.createElement("button");
            mute.className = "vw-callbtn";
            mute.title = this.text("mute_microphone");
            mute.innerHTML = this.muted ? ICONS.micOff : ICONS.mic;
            mute.addEventListener("click", () => {
              this.muted = !this.muted;
              this.voice?.setMicrophoneEnabled(!this.muted);
              this.renderFooter();
            });
            row.append(mute);
          }
          if (this.cfg.transcript_enabled) {
            const transcript = document.createElement("button");
            transcript.className = "vw-callbtn";
            transcript.innerHTML = ICONS.chat;
            transcript.title = "Transcript";
            if (this.transcriptVisible) transcript.setAttribute("data-accent", "");
            transcript.addEventListener("click", () => {
              this.transcriptVisible = !this.transcriptVisible;
              this.updateChrome();
            });
            row.append(transcript);
          }
          const end = document.createElement("button");
          end.className = "vw-callbtn";
          end.setAttribute("data-danger", "");
          end.innerHTML = `${ICONS.phoneOff}<span></span>`;
          end.lastElementChild.textContent = this.text("end_call");
          end.addEventListener("click", () => void this.endCall("user"));
          row.append(end);
          this.footerEl.append(row);
          if (this.cfg.send_text_while_on_call) {
            const inputRow = document.createElement("div");
            inputRow.className = "vw-inputrow";
            const input = document.createElement("input");
            input.className = "vw-input";
            input.placeholder = this.text("input_placeholder");
            input.setAttribute("aria-label", this.text("input_label"));
            const send = document.createElement("button");
            send.className = "vw-sendbtn";
            send.title = this.text("send_message");
            send.setAttribute("aria-label", this.text("send_message"));
            send.innerHTML = ICONS.send;
            const queued = this.voiceStatus === "queued";
            input.disabled = queued;
            send.disabled = queued;
            const submit = () => {
              if (this.voiceStatus === "queued") return;
              const value = input.value.trim();
              if (!value) return;
              if (this.voice?.sendUserText(value)) {
                input.value = "";
                this.appendMessage("user", value);
              }
            };
            send.addEventListener("click", submit);
            input.addEventListener("keydown", (e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            });
            inputRow.append(input, send);
            this.footerEl.append(inputRow);
          }
          return;
        }
        if (this.mode === "chat") {
          if (this.pendingAttachments.length > 0) {
            const chips = document.createElement("div");
            chips.className = "vw-chips";
            for (const attachment of this.pendingAttachments) {
              const chip = document.createElement("span");
              chip.className = "vw-chip";
              const name = document.createElement("span");
              name.className = "vw-chip-name";
              name.textContent = attachment.filename;
              const remove = document.createElement("button");
              remove.className = "vw-chip-remove";
              remove.title = this.text("remove_file");
              remove.setAttribute("aria-label", this.text("remove_file"));
              remove.innerHTML = ICONS.x;
              remove.addEventListener("click", () => {
                this.pendingAttachments = this.pendingAttachments.filter(
                  (a) => a.attachment_id !== attachment.attachment_id
                );
                this.renderFooter();
              });
              chip.append(name, remove);
              chips.append(chip);
            }
            this.footerEl.append(chips);
          }
          const row = document.createElement("div");
          row.className = "vw-inputrow";
          const picker = document.createElement("input");
          picker.type = "file";
          picker.accept = attachmentAcceptAttribute();
          picker.style.display = "none";
          picker.addEventListener("change", () => {
            const file = picker.files?.[0];
            picker.value = "";
            if (file) void this.attachFile(file);
          });
          const attach = document.createElement("button");
          attach.className = "vw-sendbtn vw-attachbtn";
          attach.title = this.text("attach_file");
          attach.setAttribute("aria-label", this.text("attach_file"));
          attach.innerHTML = ICONS.paperclip;
          attach.addEventListener("click", () => picker.click());
          const input = document.createElement("input");
          input.className = "vw-input";
          input.placeholder = this.cfg.voice_enabled ? this.text("input_placeholder") : this.text("input_placeholder_text_only");
          input.setAttribute("aria-label", this.text("input_label"));
          const send = document.createElement("button");
          send.className = "vw-sendbtn";
          send.title = this.text("send_message");
          send.setAttribute("aria-label", this.text("send_message"));
          send.innerHTML = ICONS.send;
          const submit = () => {
            const value = input.value.trim();
            if (!value || this.chatBusy) return;
            input.value = "";
            void this.sendChat(value);
          };
          send.addEventListener("click", submit);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          });
          row.append(attach, picker, input, send);
          this.footerEl.append(row);
          return;
        }
        if (this.ended) {
          if (this.cfg.show_conversation_id && this.ended.conversationId) {
            const idRow = document.createElement("div");
            idRow.className = "vw-convo-id";
            const label = document.createElement("span");
            label.textContent = `${this.text("conversation_id")}:`;
            const code = document.createElement("code");
            code.textContent = this.ended.conversationId;
            const copy = document.createElement("button");
            copy.className = "vw-iconbtn";
            copy.style.width = "22px";
            copy.style.height = "22px";
            copy.title = this.text("copy_id");
            copy.setAttribute("aria-label", this.text("copy_id"));
            copy.innerHTML = ICONS.copy;
            copy.addEventListener("click", () => {
              void navigator.clipboard?.writeText(this.ended?.conversationId ?? "");
              copy.innerHTML = ICONS.check;
              copy.title = this.text("copied");
              setTimeout(() => {
                copy.innerHTML = ICONS.copy;
                copy.title = this.text("copy_id");
              }, 1500);
            });
            idRow.append(label, code, copy);
            this.footerEl.append(idRow);
          }
          const row = document.createElement("div");
          row.className = "vw-callrow";
          if (this.cfg.voice_enabled) {
            const again = document.createElement("button");
            again.className = "vw-callbtn";
            again.setAttribute("data-accent", "");
            again.innerHTML = `${ICONS.phone}<span></span>`;
            again.lastElementChild.textContent = this.text("new_call");
            again.addEventListener("click", () => this.guardTerms(() => void this.startCall()));
            row.append(again);
          }
          if (this.cfg.text_enabled) {
            const chat = document.createElement("button");
            chat.className = "vw-callbtn";
            chat.innerHTML = `${ICONS.chat}<span></span>`;
            chat.lastElementChild.textContent = this.text("start_chat");
            chat.addEventListener("click", () => this.guardTerms(() => void this.startChat()));
            row.append(chat);
          }
          this.footerEl.append(row);
        }
      }
      // ── messages ─────────────────────────────────────────────────
      appendMessage(kind, raw, format = this.chatOutputFormat) {
        let text = raw;
        if (this.cfg.hide_audio_tags && kind !== "system" && kind !== "error") {
          text = stripAudioTags(text);
          if (!text.trim()) return;
        }
        const el = document.createElement("div");
        if (kind === "system") {
          el.className = "vw-system";
          el.textContent = text;
        } else if (kind === "error") {
          el.className = "vw-error";
          el.textContent = text;
        } else {
          el.className = `vw-msg vw-msg-${kind}`;
          const bubble = document.createElement("div");
          bubble.className = "vw-bubble";
          if (kind === "agent") {
            renderAgentText(bubble, text, format, (t) => this.markdownNode(t));
          } else {
            bubble.textContent = text;
          }
          el.append(bubble);
        }
        this.bodyEl.append(el);
        this.scrollToBottom();
      }
      appendActionIndicator(state, name) {
        if (!this.cfg.action_indicator_enabled) return;
        const chip = document.createElement("div");
        chip.className = "vw-action";
        chip.dataset.state = state;
        const label = state === "working" ? this.text("agent_working") : state === "done" ? this.text("agent_done") : this.text("agent_error");
        chip.innerHTML = state === "working" ? ICONS.spinner : state === "done" ? ICONS.check : ICONS.x;
        const span = document.createElement("span");
        span.textContent = name ? `${name} \u2014 ${label}` : label;
        chip.append(span);
        this.bodyEl.append(chip);
        this.scrollToBottom();
      }
      setTyping(on) {
        if (on && !this.typingEl) {
          const el = document.createElement("div");
          el.className = "vw-typing";
          const dots = document.createElement("span");
          dots.className = "vw-typing-dots";
          dots.append(
            document.createElement("span"),
            document.createElement("span"),
            document.createElement("span")
          );
          const label = document.createElement("span");
          label.textContent = this.text("typing_indicator");
          el.append(dots, label);
          this.bodyEl.append(el);
          this.typingEl = el;
          this.scrollToBottom();
        } else if (!on && this.typingEl) {
          this.typingEl.remove();
          this.typingEl = null;
        }
      }
      scrollToBottom() {
        this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
      }
      /** The ONE markdown → DOM render (agent bubbles, terms overlay). */
      markdownNode(text) {
        return renderMarkdown(parseMarkdown(text, this.cfg.link_policy), {
          syntaxTheme: this.cfg.syntax_theme,
          text: {
            copy: this.text("copy"),
            copied: this.text("copied"),
            download: this.text("download"),
            wrap: this.text("wrap")
          }
        });
      }
      // ── terms gate ───────────────────────────────────────────────
      termsAlreadyAccepted() {
        if (!this.cfg.terms.enabled || !this.cfg.terms.content.trim()) return true;
        if (this.termsAcceptedThisSession) return true;
        const key = this.cfg.terms.local_storage_key;
        if (key) {
          try {
            if (window.localStorage.getItem(key) === "accepted") return true;
          } catch {
          }
        }
        return false;
      }
      guardTerms(proceed) {
        if (this.termsAlreadyAccepted()) {
          proceed();
          return;
        }
        this.pendingAfterTerms = proceed;
        this.showTermsOverlay();
      }
      showTermsOverlay() {
        const overlay = document.createElement("div");
        overlay.className = "vw-overlay";
        const card = document.createElement("div");
        card.className = "vw-overlay-card";
        const body = document.createElement("div");
        body.className = "vw-overlay-body";
        body.append(this.markdownNode(this.cfg.terms.content));
        const actions = document.createElement("div");
        actions.className = "vw-overlay-actions";
        const cancel = document.createElement("button");
        cancel.className = "vw-callbtn";
        cancel.textContent = this.text("dismiss_terms");
        cancel.addEventListener("click", () => {
          this.pendingAfterTerms = null;
          overlay.remove();
        });
        const accept = document.createElement("button");
        accept.className = "vw-callbtn";
        accept.setAttribute("data-accent", "");
        accept.textContent = this.text("accept_terms");
        accept.addEventListener("click", () => {
          this.termsAcceptedThisSession = true;
          const key = this.cfg.terms.local_storage_key;
          if (key) {
            try {
              window.localStorage.setItem(key, "accepted");
            } catch {
            }
          }
          overlay.remove();
          const proceed = this.pendingAfterTerms;
          this.pendingAfterTerms = null;
          proceed?.();
        });
        actions.append(cancel, accept);
        card.append(body, actions);
        overlay.append(card);
        this.overlayHost.append(overlay);
      }
      // ── voice ────────────────────────────────────────────────────
      async startCall() {
        if (!this.api || this.mode === "voice") return;
        await this.teardownSessions(null);
        this.ended = null;
        this.mode = "voice";
        this.voiceStatus = "connecting";
        this.queueTimedOutShown = false;
        this.muted = false;
        this.updateChrome();
        try {
          const call = this.dispatchCall(false);
          const session = await this.api.startVoiceSession(
            call.language,
            call.overrides,
            call.dynamicVariables
          );
          this.voiceConversationId = session.conversation_id;
          if (session.queue?.status === "waiting") {
            this.voiceStatus = "queued";
            this.updateChrome();
          }
          const client = new VoiceClient(session, {
            onStateChange: (state) => {
              if (state === "connected") {
                if (this.voiceStatus !== "queued") this.voiceStatus = "listening";
                this.updateChrome();
              } else if (state === "disconnected" || state === "error") {
                if (this.mode === "voice") void this.endCall("agent");
              }
            },
            onRemoteAudio: (stream) => {
              this.audioEl.srcObject = stream;
              void this.audioEl.play().then(() => client.notifyAudioRendering()).catch(() => client.notifyAudioRendering());
            },
            onAppMessage: (msg) => this.onRtviMessage(msg),
            onError: () => {
              if (this.mode === "voice") {
                this.appendMessage("error", this.text("error_occurred"));
              }
            }
          });
          this.voice = client;
          await client.connect();
        } catch (err) {
          this.mode = "idle";
          this.voice = null;
          const hold = billingHoldSentence(err);
          if (hold) {
            this.appendMessage("agent", hold);
          } else {
            this.showError(err instanceof WidgetApiError ? `${err.status} ${err.message}` : err);
          }
          this.updateChrome();
        }
      }
      /**
       * Push background context into the live conversation without a turn
       * (E3 §4.2; the vendor's `contextual_update`). Works on a voice call
       * (data channel) and a chat session (HTTP). A later update with the same
       * `contextId` replaces the earlier one. Resolves `false` when no session
       * is open.
       */
      async sendContextualUpdate(text, opts) {
        if (this.voice) return this.voice.sendContextualUpdate(text, opts?.contextId);
        if (this.api && this.chatSessionId) {
          try {
            await this.api.postChatContext(this.chatSessionId, text, opts?.contextId);
            return true;
          } catch (err) {
            console.warn("Widget contextual update rejected:", err);
            return false;
          }
        }
        return false;
      }
      /**
       * Approve or deny an MCP tool call the agent is waiting on (E3 §4.6). Works
       * on a voice call (data channel) and a chat session (HTTP). Resolves
       * `false` when no session is open or the answer was not delivered.
       */
      async approveMcpTool(toolCallId, isApproved) {
        if (this.voice) return this.voice.sendMcpToolApproval(toolCallId, isApproved);
        if (this.api && this.chatSessionId) {
          try {
            await this.api.postChatToolApproval(this.chatSessionId, toolCallId, isApproved);
            return true;
          } catch (err) {
            console.warn("Widget MCP approval rejected:", err);
            return false;
          }
        }
        return false;
      }
      /** Hand an `mcp_tool_call` state to the page; deny an ask nobody handles. */
      handleMcpToolCall(call) {
        if (this.onMcpToolCall) {
          try {
            this.onMcpToolCall(call);
          } catch (err) {
            console.warn(`Widget onMcpToolCall ${call.toolName}:`, err);
          }
          return;
        }
        if (call.state === "awaiting_approval") void this.approveMcpTool(call.toolCallId, false);
      }
      /** Run the page's handler for a client tool call and send the answer on
       *  the channel it arrived on. */
      async handleClientToolCall(call, send) {
        const answer = await runClientTool(
          this.clientTools,
          call,
          this.onUnhandledClientToolCall ?? void 0
        );
        if (!answer) return;
        try {
          await send(answer.result, answer.isError);
        } catch (err) {
          console.warn(`Widget client tool ${call.toolName}: answer not delivered`, err);
        }
      }
      onRtviMessage(msg) {
        const mcpData = mcpToolCallDataFromRtvi(msg);
        if (mcpData) {
          const mcpCall = mcpToolCallFromRecord(mcpData);
          if (mcpCall) this.handleMcpToolCall(mcpCall);
          return;
        }
        const clientToolCall = clientToolCallFromRtvi(msg);
        if (clientToolCall) {
          const client = this.voice;
          void this.handleClientToolCall(
            clientToolCall,
            (result, isError) => client ? client.sendClientToolResult(clientToolCall.toolCallId, result, isError) : false
          );
          return;
        }
        const transition = queueTransition(msg);
        if (transition) {
          this.onQueueTransition(transition);
          return;
        }
        switch (msg.type) {
          case "bot-started-speaking":
            this.voiceStatus = "speaking";
            this.updateChrome();
            return;
          case "bot-stopped-speaking":
            if (this.voiceStatus !== "queued") this.voiceStatus = "listening";
            this.updateChrome();
            return;
          case "bot-ready":
            if (this.voiceStatus === "connecting") {
              this.voiceStatus = "listening";
              this.updateChrome();
            }
            return;
          default:
            break;
        }
        if (isRenderableTranscript(msg)) {
          const role = transcriptRole(msg);
          const text = msg.data?.text ?? "";
          if (role && typeof text === "string" && text.trim()) {
            this.appendMessage(role, text, "markdown");
          }
        }
      }
      /** E7 §4.3: `waiting` → the queued state (input off, hold audio plays);
       *  `admitted` → listening (the greeting follows); `timed_out` → the
       *  session is over — the configured per-language line is shown and the
       *  peer close that follows is an ordinary end, not an error. */
      onQueueTransition(transition) {
        if (this.mode !== "voice") return;
        if (transition === "waiting") {
          this.voiceStatus = "queued";
          this.updateChrome();
          return;
        }
        if (transition === "admitted") {
          this.voiceStatus = "listening";
          this.updateChrome();
          return;
        }
        if (this.queueTimedOutShown) return;
        this.queueTimedOutShown = true;
        this.appendMessage("system", this.text("queue_timed_out"));
        void this.endCall("agent");
      }
      async endCall(by) {
        const client = this.voice;
        this.voice = null;
        this.mode = "idle";
        this.ended = { by, conversationId: this.voiceConversationId };
        if (client) await client.disconnect();
        this.audioEl.srcObject = null;
        this.appendMessage(
          "system",
          by === "user" ? this.text("user_ended_conversation") : this.text("agent_ended_conversation")
        );
        this.updateChrome();
        if (this.cfg.feedback_enabled && this.voiceConversationId) {
          this.showFeedbackOverlay(this.voiceConversationId);
        }
      }
      // ── chat ─────────────────────────────────────────────────────
      async startChat() {
        if (!this.api || this.mode === "chat") return;
        await this.teardownSessions(null);
        this.ended = null;
        this.mode = "chat";
        this.chatBusy = true;
        this.chatConversationId = null;
        this.chatOutputFormat = DEFAULT_OUTPUT_FORMAT;
        this.pendingAttachments = [];
        this.uploadsThisConversation = 0;
        this.updateChrome();
        this.setTyping(true);
        try {
          const call = this.dispatchCall(true);
          await this.consumeChatStream(this.api.openChat(
            call.language,
            call.overrides,
            call.dynamicVariables
          ));
        } catch (err) {
          this.setTyping(false);
          this.mode = "idle";
          this.showError(err instanceof WidgetApiError ? `${err.status} ${err.message}` : err);
        } finally {
          this.chatBusy = false;
          this.updateChrome();
        }
      }
      /** Validate + upload one picked file, staging it for the next message.
       *  Every rejection speaks through the configured `file_*` texts. */
      async attachFile(file) {
        if (!this.api || !this.chatSessionId) return;
        const rejection = validateAttachment(file, this.uploadsThisConversation);
        if (rejection === "file_type_unsupported") {
          this.appendMessage(
            "error",
            `${this.text("file_type_unsupported")} png, jpeg, webp, gif, pdf, txt, csv, md`
          );
          return;
        }
        if (rejection) {
          this.appendMessage("error", this.text(rejection));
          return;
        }
        try {
          const uploaded = await this.api.uploadAttachment(this.chatSessionId, file);
          this.uploadsThisConversation += 1;
          this.pendingAttachments.push(uploaded);
          this.renderFooter();
        } catch (err) {
          this.showError(
            err instanceof WidgetApiError ? `${err.status} ${err.message}` : err,
            "file_upload_error"
          );
        }
      }
      async sendChat(text) {
        if (!this.api || !this.chatSessionId) return;
        const attachments = this.pendingAttachments;
        this.pendingAttachments = [];
        if (attachments.length > 0) this.renderFooter();
        const display = attachments.length > 0 ? `${text}
${attachments.map((a) => `[${a.filename}]`).join("\n")}` : text;
        this.appendMessage("user", display);
        this.chatBusy = true;
        this.setTyping(true);
        try {
          await this.consumeChatStream(
            this.api.sendChatMessage(
              this.chatSessionId,
              text,
              attachments.map((a) => a.attachment_id)
            )
          );
        } catch (err) {
          this.setTyping(false);
          this.showError(err instanceof WidgetApiError ? `${err.status} ${err.message}` : err);
        } finally {
          this.chatBusy = false;
        }
      }
      async consumeChatStream(stream) {
        for await (const event of stream) {
          switch (event.type) {
            case "session":
              this.chatOutputFormat = outputFormatFromFrame(event.output_format);
              this.chatSessionId = event.session_id ?? null;
              this.chatConversationId = event.conversation_id ?? null;
              break;
            case "assistant_token": {
              this.setTyping(false);
              this.streamText += event.delta ?? "";
              if (!this.streamEl) {
                const el = document.createElement("div");
                el.className = "vw-msg vw-msg-agent";
                const bubble = document.createElement("div");
                bubble.className = "vw-bubble";
                el.append(bubble);
                this.bodyEl.append(el);
                this.streamEl = bubble;
              }
              this.streamEl.textContent = this.streamText;
              this.scrollToBottom();
              break;
            }
            case "assistant_message": {
              this.finishStreamBubble();
              this.setTyping(false);
              if (event.text) this.appendMessage("agent", event.text);
              break;
            }
            case "client_tool_call": {
              const sessionId = this.chatSessionId;
              const api = this.api;
              if (typeof event.tool_call_id === "string" && typeof event.name === "string") {
                const call = {
                  toolName: event.name,
                  toolCallId: event.tool_call_id,
                  parameters: event.args ?? {},
                  expectsResponse: event.expects_response !== false,
                  ...typeof event.timeout_secs === "number" ? { responseTimeoutSecs: event.timeout_secs } : {}
                };
                void this.handleClientToolCall(call, async (result, isError) => {
                  if (!api || !sessionId) return false;
                  await api.postChatToolResult(sessionId, call.toolCallId, result, isError);
                  return true;
                });
              }
              this.appendActionIndicator("working", event.name);
              break;
            }
            case "mcp_tool_call": {
              const mcpCall = mcpToolCallFromRecord(event);
              if (mcpCall) {
                this.handleMcpToolCall(mcpCall);
                if (mcpCall.state === "awaiting_approval") {
                  this.appendActionIndicator("working", mcpCall.toolName);
                }
              }
              break;
            }
            case "tool_called":
              this.appendActionIndicator("done", event.name);
              break;
            case "turn_complete":
              this.finishStreamBubble();
              this.setTyping(false);
              break;
            case "ended": {
              this.finishStreamBubble();
              this.setTyping(false);
              this.mode = "idle";
              const conversationId = this.chatConversationId;
              this.ended = { by: "agent", conversationId };
              const sessionId = this.chatSessionId;
              this.chatSessionId = null;
              if (sessionId && this.api) void this.api.closeChat(sessionId);
              this.appendMessage("system", this.text("agent_ended_conversation"));
              this.updateChrome();
              if (this.cfg.feedback_enabled && conversationId) {
                this.showFeedbackOverlay(conversationId);
              }
              break;
            }
            case "error":
              this.finishStreamBubble();
              this.setTyping(false);
              this.appendActionIndicatorOnError(event.message, event.code);
              break;
            default:
              break;
          }
        }
        this.finishStreamBubble();
        this.setTyping(false);
      }
      /** Text sent to a person (VOSO-754 D21): every failure the visitor sees is
       *  the configured, per-language `error_occurred` line (or the given text
       *  key) — never a server body, an SSE `error.message` or an exception
       *  text. The raw detail goes to the console for the embedding developer. */
      showError(detail, key = "error_occurred") {
        if (detail !== void 0 && detail !== null && detail !== "") {
          console.debug("[voso-widget] error", detail);
        }
        this.appendMessage("error", this.text(key));
      }
      appendActionIndicatorOnError(message, code) {
        this.showError(code ? `${code}: ${message ?? ""}` : message);
      }
      /** Replace the raw streamed text with the session-format render
       *  (markdown, or literal text on a plain_text session). */
      finishStreamBubble() {
        if (!this.streamEl) return;
        const text = this.streamText;
        const bubble = this.streamEl;
        this.streamEl = null;
        this.streamText = "";
        bubble.textContent = "";
        let display = text;
        if (this.cfg.hide_audio_tags) display = stripAudioTags(display);
        renderAgentText(bubble, display, this.chatOutputFormat, (t) => this.markdownNode(t));
        this.scrollToBottom();
      }
      // ── mode switching ───────────────────────────────────────────
      async toggleMode() {
        if (this.mode === "voice") {
          await this.endCall("user");
          this.appendMessage("system", this.text("switched_to_text_mode"));
          await this.startChat();
        } else if (this.mode === "chat") {
          const sessionId = this.chatSessionId;
          this.chatSessionId = null;
          if (sessionId && this.api) void this.api.closeChat(sessionId);
          this.mode = "idle";
          this.appendMessage("system", this.text("switched_to_voice_mode"));
          await this.startCall();
        }
      }
      async teardownSessions(endedBy) {
        if (this.voice) {
          const client = this.voice;
          this.voice = null;
          await client.disconnect();
        }
        if (this.chatSessionId && this.api) {
          void this.api.closeChat(this.chatSessionId);
          this.chatSessionId = null;
        }
        if (endedBy && this.mode !== "idle") {
          this.mode = "idle";
        }
      }
      // ── feedback ─────────────────────────────────────────────────
      showFeedbackOverlay(conversationId) {
        const overlay = document.createElement("div");
        overlay.className = "vw-overlay";
        const card = document.createElement("div");
        card.className = "vw-overlay-card";
        overlay.append(card);
        this.overlayHost.append(overlay);
        let rating = 0;
        const renderRate = () => {
          card.textContent = "";
          const title = document.createElement("div");
          title.className = "vw-overlay-title";
          title.textContent = this.text("initiate_feedback");
          const stars = document.createElement("div");
          stars.className = "vw-stars";
          for (let i = 1; i <= 5; i += 1) {
            const star = document.createElement("button");
            star.className = "vw-star";
            star.innerHTML = ICONS.star;
            star.setAttribute("aria-label", `${i}`);
            if (i <= rating) star.setAttribute("data-on", "");
            star.addEventListener("click", () => {
              rating = i;
              void this.api?.submitFeedback(conversationId, rating, null).catch(() => void 0);
              renderComment();
            });
            stars.append(star);
          }
          const actions = document.createElement("div");
          actions.className = "vw-overlay-actions";
          const skip = document.createElement("button");
          skip.className = "vw-callbtn";
          skip.textContent = this.text("dismiss_terms");
          skip.addEventListener("click", () => overlay.remove());
          actions.append(skip);
          card.append(title, stars, actions);
        };
        const renderComment = () => {
          card.textContent = "";
          const title = document.createElement("div");
          title.className = "vw-overlay-title";
          title.textContent = this.text("request_follow_up_feedback");
          const textarea = document.createElement("textarea");
          textarea.className = "vw-textarea";
          textarea.placeholder = this.text("follow_up_feedback_placeholder");
          const actions = document.createElement("div");
          actions.className = "vw-overlay-actions";
          const back = document.createElement("button");
          back.className = "vw-callbtn";
          back.textContent = this.text("go_back");
          back.addEventListener("click", renderRate);
          const submit = document.createElement("button");
          submit.className = "vw-callbtn";
          submit.setAttribute("data-accent", "");
          submit.textContent = this.text("submit");
          submit.addEventListener("click", () => {
            void this.api?.submitFeedback(conversationId, rating, textarea.value.trim() || null).catch(() => void 0);
            renderThanks();
          });
          actions.append(back, submit);
          card.append(title, textarea, actions);
        };
        const renderThanks = () => {
          card.textContent = "";
          const title = document.createElement("div");
          title.className = "vw-overlay-title";
          title.textContent = this.text("thanks_for_feedback");
          const body = document.createElement("div");
          body.className = "vw-overlay-body";
          body.textContent = this.text("thanks_for_feedback_details");
          const actions = document.createElement("div");
          actions.className = "vw-overlay-actions";
          const close = document.createElement("button");
          close.className = "vw-callbtn";
          close.setAttribute("data-accent", "");
          close.textContent = this.text("go_back");
          close.addEventListener("click", () => overlay.remove());
          actions.append(close);
          card.append(title, body, actions);
        };
        renderRate();
      }
    };
    BUILD_DEFAULT_ORIGIN = typeof __VOSO_WIDGET_DEFAULT_ORIGIN__ === "string" ? __VOSO_WIDGET_DEFAULT_ORIGIN__ : null;
    SCRIPT_ORIGIN = (() => {
      try {
        const src = document.currentScript?.src;
        return src ? new URL(src).origin : null;
      } catch {
        return null;
      }
    })();
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  VosoWidgetElement: () => VosoWidgetElement,
  WIDGET_TAGS: () => WIDGET_TAGS,
  registerWidget: () => registerWidget
});
function registerWidget(tagName = "voso-widget") {
  if (typeof window === "undefined" || !("customElements" in window)) return;
  if (customElements.get(tagName)) return;
  customElements.define(
    tagName,
    tagName === "voso-widget" ? VosoWidgetElement : class extends VosoWidgetElement {
    }
  );
}
var WIDGET_TAGS;
var init_src = __esm({
  "src/index.ts"() {
    "use strict";
    init_widget();
    WIDGET_TAGS = ["voso-widget", "convoso-widget"];
    for (const tag of WIDGET_TAGS) registerWidget(tag);
  }
});

// test/registration.test.ts
import test from "node:test";
import assert from "node:assert/strict";
var defined = /* @__PURE__ */ new Map();
var FakeElement = class {
  constructor() {
    this.attrs = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
  }
  attachShadow() {
    return {};
  }
  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name, value) {
    this.attrs.set(name, value);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], fn]);
  }
  dispatchEvent(event) {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
};
var FakeCustomEvent = class {
  constructor(type, init) {
    this.type = type;
    this.init = init;
  }
  get detail() {
    return this.init.detail;
  }
};
Object.assign(globalThis, {
  HTMLElement: FakeElement,
  CustomEvent: FakeCustomEvent,
  window: globalThis,
  customElements: {
    get: (name) => defined.get(name),
    define: (name, ctor) => {
      if (defined.has(name)) throw new Error(`${name} already defined`);
      defined.set(name, ctor);
    }
  }
});
test("widget registers voso-widget and the convoso-widget alias on load", async () => {
  const mod = await Promise.resolve().then(() => (init_src(), src_exports));
  assert.deepEqual([...defined.keys()], ["voso-widget", "convoso-widget"]);
  assert.equal(defined.get("voso-widget"), mod.VosoWidgetElement);
  const alias = defined.get("convoso-widget");
  assert.equal(Object.getPrototypeOf(alias), mod.VosoWidgetElement, "the alias extends the element");
  assert.deepEqual(Object.getOwnPropertyNames(alias.prototype), ["constructor"], "the alias adds no behaviour");
  assert.deepEqual(
    alias.observedAttributes,
    mod.VosoWidgetElement.observedAttributes
  );
});
test("registerWidget(tagName) adds a custom tag once; repeats are no-ops", async () => {
  const { registerWidget: registerWidget2, VosoWidgetElement: VosoWidgetElement2 } = await Promise.resolve().then(() => (init_src(), src_exports));
  registerWidget2("acme-agent");
  registerWidget2("acme-agent");
  registerWidget2("voso-widget");
  assert.equal(Object.getPrototypeOf(defined.get("acme-agent")), VosoWidgetElement2);
  assert.equal(defined.size, 3);
});
test("the element observes the four display attributes (Q9) and keeps agent-id / config-json", async () => {
  const { VosoWidgetElement: VosoWidgetElement2 } = await Promise.resolve().then(() => (init_src(), src_exports));
  for (const name of [
    "agent-id",
    "config-json",
    "show-agent-status",
    "show-resize-button",
    "show-language-selector-on-trigger",
    "show-avatar-when-collapsed"
  ]) {
    assert.ok(VosoWidgetElement2.observedAttributes.includes(name), name);
  }
});
test("voso-widget:call: dispatched (bubbling, composed) with the start config; listener mutations are used", async () => {
  const { VosoWidgetElement: VosoWidgetElement2 } = await Promise.resolve().then(() => (init_src(), src_exports));
  const el = new VosoWidgetElement2();
  el.setAttribute("agent-id", "wgt_0123");
  el.setAttribute("override-first-message", "Hi from the attribute");
  el.setAttribute("overrides", JSON.stringify({ first_message: "Hi from overrides" }));
  el.setAttribute("user-id", "crm-42");
  const seen = [];
  const lookup = () => "found";
  el.addEventListener("voso-widget:call", (event) => {
    const e = event;
    seen.push(e);
    e.detail.config.clientTools = { lookup };
  });
  const config = el.dispatchCall(false);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].init.bubbles, seen[0].init.composed], [true, true]);
  assert.equal(config.agentId, "wgt_0123");
  assert.equal(config.textOnly, false);
  assert.equal(config.userId, "crm-42");
  assert.deepEqual(config.overrides, { first_message: "Hi from overrides" }, "the explicit overrides object wins");
  assert.deepEqual(el.clientTools, { lookup }, "the injected client tools serve the session");
});
test('allow-events: the element forwards nothing until allow-events="true"', async () => {
  const { VosoWidgetElement: VosoWidgetElement2 } = await Promise.resolve().then(() => (init_src(), src_exports));
  const el = new VosoWidgetElement2();
  const debug = [];
  el.onDebug = (e) => debug.push(e);
  el.dispatchEvent(new FakeCustomEvent("voso-widget:user-message", { detail: { message: "hi" } }));
  assert.deepEqual(debug, [], "ignored silently without the attribute");
  el.setAttribute("allow-events", "true");
  el.dispatchEvent(new FakeCustomEvent("voso-widget:user-message", { detail: { message: "hi" } }));
  assert.deepEqual(debug, [{ type: "no_live_session", event: "voso-widget:user-message" }], "heard, no session to take it");
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vLi4vYWktYWdlbnQvc3JjL2ludGVybmFsL3dpZGdldC1hcGkudHMiLCAiLi4vc3JjL2FwaS50cyIsICIuLi9zcmMvYXR0YWNobWVudHMudHMiLCAiLi4vc3JjL2xpbmstcG9saWN5LnRzIiwgIi4uL3NyYy9jb25maWcudHMiLCAiLi4vc3JjL2ljb25zLnRzIiwgIi4uL3NyYy9vcmIudHMiLCAiLi4vc3JjL21hcmtkb3duLnRzIiwgIi4uL3NyYy9oaWdobGlnaHQudHMiLCAiLi4vc3JjL21kLWRvbS50cyIsICIuLi9zcmMvb3V0cHV0LWZvcm1hdC50cyIsICIuLi9zcmMvc3R5bGVzLnRzIiwgIi4uL3NyYy90ZXh0LWRlZmF1bHRzLnRzIiwgIi4uLy4uL2FpLWFnZW50L3NyYy9pbnRlcm5hbC9wbGF0Zm9ybS50cyIsICIuLi8uLi9haS1hZ2VudC9zcmMvaW50ZXJuYWwvdm9pY2UtY2xpZW50LnRzIiwgIi4uL3NyYy92b2ljZS50cyIsICIuLi9zcmMvY2xpZW50LXRvb2xzLnRzIiwgIi4uL3NyYy9hdHRyaWJ1dGVzLnRzIiwgIi4uL3NyYy93aWRnZXQudHMiLCAiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3Rlc3QvcmVnaXN0cmF0aW9uLnRlc3QudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8vIFdpZGdldCBcdTIxOTIgdm9zb3B1bHNlLWFwaSBjbGllbnQgKHB1YmxpYywgdW5hdXRoZW50aWNhdGVkIHN1cmZhY2UpLlxuLy9cbi8vIFRoZSBBUEkgb3JpZ2luIGlzIGRlcml2ZWQgZnJvbSB0aGUgZW1iZWQgc2NyaXB0J3Mgb3duIHNyY1xuLy8gKGBodHRwczovL0hPU1Qvd2lkZ2V0LmpzYCBcdTIxOTIgYGh0dHBzOi8vSE9TVGApLCBvdmVycmlkYWJsZSB2aWEgdGhlXG4vLyBlbGVtZW50J3MgYHNlcnZlci11cmxgIGF0dHJpYnV0ZSAodXNlZCBieSB0aGUgZGFzaGJvYXJkJ3MgbGl2ZSBwcmV2aWV3LFxuLy8gd2hpY2ggaW1wb3J0cyB0aGUgZWxlbWVudCBpbnN0ZWFkIG9mIGxvYWRpbmcgdGhlIHNjcmlwdCB0YWcpLlxuXG4vKiogU2VydmVyIHBheWxvYWQgb2YgR0VUIC9hcGkvd2lkZ2V0L3twdWJsaWNfaWR9L2NvbmZpZy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVibGljV2lkZ2V0Q29uZmlnIHtcbiAgYWdlbnRfbmFtZTogc3RyaW5nO1xuICBsYW5ndWFnZXM6IHN0cmluZ1tdO1xuICAvKiogVGhlIHdpZGdldCdzIGFwcGVhcmFuY2UgY29uZmlnOyB0aGUgd2lkZ2V0IHBhY2thZ2UgbmFycm93cyBpdCB0byBpdHNcbiAgICogIGBXaWRnZXRSdW50aW1lQ29uZmlnYCAodGhlIGNvcmUgZG9lcyBub3Qga25vdyB0aGUgd2lkZ2V0J3Mgc2NoZW1hKS4gKi9cbiAgY29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgYXZhdGFyX3VybD86IHN0cmluZyB8IG51bGw7XG59XG5cbi8qKiBWb2ljZSBzZXNzaW9uIGJvb3RzdHJhcCByZXNwb25zZSAoUHJldmlld1Nlc3Npb24gc2hhcGUpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBWb2ljZVNlc3Npb25EZXNjcmlwdG9yIHtcbiAgc2Vzc2lvbl9pZDogc3RyaW5nO1xuICAvKiogT3duZXJzaGlwIHRva2VuIHJlcXVpcmVkIGJ5IHRoZSBwcmV2aWV3IHdvcmtlcidzIFBPU1QgL2FwaS9kaXNjb25uZWN0XG4gICAqICAoVk9TTy0xOTEpLiBUcmVhdCBhcyBhIHNlY3JldCBcdTIwMTQgbmV2ZXIgbG9nIGl0LiAqL1xuICBzZXNzaW9uX3Rva2VuPzogc3RyaW5nO1xuICBjb252ZXJzYXRpb25faWQ6IHN0cmluZztcbiAgc2lnbmFsaW5nX3VybDogc3RyaW5nO1xuICAvKiogQSBjb252ZXJzYXRpb24gdG9rZW4gcmVkZWVtZWQgb24gdGhlIGZpcnN0IG9mZmVyIGluc3RlYWQgb2ZcbiAgICogIGBzZXNzaW9uX2lkYCAoRTQgUDE7IHNldCBieSBgVm9pY2VDbGllbnQuZnJvbUNvbnZlcnNhdGlvblRva2VuYCkuICovXG4gIGNvbnZlcnNhdGlvbl90b2tlbj86IHN0cmluZztcbiAgaWNlX3NlcnZlcnM/OiBBcnJheTx7XG4gICAgdXJsczogc3RyaW5nIHwgc3RyaW5nW107XG4gICAgdXNlcm5hbWU/OiBzdHJpbmc7XG4gICAgY3JlZGVudGlhbD86IHN0cmluZztcbiAgfT47XG4gIHRyYWNlX2NvbnRleHQ/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICAvKiogUHJlc2VudCB3aGVuIHRoZSBjYWxsZXIgd2FzIHBsYWNlZCBpbiB0aGUgYWdlbnQncyB3YWl0IHF1ZXVlXG4gICAqICAoYWdlbnQtaW50ZWdyYXRpb24gRTcgXHUwMEE3NC4yKTogdGhlIHNlc3Npb24gZXhpc3RzLCB0aGUgd29ya2VyIGFkbWl0cyBpdFxuICAgKiAgd2hlbiBhIHNsb3QgZnJlZXMgb3IgZW5kcyBpdCBhZnRlciBgdGltZW91dF9zYC4gQWJzZW50ID0gYWRtaXR0ZWQuICovXG4gIHF1ZXVlPzogeyBzdGF0dXM6IHN0cmluZzsgdGltZW91dF9zOiBudW1iZXI7IGVucXVldWVkX2F0X21zPzogbnVtYmVyIH0gfCBudWxsO1xufVxuXG4vKiogT25lIFNTRSBjaGF0IGV2ZW50ICh3b3JrZmxvdyBDaGF0VHVybkV2ZW50ICsgdGhlIGxlYWRpbmcgc2Vzc2lvbiBmcmFtZSkuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYXRFdmVudCB7XG4gIHR5cGU6IHN0cmluZztcbiAgc2Vzc2lvbl9pZD86IHN0cmluZztcbiAgLyoqIER1cmFibGUgY29udmVyc2F0aW9uIGlkIChgY2FsbHMuY2FsbF9pZGApIG9uIHRoZSBsZWFkaW5nIGBzZXNzaW9uYFxuICAgKiAgZnJhbWUgXHUyMDE0IHNhbWUgaWRlbnRpdHkgdm9pY2Ugc2Vzc2lvbnMgY2FycnkuICovXG4gIGNvbnZlcnNhdGlvbl9pZD86IHN0cmluZztcbiAgZGVsdGE/OiBzdHJpbmc7XG4gIHRleHQ/OiBzdHJpbmc7XG4gIG1lc3NhZ2U/OiBzdHJpbmc7XG4gIC8qKiBNYWNoaW5lIGNsYXNzIG9uIGFuIGBlcnJvcmAgZnJhbWUgKGBsbG1fdW5hdmFpbGFibGVgLCBgbGxtX2ludGVycnVwdGVkYCxcbiAgICogIGB0b29sX21vY2tfbWlzc2luZ2AsIGBzZXNzaW9uX2NvbmZpZ2AsIGBpbnRlcm5hbGApOyBhYnNlbnQgb24gZnJhbWVzXG4gICAqICBmcm9tIGFuIG9sZGVyIHNlcnZlci4gKi9cbiAgY29kZT86IHN0cmluZztcbiAgcmVhc29uPzogc3RyaW5nO1xuICBuYW1lPzogc3RyaW5nO1xuICBtb2NrZWQ/OiBib29sZWFuO1xuICBjdXJyZW50X25vZGVfaWQ/OiBzdHJpbmcgfCBudWxsO1xuICAvKiogYGNsaWVudF90b29sX2NhbGxgIChFMyBcdTAwQTc0LjEuNyk6IHRoZSBpZCB0aGUgcGFnZSdzIGFuc3dlciBtdXN0IGNhcnJ5LiAqL1xuICB0b29sX2NhbGxfaWQ/OiBzdHJpbmc7XG4gIC8qKiBgY2xpZW50X3Rvb2xfY2FsbGA6IHRoZSBhZ2VudCdzIGFyZ3VtZW50cy4gKi9cbiAgYXJncz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAvKiogYGNsaWVudF90b29sX2NhbGxgOiB3aGV0aGVyIHRoZSBhZ2VudCB3YWl0cyBmb3IgdGhlIGFuc3dlci4gKi9cbiAgZXhwZWN0c19yZXNwb25zZT86IGJvb2xlYW47XG4gIC8qKiBgY2xpZW50X3Rvb2xfY2FsbGA6IHRoZSB3YWl0IGJ1ZGdldCBpbiBzZWNvbmRzLiAqL1xuICB0aW1lb3V0X3NlY3M/OiBudW1iZXI7XG4gIC8qKiBgbWNwX3Rvb2xfY2FsbGAgKEUzIFx1MDBBNzQuNik6IHRoZSBzZXJ2ZXIgaWQsIHRvb2wgbmFtZSwgYXJndW1lbnRzLCBzdGF0ZVxuICAgKiAgKGBhd2FpdGluZ19hcHByb3ZhbGAgfCBgbG9hZGluZ2AgfCBgc3VjY2Vzc2AgfCBgZmFpbHVyZWApIGFuZCB0aGVcbiAgICogIGFwcHJvdmFsIGJ1ZGdldCBpbiBzZWNvbmRzLiAqL1xuICBzZXJ2aWNlX2lkPzogc3RyaW5nO1xuICB0b29sX25hbWU/OiBzdHJpbmc7XG4gIHBhcmFtZXRlcnM/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgc3RhdGU/OiBzdHJpbmc7XG4gIGFwcHJvdmFsX3RpbWVvdXRfc2Vjcz86IG51bWJlcjtcbiAgZXJyb3JfbWVzc2FnZT86IHN0cmluZztcbiAgLyoqIExlYWRpbmcgYHNlc3Npb25gIGZyYW1lOiBob3cgYWdlbnQgcmVwbGllcyByZW5kZXIgaW4gVEhJUyBzZXNzaW9uIFx1MjAxNFxuICAgKiAgdGhlIGFnZW50IGJlaGF2aW9yIHBhbmVsJ3MgV2lkZ2V0IHJvdyAoYGNoYW5uZWxfY2F0YWxvZzo6dGV4dDo6VGV4dE91dHB1dEZvcm1hdGApLlxuICAgKiAgTWlzc2luZyBvbiBvbGRlciBBUElzIFx1MjFEMiB0aGUgd2lkZ2V0IGtlZXBzIG1hcmtkb3duLiAqL1xuICBvdXRwdXRfZm9ybWF0PzogXCJwbGFpbl90ZXh0XCIgfCBcIm1hcmtkb3duXCI7XG4gIFtrZXk6IHN0cmluZ106IHVua25vd247XG59XG5cbmV4cG9ydCBjbGFzcyBXaWRnZXRBcGlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcmVhZG9ubHkgc3RhdHVzOiBudW1iZXI7XG4gIGNvbnN0cnVjdG9yKHN0YXR1czogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLnN0YXR1cyA9IHN0YXR1cztcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiB0aHJvd0h0dHBFcnJvcihyZXM6IFJlc3BvbnNlKTogUHJvbWlzZTxuZXZlcj4ge1xuICBsZXQgZGV0YWlsID0gcmVzLnN0YXR1c1RleHQgfHwgYEhUVFAgJHtyZXMuc3RhdHVzfWA7XG4gIHRyeSB7XG4gICAgY29uc3QgYm9keSA9IChhd2FpdCByZXMuanNvbigpKSBhcyB7XG4gICAgICBlcnJvcj86IHN0cmluZztcbiAgICAgIGRldGFpbD86IEFycmF5PHsgbXNnPzogc3RyaW5nIH0+IHwgc3RyaW5nO1xuICAgIH07XG4gICAgaWYgKHR5cGVvZiBib2R5LmRldGFpbCA9PT0gXCJzdHJpbmdcIikgZGV0YWlsID0gYm9keS5kZXRhaWw7XG4gICAgZWxzZSBpZiAoQXJyYXkuaXNBcnJheShib2R5LmRldGFpbCkgJiYgYm9keS5kZXRhaWxbMF0/Lm1zZykgZGV0YWlsID0gYm9keS5kZXRhaWxbMF0ubXNnO1xuICAgIGVsc2UgaWYgKGJvZHkuZXJyb3IpIGRldGFpbCA9IGJvZHkuZXJyb3I7XG4gIH0gY2F0Y2gge1xuICAgIC8vIGtlZXAgc3RhdHVzVGV4dFxuICB9XG4gIHRocm93IG5ldyBXaWRnZXRBcGlFcnJvcihyZXMuc3RhdHVzLCBkZXRhaWwpO1xufVxuXG4vKiogT25lIHVwbG9hZGVkIGF0dGFjaG1lbnQsIGFzIHJldHVybmVkIGJ5IHRoZSB1cGxvYWQgZW5kcG9pbnQuICovXG5leHBvcnQgaW50ZXJmYWNlIFVwbG9hZGVkQXR0YWNobWVudCB7XG4gIGF0dGFjaG1lbnRfaWQ6IHN0cmluZztcbiAgZmlsZW5hbWU6IHN0cmluZztcbiAgbWltZV90eXBlOiBzdHJpbmc7XG4gIHNpemVfYnl0ZXM6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBQZXItY2FsbCBjb252ZXJzYXRpb24gb3ZlcnJpZGVzIChgZmlyc3RfbWVzc2FnZWAsIGBsYW5ndWFnZWAsXG4gKiBgc3lzdGVtX3Byb21wdGAsIGBsbG1gLCBgdm9pY2VfaWRgLCBgdm9pY2Vfc3BlZWRgLCBcdTIwMjYpLiBUaGUgQVBJIGdhdGVzIGV2ZXJ5XG4gKiBrZXkgYWdhaW5zdCB0aGUgYWdlbnQncyBHdWFyZHJhaWxzIFwiQ29udmVyc2F0aW9uIG92ZXJyaWRlc1wiIHRvZ2dsZXM6IGFcbiAqIGRpc2FibGVkIGtleSBmYWlscyB0aGUgc2Vzc2lvbiBzdGFydCAoNDAzKSwgYW4gdW5rbm93biBrZXkgb3Igd3JvbmctdHlwZWRcbiAqIHZhbHVlIDQwMC4gVm9pY2Uga2V5cyBhcmUgYWNjZXB0ZWQgb24gY2hhdCB0b28gYW5kIGFyZSBpbmVydCB0aGVyZS5cbiAqL1xuZXhwb3J0IHR5cGUgQ29udmVyc2F0aW9uT3ZlcnJpZGVzID0gUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG5cbi8qKlxuICogUGVyLXNlc3Npb24gYHt7bmFtZX19YCB2YWx1ZXMgdGhlIHBhZ2Ugc3VwcGxpZXMgKHRoZSB2ZW5kb3IgSlMgU0RLJ3NcbiAqIGBkeW5hbWljVmFyaWFibGVzYCk6IHN0cmluZywgbnVtYmVyIG9yIGJvb2xlYW4gdmFsdWVzLCBhdCBtb3N0IDIwMCBuYW1lcy5cbiAqIEdhdGVkIHNlcnZlci1zaWRlIGJ5IHRoZSBhZ2VudCdzIFNlY3VyaXR5IFx1MjE5MiBPdmVycmlkZXMgXCJEeW5hbWljIHZhcmlhYmxlc1wiXG4gKiB0b2dnbGUgKGEgbm9uLWVtcHR5IG1hcCB3aXRoIHRoZSB0b2dnbGUgb2ZmIGZhaWxzIHRoZSBzdGFydCB3aXRoIDQwMzsgYW5cbiAqIGVtcHR5IG1hcCBpcyBuZXZlciByZWZ1c2VkKS4gUmVzZXJ2ZWQgbmFtZXMgKGBzeXN0ZW1fX1x1MjAyNmAsIGBzZWNyZXRfX1x1MjAyNmAsXG4gKiBgc2lwX1x1MjAyNmAsIGBjb252b3NvLlx1MjAyNmApIGZhaWwgd2l0aCA0MDAgbmFtaW5nIHRoZSBrZXkuXG4gKi9cbmV4cG9ydCB0eXBlIER5bmFtaWNWYXJpYWJsZXMgPSBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuPjtcblxuLyoqIGBQT1NUIFx1MjAyNi9zZXNzaW9uYCBhbmQgYFx1MjAyNi9jaGF0YCBib2R5OiBvbmx5IHRoZSBrZXlzIHRoZSBlbWJlZCBzZXQuICovXG5leHBvcnQgZnVuY3Rpb24gc2Vzc2lvblN0YXJ0Qm9keShcbiAgbGFuZ3VhZ2U6IHN0cmluZyB8IG51bGwsXG4gIG92ZXJyaWRlczogQ29udmVyc2F0aW9uT3ZlcnJpZGVzIHwgbnVsbCxcbiAgZHluYW1pY1ZhcmlhYmxlczogRHluYW1pY1ZhcmlhYmxlcyB8IG51bGwgPSBudWxsLFxuKTogeyBsYW5ndWFnZT86IHN0cmluZzsgb3ZlcnJpZGVzPzogQ29udmVyc2F0aW9uT3ZlcnJpZGVzOyBkeW5hbWljX3ZhcmlhYmxlcz86IER5bmFtaWNWYXJpYWJsZXMgfSB7XG4gIGNvbnN0IGJvZHk6IHtcbiAgICBsYW5ndWFnZT86IHN0cmluZztcbiAgICBvdmVycmlkZXM/OiBDb252ZXJzYXRpb25PdmVycmlkZXM7XG4gICAgZHluYW1pY192YXJpYWJsZXM/OiBEeW5hbWljVmFyaWFibGVzO1xuICB9ID0ge307XG4gIGlmIChsYW5ndWFnZSkgYm9keS5sYW5ndWFnZSA9IGxhbmd1YWdlO1xuICBpZiAob3ZlcnJpZGVzICYmIE9iamVjdC5rZXlzKG92ZXJyaWRlcykubGVuZ3RoID4gMCkgYm9keS5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIGlmIChkeW5hbWljVmFyaWFibGVzICYmIE9iamVjdC5rZXlzKGR5bmFtaWNWYXJpYWJsZXMpLmxlbmd0aCA+IDApIHtcbiAgICBib2R5LmR5bmFtaWNfdmFyaWFibGVzID0gZHluYW1pY1ZhcmlhYmxlcztcbiAgfVxuICByZXR1cm4gYm9keTtcbn1cblxuZXhwb3J0IGNsYXNzIFdpZGdldEFwaSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3JpZ2luOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBwdWJsaWNJZDogc3RyaW5nLFxuICAgIC8qKiBEYXNoYm9hcmQgYWNjZXNzIHRva2VuIFx1MjAxNCBzZXQgT05MWSBieSB0aGUgc2V0dGluZ3MgcGFnZSdzIGxpdmVcbiAgICAgKiAgcHJldmlldyAodGhlIGVsZW1lbnQncyBgYXV0aC10b2tlbmAgYXR0cmlidXRlKSBzbyBhIERJU0FCTEVEXG4gICAgICogIHdpZGdldCBzdGlsbCBwcmV2aWV3cyBmb3IgYXV0aGVudGljYXRlZCB0ZW5hbnQgbWVtYmVycy4gQ3VzdG9tZXJcbiAgICAgKiAgZW1iZWRzIG5ldmVyIGNhcnJ5IGl0LiAqL1xuICAgIHByaXZhdGUgcmVhZG9ubHkgYXV0aFRva2VuOiBzdHJpbmcgfCBudWxsID0gbnVsbCxcbiAgKSB7fVxuXG4gIHByaXZhdGUgdXJsKHBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMub3JpZ2lufS9hcGkvd2lkZ2V0LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHRoaXMucHVibGljSWQpfSR7cGF0aH1gO1xuICB9XG5cbiAgLyoqIEJhc2UgaGVhZGVycyBmb3IgZXZlcnkgY2FsbCBcdTIwMTQgdGhlIHByZXZpZXcncyBBdXRob3JpemF0aW9uIG9ubHkuICovXG4gIHByaXZhdGUgaGVhZGVycyhleHRyYT86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyAuLi4oZXh0cmEgPz8ge30pIH07XG4gICAgaWYgKHRoaXMuYXV0aFRva2VuKSBoZWFkZXJzLkF1dGhvcml6YXRpb24gPSBgQmVhcmVyICR7dGhpcy5hdXRoVG9rZW59YDtcbiAgICByZXR1cm4gaGVhZGVycztcbiAgfVxuXG4gIGFzeW5jIGZldGNoQ29uZmlnKCk6IFByb21pc2U8UHVibGljV2lkZ2V0Q29uZmlnPiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godGhpcy51cmwoXCIvY29uZmlnXCIpLCB7IGhlYWRlcnM6IHRoaXMuaGVhZGVycygpIH0pO1xuICAgIGlmICghcmVzLm9rKSBhd2FpdCB0aHJvd0h0dHBFcnJvcihyZXMpO1xuICAgIHJldHVybiAoYXdhaXQgcmVzLmpzb24oKSkgYXMgUHVibGljV2lkZ2V0Q29uZmlnO1xuICB9XG5cbiAgLyoqIFJlc29sdmUgYSBjb25maWctcmVsYXRpdmUgYXZhdGFyIHBhdGggYWdhaW5zdCB0aGUgQVBJIG9yaWdpbi4gKi9cbiAgcmVzb2x2ZVVybChwYXRoT3JVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgaWYgKC9eaHR0cHM/OlxcL1xcLy8udGVzdChwYXRoT3JVcmwpKSByZXR1cm4gcGF0aE9yVXJsO1xuICAgIHJldHVybiBgJHt0aGlzLm9yaWdpbn0ke3BhdGhPclVybH1gO1xuICB9XG5cbiAgYXN5bmMgc3RhcnRWb2ljZVNlc3Npb24oXG4gICAgbGFuZ3VhZ2U6IHN0cmluZyB8IG51bGwsXG4gICAgb3ZlcnJpZGVzOiBDb252ZXJzYXRpb25PdmVycmlkZXMgfCBudWxsID0gbnVsbCxcbiAgICBkeW5hbWljVmFyaWFibGVzOiBEeW5hbWljVmFyaWFibGVzIHwgbnVsbCA9IG51bGwsXG4gICk6IFByb21pc2U8Vm9pY2VTZXNzaW9uRGVzY3JpcHRvcj4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRoaXMudXJsKFwiL3Nlc3Npb25cIiksIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBoZWFkZXJzOiB0aGlzLmhlYWRlcnMoeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9KSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHNlc3Npb25TdGFydEJvZHkobGFuZ3VhZ2UsIG92ZXJyaWRlcywgZHluYW1pY1ZhcmlhYmxlcykpLFxuICAgIH0pO1xuICAgIGlmICghcmVzLm9rKSBhd2FpdCB0aHJvd0h0dHBFcnJvcihyZXMpO1xuICAgIGNvbnN0IHNlc3Npb24gPSAoYXdhaXQgcmVzLmpzb24oKSkgYXMgVm9pY2VTZXNzaW9uRGVzY3JpcHRvcjtcbiAgICBpZiAoIXNlc3Npb24uc2Vzc2lvbl9pZCB8fCAhc2Vzc2lvbi5zaWduYWxpbmdfdXJsKSB7XG4gICAgICB0aHJvdyBuZXcgV2lkZ2V0QXBpRXJyb3IoNTAwLCBcIk1hbGZvcm1lZCBzZXNzaW9uIHJlc3BvbnNlXCIpO1xuICAgIH1cbiAgICByZXR1cm4gc2Vzc2lvbjtcbiAgfVxuXG4gIC8qKiBPcGVuIGEgY2hhdCBzZXNzaW9uOyB5aWVsZHMgcGFyc2VkIFNTRSBldmVudHMgKGZpcnN0OiBgc2Vzc2lvbmApLiAqL1xuICBvcGVuQ2hhdChcbiAgICBsYW5ndWFnZTogc3RyaW5nIHwgbnVsbCxcbiAgICBvdmVycmlkZXM6IENvbnZlcnNhdGlvbk92ZXJyaWRlcyB8IG51bGwgPSBudWxsLFxuICAgIGR5bmFtaWNWYXJpYWJsZXM6IER5bmFtaWNWYXJpYWJsZXMgfCBudWxsID0gbnVsbCxcbiAgKTogQXN5bmNHZW5lcmF0b3I8Q2hhdEV2ZW50LCB2b2lkLCB1bmRlZmluZWQ+IHtcbiAgICByZXR1cm4gdGhpcy5zc2UoXG4gICAgICB0aGlzLnVybChcIi9jaGF0XCIpLFxuICAgICAgSlNPTi5zdHJpbmdpZnkoc2Vzc2lvblN0YXJ0Qm9keShsYW5ndWFnZSwgb3ZlcnJpZGVzLCBkeW5hbWljVmFyaWFibGVzKSksXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBTZW5kIG9uZSBjaGF0IHR1cm47IHlpZWxkcyB0aGF0IHR1cm4ncyBldmVudHMuICovXG4gIHNlbmRDaGF0TWVzc2FnZShcbiAgICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgICB0ZXh0OiBzdHJpbmcsXG4gICAgYXR0YWNobWVudElkczogc3RyaW5nW10gPSBbXSxcbiAgKTogQXN5bmNHZW5lcmF0b3I8Q2hhdEV2ZW50LCB2b2lkLCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgdGV4dCB9O1xuICAgIGlmIChhdHRhY2htZW50SWRzLmxlbmd0aCA+IDApIGJvZHkuYXR0YWNobWVudF9pZHMgPSBhdHRhY2htZW50SWRzO1xuICAgIHJldHVybiB0aGlzLnNzZShcbiAgICAgIHRoaXMudXJsKGAvY2hhdC8ke2VuY29kZVVSSUNvbXBvbmVudChzZXNzaW9uSWQpfS9tZXNzYWdlYCksXG4gICAgICBKU09OLnN0cmluZ2lmeShib2R5KSxcbiAgICApO1xuICB9XG5cbiAgLyoqIFVwbG9hZCBvbmUgZmlsZSBmb3IgdGhlIGNvbnZlcnNhdGlvbiAobXVsdGlwYXJ0IGBmaWxlYCBwYXJ0KS4gKi9cbiAgYXN5bmMgdXBsb2FkQXR0YWNobWVudChzZXNzaW9uSWQ6IHN0cmluZywgZmlsZTogRmlsZSk6IFByb21pc2U8VXBsb2FkZWRBdHRhY2htZW50PiB7XG4gICAgY29uc3QgZm9ybSA9IG5ldyBGb3JtRGF0YSgpO1xuICAgIGZvcm0uYXBwZW5kKFwiZmlsZVwiLCBmaWxlLCBmaWxlLm5hbWUpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKFxuICAgICAgdGhpcy51cmwoYC9jaGF0LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHNlc3Npb25JZCl9L2F0dGFjaG1lbnRzYCksXG4gICAgICB7XG4gICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgIGhlYWRlcnM6IHRoaXMuaGVhZGVycygpLFxuICAgICAgICBib2R5OiBmb3JtLFxuICAgICAgfSxcbiAgICApO1xuICAgIGlmICghcmVzLm9rKSBhd2FpdCB0aHJvd0h0dHBFcnJvcihyZXMpO1xuICAgIHJldHVybiAoYXdhaXQgcmVzLmpzb24oKSkgYXMgVXBsb2FkZWRBdHRhY2htZW50O1xuICB9XG5cbiAgLyoqIEFuc3dlciBhIGBjbGllbnRfdG9vbF9jYWxsYCBmcmFtZSBvZiBhbiBvcGVuIGNoYXQgc2Vzc2lvbiAoRTMgXHUwMEE3NC4xLjcpLiAqL1xuICBhc3luYyBwb3N0Q2hhdFRvb2xSZXN1bHQoXG4gICAgc2Vzc2lvbklkOiBzdHJpbmcsXG4gICAgdG9vbENhbGxJZDogc3RyaW5nLFxuICAgIHJlc3VsdDogc3RyaW5nLFxuICAgIGlzRXJyb3I6IGJvb2xlYW4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRoaXMudXJsKGAvY2hhdC8ke2VuY29kZVVSSUNvbXBvbmVudChzZXNzaW9uSWQpfS90b29sLXJlc3VsdGApLCB7XG4gICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgaGVhZGVyczogdGhpcy5oZWFkZXJzKHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSksXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHRvb2xfY2FsbF9pZDogdG9vbENhbGxJZCwgcmVzdWx0LCBpc19lcnJvcjogaXNFcnJvciB9KSxcbiAgICB9KTtcbiAgICBpZiAoIXJlcy5vaykgYXdhaXQgdGhyb3dIdHRwRXJyb3IocmVzKTtcbiAgfVxuXG4gIC8qKiBBcHByb3ZlIG9yIGRlbnkgYW4gYG1jcF90b29sX2NhbGwge3N0YXRlOlwiYXdhaXRpbmdfYXBwcm92YWxcIn1gIGZyYW1lIChFMyBcdTAwQTc0LjYpLiAqL1xuICBhc3luYyBwb3N0Q2hhdFRvb2xBcHByb3ZhbChcbiAgICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgICB0b29sQ2FsbElkOiBzdHJpbmcsXG4gICAgaXNBcHByb3ZlZDogYm9vbGVhbixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godGhpcy51cmwoYC9jaGF0LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHNlc3Npb25JZCl9L3Rvb2wtYXBwcm92YWxgKSwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHRoaXMuaGVhZGVycyh7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0pLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyB0b29sX2NhbGxfaWQ6IHRvb2xDYWxsSWQsIGlzX2FwcHJvdmVkOiBpc0FwcHJvdmVkIH0pLFxuICAgIH0pO1xuICAgIGlmICghcmVzLm9rKSBhd2FpdCB0aHJvd0h0dHBFcnJvcihyZXMpO1xuICB9XG5cbiAgLyoqIEFwcGVuZCBiYWNrZ3JvdW5kIGNvbnRleHQgdG8gYW4gb3BlbiBjaGF0IHNlc3Npb24gd2l0aG91dCBhIHR1cm4gKEUzIFx1MDBBNzQuMikuICovXG4gIGFzeW5jIHBvc3RDaGF0Q29udGV4dChzZXNzaW9uSWQ6IHN0cmluZywgdGV4dDogc3RyaW5nLCBjb250ZXh0SWQ/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBib2R5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgdGV4dCB9O1xuICAgIGlmIChjb250ZXh0SWQgIT09IHVuZGVmaW5lZCkgYm9keS5jb250ZXh0X2lkID0gY29udGV4dElkO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRoaXMudXJsKGAvY2hhdC8ke2VuY29kZVVSSUNvbXBvbmVudChzZXNzaW9uSWQpfS9jb250ZXh0YCksIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBoZWFkZXJzOiB0aGlzLmhlYWRlcnMoeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9KSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KGJvZHkpLFxuICAgIH0pO1xuICAgIGlmICghcmVzLm9rKSBhd2FpdCB0aHJvd0h0dHBFcnJvcihyZXMpO1xuICB9XG5cbiAgYXN5bmMgY2xvc2VDaGF0KHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZldGNoKHRoaXMudXJsKGAvY2hhdC8ke2VuY29kZVVSSUNvbXBvbmVudChzZXNzaW9uSWQpfWApLCB7XG4gICAgICAgIG1ldGhvZDogXCJERUxFVEVcIixcbiAgICAgICAgaGVhZGVyczogdGhpcy5oZWFkZXJzKCksXG4gICAgICAgIGtlZXBhbGl2ZTogdHJ1ZSxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYmVzdCBlZmZvcnQgXHUyMDE0IHRoZSBzZXJ2ZXIgcmVhcHMgc2Vzc2lvbnMgYW55d2F5XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3VibWl0RmVlZGJhY2soXG4gICAgY29udmVyc2F0aW9uSWQ6IHN0cmluZyxcbiAgICByYXRpbmc6IG51bWJlcixcbiAgICBjb21tZW50OiBzdHJpbmcgfCBudWxsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0aGlzLnVybChcIi9mZWVkYmFja1wiKSwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHRoaXMuaGVhZGVycyh7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0pLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb252ZXJzYXRpb25faWQ6IGNvbnZlcnNhdGlvbklkLFxuICAgICAgICByYXRpbmcsXG4gICAgICAgIGNvbW1lbnQ6IGNvbW1lbnQgfHwgdW5kZWZpbmVkLFxuICAgICAgfSksXG4gICAgfSk7XG4gICAgaWYgKCFyZXMub2spIGF3YWl0IHRocm93SHR0cEVycm9yKHJlcyk7XG4gIH1cblxuICAvKipcbiAgICogUE9TVCArIHBhcnNlIGEgU2VydmVyLVNlbnQtRXZlbnRzIHJlc3BvbnNlLiBFdmVudFNvdXJjZSBpcyBHRVQtb25seSxcbiAgICogc28gdGhpcyByZWFkcyB0aGUgYm9keSBzdHJlYW0gYW5kIHNwbGl0cyBgZGF0YTpgIGZyYW1lcyBtYW51YWxseSBcdTIwMTRcbiAgICogdGhlIHNhbWUgYXBwcm9hY2ggdGhlIGRhc2hib2FyZCdzIHVzZS13b3JrZmxvdy1jaGF0IGhvb2sgdGFrZXMuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jICpzc2UoXG4gICAgdXJsOiBzdHJpbmcsXG4gICAgYm9keTogc3RyaW5nLFxuICApOiBBc3luY0dlbmVyYXRvcjxDaGF0RXZlbnQsIHZvaWQsIHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiBcIlBPU1RcIixcbiAgICAgIGhlYWRlcnM6IHRoaXMuaGVhZGVycyh7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBBY2NlcHQ6IFwidGV4dC9ldmVudC1zdHJlYW1cIixcbiAgICAgIH0pLFxuICAgICAgYm9keSxcbiAgICB9KTtcbiAgICBpZiAoIXJlcy5vaykgYXdhaXQgdGhyb3dIdHRwRXJyb3IocmVzKTtcbiAgICBjb25zdCByZWFkZXIgPSByZXMuYm9keT8uZ2V0UmVhZGVyKCk7XG4gICAgaWYgKCFyZWFkZXIpIHRocm93IG5ldyBXaWRnZXRBcGlFcnJvcig1MDAsIFwiU3RyZWFtaW5nIG5vdCBzdXBwb3J0ZWRcIik7XG5cbiAgICBjb25zdCBkZWNvZGVyID0gbmV3IFRleHREZWNvZGVyKCk7XG4gICAgbGV0IGJ1ZmZlciA9IFwiXCI7XG4gICAgdHJ5IHtcbiAgICAgIGZvciAoOzspIHtcbiAgICAgICAgY29uc3QgeyBkb25lLCB2YWx1ZSB9ID0gYXdhaXQgcmVhZGVyLnJlYWQoKTtcbiAgICAgICAgaWYgKGRvbmUpIGJyZWFrO1xuICAgICAgICBidWZmZXIgKz0gZGVjb2Rlci5kZWNvZGUodmFsdWUsIHsgc3RyZWFtOiB0cnVlIH0pO1xuICAgICAgICAvLyBTU0UgZnJhbWVzIGFyZSBzZXBhcmF0ZWQgYnkgYSBibGFuayBsaW5lLlxuICAgICAgICBmb3IgKDs7KSB7XG4gICAgICAgICAgY29uc3Qgc2VwID0gYnVmZmVyLmluZGV4T2YoXCJcXG5cXG5cIik7XG4gICAgICAgICAgaWYgKHNlcCA8IDApIGJyZWFrO1xuICAgICAgICAgIGNvbnN0IGZyYW1lID0gYnVmZmVyLnNsaWNlKDAsIHNlcCk7XG4gICAgICAgICAgYnVmZmVyID0gYnVmZmVyLnNsaWNlKHNlcCArIDIpO1xuICAgICAgICAgIGZvciAoY29uc3QgbGluZSBvZiBmcmFtZS5zcGxpdChcIlxcblwiKSkge1xuICAgICAgICAgICAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoXCJkYXRhOlwiKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBwYXlsb2FkID0gbGluZS5zbGljZSg1KS50cmltKCk7XG4gICAgICAgICAgICBpZiAoIXBheWxvYWQpIGNvbnRpbnVlO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgeWllbGQgSlNPTi5wYXJzZShwYXlsb2FkKSBhcyBDaGF0RXZlbnQ7XG4gICAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgICAgLy8gaWdub3JlIG1hbGZvcm1lZCBmcmFtZXMgKGtlZXAtYWxpdmVzIGV0Yy4pXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHJlYWRlci5yZWxlYXNlTG9jaygpO1xuICAgIH1cbiAgfVxufVxuIiwgImV4cG9ydCAqIGZyb20gXCIuLi8uLi9haS1hZ2VudC9zcmMvaW50ZXJuYWwvd2lkZ2V0LWFwaVwiO1xuIiwgIi8vIENsaWVudC1zaWRlIG1pcnJvciBvZiB0aGUgYmFja2VuZCBjaGF0LWF0dGFjaG1lbnQgY2FwcyBcdTIwMTQgVVggb25seTsgdGhlXG4vLyBiYWNrZW5kIChgdm9zb3B1bHNlLWFwaSByb3V0ZXMvd29ya2Zsb3dfY2hhdC5yc2ApIGlzIGF1dGhvcml0YXRpdmUgYW5kXG4vLyBlbmZvcmNlcyB0aGUgc2FtZSBhbGxvd2xpc3QgLyBzaXplIGNhcCAvIHBlci1jb252ZXJzYXRpb24gY291bnQgY2FwLlxuXG4vKiogTUlNRSB0eXBlcyB0aGUgYmFja2VuZCBhY2NlcHRzIChpbWFnZXMgYXJlIHZpc2lvbi1jYXBhYmxlKS4gKi9cbmV4cG9ydCBjb25zdCBBVFRBQ0hNRU5UX0FMTE9XRURfVFlQRVMgPSBbXG4gIFwiaW1hZ2UvcG5nXCIsXG4gIFwiaW1hZ2UvanBlZ1wiLFxuICBcImltYWdlL3dlYnBcIixcbiAgXCJpbWFnZS9naWZcIixcbiAgXCJhcHBsaWNhdGlvbi9wZGZcIixcbiAgXCJ0ZXh0L3BsYWluXCIsXG4gIFwidGV4dC9jc3ZcIixcbiAgXCJ0ZXh0L21hcmtkb3duXCIsXG5dIGFzIGNvbnN0O1xuXG4vKiogUGVyLWZpbGUgc2l6ZSBjYXAgKDUgTWlCKSBcdTIwMTQgbWlycm9ycyBNQVhfQ0hBVF9BVFRBQ0hNRU5UX1NJWkVfQllURVMuICovXG5leHBvcnQgY29uc3QgQVRUQUNITUVOVF9NQVhfU0laRV9CWVRFUyA9IDUgKiAxMDI0ICogMTAyNDtcblxuLyoqIFVwbG9hZHMgcGVyIGNvbnZlcnNhdGlvbiBcdTIwMTQgbWlycm9ycyBNQVhfQ0hBVF9BVFRBQ0hNRU5UU19QRVJfQ09OVkVSU0FUSU9OLiAqL1xuZXhwb3J0IGNvbnN0IEFUVEFDSE1FTlRfTUFYX1BFUl9DT05WRVJTQVRJT04gPSA1O1xuXG4vKiogVGV4dCBrZXkgb2YgdGhlIG1lc3NhZ2Ugc2hvd24gd2hlbiBhIHBpY2sgaXMgcmVqZWN0ZWQuICovXG5leHBvcnQgdHlwZSBBdHRhY2htZW50UmVqZWN0aW9uID1cbiAgfCBcImZpbGVfdHlwZV91bnN1cHBvcnRlZFwiXG4gIHwgXCJmaWxlX3Rvb19sYXJnZVwiXG4gIHwgXCJmaWxlX2xpbWl0X3JlYWNoZWRcIjtcblxuLyoqXG4gKiBQcmUtZmxpZ2h0IGNoZWNrIGZvciBvbmUgcGlja2VkIGZpbGUuIGB1cGxvYWRlZENvdW50YCBjb3VudHMgZXZlcnlcbiAqIHVwbG9hZCBhbHJlYWR5IG1hZGUgdGhpcyBjb252ZXJzYXRpb24gKHNlbnQgb3IgcGVuZGluZykuIFJldHVybnMgdGhlXG4gKiB0ZXh0IGtleSBvZiB0aGUgcmVqZWN0aW9uLCBvciBgbnVsbGAgd2hlbiB0aGUgcGljayBtYXkgYmUgdXBsb2FkZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUF0dGFjaG1lbnQoXG4gIGZpbGU6IHsgdHlwZTogc3RyaW5nOyBzaXplOiBudW1iZXIgfSxcbiAgdXBsb2FkZWRDb3VudDogbnVtYmVyLFxuKTogQXR0YWNobWVudFJlamVjdGlvbiB8IG51bGwge1xuICBpZiAodXBsb2FkZWRDb3VudCA+PSBBVFRBQ0hNRU5UX01BWF9QRVJfQ09OVkVSU0FUSU9OKSByZXR1cm4gXCJmaWxlX2xpbWl0X3JlYWNoZWRcIjtcbiAgaWYgKCEoQVRUQUNITUVOVF9BTExPV0VEX1RZUEVTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyhmaWxlLnR5cGUpKSB7XG4gICAgcmV0dXJuIFwiZmlsZV90eXBlX3Vuc3VwcG9ydGVkXCI7XG4gIH1cbiAgaWYgKGZpbGUuc2l6ZSA+IEFUVEFDSE1FTlRfTUFYX1NJWkVfQllURVMpIHJldHVybiBcImZpbGVfdG9vX2xhcmdlXCI7XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogYGFjY2VwdGAgYXR0cmlidXRlIHZhbHVlIGZvciB0aGUgaGlkZGVuIGZpbGUgaW5wdXQuICovXG5leHBvcnQgZnVuY3Rpb24gYXR0YWNobWVudEFjY2VwdEF0dHJpYnV0ZSgpOiBzdHJpbmcge1xuICByZXR1cm4gQVRUQUNITUVOVF9BTExPV0VEX1RZUEVTLmpvaW4oXCIsXCIpO1xufVxuIiwgIi8vIE1hcmtkb3duIGxpbmsgcG9saWN5IFx1MjAxNCBtaXJyb3JzIHRoZSBiYWNrZW5kLXZhbGlkYXRlZCB3aWRnZXQgY29uZmlnIHJ1bGVzLlxuLy9cbi8vIENvbnRyYWN0IChiYWNrZW5kLWF1dGhvcml0YXRpdmUsIGVuZm9yY2VkIGFnYWluIGhlcmUgYXQgcmVuZGVyIHRpbWUpOlxuLy8gICAqIGBqYXZhc2NyaXB0OmAgKGFuZCBldmVyeSBub24taHR0cChzKSBzY2hlbWUpIGlzIEFMV0FZUyBibG9ja2VkLlxuLy8gICAqIGBodHRwOmAgaXMgYWxsb3dlZCBvbmx5IHdoZW4gYGFsbG93X2h0dHBgIGlzIG9uIChkZWZhdWx0IGh0dHBzLW9ubHkpLlxuLy8gICAqIGBhbGxvd19hbGxgIHBlcm1pdHMgYW55IGhvc3QgKHNjaGVtZSBydWxlcyBzdGlsbCBhcHBseSkuXG4vLyAgICogT3RoZXJ3aXNlIHRoZSBVUkwncyBob3N0bmFtZSBtdXN0IG1hdGNoIGFuIGFsbG93bGlzdCBlbnRyeS4gRW50cmllcyBhcmVcbi8vICAgICBob3N0bmFtZXMgd2l0aCBhbiBvcHRpb25hbCBgOnBvcnRgLiBBbiBlbnRyeSB3aXRob3V0IGEgcG9ydCBtYXRjaGVzIGFueVxuLy8gICAgIHBvcnQ7IGFuIGVudHJ5IHdpdGggYSBwb3J0IHJlcXVpcmVzIHRoYXQgZXhhY3QgcG9ydC5cbi8vICAgKiBgaW5jbHVkZV93d3dfdmFyaWFudHNgIG1ha2VzIGBleGFtcGxlLmNvbWAgXHUyMUM0IGB3d3cuZXhhbXBsZS5jb21gXG4vLyAgICAgaW50ZXJjaGFuZ2VhYmxlIGluIGJvdGggZGlyZWN0aW9ucy5cblxuZXhwb3J0IGludGVyZmFjZSBMaW5rUG9saWN5IHtcbiAgYWxsb3dfYWxsOiBib29sZWFuO1xuICBhbGxvd2VkX2hvc3RzOiBzdHJpbmdbXTtcbiAgaW5jbHVkZV93d3dfdmFyaWFudHM6IGJvb2xlYW47XG4gIGFsbG93X2h0dHA6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xJTktfUE9MSUNZOiBMaW5rUG9saWN5ID0ge1xuICBhbGxvd19hbGw6IGZhbHNlLFxuICBhbGxvd2VkX2hvc3RzOiBbXSxcbiAgaW5jbHVkZV93d3dfdmFyaWFudHM6IHRydWUsXG4gIGFsbG93X2h0dHA6IGZhbHNlLFxufTtcblxuZnVuY3Rpb24gc3BsaXRIb3N0UG9ydChlbnRyeTogc3RyaW5nKTogeyBob3N0OiBzdHJpbmc7IHBvcnQ6IHN0cmluZyB8IG51bGwgfSB7XG4gIGNvbnN0IGlkeCA9IGVudHJ5Lmxhc3RJbmRleE9mKFwiOlwiKTtcbiAgLy8gQSBsb25lIGNvbG9uIG9yIElQdjYtc3R5bGUgZW50cmllcyBhcmUgbm90IHN1cHBvcnRlZCBieSB0aGUgYmFja2VuZFxuICAvLyBob3N0bmFtZSBydWxlLCBzbyBhIHNpbXBsZSBzcGxpdCBpcyBzdWZmaWNpZW50IGhlcmUuXG4gIGlmIChpZHggPiAwICYmIC9eXFxkKyQvLnRlc3QoZW50cnkuc2xpY2UoaWR4ICsgMSkpKSB7XG4gICAgcmV0dXJuIHsgaG9zdDogZW50cnkuc2xpY2UoMCwgaWR4KS50b0xvd2VyQ2FzZSgpLCBwb3J0OiBlbnRyeS5zbGljZShpZHggKyAxKSB9O1xuICB9XG4gIHJldHVybiB7IGhvc3Q6IGVudHJ5LnRvTG93ZXJDYXNlKCksIHBvcnQ6IG51bGwgfTtcbn1cblxuZnVuY3Rpb24gaG9zdE1hdGNoZXMoXG4gIHVybEhvc3Q6IHN0cmluZyxcbiAgZW50cnlIb3N0OiBzdHJpbmcsXG4gIGluY2x1ZGVXd3c6IGJvb2xlYW4sXG4pOiBib29sZWFuIHtcbiAgaWYgKHVybEhvc3QgPT09IGVudHJ5SG9zdCkgcmV0dXJuIHRydWU7XG4gIGlmICghaW5jbHVkZVd3dykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzdHJpcCA9IChoOiBzdHJpbmcpID0+IChoLnN0YXJ0c1dpdGgoXCJ3d3cuXCIpID8gaC5zbGljZSg0KSA6IGgpO1xuICByZXR1cm4gc3RyaXAodXJsSG9zdCkgPT09IHN0cmlwKGVudHJ5SG9zdCk7XG59XG5cbi8qKlxuICogRGVjaWRlIHdoZXRoZXIgYSBtYXJrZG93biBsaW5rIG1heSByZW5kZXIgYXMgYSBjbGlja2FibGUgYW5jaG9yLlxuICogRGlzYWxsb3dlZCBsaW5rcyBhcmUgcmVuZGVyZWQgYXMgcGxhaW4gdGV4dCBieSB0aGUgbWFya2Rvd24gcmVuZGVyZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpbmtBbGxvd2VkKGhyZWY6IHN0cmluZywgcG9saWN5OiBMaW5rUG9saWN5KTogYm9vbGVhbiB7XG4gIGxldCB1cmw6IFVSTDtcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKGhyZWYpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7IC8vIHJlbGF0aXZlL21hbGZvcm1lZCBVUkxzIG5ldmVyIHJlbmRlciBhcyBsaW5rc1xuICB9XG4gIGNvbnN0IHNjaGVtZSA9IHVybC5wcm90b2NvbDtcbiAgaWYgKHNjaGVtZSA9PT0gXCJqYXZhc2NyaXB0OlwiKSByZXR1cm4gZmFsc2U7IC8vIGV4cGxpY2l0LCBiZWx0IGFuZCBicmFjZXNcbiAgaWYgKHNjaGVtZSAhPT0gXCJodHRwczpcIiAmJiBzY2hlbWUgIT09IFwiaHR0cDpcIikgcmV0dXJuIGZhbHNlO1xuICBpZiAoc2NoZW1lID09PSBcImh0dHA6XCIgJiYgIXBvbGljeS5hbGxvd19odHRwKSByZXR1cm4gZmFsc2U7XG4gIGlmIChwb2xpY3kuYWxsb3dfYWxsKSByZXR1cm4gdHJ1ZTtcblxuICBjb25zdCB1cmxIb3N0ID0gdXJsLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHVybFBvcnQgPSB1cmwucG9ydDsgLy8gXCJcIiB3aGVuIGRlZmF1bHQgZm9yIHRoZSBzY2hlbWVcbiAgZm9yIChjb25zdCByYXcgb2YgcG9saWN5LmFsbG93ZWRfaG9zdHMpIHtcbiAgICBjb25zdCBlbnRyeSA9IHJhdy50cmltKCk7XG4gICAgaWYgKCFlbnRyeSkgY29udGludWU7XG4gICAgY29uc3QgeyBob3N0LCBwb3J0IH0gPSBzcGxpdEhvc3RQb3J0KGVudHJ5KTtcbiAgICBpZiAoIWhvc3RNYXRjaGVzKHVybEhvc3QsIGhvc3QsIHBvbGljeS5pbmNsdWRlX3d3d192YXJpYW50cykpIGNvbnRpbnVlO1xuICAgIGlmIChwb3J0ID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBlZmZlY3RpdmVQb3J0ID0gdXJsUG9ydCB8fCAoc2NoZW1lID09PSBcImh0dHBzOlwiID8gXCI0NDNcIiA6IFwiODBcIik7XG4gICAgaWYgKGVmZmVjdGl2ZVBvcnQgPT09IHBvcnQpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvLyBXaWRnZXQgcnVudGltZSBjb25maWcgXHUyMDE0IHRoZSBzaGFwZSBzZXJ2ZWQgYnkgdGhlIFBVQkxJQyBjb25maWcgZW5kcG9pbnRcbi8vIChgR0VUIHtvcmlnaW59L2FwaS93aWRnZXQve3B1YmxpY19pZH0vY29uZmlnYCwgcnVudGltZS1zYWZlIGZpZWxkcyBvbmx5KVxuLy8gcGx1cyBkZWZhdWx0cyBhbmQgdGhlIENTUyBjdXN0b20tcHJvcGVydHkgcHJvamVjdGlvbi5cbi8vXG4vLyBCYWNrZW5kIHZhbGlkYXRpb24gaXMgYXV0aG9yaXRhdGl2ZSAodm9zb3B1bHNlLWFwaSB3aWRnZXQgcm91dGVzKTsgdGhlXG4vLyBkZWZhdWx0cyBoZXJlIG9ubHkgZmlsbCBnYXBzIHNvIGEgcGFydGlhbCBjb25maWcgc3RpbGwgcmVuZGVycy5cblxuaW1wb3J0IHR5cGUgeyBMaW5rUG9saWN5IH0gZnJvbSBcIi4vbGluay1wb2xpY3lcIjtcbmltcG9ydCB7IERFRkFVTFRfTElOS19QT0xJQ1kgfSBmcm9tIFwiLi9saW5rLXBvbGljeVwiO1xuaW1wb3J0IHR5cGUgeyBXaWRnZXRUZXh0S2V5IH0gZnJvbSBcIi4vdGV4dC1kZWZhdWx0c1wiO1xuXG5leHBvcnQgdHlwZSBXaWRnZXRWYXJpYW50ID0gXCJ0aW55XCIgfCBcImNvbXBhY3RcIiB8IFwiZnVsbFwiO1xuZXhwb3J0IHR5cGUgV2lkZ2V0UGxhY2VtZW50ID1cbiAgfCBcInRvcC1sZWZ0XCJcbiAgfCBcInRvcFwiXG4gIHwgXCJ0b3AtcmlnaHRcIlxuICB8IFwiYm90dG9tLWxlZnRcIlxuICB8IFwiYm90dG9tXCJcbiAgfCBcImJvdHRvbS1yaWdodFwiO1xuZXhwb3J0IHR5cGUgRXhwYW5kZWRCZWhhdmlvciA9XG4gIHwgXCJzdGFydHNfY29sbGFwc2VkXCJcbiAgfCBcInN0YXJ0c19leHBhbmRlZFwiXG4gIHwgXCJhbHdheXNfZXhwYW5kZWRcIjtcbmV4cG9ydCB0eXBlIFN5bnRheFRoZW1lID0gXCJhdXRvXCIgfCBcImxpZ2h0XCIgfCBcImRhcmtcIjtcblxuZXhwb3J0IHR5cGUgV2lkZ2V0QXZhdGFyID1cbiAgfCB7IGtpbmQ6IFwib3JiXCI7IGNvbG9yXzE6IHN0cmluZzsgY29sb3JfMjogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6IFwidXJsXCI7IHVybDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6IFwiaW1hZ2VcIjsgdXJsOiBzdHJpbmcgfTtcblxuZXhwb3J0IGludGVyZmFjZSBXaWRnZXRDb2xvcnMge1xuICBiYXNlOiBzdHJpbmc7XG4gIGJhc2VfaG92ZXI6IHN0cmluZztcbiAgYmFzZV9hY3RpdmU6IHN0cmluZztcbiAgYmFzZV9ib3JkZXI6IHN0cmluZztcbiAgYmFzZV9zdWJ0bGU6IHN0cmluZztcbiAgYmFzZV9wcmltYXJ5OiBzdHJpbmc7XG4gIGJhc2VfZXJyb3I6IHN0cmluZztcbiAgYWNjZW50OiBzdHJpbmc7XG4gIGFjY2VudF9ob3Zlcjogc3RyaW5nO1xuICBhY2NlbnRfYWN0aXZlOiBzdHJpbmc7XG4gIGFjY2VudF9ib3JkZXI6IHN0cmluZztcbiAgYWNjZW50X3N1YnRsZTogc3RyaW5nO1xuICBhY2NlbnRfcHJpbWFyeTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdpZGdldFJhZGlpIHtcbiAgb3ZlcmxheV9wYWRkaW5nOiBudW1iZXI7XG4gIGJ1dHRvbl9yYWRpdXM6IG51bWJlcjtcbiAgaW5wdXRfcmFkaXVzOiBudW1iZXI7XG4gIGJ1YmJsZV9yYWRpdXM6IG51bWJlcjtcbiAgc2hlZXRfcmFkaXVzOiBudW1iZXI7XG4gIGNvbXBhY3Rfc2hlZXRfcmFkaXVzOiBudW1iZXI7XG4gIGRyb3Bkb3duX3NoZWV0X3JhZGl1czogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdpZGdldFRlcm1zIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgLyoqIE1hcmtkb3duIGJvZHkgc2hvd24gaW4gdGhlIGdhdGUuICovXG4gIGNvbnRlbnQ6IHN0cmluZztcbiAgLyoqIFdoZW4gbm9uLWVtcHR5LCBhY2NlcHRpbmcgc3RvcmVzIHRoaXMgbG9jYWxTdG9yYWdlIGtleSBhbmQgZnV0dXJlXG4gICAqICB2aXNpdHMgc2tpcCB0aGUgcHJvbXB0LiAqL1xuICBsb2NhbF9zdG9yYWdlX2tleTogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdpZGdldEZlYXR1cmVUb2dnbGVzIHtcbiAgLyoqIFN0b3JhZ2UgZm9ybSBvZiB0aGUgc2luZ2xlIFwiQ2hhdCAodGV4dC1vbmx5KSBtb2RlXCIgdG9nZ2xlOlxuICAgKiAgYHZvaWNlX2VuYWJsZWQgPSAhdGV4dF9vbmx5YC4gVGV4dC1vbmx5IE9GRiAoZGVmYXVsdCkgPSB2b2ljZSBBTkRcbiAgICogIGNoYXQgYm90aCBhdmFpbGFibGU7IE9OID0gY2hhdCBvbmx5LiAqL1xuICB2b2ljZV9lbmFibGVkOiBib29sZWFuO1xuICAvKiogTEVHQUNZIFx1MjAxNCBhY2NlcHRlZCBmcm9tIHN0b3JlZCBjb25maWdzIGJ1dCBmb3JjZWQgYHRydWVgIGJ5XG4gICAqICBgbWVyZ2VDb25maWdgOiBjaGF0IGlzIGFsd2F5cyBhdmFpbGFibGUgKG5vIGNoYXQtb2ZmIG1vZGUgaW4gdGhlXG4gICAqICBzaW5nbGUtdG9nZ2xlIG1vZGVsKS4gKi9cbiAgdGV4dF9lbmFibGVkOiBib29sZWFuO1xuICAvKiogU2hvdyB0aGUgY29tcG9zZXIgZHVyaW5nIGEgbGl2ZSBjYWxsOyB0eXBlZCB0ZXh0IGJlY29tZXMgYSByZWFsXG4gICAqICB1c2VyIHR1cm4gKFJUVkkgc2VuZC10ZXh0KS4gKi9cbiAgc2VuZF90ZXh0X3doaWxlX29uX2NhbGw6IGJvb2xlYW47XG4gIHRyYW5zY3JpcHRfZW5hYmxlZDogYm9vbGVhbjtcbiAgbGFuZ3VhZ2VfZHJvcGRvd25fZW5hYmxlZDogYm9vbGVhbjtcbiAgbXV0ZV9idXR0b25fZW5hYmxlZDogYm9vbGVhbjtcbiAgc2hvd19jb252ZXJzYXRpb25faWQ6IGJvb2xlYW47XG4gIGhpZGVfYXVkaW9fdGFnczogYm9vbGVhbjtcbiAgYWN0aW9uX2luZGljYXRvcl9lbmFibGVkOiBib29sZWFuO1xuICByZXNpemVfYnV0dG9uX2VuYWJsZWQ6IGJvb2xlYW47XG4gIGZlZWRiYWNrX2VuYWJsZWQ6IGJvb2xlYW47XG4gIC8qKiBFbGVtZW50LW9ubHkgZGlzcGxheSBmbGFncyAoRTQgUTkpIFx1MjAxNCBzZXQgYnkgdGhlIGBzaG93LSpgIGF0dHJpYnV0ZXMsXG4gICAqICBuZXZlciBieSB0aGUgc2VydmVyIGNvbmZpZzsgdGhlIGRlZmF1bHRzIGFyZSB0b2RheSdzIHJlbmRlcmluZy4gKi9cbiAgc2hvd19hZ2VudF9zdGF0dXM6IGJvb2xlYW47XG4gIHNob3dfbGFuZ3VhZ2Vfc2VsZWN0b3Jfb25fdHJpZ2dlcjogYm9vbGVhbjtcbiAgc2hvd19hdmF0YXJfd2hlbl9jb2xsYXBzZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2lkZ2V0UnVudGltZUNvbmZpZyBleHRlbmRzIFdpZGdldEZlYXR1cmVUb2dnbGVzIHtcbiAgYWdlbnRfbmFtZTogc3RyaW5nO1xuICB2YXJpYW50OiBXaWRnZXRWYXJpYW50O1xuICBwbGFjZW1lbnQ6IFdpZGdldFBsYWNlbWVudDtcbiAgZXhwYW5kZWRfYmVoYXZpb3I6IEV4cGFuZGVkQmVoYXZpb3I7XG4gIGNvbGxhcHNpYmxlOiBib29sZWFuO1xuICBzeW50YXhfdGhlbWU6IFN5bnRheFRoZW1lO1xuICBhdmF0YXI6IFdpZGdldEF2YXRhcjtcbiAgY29sb3JzOiBXaWRnZXRDb2xvcnM7XG4gIHJhZGlpOiBXaWRnZXRSYWRpaTtcbiAgdGVybXM6IFdpZGdldFRlcm1zO1xuICBsaW5rX3BvbGljeTogTGlua1BvbGljeTtcbiAgLyoqIEJDUC00Ny1pc2ggbGFuZ3VhZ2UgY29kZXMgdGhlIGFnZW50IHN1cHBvcnRzOyBmaXJzdCBlbnRyeSBpcyBkZWZhdWx0LiAqL1xuICBsYW5ndWFnZXM6IHN0cmluZ1tdO1xuICB0ZXh0OiBQYXJ0aWFsPFJlY29yZDxXaWRnZXRUZXh0S2V5LCBzdHJpbmc+Pjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfQ09MT1JTOiBXaWRnZXRDb2xvcnMgPSB7XG4gIGJhc2U6IFwiI2ZmZmZmZlwiLFxuICBiYXNlX2hvdmVyOiBcIiNmOWZhZmJcIixcbiAgYmFzZV9hY3RpdmU6IFwiI2YzZjRmNlwiLFxuICBiYXNlX2JvcmRlcjogXCIjZTVlN2ViXCIsXG4gIGJhc2Vfc3VidGxlOiBcIiM2YjcyODBcIixcbiAgYmFzZV9wcmltYXJ5OiBcIiMwMDAwMDBcIixcbiAgYmFzZV9lcnJvcjogXCIjZWY0NDQ0XCIsXG4gIGFjY2VudDogXCIjMDAwMDAwXCIsXG4gIGFjY2VudF9ob3ZlcjogXCIjMWYyOTM3XCIsXG4gIGFjY2VudF9hY3RpdmU6IFwiIzM3NDE1MVwiLFxuICBhY2NlbnRfYm9yZGVyOiBcIiM0YjU1NjNcIixcbiAgYWNjZW50X3N1YnRsZTogXCIjNmI3MjgwXCIsXG4gIGFjY2VudF9wcmltYXJ5OiBcIiNmZmZmZmZcIixcbn07XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JBRElJOiBXaWRnZXRSYWRpaSA9IHtcbiAgb3ZlcmxheV9wYWRkaW5nOiAzMixcbiAgYnV0dG9uX3JhZGl1czogMTgsXG4gIGlucHV0X3JhZGl1czogMTgsXG4gIGJ1YmJsZV9yYWRpdXM6IDE1LFxuICBzaGVldF9yYWRpdXM6IDI0LFxuICBjb21wYWN0X3NoZWV0X3JhZGl1czogMzAsXG4gIGRyb3Bkb3duX3NoZWV0X3JhZGl1czogMjQsXG59O1xuXG5leHBvcnQgY29uc3QgREVGQVVMVF9DT05GSUc6IFdpZGdldFJ1bnRpbWVDb25maWcgPSB7XG4gIGFnZW50X25hbWU6IFwiQUkgQWdlbnRcIixcbiAgdmFyaWFudDogXCJjb21wYWN0XCIsXG4gIHBsYWNlbWVudDogXCJib3R0b20tcmlnaHRcIixcbiAgZXhwYW5kZWRfYmVoYXZpb3I6IFwic3RhcnRzX2NvbGxhcHNlZFwiLFxuICBjb2xsYXBzaWJsZTogdHJ1ZSxcbiAgc3ludGF4X3RoZW1lOiBcImF1dG9cIixcbiAgYXZhdGFyOiB7IGtpbmQ6IFwib3JiXCIsIGNvbG9yXzE6IFwiIzc5NTlmZlwiLCBjb2xvcl8yOiBcIiM5YjdhZmZcIiB9LFxuICBjb2xvcnM6IERFRkFVTFRfQ09MT1JTLFxuICByYWRpaTogREVGQVVMVF9SQURJSSxcbiAgdGVybXM6IHsgZW5hYmxlZDogZmFsc2UsIGNvbnRlbnQ6IFwiXCIsIGxvY2FsX3N0b3JhZ2Vfa2V5OiBcIlwiIH0sXG4gIGxpbmtfcG9saWN5OiBERUZBVUxUX0xJTktfUE9MSUNZLFxuICBsYW5ndWFnZXM6IFtdLFxuICB0ZXh0OiB7fSxcbiAgdm9pY2VfZW5hYmxlZDogdHJ1ZSxcbiAgdGV4dF9lbmFibGVkOiB0cnVlLFxuICBzZW5kX3RleHRfd2hpbGVfb25fY2FsbDogdHJ1ZSxcbiAgdHJhbnNjcmlwdF9lbmFibGVkOiB0cnVlLFxuICBsYW5ndWFnZV9kcm9wZG93bl9lbmFibGVkOiB0cnVlLFxuICBtdXRlX2J1dHRvbl9lbmFibGVkOiB0cnVlLFxuICBzaG93X2NvbnZlcnNhdGlvbl9pZDogdHJ1ZSxcbiAgaGlkZV9hdWRpb190YWdzOiBmYWxzZSxcbiAgYWN0aW9uX2luZGljYXRvcl9lbmFibGVkOiB0cnVlLFxuICByZXNpemVfYnV0dG9uX2VuYWJsZWQ6IHRydWUsXG4gIGZlZWRiYWNrX2VuYWJsZWQ6IHRydWUsXG4gIHNob3dfYWdlbnRfc3RhdHVzOiB0cnVlLFxuICBzaG93X2xhbmd1YWdlX3NlbGVjdG9yX29uX3RyaWdnZXI6IGZhbHNlLFxuICBzaG93X2F2YXRhcl93aGVuX2NvbGxhcHNlZDogdHJ1ZSxcbn07XG5cbi8qKiBEZWVwLW1lcmdlIGEgc2VydmVyIGNvbmZpZyBvdmVyIHRoZSBkZWZhdWx0cyAoYXJyYXlzL29iamVjdHMgcmVwbGFjZWQsXG4gKiAgbmVzdGVkIGtub3duIG9iamVjdHMgbWVyZ2VkIGtleS13aXNlKS4gVG9sZXJhdGVzIG1pc3NpbmcgZmllbGRzLlxuICpcbiAqICBTaW5nbGUtdG9nZ2xlIHNlbWFudGljczogY2hhdCBpcyBBTFdBWVMgYXZhaWxhYmxlIChgdGV4dF9lbmFibGVkYCBpc1xuICogIGZvcmNlZCBgdHJ1ZWAsIHdoYXRldmVyIGEgc3RvcmVkIGNvbmZpZyBjYXJyaWVzKSwgYW5kIHZvaWNlXG4gKiAgYXZhaWxhYmlsaXR5IGlzIGV4YWN0bHkgYHZvaWNlX2VuYWJsZWRgICg9ICF0ZXh0LW9ubHkpLiBBIGxlZ2FjeVxuICogIGNvbmZpZyB0aGF0IGV4cGxpY2l0bHkgZGlzYWJsZWQgdm9pY2UgdGhlcmVmb3JlIGJlaGF2ZXMgYXNcbiAqICB0ZXh0LW9ubHkgT04uICovXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VDb25maWcoXG4gIHBhcnRpYWw6IFBhcnRpYWw8V2lkZ2V0UnVudGltZUNvbmZpZz4gfCB1bmRlZmluZWQsXG4pOiBXaWRnZXRSdW50aW1lQ29uZmlnIHtcbiAgaWYgKCFwYXJ0aWFsKSByZXR1cm4gREVGQVVMVF9DT05GSUc7XG4gIHJldHVybiB7XG4gICAgLi4uREVGQVVMVF9DT05GSUcsXG4gICAgLi4ucGFydGlhbCxcbiAgICB0ZXh0X2VuYWJsZWQ6IHRydWUsXG4gICAgYXZhdGFyOiBwYXJ0aWFsLmF2YXRhciA/PyBERUZBVUxUX0NPTkZJRy5hdmF0YXIsXG4gICAgY29sb3JzOiB7IC4uLkRFRkFVTFRfQ09MT1JTLCAuLi4ocGFydGlhbC5jb2xvcnMgPz8ge30pIH0sXG4gICAgcmFkaWk6IHsgLi4uREVGQVVMVF9SQURJSSwgLi4uKHBhcnRpYWwucmFkaWkgPz8ge30pIH0sXG4gICAgdGVybXM6IHsgLi4uREVGQVVMVF9DT05GSUcudGVybXMsIC4uLihwYXJ0aWFsLnRlcm1zID8/IHt9KSB9LFxuICAgIGxpbmtfcG9saWN5OiB7IC4uLkRFRkFVTFRfTElOS19QT0xJQ1ksIC4uLihwYXJ0aWFsLmxpbmtfcG9saWN5ID8/IHt9KSB9LFxuICAgIGxhbmd1YWdlczogcGFydGlhbC5sYW5ndWFnZXMgPz8gW10sXG4gICAgdGV4dDogcGFydGlhbC50ZXh0ID8/IHt9LFxuICB9O1xufVxuXG4vKipcbiAqIFByb2plY3QgY29uZmlnIG9udG8gdGhlIHNoYWRvdy1yb290IENTUyBjdXN0b20gcHJvcGVydGllcy5cbiAqIEV2ZXJ5IHZpc3VhbCBrbm9iIHRoZSB3aWRnZXQgdXNlcyBmbG93cyB0aHJvdWdoIHRoZXNlIHZhcmlhYmxlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ3NzVmFycyhjZmc6IFdpZGdldFJ1bnRpbWVDb25maWcpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3QgYyA9IGNmZy5jb2xvcnM7XG4gIGNvbnN0IHIgPSBjZmcucmFkaWk7XG4gIHJldHVybiB7XG4gICAgXCItLXZ3LWJhc2VcIjogYy5iYXNlLFxuICAgIFwiLS12dy1iYXNlLWhvdmVyXCI6IGMuYmFzZV9ob3ZlcixcbiAgICBcIi0tdnctYmFzZS1hY3RpdmVcIjogYy5iYXNlX2FjdGl2ZSxcbiAgICBcIi0tdnctYmFzZS1ib3JkZXJcIjogYy5iYXNlX2JvcmRlcixcbiAgICBcIi0tdnctYmFzZS1zdWJ0bGVcIjogYy5iYXNlX3N1YnRsZSxcbiAgICBcIi0tdnctYmFzZS1wcmltYXJ5XCI6IGMuYmFzZV9wcmltYXJ5LFxuICAgIFwiLS12dy1iYXNlLWVycm9yXCI6IGMuYmFzZV9lcnJvcixcbiAgICBcIi0tdnctYWNjZW50XCI6IGMuYWNjZW50LFxuICAgIFwiLS12dy1hY2NlbnQtaG92ZXJcIjogYy5hY2NlbnRfaG92ZXIsXG4gICAgXCItLXZ3LWFjY2VudC1hY3RpdmVcIjogYy5hY2NlbnRfYWN0aXZlLFxuICAgIFwiLS12dy1hY2NlbnQtYm9yZGVyXCI6IGMuYWNjZW50X2JvcmRlcixcbiAgICBcIi0tdnctYWNjZW50LXN1YnRsZVwiOiBjLmFjY2VudF9zdWJ0bGUsXG4gICAgXCItLXZ3LWFjY2VudC1wcmltYXJ5XCI6IGMuYWNjZW50X3ByaW1hcnksXG4gICAgXCItLXZ3LW92ZXJsYXktcGFkZGluZ1wiOiBgJHtyLm92ZXJsYXlfcGFkZGluZ31weGAsXG4gICAgXCItLXZ3LWJ1dHRvbi1yYWRpdXNcIjogYCR7ci5idXR0b25fcmFkaXVzfXB4YCxcbiAgICBcIi0tdnctaW5wdXQtcmFkaXVzXCI6IGAke3IuaW5wdXRfcmFkaXVzfXB4YCxcbiAgICBcIi0tdnctYnViYmxlLXJhZGl1c1wiOiBgJHtyLmJ1YmJsZV9yYWRpdXN9cHhgLFxuICAgIFwiLS12dy1zaGVldC1yYWRpdXNcIjogYCR7ci5zaGVldF9yYWRpdXN9cHhgLFxuICAgIFwiLS12dy1jb21wYWN0LXNoZWV0LXJhZGl1c1wiOiBgJHtyLmNvbXBhY3Rfc2hlZXRfcmFkaXVzfXB4YCxcbiAgICBcIi0tdnctZHJvcGRvd24tc2hlZXQtcmFkaXVzXCI6IGAke3IuZHJvcGRvd25fc2hlZXRfcmFkaXVzfXB4YCxcbiAgfTtcbn1cbiIsICIvLyBJbmxpbmUgU1ZHIGljb24gc3RyaW5ncyAoc3Ryb2tlID0gY3VycmVudENvbG9yLCAyNFx1MDBENzI0IHZpZXdCb3gpLlxuLy8gU291cmNlZC1zaGFwZS1jb21wYXRpYmxlIHdpdGggbHVjaWRlOyBpbmxpbmVkIHNvIHRoZSBidW5kbGUgc3RheXNcbi8vIGRlcGVuZGVuY3ktZnJlZS5cblxuY29uc3Qgc3ZnID0gKGJvZHk6IHN0cmluZywgc2l6ZSA9IDE2KTogc3RyaW5nID0+XG4gIGA8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB3aWR0aD1cIiR7c2l6ZX1cIiBoZWlnaHQ9XCIke3NpemV9XCIgdmlld0JveD1cIjAgMCAyNCAyNFwiIGZpbGw9XCJub25lXCIgc3Ryb2tlPVwiY3VycmVudENvbG9yXCIgc3Ryb2tlLXdpZHRoPVwiMlwiIHN0cm9rZS1saW5lY2FwPVwicm91bmRcIiBzdHJva2UtbGluZWpvaW49XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPiR7Ym9keX08L3N2Zz5gO1xuXG5leHBvcnQgY29uc3QgSUNPTlMgPSB7XG4gIHBob25lOiBzdmcoXG4gICAgJzxwYXRoIGQ9XCJNMjIgMTYuOTJ2M2EyIDIgMCAwIDEtMi4xOCAyIDE5Ljc5IDE5Ljc5IDAgMCAxLTguNjMtMy4wNyAxOS41IDE5LjUgMCAwIDEtNi02IDE5Ljc5IDE5Ljc5IDAgMCAxLTMuMDctOC42N0EyIDIgMCAwIDEgNC4xMSAyaDNhMiAyIDAgMCAxIDIgMS43MiAxMi44NCAxMi44NCAwIDAgMCAuNyAyLjgxIDIgMiAwIDAgMS0uNDUgMi4xMUw4LjA5IDkuOTFhMTYgMTYgMCAwIDAgNiA2bDEuMjctMS4yN2EyIDIgMCAwIDEgMi4xMS0uNDUgMTIuODQgMTIuODQgMCAwIDAgMi44MS43QTIgMiAwIDAgMSAyMiAxNi45MnpcIi8+JyxcbiAgKSxcbiAgcGhvbmVPZmY6IHN2ZyhcbiAgICAnPHBhdGggZD1cIk0xMC42OCAxMy4zMWExNiAxNiAwIDAgMCAzLjQxIDIuNmwxLjI3LTEuMjdhMiAyIDAgMCAxIDIuMTEtLjQ1IDEyLjg0IDEyLjg0IDAgMCAwIDIuODEuNyAyIDIgMCAwIDEgMS43MiAydjNhMiAyIDAgMCAxLTIuMTggMiAxOS43OSAxOS43OSAwIDAgMS04LjYzLTMuMDcgMTkuNDIgMTkuNDIgMCAwIDEtMy4zMy0yLjY3bS0yLjY3LTMuMzRhMTkuNzkgMTkuNzkgMCAwIDEtMy4wNy04LjYzQTIgMiAwIDAgMSA0LjExIDJoM2EyIDIgMCAwIDEgMiAxLjcyIDEyLjg0IDEyLjg0IDAgMCAwIC43IDIuODEgMiAyIDAgMCAxLS40NSAyLjExTDguMDkgOS45MVwiLz48bGluZSB4MT1cIjIyXCIgeDI9XCIyXCIgeTE9XCIyXCIgeTI9XCIyMlwiLz4nLFxuICApLFxuICBjaGF0OiBzdmcoJzxwYXRoIGQ9XCJNMjEgMTVhMiAyIDAgMCAxLTIgMkg3bC00IDRWNWEyIDIgMCAwIDEgMi0yaDE0YTIgMiAwIDAgMSAyIDJ6XCIvPicpLFxuICBzZW5kOiBzdmcoJzxwYXRoIGQ9XCJtMjIgMi03IDIwLTQtOS05LTRaXCIvPjxwYXRoIGQ9XCJNMjIgMiAxMSAxM1wiLz4nKSxcbiAgbWljOiBzdmcoXG4gICAgJzxwYXRoIGQ9XCJNMTIgMmEzIDMgMCAwIDAtMyAzdjdhMyAzIDAgMCAwIDYgMFY1YTMgMyAwIDAgMC0zLTNaXCIvPjxwYXRoIGQ9XCJNMTkgMTB2MmE3IDcgMCAwIDEtMTQgMHYtMlwiLz48bGluZSB4MT1cIjEyXCIgeDI9XCIxMlwiIHkxPVwiMTlcIiB5Mj1cIjIyXCIvPicsXG4gICksXG4gIG1pY09mZjogc3ZnKFxuICAgICc8bGluZSB4MT1cIjJcIiB4Mj1cIjIyXCIgeTE9XCIyXCIgeTI9XCIyMlwiLz48cGF0aCBkPVwiTTE4Ljg5IDEzLjIzQTcuMTIgNy4xMiAwIDAgMCAxOSAxMnYtMlwiLz48cGF0aCBkPVwiTTUgMTB2MmE3IDcgMCAwIDAgMTIgNVwiLz48cGF0aCBkPVwiTTE1IDkuMzRWNWEzIDMgMCAwIDAtNS42OC0xLjMzXCIvPjxwYXRoIGQ9XCJNOSA5djNhMyAzIDAgMCAwIDUuMTIgMi4xMlwiLz48bGluZSB4MT1cIjEyXCIgeDI9XCIxMlwiIHkxPVwiMTlcIiB5Mj1cIjIyXCIvPicsXG4gICksXG4gIHg6IHN2ZygnPHBhdGggZD1cIk0xOCA2IDYgMThcIi8+PHBhdGggZD1cIm02IDYgMTIgMTJcIi8+JyksXG4gIGNoZXZyb25Eb3duOiBzdmcoJzxwYXRoIGQ9XCJtNiA5IDYgNiA2LTZcIi8+JyksXG4gIGNoZXZyb25VcDogc3ZnKCc8cGF0aCBkPVwibTE4IDE1LTYtNi02IDZcIi8+JyksXG4gIGNvcHk6IHN2ZyhcbiAgICAnPHJlY3Qgd2lkdGg9XCIxNFwiIGhlaWdodD1cIjE0XCIgeD1cIjhcIiB5PVwiOFwiIHJ4PVwiMlwiIHJ5PVwiMlwiLz48cGF0aCBkPVwiTTQgMTZjLTEuMSAwLTItLjktMi0yVjRjMC0xLjEuOS0yIDItMmgxMGMxLjEgMCAyIC45IDIgMlwiLz4nLFxuICApLFxuICBjaGVjazogc3ZnKCc8cGF0aCBkPVwiTTIwIDYgOSAxN2wtNS01XCIvPicpLFxuICBkb3dubG9hZDogc3ZnKFxuICAgICc8cGF0aCBkPVwiTTIxIDE1djRhMiAyIDAgMCAxLTIgMkg1YTIgMiAwIDAgMS0yLTJ2LTRcIi8+PHBvbHlsaW5lIHBvaW50cz1cIjcgMTAgMTIgMTUgMTcgMTBcIi8+PGxpbmUgeDE9XCIxMlwiIHgyPVwiMTJcIiB5MT1cIjE1XCIgeTI9XCIzXCIvPicsXG4gICksXG4gIHdyYXA6IHN2ZygnPGxpbmUgeDE9XCIzXCIgeDI9XCIyMVwiIHkxPVwiNlwiIHkyPVwiNlwiLz48cGF0aCBkPVwiTTMgMTJoMTVhMyAzIDAgMSAxIDAgNmgtNFwiLz48cG9seWxpbmUgcG9pbnRzPVwiMTYgMTYgMTQgMTggMTYgMjBcIi8+PGxpbmUgeDE9XCIzXCIgeDI9XCIxMFwiIHkxPVwiMThcIiB5Mj1cIjE4XCIvPicpLFxuICBleHBhbmQ6IHN2ZyhcbiAgICAnPHBvbHlsaW5lIHBvaW50cz1cIjE1IDMgMjEgMyAyMSA5XCIvPjxwb2x5bGluZSBwb2ludHM9XCI5IDIxIDMgMjEgMyAxNVwiLz48bGluZSB4MT1cIjIxXCIgeDI9XCIxNFwiIHkxPVwiM1wiIHkyPVwiMTBcIi8+PGxpbmUgeDE9XCIzXCIgeDI9XCIxMFwiIHkxPVwiMjFcIiB5Mj1cIjE0XCIvPicsXG4gICksXG4gIHNocmluazogc3ZnKFxuICAgICc8cG9seWxpbmUgcG9pbnRzPVwiNCAxNCAxMCAxNCAxMCAyMFwiLz48cG9seWxpbmUgcG9pbnRzPVwiMjAgMTAgMTQgMTAgMTQgNFwiLz48bGluZSB4MT1cIjE0XCIgeDI9XCIyMVwiIHkxPVwiMTBcIiB5Mj1cIjNcIi8+PGxpbmUgeDE9XCIzXCIgeDI9XCIxMFwiIHkxPVwiMjFcIiB5Mj1cIjE0XCIvPicsXG4gICksXG4gIGxpbms6IHN2ZyhcbiAgICAnPHBhdGggZD1cIk0xMCAxM2E1IDUgMCAwIDAgNy41NC41NGwzLTNhNSA1IDAgMCAwLTcuMDctNy4wN2wtMS43MiAxLjcxXCIvPjxwYXRoIGQ9XCJNMTQgMTFhNSA1IDAgMCAwLTcuNTQtLjU0bC0zIDNhNSA1IDAgMCAwIDcuMDcgNy4wN2wxLjcxLTEuNzFcIi8+JyxcbiAgKSxcbiAgaW1hZ2U6IHN2ZyhcbiAgICAnPHJlY3Qgd2lkdGg9XCIxOFwiIGhlaWdodD1cIjE4XCIgeD1cIjNcIiB5PVwiM1wiIHJ4PVwiMlwiIHJ5PVwiMlwiLz48Y2lyY2xlIGN4PVwiOVwiIGN5PVwiOVwiIHI9XCIyXCIvPjxwYXRoIGQ9XCJtMjEgMTUtMy4wODYtMy4wODZhMiAyIDAgMCAwLTIuODI4IDBMNiAyMVwiLz4nLFxuICApLFxuICBnbG9iZTogc3ZnKFxuICAgICc8Y2lyY2xlIGN4PVwiMTJcIiBjeT1cIjEyXCIgcj1cIjEwXCIvPjxwYXRoIGQ9XCJNMTIgMmExNC41IDE0LjUgMCAwIDAgMCAyMCAxNC41IDE0LjUgMCAwIDAgMC0yMFwiLz48cGF0aCBkPVwiTTIgMTJoMjBcIi8+JyxcbiAgKSxcbiAgcGFwZXJjbGlwOiBzdmcoXG4gICAgJzxwYXRoIGQ9XCJtMjEuNDQgMTEuMDUtOS4xOSA5LjE5YTYgNiAwIDAgMS04LjQ5LTguNDlsOC41Ny04LjU3QTQgNCAwIDEgMSAxOCA4Ljg0bC04LjU5IDguNTdhMiAyIDAgMCAxLTIuODMtMi44M2w4LjQ5LTguNDhcIi8+JyxcbiAgKSxcbiAga2V5Ym9hcmQ6IHN2ZyhcbiAgICAnPHJlY3Qgd2lkdGg9XCIyMFwiIGhlaWdodD1cIjE2XCIgeD1cIjJcIiB5PVwiNFwiIHJ4PVwiMlwiIHJ5PVwiMlwiLz48cGF0aCBkPVwiTTYgOGguMDAxXCIvPjxwYXRoIGQ9XCJNMTAgOGguMDAxXCIvPjxwYXRoIGQ9XCJNMTQgOGguMDAxXCIvPjxwYXRoIGQ9XCJNMTggOGguMDAxXCIvPjxwYXRoIGQ9XCJNOCAxMmguMDAxXCIvPjxwYXRoIGQ9XCJNMTIgMTJoLjAwMVwiLz48cGF0aCBkPVwiTTE2IDEyaC4wMDFcIi8+PHBhdGggZD1cIk03IDE2aDEwXCIvPicsXG4gICksXG4gIHN0YXI6IHN2ZyhcbiAgICAnPHBvbHlnb24gcG9pbnRzPVwiMTIgMiAxNS4wOSA4LjI2IDIyIDkuMjcgMTcgMTQuMTQgMTguMTggMjEuMDIgMTIgMTcuNzcgNS44MiAyMS4wMiA3IDE0LjE0IDIgOS4yNyA4LjkxIDguMjYgMTIgMlwiLz4nLFxuICAgIDIwLFxuICApLFxuICBzcGlubmVyOlxuICAgICc8c3ZnIHhtbG5zPVwiaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmdcIiB3aWR0aD1cIjE0XCIgaGVpZ2h0PVwiMTRcIiB2aWV3Qm94PVwiMCAwIDI0IDI0XCIgZmlsbD1cIm5vbmVcIiBzdHJva2U9XCJjdXJyZW50Q29sb3JcIiBzdHJva2Utd2lkdGg9XCIyXCIgc3Ryb2tlLWxpbmVjYXA9XCJyb3VuZFwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiIGNsYXNzPVwidnctc3BpblwiPjxwYXRoIGQ9XCJNMjEgMTJhOSA5IDAgMSAxLTYuMjE5LTguNTZcIi8+PC9zdmc+Jyxcbn0gYXMgY29uc3Q7XG5cbmV4cG9ydCB0eXBlIEljb25OYW1lID0ga2V5b2YgdHlwZW9mIElDT05TO1xuIiwgIi8vIENhbnZhcyByZXBsaWNhIG9mIHRoZSBkYXNoYm9hcmQncyBWb3NvT3JiICh0aHJlZS5qcyB3aXJlZnJhbWVcbi8vIGljb3NhaGVkcm9uLCBzaW1wbGV4LW5vaXNlIHZlcnRleCBtb3JwaGluZywgc2xvdyBZIHJvdGF0aW9uIFx1MjAxNFxuLy8gZnJvbnRlbmQvc3JjL2NvbXBvbmVudHMvdmlzdWFsaXplcnMvdm9zby1vcmIudHN4KS4gVGhlIGVtYmVkIGJ1bmRsZSBpc1xuLy8gZGVwZW5kZW5jeS1mcmVlLCBzbyB0aGlzIHJlLWNyZWF0ZXMgdGhlIHNhbWUgbG9vayB3aXRoIDJEIGNhbnZhczogdGhlXG4vLyBTQU1FIGdlb21ldHJ5IGZhbWlseSBcdTIwMTQgYSBzdWJkaXZpZGVkIGljb3NhaGVkcm9uIChcImljb3NwaGVyZVwiKSBkcmF3biBhc1xuLy8gYSB0cmlhbmd1bGFyIHdpcmVmcmFtZSBcdTIwMTQgcm90YXRlZCBhdCBWb3NvT3JiJ3MgMC4wMDUgcmFkL2ZyYW1lIHdpdGggaXRzXG4vLyBleGFjdCBwZXItc3RhdGUgbW9ycGggYW1wbGl0dWRlcywgc3Ryb2tlZCBpbiB0aGUgY29uZmlndXJlZCBwcmltYXJ5XG4vLyBjb2xvciBvdmVyIGEgc29mdCBnbG93IG9mIHRoZSBzZWNvbmRhcnkgY29sb3IuIFN1YmRpdmlzaW9uIGRldGFpbFxuLy8gc2NhbGVzIHdpdGggY2FudmFzIHNpemUgc28gYSAyNnB4IGxhdW5jaGVyIHN0YXlzIGNyaXNwIHdoaWxlIHRoZSA2NHB4XG4vLyBpbnRybyBvcmIgc2hvd3MgdGhlIGRlbnNlIG1lc2ggdGhlIFwiVGVzdCB5b3VyIGFnZW50XCIgcHJldmlldyByZW5kZXJzLlxuXG5leHBvcnQgdHlwZSBPcmJTdGF0ZSA9IFwiaWRsZVwiIHwgXCJjb25uZWN0aW5nXCIgfCBcImxpc3RlbmluZ1wiIHwgXCJzcGVha2luZ1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9yYkhhbmRsZSB7XG4gIGVsOiBIVE1MQ2FudmFzRWxlbWVudDtcbiAgc2V0U3RhdGUoc3RhdGU6IE9yYlN0YXRlKTogdm9pZDtcbiAgZGVzdHJveSgpOiB2b2lkO1xufVxuXG4vKiogQ2hlYXAgZGV0ZXJtaW5pc3RpYyAzRCB2YWx1ZSBub2lzZSAoaGFzaCArIHRyaWxpbmVhciBzbW9vdGhzdGVwKS4gKi9cbmZ1bmN0aW9uIGhhc2gzKHg6IG51bWJlciwgeTogbnVtYmVyLCB6OiBudW1iZXIpOiBudW1iZXIge1xuICBsZXQgaCA9IChNYXRoLmltdWwoeCwgMzc0NzYxMzkzKSArIE1hdGguaW11bCh5LCA2NjgyNjUyNjMpICsgTWF0aC5pbXVsKHosIDIxNDc0ODM2NDcpKSB8IDA7XG4gIGggPSBNYXRoLmltdWwoaCBeIChoID4+PiAxMyksIDEyNzQxMjYxNzcpO1xuICByZXR1cm4gKCgoaCBeIChoID4+PiAxNikpID4+PiAwKSAlIDEwMjQpIC8gMTAyNDtcbn1cblxuZnVuY3Rpb24gc21vb3RoKHQ6IG51bWJlcik6IG51bWJlciB7XG4gIHJldHVybiB0ICogdCAqICgzIC0gMiAqIHQpO1xufVxuXG5mdW5jdGlvbiBub2lzZTMoeDogbnVtYmVyLCB5OiBudW1iZXIsIHo6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IHhpID0gTWF0aC5mbG9vcih4KTtcbiAgY29uc3QgeWkgPSBNYXRoLmZsb29yKHkpO1xuICBjb25zdCB6aSA9IE1hdGguZmxvb3Ioeik7XG4gIGNvbnN0IHhmID0gc21vb3RoKHggLSB4aSk7XG4gIGNvbnN0IHlmID0gc21vb3RoKHkgLSB5aSk7XG4gIGNvbnN0IHpmID0gc21vb3RoKHogLSB6aSk7XG4gIGxldCB2ID0gMDtcbiAgZm9yIChsZXQgZHggPSAwOyBkeCA8PSAxOyBkeCArPSAxKSB7XG4gICAgZm9yIChsZXQgZHkgPSAwOyBkeSA8PSAxOyBkeSArPSAxKSB7XG4gICAgICBmb3IgKGxldCBkeiA9IDA7IGR6IDw9IDE7IGR6ICs9IDEpIHtcbiAgICAgICAgY29uc3QgdyA9XG4gICAgICAgICAgKGR4ID8geGYgOiAxIC0geGYpICogKGR5ID8geWYgOiAxIC0geWYpICogKGR6ID8gemYgOiAxIC0gemYpO1xuICAgICAgICB2ICs9IHcgKiBoYXNoMyh4aSArIGR4LCB5aSArIGR5LCB6aSArIGR6KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHYgKiAyIC0gMTsgLy8gLTEuLjFcbn1cblxuLy8gXHUyNTAwXHUyNTAwIEljb3NwaGVyZSBnZW9tZXRyeSAoVm9zb09yYidzIEljb3NhaGVkcm9uR2VvbWV0cnksIGNhbnZhcy1zaXplZCkgXHUyNTAwXHUyNTAwXG5cbnR5cGUgVmVjMyA9IFtudW1iZXIsIG51bWJlciwgbnVtYmVyXTtcblxuZnVuY3Rpb24gbm9ybWFsaXplKHY6IFZlYzMpOiBWZWMzIHtcbiAgY29uc3QgbCA9IE1hdGguaHlwb3QodlswXSwgdlsxXSwgdlsyXSkgfHwgMTtcbiAgcmV0dXJuIFt2WzBdIC8gbCwgdlsxXSAvIGwsIHZbMl0gLyBsXTtcbn1cblxuLyoqIFVuaXQgaWNvc2FoZWRyb24gc3ViZGl2aWRlZCBgZGV0YWlsYCB0aW1lcyB3aXRoIG1pZHBvaW50LW5vcm1hbGl6ZSBcdTIwMTRcbiAqICB0aGUgc2FtZSBjb25zdHJ1Y3Rpb24gdGhyZWUuanMncyBJY29zYWhlZHJvbkdlb21ldHJ5IHVzZXMuIFJldHVybnNcbiAqICB1bml0LXNwaGVyZSB2ZXJ0aWNlcyBhbmQgdGhlIHVuaXF1ZSB3aXJlZnJhbWUgZWRnZXMuICovXG5mdW5jdGlvbiBpY29zcGhlcmUoZGV0YWlsOiBudW1iZXIpOiB7IHZlcnRzOiBWZWMzW107IGVkZ2VzOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiB9IHtcbiAgY29uc3QgdCA9ICgxICsgTWF0aC5zcXJ0KDUpKSAvIDI7XG4gIGNvbnN0IHZlcnRzOiBWZWMzW10gPSAoXG4gICAgW1xuICAgICAgWy0xLCB0LCAwXSwgWzEsIHQsIDBdLCBbLTEsIC10LCAwXSwgWzEsIC10LCAwXSxcbiAgICAgIFswLCAtMSwgdF0sIFswLCAxLCB0XSwgWzAsIC0xLCAtdF0sIFswLCAxLCAtdF0sXG4gICAgICBbdCwgMCwgLTFdLCBbdCwgMCwgMV0sIFstdCwgMCwgLTFdLCBbLXQsIDAsIDFdLFxuICAgIF0gYXMgVmVjM1tdXG4gICkubWFwKG5vcm1hbGl6ZSk7XG4gIGxldCBmYWNlczogQXJyYXk8W251bWJlciwgbnVtYmVyLCBudW1iZXJdPiA9IFtcbiAgICBbMCwgMTEsIDVdLCBbMCwgNSwgMV0sIFswLCAxLCA3XSwgWzAsIDcsIDEwXSwgWzAsIDEwLCAxMV0sXG4gICAgWzEsIDUsIDldLCBbNSwgMTEsIDRdLCBbMTEsIDEwLCAyXSwgWzEwLCA3LCA2XSwgWzcsIDEsIDhdLFxuICAgIFszLCA5LCA0XSwgWzMsIDQsIDJdLCBbMywgMiwgNl0sIFszLCA2LCA4XSwgWzMsIDgsIDldLFxuICAgIFs0LCA5LCA1XSwgWzIsIDQsIDExXSwgWzYsIDIsIDEwXSwgWzgsIDYsIDddLCBbOSwgOCwgMV0sXG4gIF07XG5cbiAgZm9yIChsZXQgZCA9IDA7IGQgPCBkZXRhaWw7IGQgKz0gMSkge1xuICAgIGNvbnN0IG1pZENhY2hlID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTtcbiAgICBjb25zdCBtaWRwb2ludCA9IChhOiBudW1iZXIsIGI6IG51bWJlcik6IG51bWJlciA9PiB7XG4gICAgICBjb25zdCBrZXkgPSBhIDwgYiA/IGEgKiA2NTUzNiArIGIgOiBiICogNjU1MzYgKyBhO1xuICAgICAgY29uc3QgaGl0ID0gbWlkQ2FjaGUuZ2V0KGtleSk7XG4gICAgICBpZiAoaGl0ICE9PSB1bmRlZmluZWQpIHJldHVybiBoaXQ7XG4gICAgICBjb25zdCB2YSA9IHZlcnRzW2FdITtcbiAgICAgIGNvbnN0IHZiID0gdmVydHNbYl0hO1xuICAgICAgY29uc3QgaWR4ID0gdmVydHMubGVuZ3RoO1xuICAgICAgdmVydHMucHVzaChcbiAgICAgICAgbm9ybWFsaXplKFsodmFbMF0gKyB2YlswXSkgLyAyLCAodmFbMV0gKyB2YlsxXSkgLyAyLCAodmFbMl0gKyB2YlsyXSkgLyAyXSksXG4gICAgICApO1xuICAgICAgbWlkQ2FjaGUuc2V0KGtleSwgaWR4KTtcbiAgICAgIHJldHVybiBpZHg7XG4gICAgfTtcbiAgICBjb25zdCBuZXh0OiBBcnJheTxbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0+ID0gW107XG4gICAgZm9yIChjb25zdCBbYSwgYiwgY10gb2YgZmFjZXMpIHtcbiAgICAgIGNvbnN0IGFiID0gbWlkcG9pbnQoYSwgYik7XG4gICAgICBjb25zdCBiYyA9IG1pZHBvaW50KGIsIGMpO1xuICAgICAgY29uc3QgY2EgPSBtaWRwb2ludChjLCBhKTtcbiAgICAgIG5leHQucHVzaChbYSwgYWIsIGNhXSwgW2IsIGJjLCBhYl0sIFtjLCBjYSwgYmNdLCBbYWIsIGJjLCBjYV0pO1xuICAgIH1cbiAgICBmYWNlcyA9IG5leHQ7XG4gIH1cblxuICBjb25zdCBlZGdlU2V0ID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGNvbnN0IGVkZ2VzOiBBcnJheTxbbnVtYmVyLCBudW1iZXJdPiA9IFtdO1xuICBjb25zdCBhZGRFZGdlID0gKGE6IG51bWJlciwgYjogbnVtYmVyKSA9PiB7XG4gICAgY29uc3Qga2V5ID0gYSA8IGIgPyBhICogNjU1MzYgKyBiIDogYiAqIDY1NTM2ICsgYTtcbiAgICBpZiAoZWRnZVNldC5oYXMoa2V5KSkgcmV0dXJuO1xuICAgIGVkZ2VTZXQuYWRkKGtleSk7XG4gICAgZWRnZXMucHVzaChbYSwgYl0pO1xuICB9O1xuICBmb3IgKGNvbnN0IFthLCBiLCBjXSBvZiBmYWNlcykge1xuICAgIGFkZEVkZ2UoYSwgYik7XG4gICAgYWRkRWRnZShiLCBjKTtcbiAgICBhZGRFZGdlKGMsIGEpO1xuICB9XG4gIHJldHVybiB7IHZlcnRzLCBlZGdlcyB9O1xufVxuXG4vKiogQ3JlYXRlIGFuIGFuaW1hdGVkIG9yYiBjYW52YXMgb2YgYHNpemVgIENTUyBwaXhlbHMuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlT3JiKFxuICBzaXplOiBudW1iZXIsXG4gIGNvbG9yMTogc3RyaW5nLFxuICBjb2xvcjI6IHN0cmluZyxcbik6IE9yYkhhbmRsZSB7XG4gIGNvbnN0IGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjYW52YXNcIik7XG4gIGNvbnN0IGRwciA9IE1hdGgubWluKHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsIDIpO1xuICBjYW52YXMud2lkdGggPSBzaXplICogZHByO1xuICBjYW52YXMuaGVpZ2h0ID0gc2l6ZSAqIGRwcjtcbiAgY2FudmFzLnN0eWxlLndpZHRoID0gYCR7c2l6ZX1weGA7XG4gIGNhbnZhcy5zdHlsZS5oZWlnaHQgPSBgJHtzaXplfXB4YDtcbiAgY2FudmFzLnN0eWxlLmRpc3BsYXkgPSBcImJsb2NrXCI7XG4gIGNvbnN0IGN0eCA9IGNhbnZhcy5nZXRDb250ZXh0KFwiMmRcIik7XG5cbiAgbGV0IHN0YXRlOiBPcmJTdGF0ZSA9IFwiaWRsZVwiO1xuICBsZXQgcmFmID0gMDtcbiAgbGV0IHJ1bm5pbmcgPSB0cnVlO1xuXG4gIGNvbnN0IGhhbGYgPSAoc2l6ZSAqIGRwcikgLyAyO1xuICAvLyBGaWxsIHRoZSBjYW52YXMgbGlrZSB0aGUgc29saWQtZ3JhZGllbnQgYXZhdGFyIHRoaXMgb3JiIHJlcGxhY2VkIFx1MjAxNFxuICAvLyBpZGxlIG1vcnBoIGFtcGxpdHVkZSBsZWF2ZXMgfjYlIGhlYWRyb29tOyBzcGVha2luZyBtYXkgZ3JhemUgdGhlXG4gIC8vIGVkZ2UsIHdoaWNoIHJlYWRzIGFzIGVuZXJneSByYXRoZXIgdGhhbiBjbGlwcGluZy5cbiAgY29uc3QgYmFzZVJhZGl1cyA9IGhhbGYgKiAwLjg2O1xuXG4gIC8vIFZvc29PcmIgdXNlcyBJY29zYWhlZHJvbkdlb21ldHJ5KDEwLCA4KSBvbiB0aGUgR1BVOyBhIDJEIGNhbnZhcyBnZXRzXG4gIC8vIHRoZSBzYW1lIHZpc3VhbCBkZW5zaXR5IHdpdGggZmFyIGZld2VyIGxpbmVzIFx1MjAxNCBkZXRhaWwgMyAoMSw5MjAgZWRnZXMpXG4gIC8vIHJlYWRzIGlkZW50aWNhbGx5IGF0IFx1MjI2NTU2cHgsIGRldGFpbCAyICg0ODAgZWRnZXMpIGJlbG93IHRoYXQuXG4gIGNvbnN0IHsgdmVydHMsIGVkZ2VzIH0gPSBpY29zcGhlcmUoc2l6ZSA+PSA1NiA/IDMgOiAyKTtcbiAgY29uc3QgcHJvamVjdGVkOiBBcnJheTxbbnVtYmVyLCBudW1iZXIsIG51bWJlcl0+ID0gdmVydHMubWFwKCgpID0+IFswLCAwLCAwXSk7XG5cbiAgZnVuY3Rpb24gYW1wbGl0dWRlKG5vdzogbnVtYmVyKTogbnVtYmVyIHtcbiAgICAvLyBNaXJyb3JzIFZvc29PcmIncyBtb3JwaEFtb3VudCBwZXIgc3RhdGUgKHZvc28tb3JiLnRzeCByZW5kZXIgbG9vcCkuXG4gICAgc3dpdGNoIChzdGF0ZSkge1xuICAgICAgY2FzZSBcImlkbGVcIjpcbiAgICAgICAgcmV0dXJuIDAuMDMgKyBNYXRoLnNpbihub3cgKiAwLjAwMikgKiAwLjAyO1xuICAgICAgY2FzZSBcImNvbm5lY3RpbmdcIjpcbiAgICAgICAgcmV0dXJuIDAuMDggKyBNYXRoLnNpbihub3cgKiAwLjAwNCkgKiAwLjA2O1xuICAgICAgY2FzZSBcInNwZWFraW5nXCI6XG4gICAgICAgIHJldHVybiAwLjIyICsgTWF0aC5zaW4obm93ICogMC4wMDYpICogMC4xMjtcbiAgICAgIGNhc2UgXCJsaXN0ZW5pbmdcIjpcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiAwLjA2ICsgTWF0aC5zaW4obm93ICogMC4wMDMpICogMC4wMztcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiByZW5kZXIobm93OiBudW1iZXIpIHtcbiAgICBpZiAoIXJ1bm5pbmcgfHwgIWN0eCkgcmV0dXJuO1xuICAgIGNvbnN0IGFtcCA9IGFtcGxpdHVkZShub3cpO1xuICAgIC8vIGdyb3VwLnJvdGF0aW9uLnkgKz0gMC4wMDUvZnJhbWUgXHUyMjQ4IDAuMyByYWQvcyBhdCA2MGZwcy5cbiAgICBjb25zdCByb3QgPSBub3cgKiAwLjAwMDM7XG4gICAgY29uc3QgY29zUiA9IE1hdGguY29zKHJvdCk7XG4gICAgY29uc3Qgc2luUiA9IE1hdGguc2luKHJvdCk7XG4gICAgY3R4LmNsZWFyUmVjdCgwLCAwLCBzaXplICogZHByLCBzaXplICogZHByKTtcblxuICAgIC8vIFNvZnQgc2Vjb25kYXJ5LWNvbG9yIGdsb3cgYmVoaW5kIHRoZSB3aXJlZnJhbWUuXG4gICAgY29uc3QgZ2xvdyA9IGN0eC5jcmVhdGVSYWRpYWxHcmFkaWVudChoYWxmLCBoYWxmLCAwLCBoYWxmLCBoYWxmLCBoYWxmKTtcbiAgICBnbG93LmFkZENvbG9yU3RvcCgwLCBgJHtjb2xvcjJ9NTVgKTtcbiAgICBnbG93LmFkZENvbG9yU3RvcCgwLjc1LCBgJHtjb2xvcjJ9MThgKTtcbiAgICBnbG93LmFkZENvbG9yU3RvcCgxLCBgJHtjb2xvcjJ9MDBgKTtcbiAgICBjdHguZmlsbFN0eWxlID0gZ2xvdztcbiAgICBjdHguZmlsbFJlY3QoMCwgMCwgc2l6ZSAqIGRwciwgc2l6ZSAqIGRwcik7XG5cbiAgICAvLyBNb3JwaCArIHJvdGF0ZSArIHByb2plY3QgZXZlcnkgdmVydGV4IG9uY2UsIHRoZW4gc3Ryb2tlIHRoZSBlZGdlcy5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHZlcnRzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBjb25zdCBbbngwLCBueSwgbnowXSA9IHZlcnRzW2ldITtcbiAgICAgIGNvbnN0IG4gPSBub2lzZTMoXG4gICAgICAgIG54MCAqIDEuNCArIG5vdyAqIDAuMDAwMzUsXG4gICAgICAgIG55ICogMS40ICsgbm93ICogMC4wMDA0LFxuICAgICAgICBuejAgKiAxLjQgKyBub3cgKiAwLjAwMDQ1LFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHIgPSAxICsgbiAqIGFtcCAqIDEuNCArIGFtcCAqIDAuMzU7XG4gICAgICBjb25zdCBueCA9IG54MCAqIGNvc1IgKyBuejAgKiBzaW5SO1xuICAgICAgY29uc3QgbnogPSAtbngwICogc2luUiArIG56MCAqIGNvc1I7XG4gICAgICAvLyBNaWxkIHBlcnNwZWN0aXZlIG1pcnJvcmluZyBWb3NvT3JiJ3MgMjBcdTAwQjAgZm92IGNhbWVyYS5cbiAgICAgIGNvbnN0IHBlcnNwID0gMSAvICgxLjYgLSAwLjYgKiBueik7XG4gICAgICBwcm9qZWN0ZWRbaV0gPSBbXG4gICAgICAgIGhhbGYgKyBueCAqIHIgKiBiYXNlUmFkaXVzICogcGVyc3AsXG4gICAgICAgIGhhbGYgKyBueSAqIHIgKiBiYXNlUmFkaXVzICogcGVyc3AsXG4gICAgICAgIG56LFxuICAgICAgXTtcbiAgICB9XG5cbiAgICBjdHgubGluZVdpZHRoID0gTWF0aC5tYXgoMC42LCBzaXplICogZHByICogMC4wMDYpO1xuICAgIGN0eC5zdHJva2VTdHlsZSA9IGNvbG9yMTtcbiAgICBjdHguZ2xvYmFsQWxwaGEgPSAwLjg7XG4gICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgIGZvciAoY29uc3QgW2EsIGJdIG9mIGVkZ2VzKSB7XG4gICAgICBjb25zdCBwYSA9IHByb2plY3RlZFthXSE7XG4gICAgICBjb25zdCBwYiA9IHByb2plY3RlZFtiXSE7XG4gICAgICAvLyBTa2lwIHRoZSBmYXJ0aGVzdCBiYWNrLWZhY2UgZWRnZXMgc28gdGhlIGZyb250IG1lc2ggcmVhZHNcbiAgICAgIC8vIGNyaXNwbHksIGxpa2UgdGhlIGxpdCB0aHJlZS5qcyB3aXJlZnJhbWUuXG4gICAgICBpZiAocGFbMl0gPCAtMC41NSAmJiBwYlsyXSA8IC0wLjU1KSBjb250aW51ZTtcbiAgICAgIGN0eC5tb3ZlVG8ocGFbMF0sIHBhWzFdKTtcbiAgICAgIGN0eC5saW5lVG8ocGJbMF0sIHBiWzFdKTtcbiAgICB9XG4gICAgY3R4LnN0cm9rZSgpO1xuICAgIGN0eC5nbG9iYWxBbHBoYSA9IDE7XG5cbiAgICByYWYgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocmVuZGVyKTtcbiAgfVxuICByYWYgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUocmVuZGVyKTtcblxuICByZXR1cm4ge1xuICAgIGVsOiBjYW52YXMsXG4gICAgc2V0U3RhdGUobmV4dDogT3JiU3RhdGUpIHtcbiAgICAgIHN0YXRlID0gbmV4dDtcbiAgICB9LFxuICAgIGRlc3Ryb3koKSB7XG4gICAgICBydW5uaW5nID0gZmFsc2U7XG4gICAgICBjYW5jZWxBbmltYXRpb25GcmFtZShyYWYpO1xuICAgIH0sXG4gIH07XG59XG4iLCAiLy8gTWluaW1hbCBtYXJrZG93biBwYXJzZXIgZm9yIHdpZGdldCBjaGF0IGJ1YmJsZXMuXG4vL1xuLy8gRGVsaWJlcmF0ZWx5IHNtYWxsIChubyBkZXBlbmRlbmN5KTogcGFyYWdyYXBocywgQVRYIGhlYWRpbmdzLCBmZW5jZWQgY29kZVxuLy8gYmxvY2tzLCBvcmRlcmVkL3Vub3JkZXJlZCBsaXN0cywgYm9sZC9pdGFsaWMvc3RyaWtldGhyb3VnaCwgaW5saW5lIGNvZGUsXG4vLyBhbmQgbGlua3MgZ2F0ZWQgYnkgdGhlIExpbmtQb2xpY3kuIFRoZSBwYXJzZXIgcHJvZHVjZXMgYSBwdXJlIHRyZWUgXHUyMDE0IHRoZVxuLy8gRE9NIGlzIGJ1aWx0IHNlcGFyYXRlbHkgaW4gdGhlIGJyb3dzZXIgKG5ldmVyIHZpYSBpbm5lckhUTUwpLCBzbyBwYXJzaW5nIGlzXG4vLyB1bml0LXRlc3RhYmxlIHVuZGVyIG5vZGUgYW5kIGluamVjdGlvbi1zYWZlIGJ5IGNvbnN0cnVjdGlvbi5cblxuaW1wb3J0IHsgaXNMaW5rQWxsb3dlZCwgdHlwZSBMaW5rUG9saWN5IH0gZnJvbSBcIi4vbGluay1wb2xpY3lcIjtcblxuZXhwb3J0IHR5cGUgTWRJbmxpbmUgPVxuICB8IHsga2luZDogXCJ0ZXh0XCI7IHRleHQ6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcInN0cm9uZ1wiOyBjaGlsZHJlbjogTWRJbmxpbmVbXSB9XG4gIHwgeyBraW5kOiBcImVtXCI7IGNoaWxkcmVuOiBNZElubGluZVtdIH1cbiAgfCB7IGtpbmQ6IFwiZGVsXCI7IGNoaWxkcmVuOiBNZElubGluZVtdIH1cbiAgfCB7IGtpbmQ6IFwiY29kZVwiOyB0ZXh0OiBzdHJpbmcgfVxuICB8IHsga2luZDogXCJsaW5rXCI7IGhyZWY6IHN0cmluZzsgY2hpbGRyZW46IE1kSW5saW5lW107IGFsbG93ZWQ6IGJvb2xlYW4gfTtcblxuZXhwb3J0IHR5cGUgTWRCbG9jayA9XG4gIHwgeyBraW5kOiBcInBhcmFncmFwaFwiOyBjaGlsZHJlbjogTWRJbmxpbmVbXSB9XG4gIHwgeyBraW5kOiBcImhlYWRpbmdcIjsgbGV2ZWw6IG51bWJlcjsgY2hpbGRyZW46IE1kSW5saW5lW10gfVxuICB8IHsga2luZDogXCJjb2RlX2Jsb2NrXCI7IGxhbmc6IHN0cmluZzsgdGV4dDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6IFwibGlzdFwiOyBvcmRlcmVkOiBib29sZWFuOyBpdGVtczogTWRJbmxpbmVbXVtdIH07XG5cbi8qKiBQYXJzZSBtYXJrZG93biBpbnRvIGEgcmVuZGVyIHRyZWUuIExpbmtzIGNhcnJ5IGFuIGBhbGxvd2VkYCB2ZXJkaWN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd24oc3JjOiBzdHJpbmcsIHBvbGljeTogTGlua1BvbGljeSk6IE1kQmxvY2tbXSB7XG4gIGNvbnN0IGJsb2NrczogTWRCbG9ja1tdID0gW107XG4gIGNvbnN0IGxpbmVzID0gc3JjLnJlcGxhY2UoL1xcclxcbj8vZywgXCJcXG5cIikuc3BsaXQoXCJcXG5cIik7XG4gIGxldCBpID0gMDtcblxuICB3aGlsZSAoaSA8IGxpbmVzLmxlbmd0aCkge1xuICAgIGNvbnN0IGxpbmUgPSBsaW5lc1tpXSA/PyBcIlwiO1xuXG4gICAgaWYgKGxpbmUudHJpbSgpID09PSBcIlwiKSB7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBGZW5jZWQgY29kZSBibG9jay5cbiAgICBjb25zdCBmZW5jZSA9IGxpbmUubWF0Y2goL15gYGAoW0EtWmEtejAtOSsjLl8tXSopXFxzKiQvKTtcbiAgICBpZiAoZmVuY2UpIHtcbiAgICAgIGNvbnN0IGxhbmcgPSAoZmVuY2VbMV0gPz8gXCJcIikudG9Mb3dlckNhc2UoKTtcbiAgICAgIGNvbnN0IGJvZHk6IHN0cmluZ1tdID0gW107XG4gICAgICBpICs9IDE7XG4gICAgICB3aGlsZSAoaSA8IGxpbmVzLmxlbmd0aCAmJiAhL15gYGBcXHMqJC8udGVzdChsaW5lc1tpXSA/PyBcIlwiKSkge1xuICAgICAgICBib2R5LnB1c2gobGluZXNbaV0gPz8gXCJcIik7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgIH1cbiAgICAgIGkgKz0gMTsgLy8gY29uc3VtZSBjbG9zaW5nIGZlbmNlIChvciBFT0YpXG4gICAgICBibG9ja3MucHVzaCh7IGtpbmQ6IFwiY29kZV9ibG9ja1wiLCBsYW5nLCB0ZXh0OiBib2R5LmpvaW4oXCJcXG5cIikgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBBVFggaGVhZGluZy5cbiAgICBjb25zdCBoZWFkaW5nID0gbGluZS5tYXRjaCgvXigjezEsNH0pXFxzKyguKikkLyk7XG4gICAgaWYgKGhlYWRpbmcpIHtcbiAgICAgIGJsb2Nrcy5wdXNoKHtcbiAgICAgICAga2luZDogXCJoZWFkaW5nXCIsXG4gICAgICAgIGxldmVsOiAoaGVhZGluZ1sxXSA/PyBcIiNcIikubGVuZ3RoLFxuICAgICAgICBjaGlsZHJlbjogcGFyc2VJbmxpbmUoaGVhZGluZ1syXSA/PyBcIlwiLCBwb2xpY3kpLFxuICAgICAgfSk7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBMaXN0ICh1bm9yZGVyZWQgb3Igb3JkZXJlZCkgXHUyMDE0IGNvbnNlY3V0aXZlIGl0ZW0gbGluZXMuXG4gICAgY29uc3QgbGlzdEl0ZW0gPSBtYXRjaExpc3RJdGVtKGxpbmUpO1xuICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgY29uc3Qgb3JkZXJlZCA9IGxpc3RJdGVtLm9yZGVyZWQ7XG4gICAgICBjb25zdCBpdGVtczogTWRJbmxpbmVbXVtdID0gW107XG4gICAgICB3aGlsZSAoaSA8IGxpbmVzLmxlbmd0aCkge1xuICAgICAgICBjb25zdCBtID0gbWF0Y2hMaXN0SXRlbShsaW5lc1tpXSA/PyBcIlwiKTtcbiAgICAgICAgaWYgKCFtIHx8IG0ub3JkZXJlZCAhPT0gb3JkZXJlZCkgYnJlYWs7XG4gICAgICAgIGl0ZW1zLnB1c2gocGFyc2VJbmxpbmUobS50ZXh0LCBwb2xpY3kpKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgYmxvY2tzLnB1c2goeyBraW5kOiBcImxpc3RcIiwgb3JkZXJlZCwgaXRlbXMgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBQYXJhZ3JhcGg6IGdhdGhlciB1bnRpbCBibGFuayBsaW5lIG9yIGEgc3RydWN0dXJhbCBsaW5lLlxuICAgIGNvbnN0IHBhcmE6IHN0cmluZ1tdID0gW2xpbmVdO1xuICAgIGkgKz0gMTtcbiAgICB3aGlsZSAoaSA8IGxpbmVzLmxlbmd0aCkge1xuICAgICAgY29uc3QgbmV4dCA9IGxpbmVzW2ldID8/IFwiXCI7XG4gICAgICBpZiAoXG4gICAgICAgIG5leHQudHJpbSgpID09PSBcIlwiIHx8XG4gICAgICAgIC9eYGBgLy50ZXN0KG5leHQpIHx8XG4gICAgICAgIC9eI3sxLDR9XFxzLy50ZXN0KG5leHQpIHx8XG4gICAgICAgIG1hdGNoTGlzdEl0ZW0obmV4dClcbiAgICAgICkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHBhcmEucHVzaChuZXh0KTtcbiAgICAgIGkgKz0gMTtcbiAgICB9XG4gICAgYmxvY2tzLnB1c2goeyBraW5kOiBcInBhcmFncmFwaFwiLCBjaGlsZHJlbjogcGFyc2VJbmxpbmUocGFyYS5qb2luKFwiXFxuXCIpLCBwb2xpY3kpIH0pO1xuICB9XG5cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuZnVuY3Rpb24gbWF0Y2hMaXN0SXRlbShcbiAgbGluZTogc3RyaW5nLFxuKTogeyBvcmRlcmVkOiBib29sZWFuOyB0ZXh0OiBzdHJpbmcgfSB8IG51bGwge1xuICBjb25zdCB1bCA9IGxpbmUubWF0Y2goL15cXHN7MCwzfVstKitdXFxzKyguKikkLyk7XG4gIGlmICh1bCkgcmV0dXJuIHsgb3JkZXJlZDogZmFsc2UsIHRleHQ6IHVsWzFdID8/IFwiXCIgfTtcbiAgY29uc3Qgb2wgPSBsaW5lLm1hdGNoKC9eXFxzezAsM31cXGR7MSw5fVsuKV1cXHMrKC4qKSQvKTtcbiAgaWYgKG9sKSByZXR1cm4geyBvcmRlcmVkOiB0cnVlLCB0ZXh0OiBvbFsxXSA/PyBcIlwiIH07XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogUGFyc2UgaW5saW5lIG1hcmtkb3duLiBFeHBvcnRlZCBmb3IgdGVzdHMuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VJbmxpbmUoc3JjOiBzdHJpbmcsIHBvbGljeTogTGlua1BvbGljeSk6IE1kSW5saW5lW10ge1xuICBjb25zdCBvdXQ6IE1kSW5saW5lW10gPSBbXTtcbiAgbGV0IHJlc3QgPSBzcmM7XG5cbiAgY29uc3QgcHVzaFRleHQgPSAodDogc3RyaW5nKSA9PiB7XG4gICAgaWYgKHQgPT09IFwiXCIpIHJldHVybjtcbiAgICBjb25zdCBsYXN0ID0gb3V0W291dC5sZW5ndGggLSAxXTtcbiAgICBpZiAobGFzdCAmJiBsYXN0LmtpbmQgPT09IFwidGV4dFwiKSBsYXN0LnRleHQgKz0gdDtcbiAgICBlbHNlIG91dC5wdXNoKHsga2luZDogXCJ0ZXh0XCIsIHRleHQ6IHQgfSk7XG4gIH07XG5cbiAgd2hpbGUgKHJlc3QubGVuZ3RoID4gMCkge1xuICAgIC8vIElubGluZSBjb2RlIFx1MjAxNCBlYXJsaWVzdCBzcGVjaWFsIGZpcnN0OyBjb2RlIHdpbnMgb3ZlciBlbXBoYXNpcyBpbnNpZGUgaXQuXG4gICAgY29uc3QgcGF0dGVybnM6IEFycmF5PHsgaW5kZXg6IG51bWJlcjsgcnVuOiAoKSA9PiB2b2lkOyBsZW46IG51bWJlciB9PiA9IFtdO1xuXG4gICAgY29uc3QgY29kZSA9IHJlc3QubWF0Y2goL2AoW15gXFxuXSspYC8pO1xuICAgIGlmIChjb2RlICYmIGNvZGUuaW5kZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0dGVybnMucHVzaCh7XG4gICAgICAgIGluZGV4OiBjb2RlLmluZGV4LFxuICAgICAgICBsZW46IGNvZGVbMF0ubGVuZ3RoLFxuICAgICAgICBydW46ICgpID0+IG91dC5wdXNoKHsga2luZDogXCJjb2RlXCIsIHRleHQ6IGNvZGVbMV0gPz8gXCJcIiB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGxpbmsgPSByZXN0Lm1hdGNoKC9cXFsoW15cXF1cXG5dKilcXF1cXCgoW14pXFxzXSspXFwpLyk7XG4gICAgaWYgKGxpbmsgJiYgbGluay5pbmRleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBocmVmID0gbGlua1syXSA/PyBcIlwiO1xuICAgICAgY29uc3QgbGFiZWwgPSBsaW5rWzFdID8/IFwiXCI7XG4gICAgICBwYXR0ZXJucy5wdXNoKHtcbiAgICAgICAgaW5kZXg6IGxpbmsuaW5kZXgsXG4gICAgICAgIGxlbjogbGlua1swXS5sZW5ndGgsXG4gICAgICAgIHJ1bjogKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGFsbG93ZWQgPSBpc0xpbmtBbGxvd2VkKGhyZWYsIHBvbGljeSk7XG4gICAgICAgICAgb3V0LnB1c2goe1xuICAgICAgICAgICAga2luZDogXCJsaW5rXCIsXG4gICAgICAgICAgICBocmVmLFxuICAgICAgICAgICAgY2hpbGRyZW46IHBhcnNlSW5saW5lKGxhYmVsLCBwb2xpY3kpLFxuICAgICAgICAgICAgYWxsb3dlZCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHN0cm9uZyA9IHJlc3QubWF0Y2goL1xcKlxcKihbXipcXG5dKylcXCpcXCp8X18oW15fXFxuXSspX18vKTtcbiAgICBpZiAoc3Ryb25nICYmIHN0cm9uZy5pbmRleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBpbm5lciA9IHN0cm9uZ1sxXSA/PyBzdHJvbmdbMl0gPz8gXCJcIjtcbiAgICAgIHBhdHRlcm5zLnB1c2goe1xuICAgICAgICBpbmRleDogc3Ryb25nLmluZGV4LFxuICAgICAgICBsZW46IHN0cm9uZ1swXS5sZW5ndGgsXG4gICAgICAgIHJ1bjogKCkgPT5cbiAgICAgICAgICBvdXQucHVzaCh7IGtpbmQ6IFwic3Ryb25nXCIsIGNoaWxkcmVuOiBwYXJzZUlubGluZShpbm5lciwgcG9saWN5KSB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGVtID0gcmVzdC5tYXRjaCgvKD88IVsqXFx3XSlcXCooW14qXFxuXSspXFwqKD8hXFwqKXwoPzwhW19cXHddKV8oW15fXFxuXSspXyg/IV8pLyk7XG4gICAgaWYgKGVtICYmIGVtLmluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGlubmVyID0gZW1bMV0gPz8gZW1bMl0gPz8gXCJcIjtcbiAgICAgIHBhdHRlcm5zLnB1c2goe1xuICAgICAgICBpbmRleDogZW0uaW5kZXgsXG4gICAgICAgIGxlbjogZW1bMF0ubGVuZ3RoLFxuICAgICAgICBydW46ICgpID0+IG91dC5wdXNoKHsga2luZDogXCJlbVwiLCBjaGlsZHJlbjogcGFyc2VJbmxpbmUoaW5uZXIsIHBvbGljeSkgfSksXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBkZWwgPSByZXN0Lm1hdGNoKC9+fihbXn5cXG5dKyl+fi8pO1xuICAgIGlmIChkZWwgJiYgZGVsLmluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goe1xuICAgICAgICBpbmRleDogZGVsLmluZGV4LFxuICAgICAgICBsZW46IGRlbFswXS5sZW5ndGgsXG4gICAgICAgIHJ1bjogKCkgPT5cbiAgICAgICAgICBvdXQucHVzaCh7IGtpbmQ6IFwiZGVsXCIsIGNoaWxkcmVuOiBwYXJzZUlubGluZShkZWxbMV0gPz8gXCJcIiwgcG9saWN5KSB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChwYXR0ZXJucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHB1c2hUZXh0KHJlc3QpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHBhdHRlcm5zLnNvcnQoKGEsIGIpID0+IGEuaW5kZXggLSBiLmluZGV4KTtcbiAgICBjb25zdCBmaXJzdCA9IHBhdHRlcm5zWzBdITtcbiAgICBwdXNoVGV4dChyZXN0LnNsaWNlKDAsIGZpcnN0LmluZGV4KSk7XG4gICAgZmlyc3QucnVuKCk7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoZmlyc3QuaW5kZXggKyBmaXJzdC5sZW4pO1xuICB9XG5cbiAgcmV0dXJuIG91dDtcbn1cblxuLyoqXG4gKiBTdHJpcCB2ZW5kb3Itc3R5bGUgYXVkaW8gdGFncyBcdTIwMTQgYnJhY2tldGVkIGN1ZXMgbGlrZSBgW2xhdWdoc11gIG9yXG4gKiBgW3doaXNwZXJpbmddYCBcdTIwMTQgZnJvbSB0cmFuc2NyaXB0IHRleHQgd2hlbiBgaGlkZV9hdWRpb190YWdzYCBpcyBlbmFibGVkLlxuICogTWFya2Rvd24gbGlua3MgKGBbdGV4dF0odXJsKWApIGFyZSBwcmVzZXJ2ZWQ6IG9ubHkgYFsuLi5dYCBOT1QgZm9sbG93ZWQgYnlcbiAqIGAoYCBpcyB0cmVhdGVkIGFzIGFuIGF1ZGlvIHRhZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0cmlwQXVkaW9UYWdzKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnJlcGxhY2UoL1xcW1teXFxdW1xcbl17MSw2MH1cXF0oPyFcXCgpL2csIFwiXCIpXG4gICAgLnJlcGxhY2UoLyB7Mix9L2csIFwiIFwiKVxuICAgIC5yZXBsYWNlKC9eICt8ICskL2dtLCBcIlwiKTtcbn1cbiIsICIvLyBNaW5pbWFsIGdlbmVyaWMgc3ludGF4IGhpZ2hsaWdodGVyIGZvciB3aWRnZXQgY29kZSBibG9ja3MuXG4vL1xuLy8gT25lIHRva2VuaXplciwgcGVyLWxhbmd1YWdlIGtleXdvcmQgc2V0cy4gT3V0cHV0IGlzIGEgZmxhdCB0b2tlbiBsaXN0IHRoZVxuLy8gRE9NIGxheWVyIHJlbmRlcnMgYXMgPHNwYW4gY2xhc3M9XCJobC0uLi5cIj47IHRoZW1lcyAoYXV0by9saWdodC9kYXJrKSBhcmVcbi8vIHB1cmUgQ1NTIGluIHRoZSBzaGFkb3cgcm9vdC4gTm90IGEgcmVhbCBsZXhlciBcdTIwMTQgZ29vZCBlbm91Z2ggZm9yIGNoYXRcbi8vIHNuaXBwZXRzLCB6ZXJvIGRlcGVuZGVuY2llcy5cblxuZXhwb3J0IHR5cGUgSGxDbGFzcyA9IFwia3dcIiB8IFwic3RyXCIgfCBcImNvbVwiIHwgXCJudW1cIiB8IFwicGxuXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGxUb2tlbiB7XG4gIGNsczogSGxDbGFzcztcbiAgdGV4dDogc3RyaW5nO1xufVxuXG5jb25zdCBLRVlXT1JEUzogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0ge1xuICBqYXZhc2NyaXB0OiBqc0tleXdvcmRzKCksXG4gIHR5cGVzY3JpcHQ6IFsuLi5qc0tleXdvcmRzKCksIFwidHlwZVwiLCBcImludGVyZmFjZVwiLCBcImVudW1cIiwgXCJuYW1lc3BhY2VcIiwgXCJkZWNsYXJlXCIsIFwicmVhZG9ubHlcIiwgXCJrZXlvZlwiLCBcImluZmVyXCIsIFwiaXNcIiwgXCJhc3NlcnRzXCIsIFwic2F0aXNmaWVzXCJdLFxuICBqczoganNLZXl3b3JkcygpLFxuICB0czogWy4uLmpzS2V5d29yZHMoKSwgXCJ0eXBlXCIsIFwiaW50ZXJmYWNlXCIsIFwiZW51bVwiLCBcInJlYWRvbmx5XCJdLFxuICBqc3g6IGpzS2V5d29yZHMoKSxcbiAgdHN4OiBbLi4uanNLZXl3b3JkcygpLCBcInR5cGVcIiwgXCJpbnRlcmZhY2VcIiwgXCJlbnVtXCIsIFwicmVhZG9ubHlcIl0sXG4gIHB5dGhvbjogW1wiZGVmXCIsIFwicmV0dXJuXCIsIFwiaWZcIiwgXCJlbGlmXCIsIFwiZWxzZVwiLCBcImZvclwiLCBcIndoaWxlXCIsIFwiaW5cIiwgXCJub3RcIiwgXCJhbmRcIiwgXCJvclwiLCBcImltcG9ydFwiLCBcImZyb21cIiwgXCJhc1wiLCBcImNsYXNzXCIsIFwidHJ5XCIsIFwiZXhjZXB0XCIsIFwiZmluYWxseVwiLCBcIndpdGhcIiwgXCJsYW1iZGFcIiwgXCJwYXNzXCIsIFwiYnJlYWtcIiwgXCJjb250aW51ZVwiLCBcInJhaXNlXCIsIFwieWllbGRcIiwgXCJnbG9iYWxcIiwgXCJub25sb2NhbFwiLCBcImFzc2VydFwiLCBcImRlbFwiLCBcIlRydWVcIiwgXCJGYWxzZVwiLCBcIk5vbmVcIiwgXCJhc3luY1wiLCBcImF3YWl0XCIsIFwibWF0Y2hcIiwgXCJjYXNlXCJdLFxuICBweTogW1wiZGVmXCIsIFwicmV0dXJuXCIsIFwiaWZcIiwgXCJlbGlmXCIsIFwiZWxzZVwiLCBcImZvclwiLCBcIndoaWxlXCIsIFwiaW5cIiwgXCJub3RcIiwgXCJhbmRcIiwgXCJvclwiLCBcImltcG9ydFwiLCBcImZyb21cIiwgXCJhc1wiLCBcImNsYXNzXCIsIFwidHJ5XCIsIFwiZXhjZXB0XCIsIFwiZmluYWxseVwiLCBcIndpdGhcIiwgXCJsYW1iZGFcIiwgXCJUcnVlXCIsIFwiRmFsc2VcIiwgXCJOb25lXCIsIFwiYXN5bmNcIiwgXCJhd2FpdFwiXSxcbiAgcnVzdDogW1wiZm5cIiwgXCJsZXRcIiwgXCJtdXRcIiwgXCJjb25zdFwiLCBcInN0YXRpY1wiLCBcImlmXCIsIFwiZWxzZVwiLCBcIm1hdGNoXCIsIFwibG9vcFwiLCBcIndoaWxlXCIsIFwiZm9yXCIsIFwiaW5cIiwgXCJyZXR1cm5cIiwgXCJicmVha1wiLCBcImNvbnRpbnVlXCIsIFwic3RydWN0XCIsIFwiZW51bVwiLCBcInRyYWl0XCIsIFwiaW1wbFwiLCBcInB1YlwiLCBcInVzZVwiLCBcIm1vZFwiLCBcImNyYXRlXCIsIFwic2VsZlwiLCBcIlNlbGZcIiwgXCJzdXBlclwiLCBcIndoZXJlXCIsIFwiYXN5bmNcIiwgXCJhd2FpdFwiLCBcIm1vdmVcIiwgXCJyZWZcIiwgXCJ0eXBlXCIsIFwidW5zYWZlXCIsIFwiZHluXCIsIFwiYXNcIiwgXCJ0cnVlXCIsIFwiZmFsc2VcIl0sXG4gIGdvOiBbXCJmdW5jXCIsIFwicmV0dXJuXCIsIFwiaWZcIiwgXCJlbHNlXCIsIFwiZm9yXCIsIFwicmFuZ2VcIiwgXCJzd2l0Y2hcIiwgXCJjYXNlXCIsIFwiZGVmYXVsdFwiLCBcImJyZWFrXCIsIFwiY29udGludWVcIiwgXCJ0eXBlXCIsIFwic3RydWN0XCIsIFwiaW50ZXJmYWNlXCIsIFwibWFwXCIsIFwiY2hhblwiLCBcImdvXCIsIFwiZGVmZXJcIiwgXCJzZWxlY3RcIiwgXCJwYWNrYWdlXCIsIFwiaW1wb3J0XCIsIFwidmFyXCIsIFwiY29uc3RcIiwgXCJuaWxcIiwgXCJ0cnVlXCIsIFwiZmFsc2VcIl0sXG4gIGphdmE6IFtcInB1YmxpY1wiLCBcInByaXZhdGVcIiwgXCJwcm90ZWN0ZWRcIiwgXCJjbGFzc1wiLCBcImludGVyZmFjZVwiLCBcImV4dGVuZHNcIiwgXCJpbXBsZW1lbnRzXCIsIFwicmV0dXJuXCIsIFwiaWZcIiwgXCJlbHNlXCIsIFwiZm9yXCIsIFwid2hpbGVcIiwgXCJzd2l0Y2hcIiwgXCJjYXNlXCIsIFwibmV3XCIsIFwic3RhdGljXCIsIFwiZmluYWxcIiwgXCJ2b2lkXCIsIFwiaW50XCIsIFwibG9uZ1wiLCBcImRvdWJsZVwiLCBcImJvb2xlYW5cIiwgXCJTdHJpbmdcIiwgXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwiaW1wb3J0XCIsIFwicGFja2FnZVwiLCBcInRyeVwiLCBcImNhdGNoXCIsIFwiZmluYWxseVwiLCBcInRocm93XCIsIFwidGhyb3dzXCJdLFxuICBzcWw6IFtcInNlbGVjdFwiLCBcImZyb21cIiwgXCJ3aGVyZVwiLCBcImluc2VydFwiLCBcImludG9cIiwgXCJ2YWx1ZXNcIiwgXCJ1cGRhdGVcIiwgXCJzZXRcIiwgXCJkZWxldGVcIiwgXCJjcmVhdGVcIiwgXCJ0YWJsZVwiLCBcImFsdGVyXCIsIFwiZHJvcFwiLCBcImpvaW5cIiwgXCJsZWZ0XCIsIFwicmlnaHRcIiwgXCJpbm5lclwiLCBcIm91dGVyXCIsIFwib25cIiwgXCJncm91cFwiLCBcImJ5XCIsIFwib3JkZXJcIiwgXCJoYXZpbmdcIiwgXCJsaW1pdFwiLCBcIm9mZnNldFwiLCBcImFuZFwiLCBcIm9yXCIsIFwibm90XCIsIFwibnVsbFwiLCBcImFzXCIsIFwiZGlzdGluY3RcIiwgXCJ1bmlvblwiLCBcImFsbFwiLCBcImV4aXN0c1wiLCBcImluXCIsIFwibGlrZVwiLCBcImJldHdlZW5cIiwgXCJwcmltYXJ5XCIsIFwia2V5XCIsIFwiZm9yZWlnblwiLCBcInJlZmVyZW5jZXNcIiwgXCJpbmRleFwiXSxcbiAgYmFzaDogW1wiaWZcIiwgXCJ0aGVuXCIsIFwiZWxzZVwiLCBcImVsaWZcIiwgXCJmaVwiLCBcImZvclwiLCBcIndoaWxlXCIsIFwiZG9cIiwgXCJkb25lXCIsIFwiY2FzZVwiLCBcImVzYWNcIiwgXCJmdW5jdGlvblwiLCBcInJldHVyblwiLCBcImxvY2FsXCIsIFwiZXhwb3J0XCIsIFwiZWNob1wiLCBcImV4aXRcIiwgXCJpblwiXSxcbiAgc2g6IFtcImlmXCIsIFwidGhlblwiLCBcImVsc2VcIiwgXCJlbGlmXCIsIFwiZmlcIiwgXCJmb3JcIiwgXCJ3aGlsZVwiLCBcImRvXCIsIFwiZG9uZVwiLCBcImNhc2VcIiwgXCJlc2FjXCIsIFwiZnVuY3Rpb25cIiwgXCJyZXR1cm5cIiwgXCJsb2NhbFwiLCBcImV4cG9ydFwiLCBcImVjaG9cIiwgXCJleGl0XCIsIFwiaW5cIl0sXG4gIGpzb246IFtcInRydWVcIiwgXCJmYWxzZVwiLCBcIm51bGxcIl0sXG4gIGNzczogW10sXG4gIGh0bWw6IFtdLFxufTtcblxuZnVuY3Rpb24ganNLZXl3b3JkcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbXCJjb25zdFwiLCBcImxldFwiLCBcInZhclwiLCBcImZ1bmN0aW9uXCIsIFwicmV0dXJuXCIsIFwiaWZcIiwgXCJlbHNlXCIsIFwiZm9yXCIsIFwid2hpbGVcIiwgXCJkb1wiLCBcInN3aXRjaFwiLCBcImNhc2VcIiwgXCJkZWZhdWx0XCIsIFwiYnJlYWtcIiwgXCJjb250aW51ZVwiLCBcIm5ld1wiLCBcImRlbGV0ZVwiLCBcInR5cGVvZlwiLCBcImluc3RhbmNlb2ZcIiwgXCJpblwiLCBcIm9mXCIsIFwiY2xhc3NcIiwgXCJleHRlbmRzXCIsIFwic3VwZXJcIiwgXCJ0aGlzXCIsIFwiaW1wb3J0XCIsIFwiZXhwb3J0XCIsIFwiZnJvbVwiLCBcImFzXCIsIFwiYXN5bmNcIiwgXCJhd2FpdFwiLCBcInlpZWxkXCIsIFwidHJ5XCIsIFwiY2F0Y2hcIiwgXCJmaW5hbGx5XCIsIFwidGhyb3dcIiwgXCJ0cnVlXCIsIFwiZmFsc2VcIiwgXCJudWxsXCIsIFwidW5kZWZpbmVkXCIsIFwidm9pZFwiLCBcInN0YXRpY1wiLCBcImdldFwiLCBcInNldFwiXTtcbn1cblxuY29uc3QgVE9LRU5fUkUgPVxuICAvKFxcL1xcL1teXFxuXSp8I1teXFxuXSp8LS1bXlxcbl0qfFxcL1xcKltcXHNcXFNdKj9cXCpcXC8pfChcIig/OlteXCJcXFxcXFxuXXxcXFxcLikqXCJ8Jyg/OlteJ1xcXFxcXG5dfFxcXFwuKSonfGAoPzpbXmBcXFxcXXxcXFxcLikqYCl8KFxcYlxcZCsoPzpcXC5cXGQrKT9cXGIpfChbQS1aYS16XyRdW0EtWmEtejAtOV8kXSopfChcXHMrfFteXFxzQS1aYS16MC05XyRdKykvZztcblxuLyoqIFRva2VuaXplIGBjb2RlYCBmb3IgbGFuZ3VhZ2UgYGxhbmdgIChsb3dlcmNhc2U7IHVua25vd24gXHUyMUQyIHBsYWluKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBoaWdobGlnaHRDb2RlKGNvZGU6IHN0cmluZywgbGFuZzogc3RyaW5nKTogSGxUb2tlbltdIHtcbiAgY29uc3Qga3cgPSBuZXcgU2V0KEtFWVdPUkRTW2xhbmddID8/IFtdKTtcbiAgY29uc3QgY2FzZUluc2Vuc2l0aXZlID0gbGFuZyA9PT0gXCJzcWxcIjtcbiAgY29uc3QgdG9rZW5zOiBIbFRva2VuW10gPSBbXTtcbiAgY29uc3QgcHVzaCA9IChjbHM6IEhsQ2xhc3MsIHRleHQ6IHN0cmluZykgPT4ge1xuICAgIGNvbnN0IGxhc3QgPSB0b2tlbnNbdG9rZW5zLmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0ICYmIGxhc3QuY2xzID09PSBjbHMpIGxhc3QudGV4dCArPSB0ZXh0O1xuICAgIGVsc2UgdG9rZW5zLnB1c2goeyBjbHMsIHRleHQgfSk7XG4gIH07XG5cbiAgLy8gQ29tbWVudCBzeW50YXggdmFyaWVzOyBvbmx5IHRyZWF0IGEgbWFya2VyIGFzIGEgY29tbWVudCB3aGVuIHRoZSBsYW5ndWFnZVxuICAvLyBwbGF1c2libHkgdXNlcyBpdCAoIyBmb3IgcHl0aG9uL2Jhc2gsIC0tIGZvciBzcWwsIC8vIGFuZCAvKiAqLyBlbHNld2hlcmUpLlxuICBjb25zdCBoYXNoQ29tbWVudCA9IGxhbmcgPT09IFwicHl0aG9uXCIgfHwgbGFuZyA9PT0gXCJweVwiIHx8IGxhbmcgPT09IFwiYmFzaFwiIHx8IGxhbmcgPT09IFwic2hcIjtcbiAgY29uc3QgZGFzaENvbW1lbnQgPSBsYW5nID09PSBcInNxbFwiO1xuICBjb25zdCBzbGFzaENvbW1lbnQgPSAhaGFzaENvbW1lbnQgJiYgIWRhc2hDb21tZW50ICYmIGxhbmcgIT09IFwiY3NzXCIgJiYgbGFuZyAhPT0gXCJodG1sXCI7XG5cbiAgVE9LRU5fUkUubGFzdEluZGV4ID0gMDtcbiAgbGV0IG06IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobSA9IFRPS0VOX1JFLmV4ZWMoY29kZSkpICE9PSBudWxsKSB7XG4gICAgY29uc3QgW2Z1bGwsIGNvbSwgc3RyLCBudW0sIHdvcmQsIG90aGVyXSA9IG07XG4gICAgaWYgKGNvbSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBpc0NvbW1lbnQgPVxuICAgICAgICAoY29tLnN0YXJ0c1dpdGgoXCIjXCIpICYmIGhhc2hDb21tZW50KSB8fFxuICAgICAgICAoY29tLnN0YXJ0c1dpdGgoXCItLVwiKSAmJiBkYXNoQ29tbWVudCkgfHxcbiAgICAgICAgKChjb20uc3RhcnRzV2l0aChcIi8vXCIpIHx8IGNvbS5zdGFydHNXaXRoKFwiLypcIikpICYmIHNsYXNoQ29tbWVudCk7XG4gICAgICBwdXNoKGlzQ29tbWVudCA/IFwiY29tXCIgOiBcInBsblwiLCBjb20pO1xuICAgIH0gZWxzZSBpZiAoc3RyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHB1c2goXCJzdHJcIiwgc3RyKTtcbiAgICB9IGVsc2UgaWYgKG51bSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwdXNoKFwibnVtXCIsIG51bSk7XG4gICAgfSBlbHNlIGlmICh3b3JkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHByb2JlID0gY2FzZUluc2Vuc2l0aXZlID8gd29yZC50b0xvd2VyQ2FzZSgpIDogd29yZDtcbiAgICAgIHB1c2goa3cuaGFzKHByb2JlKSA/IFwia3dcIiA6IFwicGxuXCIsIHdvcmQpO1xuICAgIH0gZWxzZSBpZiAob3RoZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcHVzaChcInBsblwiLCBvdGhlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1c2goXCJwbG5cIiwgZnVsbCk7XG4gICAgfVxuICB9XG4gIHJldHVybiB0b2tlbnM7XG59XG4iLCAiLy8gTWFya2Rvd24gcmVuZGVyIHRyZWUgXHUyMTkyIERPTSAoc2hhZG93LXJvb3Qgc2FmZSwgbm8gaW5uZXJIVE1MIGZvciBjb250ZW50KS5cbi8vXG4vLyBDb2RlIGJsb2NrcyBnZXQgYSB0b29sYmFyIChjb3B5IC8gZG93bmxvYWQgLyB3cmFwKSB1c2luZyB0aGUgY29uZmlndXJlZFxuLy8gdGV4dCBzdHJpbmdzOyBsaW5rcyBvcGVuIGluIGEgbmV3IHRhYiBhbmQgYXJlIGdhdGVkIGJ5IHRoZSBMaW5rUG9saWN5IGF0XG4vLyBwYXJzZSB0aW1lIChkaXNhbGxvd2VkIGxpbmtzIGFycml2ZSBhcyBgYWxsb3dlZDogZmFsc2VgIGFuZCByZW5kZXIgYXNcbi8vIHBsYWluIHRleHQpLlxuXG5pbXBvcnQgeyBoaWdobGlnaHRDb2RlIH0gZnJvbSBcIi4vaGlnaGxpZ2h0XCI7XG5pbXBvcnQgdHlwZSB7IE1kQmxvY2ssIE1kSW5saW5lIH0gZnJvbSBcIi4vbWFya2Rvd25cIjtcbmltcG9ydCB7IElDT05TIH0gZnJvbSBcIi4vaWNvbnNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNZFJlbmRlck9wdGlvbnMge1xuICBzeW50YXhUaGVtZTogXCJhdXRvXCIgfCBcImxpZ2h0XCIgfCBcImRhcmtcIjtcbiAgdGV4dDoge1xuICAgIGNvcHk6IHN0cmluZztcbiAgICBjb3BpZWQ6IHN0cmluZztcbiAgICBkb3dubG9hZDogc3RyaW5nO1xuICAgIHdyYXA6IHN0cmluZztcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck1hcmtkb3duKFxuICBibG9ja3M6IE1kQmxvY2tbXSxcbiAgb3B0czogTWRSZW5kZXJPcHRpb25zLFxuKTogRG9jdW1lbnRGcmFnbWVudCB7XG4gIGNvbnN0IGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XG4gICAgc3dpdGNoIChibG9jay5raW5kKSB7XG4gICAgICBjYXNlIFwicGFyYWdyYXBoXCI6IHtcbiAgICAgICAgY29uc3QgcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJwXCIpO1xuICAgICAgICBwLmFwcGVuZChyZW5kZXJJbmxpbmUoYmxvY2suY2hpbGRyZW4pKTtcbiAgICAgICAgZnJhZy5hcHBlbmQocCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSBcImhlYWRpbmdcIjoge1xuICAgICAgICBjb25zdCBoID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChgaCR7TWF0aC5taW4oYmxvY2subGV2ZWwsIDQpfWApO1xuICAgICAgICBoLmFwcGVuZChyZW5kZXJJbmxpbmUoYmxvY2suY2hpbGRyZW4pKTtcbiAgICAgICAgZnJhZy5hcHBlbmQoaCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSBcImxpc3RcIjoge1xuICAgICAgICBjb25zdCBsaXN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChibG9jay5vcmRlcmVkID8gXCJvbFwiIDogXCJ1bFwiKTtcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGJsb2NrLml0ZW1zKSB7XG4gICAgICAgICAgY29uc3QgbGkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwibGlcIik7XG4gICAgICAgICAgbGkuYXBwZW5kKHJlbmRlcklubGluZShpdGVtKSk7XG4gICAgICAgICAgbGlzdC5hcHBlbmQobGkpO1xuICAgICAgICB9XG4gICAgICAgIGZyYWcuYXBwZW5kKGxpc3QpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJjb2RlX2Jsb2NrXCI6XG4gICAgICAgIGZyYWcuYXBwZW5kKHJlbmRlckNvZGVCbG9jayhibG9jay5sYW5nLCBibG9jay50ZXh0LCBvcHRzKSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZnJhZztcbn1cblxuZnVuY3Rpb24gcmVuZGVySW5saW5lKG5vZGVzOiBNZElubGluZVtdKTogRG9jdW1lbnRGcmFnbWVudCB7XG4gIGNvbnN0IGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gIGZvciAoY29uc3Qgbm9kZSBvZiBub2Rlcykge1xuICAgIHN3aXRjaCAobm9kZS5raW5kKSB7XG4gICAgICBjYXNlIFwidGV4dFwiOlxuICAgICAgICBmcmFnLmFwcGVuZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShub2RlLnRleHQpKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIFwic3Ryb25nXCI6IHtcbiAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3Ryb25nXCIpO1xuICAgICAgICBlbC5hcHBlbmQocmVuZGVySW5saW5lKG5vZGUuY2hpbGRyZW4pKTtcbiAgICAgICAgZnJhZy5hcHBlbmQoZWwpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJlbVwiOiB7XG4gICAgICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImVtXCIpO1xuICAgICAgICBlbC5hcHBlbmQocmVuZGVySW5saW5lKG5vZGUuY2hpbGRyZW4pKTtcbiAgICAgICAgZnJhZy5hcHBlbmQoZWwpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJkZWxcIjoge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkZWxcIik7XG4gICAgICAgIGVsLmFwcGVuZChyZW5kZXJJbmxpbmUobm9kZS5jaGlsZHJlbikpO1xuICAgICAgICBmcmFnLmFwcGVuZChlbCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSBcImNvZGVcIjoge1xuICAgICAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJjb2RlXCIpO1xuICAgICAgICBlbC50ZXh0Q29udGVudCA9IG5vZGUudGV4dDtcbiAgICAgICAgZnJhZy5hcHBlbmQoZWwpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgXCJsaW5rXCI6IHtcbiAgICAgICAgaWYgKG5vZGUuYWxsb3dlZCkge1xuICAgICAgICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYVwiKTtcbiAgICAgICAgICBhLmhyZWYgPSBub2RlLmhyZWY7XG4gICAgICAgICAgYS50YXJnZXQgPSBcIl9ibGFua1wiO1xuICAgICAgICAgIGEucmVsID0gXCJub29wZW5lciBub3JlZmVycmVyXCI7XG4gICAgICAgICAgYS5hcHBlbmQocmVuZGVySW5saW5lKG5vZGUuY2hpbGRyZW4pKTtcbiAgICAgICAgICBmcmFnLmFwcGVuZChhKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBEaXNhbGxvd2VkIGxpbms6IGxhYmVsIG9ubHksIGFzIHBsYWluIHRleHQuXG4gICAgICAgICAgZnJhZy5hcHBlbmQocmVuZGVySW5saW5lKG5vZGUuY2hpbGRyZW4pKTtcbiAgICAgICAgfVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZyYWc7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckNvZGVCbG9jayhcbiAgbGFuZzogc3RyaW5nLFxuICBjb2RlOiBzdHJpbmcsXG4gIG9wdHM6IE1kUmVuZGVyT3B0aW9ucyxcbik6IEhUTUxFbGVtZW50IHtcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIHdyYXAuY2xhc3NOYW1lID0gXCJ2dy1jb2RlYmxvY2tcIjtcbiAgd3JhcC5kYXRhc2V0LnRoZW1lID0gb3B0cy5zeW50YXhUaGVtZTtcblxuICBjb25zdCBiYXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICBiYXIuY2xhc3NOYW1lID0gXCJ2dy1jb2RlYmxvY2stYmFyXCI7XG4gIGNvbnN0IGxhYmVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gIGxhYmVsLnRleHRDb250ZW50ID0gbGFuZyB8fCBcInRleHRcIjtcbiAgYmFyLmFwcGVuZChsYWJlbCk7XG5cbiAgY29uc3QgYWN0aW9ucyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gIGFjdGlvbnMuY2xhc3NOYW1lID0gXCJ2dy1jb2RlYmxvY2stYWN0aW9uc1wiO1xuICBhY3Rpb25zLmFwcGVuZChcbiAgICB0b29sQnV0dG9uKElDT05TLmNvcHksIG9wdHMudGV4dC5jb3B5LCAoYnRuKSA9PiB7XG4gICAgICBjb25zdCBwID0gbmF2aWdhdG9yLmNsaXBib2FyZD8ud3JpdGVUZXh0KGNvZGUpO1xuICAgICAgaWYgKCFwKSByZXR1cm47XG4gICAgICB2b2lkIHBcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIGJ0bi50aXRsZSA9IG9wdHMudGV4dC5jb3BpZWQ7XG4gICAgICAgICAgYnRuLmlubmVySFRNTCA9IElDT05TLmNoZWNrO1xuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgYnRuLnRpdGxlID0gb3B0cy50ZXh0LmNvcHk7XG4gICAgICAgICAgICBidG4uaW5uZXJIVE1MID0gSUNPTlMuY29weTtcbiAgICAgICAgICB9LCAxNTAwKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKCgpID0+IHtcbiAgICAgICAgICAvLyBDbGlwYm9hcmQgd3JpdGUgZmFpbGVkIChwZXJtaXNzaW9ucyAvIGluc2VjdXJlIGNvbnRleHQpLlxuICAgICAgICB9KTtcbiAgICB9KSxcbiAgICB0b29sQnV0dG9uKElDT05TLmRvd25sb2FkLCBvcHRzLnRleHQuZG93bmxvYWQsICgpID0+IHtcbiAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbY29kZV0sIHsgdHlwZTogXCJ0ZXh0L3BsYWluXCIgfSk7XG4gICAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xuICAgICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJhXCIpO1xuICAgICAgYS5ocmVmID0gdXJsO1xuICAgICAgYS5kb3dubG9hZCA9IGBzbmlwcGV0LiR7bGFuZyB8fCBcInR4dFwifWA7XG4gICAgICBhLmNsaWNrKCk7XG4gICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XG4gICAgfSksXG4gICAgdG9vbEJ1dHRvbihJQ09OUy53cmFwLCBvcHRzLnRleHQud3JhcCwgKCkgPT4ge1xuICAgICAgaWYgKHdyYXAuaGFzQXR0cmlidXRlKFwiZGF0YS13cmFwXCIpKSB3cmFwLnJlbW92ZUF0dHJpYnV0ZShcImRhdGEtd3JhcFwiKTtcbiAgICAgIGVsc2Ugd3JhcC5zZXRBdHRyaWJ1dGUoXCJkYXRhLXdyYXBcIiwgXCJcIik7XG4gICAgfSksXG4gICk7XG4gIGJhci5hcHBlbmQoYWN0aW9ucyk7XG4gIHdyYXAuYXBwZW5kKGJhcik7XG5cbiAgY29uc3QgcHJlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInByZVwiKTtcbiAgY29uc3QgY29kZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImNvZGVcIik7XG4gIGZvciAoY29uc3QgdG9rZW4gb2YgaGlnaGxpZ2h0Q29kZShjb2RlLCBsYW5nKSkge1xuICAgIGlmICh0b2tlbi5jbHMgPT09IFwicGxuXCIpIHtcbiAgICAgIGNvZGVFbC5hcHBlbmQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUodG9rZW4udGV4dCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzcGFuID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICBzcGFuLmNsYXNzTmFtZSA9IGBobC0ke3Rva2VuLmNsc31gO1xuICAgICAgc3Bhbi50ZXh0Q29udGVudCA9IHRva2VuLnRleHQ7XG4gICAgICBjb2RlRWwuYXBwZW5kKHNwYW4pO1xuICAgIH1cbiAgfVxuICBwcmUuYXBwZW5kKGNvZGVFbCk7XG4gIHdyYXAuYXBwZW5kKHByZSk7XG4gIHJldHVybiB3cmFwO1xufVxuXG5mdW5jdGlvbiB0b29sQnV0dG9uKFxuICBpY29uOiBzdHJpbmcsXG4gIHRpdGxlOiBzdHJpbmcsXG4gIG9uQ2xpY2s6IChidG46IEhUTUxCdXR0b25FbGVtZW50KSA9PiB2b2lkLFxuKTogSFRNTEJ1dHRvbkVsZW1lbnQge1xuICBjb25zdCBidG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICBidG4uY2xhc3NOYW1lID0gXCJ2dy1pY29uYnRuXCI7XG4gIGJ0bi5zdHlsZS53aWR0aCA9IFwiMjJweFwiO1xuICBidG4uc3R5bGUuaGVpZ2h0ID0gXCIyMnB4XCI7XG4gIGJ0bi50aXRsZSA9IHRpdGxlO1xuICBidG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCB0aXRsZSk7XG4gIGJ0bi5pbm5lckhUTUwgPSBpY29uOyAvLyBzdGF0aWMsIHRydXN0ZWQgaWNvbiBtYXJrdXAgb25seVxuICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG9uQ2xpY2soYnRuKSk7XG4gIHJldHVybiBidG47XG59XG4iLCAiLy8gQWdlbnQtYnViYmxlIG91dHB1dC1mb3JtYXQgZ2F0ZSAoYWdlbnQgYmVoYXZpb3IgcGFuZWwgXHUyMDE0IFdpZGdldCByb3csXG4vLyBwbGFuIFx1MDBBNzcuNikuIFRoZSBsZWFkaW5nIGNoYXQgYHNlc3Npb25gIGZyYW1lIGNhcnJpZXMgYG91dHB1dF9mb3JtYXRgO1xuLy8gdGhlIHdpZGdldCByZW5kZXJzIGFnZW50IHRleHQgYXMgbWFya2Rvd24gb3IgYXMgbGl0ZXJhbCB0ZXh0IGZyb20gaXQuXG4vLyBUaGUgZmxhZyByaWRlcyB0aGUgQ0hBVCBmcmFtZSBvbmx5OiB2b2ljZSB0cmFuc2NyaXB0cyBhbHdheXMgcmVuZGVyXG4vLyBtYXJrZG93biAodG9kYXkncyBiZWhhdmlvdXIpLCBzbyBhIFBsYWluLXRleHQgV2lkZ2V0IHJvdyBuZXZlciB0b3VjaGVzXG4vLyBhIHZvaWNlIGNvbnZlcnNhdGlvbi5cblxuLyoqIFdpcmUgdmFsdWVzIG9mIGBjaGFubmVsX2NhdGFsb2c6OnRleHQ6OlRleHRPdXRwdXRGb3JtYXRgLiAqL1xuZXhwb3J0IHR5cGUgT3V0cHV0Rm9ybWF0ID0gXCJwbGFpbl90ZXh0XCIgfCBcIm1hcmtkb3duXCI7XG5cbi8qKiBUb2RheSdzIHJlbmRlcmluZyBcdTIwMTQgdXNlZCB1bnRpbCB0aGUgYHNlc3Npb25gIGZyYW1lIGFycml2ZXMgYW5kIGZvciBldmVyeVxuICogIHZvaWNlIHRyYW5zY3JpcHQuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9PVVRQVVRfRk9STUFUOiBPdXRwdXRGb3JtYXQgPSBcIm1hcmtkb3duXCI7XG5cbi8qKiBUaGUgZnJhbWUncyBgb3V0cHV0X2Zvcm1hdGAuIE1pc3Npbmcgb3IgdW5rbm93biBcdTIxRDIgdGhlIGRlZmF1bHQsIHNvIGFuXG4gKiAgb2xkZXIgQVBJIChvciBhIG1hbGZvcm1lZCBmcmFtZSkgbmV2ZXIgc3RyaXBzIGZvcm1hdHRpbmcgZnJvbSBhIGxpdmVcbiAqICB3aWRnZXQuICovXG5leHBvcnQgZnVuY3Rpb24gb3V0cHV0Rm9ybWF0RnJvbUZyYW1lKHZhbHVlOiB1bmtub3duKTogT3V0cHV0Rm9ybWF0IHtcbiAgcmV0dXJuIHZhbHVlID09PSBcInBsYWluX3RleHRcIiA/IFwicGxhaW5fdGV4dFwiIDogREVGQVVMVF9PVVRQVVRfRk9STUFUO1xufVxuXG4vKiogTWluaW1hbCBidWJibGUgc3VyZmFjZSBcdTIwMTQgYSBET00gZWxlbWVudCBpbiB0aGUgd2lkZ2V0LCBhIHN0dWIgaW4gdGVzdHMuICovXG5leHBvcnQgaW50ZXJmYWNlIEFnZW50QnViYmxlIHtcbiAgdGV4dENvbnRlbnQ6IHN0cmluZyB8IG51bGw7XG4gIGFwcGVuZChub2RlOiBOb2RlKTogdm9pZDtcbn1cblxuLyoqIFRoZSBPTkUgYWdlbnQtYnViYmxlIHRleHQgcmVuZGVyLiBgcGxhaW5fdGV4dGAgXHUyMUQyIGxpdGVyYWwgdGV4dCAodGhlIHNhbWVcbiAqICBwYXRoIHVzZXIgYnViYmxlcyB0YWtlOiBhc3Rlcmlza3Mgc3RheSBhc3Rlcmlza3MsIG5vIGxpbmtzLCBubyBjb2RlXG4gKiAgYmxvY2tzKTsgYG1hcmtkb3duYCBcdTIxRDIgdGhlIHJlbmRlcmVyJ3Mgbm9kZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW5kZXJBZ2VudFRleHQoXG4gIGJ1YmJsZTogQWdlbnRCdWJibGUsXG4gIHRleHQ6IHN0cmluZyxcbiAgZm9ybWF0OiBPdXRwdXRGb3JtYXQsXG4gIG1hcmtkb3duOiAodGV4dDogc3RyaW5nKSA9PiBOb2RlLFxuKTogdm9pZCB7XG4gIGlmIChmb3JtYXQgPT09IFwicGxhaW5fdGV4dFwiKSB7XG4gICAgYnViYmxlLnRleHRDb250ZW50ID0gdGV4dDtcbiAgICByZXR1cm47XG4gIH1cbiAgYnViYmxlLmFwcGVuZChtYXJrZG93bih0ZXh0KSk7XG59XG4iLCAiLy8gU2hhZG93LXJvb3Qgc3R5bGVzaGVldC4gRXZlcnkgdmlzdWFsIGtub2IgZmxvd3MgdGhyb3VnaCB0aGUgLS12dy0qXG4vLyBjdXN0b20gcHJvcGVydGllcyBzZXQgZnJvbSB0aGUgY29uZmlnIChzZWUgY29uZmlnLnRzIGJ1aWxkQ3NzVmFycykuXG5cbmV4cG9ydCBjb25zdCBXSURHRVRfQ1NTID0gYFxuOmhvc3QgeyBhbGw6IGluaXRpYWw7IH1cbiogeyBib3gtc2l6aW5nOiBib3JkZXItYm94OyBtYXJnaW46IDA7IHBhZGRpbmc6IDA7IH1cbmJ1dHRvbiB7IGZvbnQ6IGluaGVyaXQ7IGJhY2tncm91bmQ6IG5vbmU7IGJvcmRlcjogbm9uZTsgY3Vyc29yOiBwb2ludGVyOyBjb2xvcjogaW5oZXJpdDsgfVxuaW5wdXQsIHRleHRhcmVhIHsgZm9udDogaW5oZXJpdDsgY29sb3I6IGluaGVyaXQ7IH1cblxuLnZ3LXJvb3Qge1xuICBwb3NpdGlvbjogZml4ZWQ7XG4gIHotaW5kZXg6IDIxNDc0ODMwMDA7XG4gIGZvbnQtZmFtaWx5OiAtYXBwbGUtc3lzdGVtLCBCbGlua01hY1N5c3RlbUZvbnQsIFwiU2Vnb2UgVUlcIiwgUm9ib3RvLCBIZWx2ZXRpY2EsIEFyaWFsLCBzYW5zLXNlcmlmO1xuICBmb250LXNpemU6IDE0cHg7XG4gIGxpbmUtaGVpZ2h0OiAxLjQ1O1xuICBjb2xvcjogdmFyKC0tdnctYmFzZS1wcmltYXJ5KTtcbiAgZGlzcGxheTogZmxleDtcbiAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgYWxpZ24taXRlbXM6IGZsZXgtZW5kO1xuICBnYXA6IDEwcHg7XG59XG4vKiBQcmV2aWV3IG1vZGUgKGRhc2hib2FyZCBzZXR0aW5ncyBwYWdlKTogZmlsbCB0aGUgcHJldmlldyBjb250YWluZXIgYW5kXG4gICBzaXplIHRoZSBzaGVldCB0byBJVCwgbm90IHRoZSB2aWV3cG9ydCBcdTIwMTQgb3RoZXJ3aXNlIHRoZSBzaGVldCBjbGlwcy5cbiAgIFRoZSBbZGF0YS1wbGFjZW1lbnRdIGNvbXBvdW5kIG91dHJhbmtzIHRoZSBjb3JuZXItcGxhY2VtZW50IHJ1bGVzIGJlbG93XG4gICByZWdhcmRsZXNzIG9mIHNvdXJjZSBvcmRlci4gKi9cbi52dy1yb290W2RhdGEtcHJldmlld10sXG4udnctcm9vdFtkYXRhLXByZXZpZXddW2RhdGEtcGxhY2VtZW50XSB7XG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgaW5zZXQ6IDA7XG4gIHBhZGRpbmc6IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7XG4gIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gIGFsaWduLWl0ZW1zOiBmbGV4LWVuZDtcbiAganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDtcbiAgdHJhbnNmb3JtOiBub25lO1xufVxuLnZ3LXJvb3RbZGF0YS1wcmV2aWV3XSAudnctc2hlZXQsXG4udnctcm9vdFtkYXRhLXByZXZpZXddIC52dy1zaGVldFtkYXRhLWxhcmdlXSB7XG4gIG1heC1oZWlnaHQ6IDEwMCU7XG4gIG1heC13aWR0aDogMTAwJTtcbiAgbWluLWhlaWdodDogMDtcbn1cbi52dy1yb290W2RhdGEtcGxhY2VtZW50PVwiYm90dG9tLXJpZ2h0XCJdIHsgcmlnaHQ6IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7IGJvdHRvbTogdmFyKC0tdnctb3ZlcmxheS1wYWRkaW5nKTsgfVxuLnZ3LXJvb3RbZGF0YS1wbGFjZW1lbnQ9XCJib3R0b20tbGVmdFwiXSAgeyBsZWZ0OiB2YXIoLS12dy1vdmVybGF5LXBhZGRpbmcpOyBib3R0b206IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7IGFsaWduLWl0ZW1zOiBmbGV4LXN0YXJ0OyB9XG4udnctcm9vdFtkYXRhLXBsYWNlbWVudD1cImJvdHRvbVwiXSAgICAgICB7IGxlZnQ6IDUwJTsgdHJhbnNmb3JtOiB0cmFuc2xhdGVYKC01MCUpOyBib3R0b206IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IH1cbi52dy1yb290W2RhdGEtcGxhY2VtZW50PVwidG9wLXJpZ2h0XCJdICAgIHsgcmlnaHQ6IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7IHRvcDogdmFyKC0tdnctb3ZlcmxheS1wYWRkaW5nKTsgZmxleC1kaXJlY3Rpb246IGNvbHVtbi1yZXZlcnNlOyB9XG4udnctcm9vdFtkYXRhLXBsYWNlbWVudD1cInRvcC1sZWZ0XCJdICAgICB7IGxlZnQ6IHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZyk7IHRvcDogdmFyKC0tdnctb3ZlcmxheS1wYWRkaW5nKTsgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW4tcmV2ZXJzZTsgfVxuLnZ3LXJvb3RbZGF0YS1wbGFjZW1lbnQ9XCJ0b3BcIl0gICAgICAgICAgeyBsZWZ0OiA1MCU7IHRyYW5zZm9ybTogdHJhbnNsYXRlWCgtNTAlKTsgdG9wOiB2YXIoLS12dy1vdmVybGF5LXBhZGRpbmcpOyBhbGlnbi1pdGVtczogY2VudGVyOyBmbGV4LWRpcmVjdGlvbjogY29sdW1uLXJldmVyc2U7IH1cblxuLyogXHUyNTAwXHUyNTAwIExhdW5jaGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuLnZ3LWxhdW5jaGVyIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGdhcDogMTBweDtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYWNjZW50KTtcbiAgY29sb3I6IHZhcigtLXZ3LWFjY2VudC1wcmltYXJ5KTtcbiAgYm9yZGVyLXJhZGl1czogdmFyKC0tdnctYnV0dG9uLXJhZGl1cyk7XG4gIHBhZGRpbmc6IDEycHggMThweDtcbiAgYm94LXNoYWRvdzogMCA4cHggMjhweCByZ2JhKDAsMCwwLC4yMik7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQgLjE1cyBlYXNlLCB0cmFuc2Zvcm0gLjFzIGVhc2U7XG59XG4udnctbGF1bmNoZXI6aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1hY2NlbnQtaG92ZXIpOyB9XG4udnctbGF1bmNoZXI6YWN0aXZlIHsgYmFja2dyb3VuZDogdmFyKC0tdnctYWNjZW50LWFjdGl2ZSk7IHRyYW5zZm9ybTogc2NhbGUoLjk4KTsgfVxuLnZ3LWxhdW5jaGVyIC52dy1hdmF0YXIgeyB3aWR0aDogMjZweDsgaGVpZ2h0OiAyNnB4OyB9XG4udnctbGF1bmNoZXItbGFiZWwgeyBmb250LXdlaWdodDogNjAwOyB3aGl0ZS1zcGFjZTogbm93cmFwOyB9XG4udnctbGF1bmNoZXJbZGF0YS12YXJpYW50PVwidGlueVwiXSB7IHBhZGRpbmc6IDVweDsgYm9yZGVyLXJhZGl1czogNTAlOyB9XG4udnctbGF1bmNoZXJbZGF0YS12YXJpYW50PVwidGlueVwiXSAudnctYXZhdGFyIHsgd2lkdGg6IDQ0cHg7IGhlaWdodDogNDRweDsgfVxuLnZ3LWxhdW5jaGVyW2RhdGEtdmFyaWFudD1cInRpbnlcIl0gLnZ3LWxhdW5jaGVyLWxhYmVsIHsgZGlzcGxheTogbm9uZTsgfVxuLnZ3LWxhdW5jaGVyW2RhdGEtdmFyaWFudD1cImZ1bGxcIl0geyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBwYWRkaW5nOiAxNnB4IDIycHg7IGdhcDogOHB4OyB9XG4udnctbGF1bmNoZXJbZGF0YS12YXJpYW50PVwiZnVsbFwiXSAudnctYXZhdGFyIHsgd2lkdGg6IDQwcHg7IGhlaWdodDogNDBweDsgfVxuXG4vKiBcdTI1MDBcdTI1MDAgQXZhdGFyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuLnZ3LWF2YXRhciB7XG4gIHdpZHRoOiAzNHB4OyBoZWlnaHQ6IDM0cHg7XG4gIGJvcmRlci1yYWRpdXM6IDUwJTtcbiAgZmxleDogbm9uZTtcbiAgYmFja2dyb3VuZDogcmFkaWFsLWdyYWRpZW50KGNpcmNsZSBhdCAzMCUgMzAlLCB2YXIoLS12dy1vcmItMSwgIzc5NTlmZiksIHZhcigtLXZ3LW9yYi0yLCAjOWI3YWZmKSk7XG4gIG92ZXJmbG93OiBoaWRkZW47XG59XG4udnctYXZhdGFyIGltZyB7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IG9iamVjdC1maXQ6IGNvdmVyOyBkaXNwbGF5OiBibG9jazsgfVxuLnZ3LWF2YXRhci1nbHlwaCB7IGRpc3BsYXk6IGZsZXg7IHdpZHRoOiAxMDAlOyBoZWlnaHQ6IDEwMCU7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyOyBjb2xvcjogI2ZmZjsgfVxuLnZ3LWF2YXRhci1nbHlwaCBzdmcgeyB3aWR0aDogNTUlOyBoZWlnaHQ6IDU1JTsgfVxuLnZ3LWF2YXRhciBjYW52YXMgeyB3aWR0aDogMTAwJSAhaW1wb3J0YW50OyBoZWlnaHQ6IDEwMCUgIWltcG9ydGFudDsgfVxuLnZ3LWF2YXRhcltkYXRhLXNwZWFraW5nXSB7IGFuaW1hdGlvbjogdnctcHVsc2UgMS42cyBlYXNlLWluLW91dCBpbmZpbml0ZTsgfVxuQGtleWZyYW1lcyB2dy1wdWxzZSB7XG4gIDAlLCAxMDAlIHsgYm94LXNoYWRvdzogMCAwIDAgMCByZ2JhKDk5LDEwMiwyNDEsLjQ1KTsgfVxuICA1MCUgeyBib3gtc2hhZG93OiAwIDAgMCA3cHggcmdiYSg5OSwxMDIsMjQxLDApOyB9XG59XG5cbi8qIFx1MjUwMFx1MjUwMCBTaGVldCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cbi52dy1zaGVldCB7XG4gIHdpZHRoOiAzNjBweDtcbiAgaGVpZ2h0OiA1NDBweDtcbiAgbWF4LWhlaWdodDogY2FsYygxMDB2aCAtIDIgKiB2YXIoLS12dy1vdmVybGF5LXBhZGRpbmcpKTtcbiAgbWF4LXdpZHRoOiBjYWxjKDEwMHZ3IC0gMiAqIHZhcigtLXZ3LW92ZXJsYXktcGFkZGluZykpO1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS12dy1iYXNlKTtcbiAgY29sb3I6IHZhcigtLXZ3LWJhc2UtcHJpbWFyeSk7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogdmFyKC0tdnctc2hlZXQtcmFkaXVzKTtcbiAgYm94LXNoYWRvdzogMCAxOHB4IDUwcHggcmdiYSgwLDAsMCwuMjgpO1xuICBvdmVyZmxvdzogaGlkZGVuO1xufVxuLnZ3LXNoZWV0W2RhdGEtbGFyZ2VdIHsgd2lkdGg6IDQ2MHB4OyBoZWlnaHQ6IDY2MHB4OyB9XG5cbi52dy1oZWFkZXIge1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogY2VudGVyO1xuICBnYXA6IDEwcHg7XG4gIHBhZGRpbmc6IDEycHggMTRweDtcbiAgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbiAgZmxleDogbm9uZTtcbn1cbi52dy1oZWFkZXItbWV0YSB7IGZsZXg6IDE7IG1pbi13aWR0aDogMDsgfVxuLnZ3LWhlYWRlci1uYW1lIHsgZm9udC13ZWlnaHQ6IDYwMDsgZm9udC1zaXplOiAxNHB4OyB3aGl0ZS1zcGFjZTogbm93cmFwOyBvdmVyZmxvdzogaGlkZGVuOyB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsgfVxuLnZ3LWhlYWRlci1zdGF0dXMgeyBmb250LXNpemU6IDEycHg7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogNXB4OyB9XG4udnctc3RhdHVzLWRvdCB7IHdpZHRoOiA3cHg7IGhlaWdodDogN3B4OyBib3JkZXItcmFkaXVzOiA1MCU7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2Utc3VidGxlKTsgZmxleDogbm9uZTsgfVxuLnZ3LXN0YXR1cy1kb3RbZGF0YS1saXZlXSB7IGJhY2tncm91bmQ6ICMyMmM1NWU7IH1cbi52dy1oZWFkZXItYWN0aW9ucyB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMnB4OyB9XG4udnctaWNvbmJ0biB7XG4gIGRpc3BsYXk6IGlubGluZS1mbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcbiAgd2lkdGg6IDMwcHg7IGhlaWdodDogMzBweDtcbiAgYm9yZGVyLXJhZGl1czogOHB4O1xuICBjb2xvcjogdmFyKC0tdnctYmFzZS1zdWJ0bGUpO1xufVxuLnZ3LWljb25idG46aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1iYXNlLWhvdmVyKTsgY29sb3I6IHZhcigtLXZ3LWJhc2UtcHJpbWFyeSk7IH1cbi52dy1pY29uYnRuOmFjdGl2ZSB7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2UtYWN0aXZlKTsgfVxuLnZ3LWljb25idG5bZGF0YS1hY3RpdmVdIHsgY29sb3I6IHZhcigtLXZ3LWJhc2UtcHJpbWFyeSk7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2UtYWN0aXZlKTsgfVxuXG4udnctbGFuZyB7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgY29sb3I6IHZhcigtLXZ3LWJhc2Utc3VidGxlKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogdmFyKC0tdnctZHJvcGRvd24tc2hlZXQtcmFkaXVzKTtcbiAgcGFkZGluZzogM3B4IDhweDtcbiAgbWF4LXdpZHRoOiA5MHB4O1xufVxuXG4vKiBcdTI1MDBcdTI1MDAgQm9keSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cbi52dy1ib2R5IHsgZmxleDogMTsgb3ZlcmZsb3cteTogYXV0bzsgcGFkZGluZzogMTRweDsgZGlzcGxheTogZmxleDsgZmxleC1kaXJlY3Rpb246IGNvbHVtbjsgZ2FwOiAxMHB4OyB9XG4udnctYm9keVtkYXRhLWhpZGRlbl0geyBkaXNwbGF5OiBub25lOyB9XG5cbi52dy1pbnRybyB7XG4gIGZsZXg6IDE7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICBnYXA6IDE0cHg7XG4gIHRleHQtYWxpZ246IGNlbnRlcjtcbiAgcGFkZGluZzogMjBweDtcbn1cbi52dy1pbnRybyAudnctYXZhdGFyIHsgd2lkdGg6IDY0cHg7IGhlaWdodDogNjRweDsgfVxuLnZ3LWludHJvLXRpdGxlIHsgZm9udC13ZWlnaHQ6IDYwMDsgZm9udC1zaXplOiAxNnB4OyB9XG4udnctY3RhIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogOHB4O1xuICBiYWNrZ3JvdW5kOiB2YXIoLS12dy1hY2NlbnQpO1xuICBjb2xvcjogdmFyKC0tdnctYWNjZW50LXByaW1hcnkpO1xuICBib3JkZXItcmFkaXVzOiB2YXIoLS12dy1idXR0b24tcmFkaXVzKTtcbiAgcGFkZGluZzogMTBweCAxOHB4O1xuICBmb250LXdlaWdodDogNjAwO1xufVxuLnZ3LWN0YTpob3ZlciB7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWFjY2VudC1ob3Zlcik7IH1cbi52dy1jdGE6YWN0aXZlIHsgYmFja2dyb3VuZDogdmFyKC0tdnctYWNjZW50LWFjdGl2ZSk7IH1cbi52dy1jdGEtc2Vjb25kYXJ5IHtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIGNvbG9yOiB2YXIoLS12dy1iYXNlLXByaW1hcnkpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS12dy1iYXNlLWJvcmRlcik7XG59XG4udnctY3RhLXNlY29uZGFyeTpob3ZlciB7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2UtaG92ZXIpOyB9XG5cbi52dy1tc2cgeyBtYXgtd2lkdGg6IDg1JTsgfVxuLnZ3LW1zZy1hZ2VudCB7IGFsaWduLXNlbGY6IGZsZXgtc3RhcnQ7IH1cbi52dy1tc2ctdXNlciB7IGFsaWduLXNlbGY6IGZsZXgtZW5kOyB9XG4udnctYnViYmxlIHtcbiAgcGFkZGluZzogOHB4IDEycHg7XG4gIGJvcmRlci1yYWRpdXM6IHZhcigtLXZ3LWJ1YmJsZS1yYWRpdXMpO1xuICB3b3JkLXdyYXA6IGJyZWFrLXdvcmQ7XG4gIG92ZXJmbG93LXdyYXA6IGFueXdoZXJlO1xufVxuLnZ3LW1zZy1hZ2VudCAudnctYnViYmxlIHsgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZS1ob3Zlcik7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTsgfVxuLnZ3LW1zZy11c2VyIC52dy1idWJibGUgeyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1hY2NlbnQpOyBjb2xvcjogdmFyKC0tdnctYWNjZW50LXByaW1hcnkpOyB9XG4udnctc3lzdGVtIHsgYWxpZ24tc2VsZjogY2VudGVyOyBmb250LXNpemU6IDEycHg7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IHRleHQtYWxpZ246IGNlbnRlcjsgfVxuLnZ3LWVycm9yIHsgY29sb3I6IHZhcigtLXZ3LWJhc2UtZXJyb3IpOyBmb250LXNpemU6IDEycHg7IGFsaWduLXNlbGY6IGNlbnRlcjsgdGV4dC1hbGlnbjogY2VudGVyOyB9XG5cbi52dy10eXBpbmcgeyBkaXNwbGF5OiBpbmxpbmUtZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiA2cHg7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IGZvbnQtc2l6ZTogMTJweDsgfVxuLnZ3LXR5cGluZy1kb3RzIHsgZGlzcGxheTogaW5saW5lLWZsZXg7IGdhcDogM3B4OyB9XG4udnctdHlwaW5nLWRvdHMgc3BhbiB7IHdpZHRoOiA1cHg7IGhlaWdodDogNXB4OyBib3JkZXItcmFkaXVzOiA1MCU7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2Utc3VidGxlKTsgYW5pbWF0aW9uOiB2dy1ibGluayAxLjJzIGluZmluaXRlOyB9XG4udnctdHlwaW5nLWRvdHMgc3BhbjpudGgtY2hpbGQoMikgeyBhbmltYXRpb24tZGVsYXk6IC4yczsgfVxuLnZ3LXR5cGluZy1kb3RzIHNwYW46bnRoLWNoaWxkKDMpIHsgYW5pbWF0aW9uLWRlbGF5OiAuNHM7IH1cbkBrZXlmcmFtZXMgdnctYmxpbmsgeyAwJSwgODAlLCAxMDAlIHsgb3BhY2l0eTogLjI1OyB9IDQwJSB7IG9wYWNpdHk6IDE7IH0gfVxuXG4udnctYWN0aW9uIHsgYWxpZ24tc2VsZjogZmxleC1zdGFydDsgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogNnB4OyBmb250LXNpemU6IDEycHg7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTsgYm9yZGVyLXJhZGl1czogOTk5cHg7IHBhZGRpbmc6IDNweCAxMHB4OyB9XG4udnctYWN0aW9uW2RhdGEtc3RhdGU9XCJlcnJvclwiXSB7IGNvbG9yOiB2YXIoLS12dy1iYXNlLWVycm9yKTsgYm9yZGVyLWNvbG9yOiB2YXIoLS12dy1iYXNlLWVycm9yKTsgfVxuLnZ3LXNwaW4geyBhbmltYXRpb246IHZ3LXJvdGF0ZSAxcyBsaW5lYXIgaW5maW5pdGU7IH1cbkBrZXlmcmFtZXMgdnctcm90YXRlIHsgdG8geyB0cmFuc2Zvcm06IHJvdGF0ZSgzNjBkZWcpOyB9IH1cblxuLyogTWFya2Rvd24gKi9cbi52dy1idWJibGUgcCArIHAsIC52dy1idWJibGUgdWwsIC52dy1idWJibGUgb2wsIC52dy1idWJibGUgaDEsIC52dy1idWJibGUgaDIsIC52dy1idWJibGUgaDMsIC52dy1idWJibGUgaDQgeyBtYXJnaW4tdG9wOiA2cHg7IH1cbi52dy1idWJibGUgaDEgeyBmb250LXNpemU6IDE3cHg7IH0gLnZ3LWJ1YmJsZSBoMiB7IGZvbnQtc2l6ZTogMTZweDsgfSAudnctYnViYmxlIGgzLCAudnctYnViYmxlIGg0IHsgZm9udC1zaXplOiAxNXB4OyB9XG4udnctYnViYmxlIHVsLCAudnctYnViYmxlIG9sIHsgcGFkZGluZy1sZWZ0OiAxOHB4OyB9XG4udnctYnViYmxlIGEgeyBjb2xvcjogaW5oZXJpdDsgdGV4dC1kZWNvcmF0aW9uOiB1bmRlcmxpbmU7IH1cbi52dy1idWJibGUgY29kZSB7IGZvbnQtZmFtaWx5OiB1aS1tb25vc3BhY2UsIFNGTW9uby1SZWd1bGFyLCBNZW5sbywgbW9ub3NwYWNlOyBmb250LXNpemU6IDEycHg7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2UtYWN0aXZlKTsgYm9yZGVyLXJhZGl1czogNHB4OyBwYWRkaW5nOiAxcHggNHB4OyB9XG4udnctY29kZWJsb2NrIHsgbWFyZ2luLXRvcDogNnB4OyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS12dy1iYXNlLWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IDhweDsgb3ZlcmZsb3c6IGhpZGRlbjsgZm9udC1zaXplOiAxMnB4OyB9XG4udnctY29kZWJsb2NrLWJhciB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgcGFkZGluZzogM3B4IDhweDsgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZS1ob3Zlcik7IGJvcmRlci1ib3R0b206IDFweCBzb2xpZCB2YXIoLS12dy1iYXNlLWJvcmRlcik7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IGZvbnQtc2l6ZTogMTFweDsgfVxuLnZ3LWNvZGVibG9jay1hY3Rpb25zIHsgZGlzcGxheTogaW5saW5lLWZsZXg7IGdhcDogMnB4OyB9XG4udnctY29kZWJsb2NrIHByZSB7IHBhZGRpbmc6IDhweDsgb3ZlcmZsb3cteDogYXV0bzsgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS13cmFwXSBwcmUgeyB3aGl0ZS1zcGFjZTogcHJlLXdyYXA7IG92ZXJmbG93LXdyYXA6IGFueXdoZXJlOyB9XG4udnctY29kZWJsb2NrIHByZSBjb2RlIHsgYmFja2dyb3VuZDogbm9uZTsgcGFkZGluZzogMDsgfVxuLyogaGlnaGxpZ2h0IHRoZW1lcyAqL1xuLnZ3LWNvZGVibG9ja1tkYXRhLXRoZW1lPVwibGlnaHRcIl0gcHJlIHsgYmFja2dyb3VuZDogI2Y4ZmFmYzsgY29sb3I6ICMwZjE3MmE7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImxpZ2h0XCJdIC5obC1rdyB7IGNvbG9yOiAjN2MzYWVkOyB9XG4udnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJsaWdodFwiXSAuaGwtc3RyIHsgY29sb3I6ICMxNmEzNGE7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImxpZ2h0XCJdIC5obC1jb20geyBjb2xvcjogIzk0YTNiODsgZm9udC1zdHlsZTogaXRhbGljOyB9XG4udnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJsaWdodFwiXSAuaGwtbnVtIHsgY29sb3I6ICNlYTU4MGM7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImRhcmtcIl0gcHJlIHsgYmFja2dyb3VuZDogIzBmMTcyYTsgY29sb3I6ICNlMmU4ZjA7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImRhcmtcIl0gLmhsLWt3IHsgY29sb3I6ICNjNGI1ZmQ7IH1cbi52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImRhcmtcIl0gLmhsLXN0ciB7IGNvbG9yOiAjODZlZmFjOyB9XG4udnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJkYXJrXCJdIC5obC1jb20geyBjb2xvcjogIzY0NzQ4YjsgZm9udC1zdHlsZTogaXRhbGljOyB9XG4udnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJkYXJrXCJdIC5obC1udW0geyBjb2xvcjogI2ZkYmE3NDsgfVxuQG1lZGlhIChwcmVmZXJzLWNvbG9yLXNjaGVtZTogbGlnaHQpIHtcbiAgLnZ3LWNvZGVibG9ja1tkYXRhLXRoZW1lPVwiYXV0b1wiXSBwcmUgeyBiYWNrZ3JvdW5kOiAjZjhmYWZjOyBjb2xvcjogIzBmMTcyYTsgfVxuICAudnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJhdXRvXCJdIC5obC1rdyB7IGNvbG9yOiAjN2MzYWVkOyB9XG4gIC52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImF1dG9cIl0gLmhsLXN0ciB7IGNvbG9yOiAjMTZhMzRhOyB9XG4gIC52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImF1dG9cIl0gLmhsLWNvbSB7IGNvbG9yOiAjOTRhM2I4OyBmb250LXN0eWxlOiBpdGFsaWM7IH1cbiAgLnZ3LWNvZGVibG9ja1tkYXRhLXRoZW1lPVwiYXV0b1wiXSAuaGwtbnVtIHsgY29sb3I6ICNlYTU4MGM7IH1cbn1cbkBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6IGRhcmspIHtcbiAgLnZ3LWNvZGVibG9ja1tkYXRhLXRoZW1lPVwiYXV0b1wiXSBwcmUgeyBiYWNrZ3JvdW5kOiAjMGYxNzJhOyBjb2xvcjogI2UyZThmMDsgfVxuICAudnctY29kZWJsb2NrW2RhdGEtdGhlbWU9XCJhdXRvXCJdIC5obC1rdyB7IGNvbG9yOiAjYzRiNWZkOyB9XG4gIC52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImF1dG9cIl0gLmhsLXN0ciB7IGNvbG9yOiAjODZlZmFjOyB9XG4gIC52dy1jb2RlYmxvY2tbZGF0YS10aGVtZT1cImF1dG9cIl0gLmhsLWNvbSB7IGNvbG9yOiAjNjQ3NDhiOyBmb250LXN0eWxlOiBpdGFsaWM7IH1cbiAgLnZ3LWNvZGVibG9ja1tkYXRhLXRoZW1lPVwiYXV0b1wiXSAuaGwtbnVtIHsgY29sb3I6ICNmZGJhNzQ7IH1cbn1cblxuLyogXHUyNTAwXHUyNTAwIEZvb3RlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cbi52dy1mb290ZXIgeyBmbGV4OiBub25lOyBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tdnctYmFzZS1ib3JkZXIpOyBwYWRkaW5nOiAxMHB4IDEycHg7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogOHB4OyB9XG4udnctaW5wdXRyb3cgeyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDsgfVxuLnZ3LWlucHV0IHtcbiAgZmxleDogMTtcbiAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tdnctYmFzZS1ib3JkZXIpO1xuICBib3JkZXItcmFkaXVzOiB2YXIoLS12dy1pbnB1dC1yYWRpdXMpO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS12dy1iYXNlKTtcbiAgcGFkZGluZzogOHB4IDEycHg7XG4gIG91dGxpbmU6IG5vbmU7XG4gIG1pbi13aWR0aDogMDtcbn1cbi52dy1pbnB1dDpmb2N1cyB7IGJvcmRlci1jb2xvcjogdmFyKC0tdnctYWNjZW50LWJvcmRlcik7IH1cbi52dy1zZW5kYnRuIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICB3aWR0aDogMzZweDsgaGVpZ2h0OiAzNnB4OyBmbGV4OiBub25lO1xuICBiYWNrZ3JvdW5kOiB2YXIoLS12dy1hY2NlbnQpO1xuICBjb2xvcjogdmFyKC0tdnctYWNjZW50LXByaW1hcnkpO1xuICBib3JkZXItcmFkaXVzOiB2YXIoLS12dy1idXR0b24tcmFkaXVzKTtcbn1cbi52dy1zZW5kYnRuOmhvdmVyIHsgYmFja2dyb3VuZDogdmFyKC0tdnctYWNjZW50LWhvdmVyKTsgfVxuLnZ3LXNlbmRidG46ZGlzYWJsZWQgeyBvcGFjaXR5OiAuNTsgY3Vyc29yOiBkZWZhdWx0OyB9XG4udnctYXR0YWNoYnRuIHtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbn1cbi52dy1hdHRhY2hidG46aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1iYXNlLWhvdmVyKTsgY29sb3I6IHZhcigtLXZ3LWJhc2UtcHJpbWFyeSk7IH1cbi52dy1jaGlwcyB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtd3JhcDogd3JhcDsgZ2FwOiA2cHg7IH1cbi52dy1jaGlwIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogNHB4O1xuICBtYXgtd2lkdGg6IDEwMCU7XG4gIHBhZGRpbmc6IDNweCA2cHggM3B4IDEwcHg7XG4gIGZvbnQtc2l6ZTogMTJweDtcbiAgY29sb3I6IHZhcigtLXZ3LWJhc2UtcHJpbWFyeSk7XG4gIGJhY2tncm91bmQ6IHZhcigtLXZ3LWJhc2UtaG92ZXIpO1xuICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS12dy1iYXNlLWJvcmRlcik7XG4gIGJvcmRlci1yYWRpdXM6IHZhcigtLXZ3LWJ1dHRvbi1yYWRpdXMpO1xufVxuLnZ3LWNoaXAtbmFtZSB7XG4gIG1heC13aWR0aDogMTYwcHg7XG4gIG92ZXJmbG93OiBoaWRkZW47IHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzOyB3aGl0ZS1zcGFjZTogbm93cmFwO1xufVxuLnZ3LWNoaXAtcmVtb3ZlIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyO1xuICB3aWR0aDogMThweDsgaGVpZ2h0OiAxOHB4OyBmbGV4OiBub25lO1xuICBjb2xvcjogdmFyKC0tdnctYmFzZS1zdWJ0bGUpO1xuICBib3JkZXItcmFkaXVzOiA1MCU7XG59XG4udnctY2hpcC1yZW1vdmU6aG92ZXIgeyBjb2xvcjogdmFyKC0tdnctYmFzZS1wcmltYXJ5KTsgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZS1hY3RpdmUpOyB9XG4udnctY2FsbHJvdyB7IGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogY2VudGVyOyBnYXA6IDEwcHg7IH1cbi52dy1jYWxsYnRuIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogN3B4O1xuICBwYWRkaW5nOiA4cHggMTZweDtcbiAgYm9yZGVyLXJhZGl1czogdmFyKC0tdnctYnV0dG9uLXJhZGl1cyk7XG4gIGZvbnQtd2VpZ2h0OiA2MDA7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIGNvbG9yOiB2YXIoLS12dy1iYXNlLXByaW1hcnkpO1xufVxuLnZ3LWNhbGxidG46aG92ZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1iYXNlLWhvdmVyKTsgfVxuLnZ3LWNhbGxidG5bZGF0YS1kYW5nZXJdIHsgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZS1lcnJvcik7IGJvcmRlci1jb2xvcjogdmFyKC0tdnctYmFzZS1lcnJvcik7IGNvbG9yOiAjZmZmZmZmOyB9XG4udnctY2FsbGJ0bltkYXRhLWFjY2VudF0geyBiYWNrZ3JvdW5kOiB2YXIoLS12dy1hY2NlbnQpOyBib3JkZXItY29sb3I6IHZhcigtLXZ3LWFjY2VudCk7IGNvbG9yOiB2YXIoLS12dy1hY2NlbnQtcHJpbWFyeSk7IH1cbi52dy1jYWxsYnRuW2RhdGEtYWNjZW50XTpob3ZlciB7IGJhY2tncm91bmQ6IHZhcigtLXZ3LWFjY2VudC1ob3Zlcik7IH1cbi52dy1mb290ZXItbm90ZSB7IGZvbnQtc2l6ZTogMTFweDsgY29sb3I6IHZhcigtLXZ3LWJhc2Utc3VidGxlKTsgdGV4dC1hbGlnbjogY2VudGVyOyBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZ2FwOiA2cHg7IGZsZXgtd3JhcDogd3JhcDsgfVxuLnZ3LWZvb3Rlci1ub3RlIGJ1dHRvbiB7IHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOyBjb2xvcjogaW5oZXJpdDsgfVxuXG4vKiBcdTI1MDBcdTI1MDAgT3ZlcmxheXMgKHRlcm1zIC8gZmVlZGJhY2spIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xuLnZ3LW92ZXJsYXkge1xuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIGluc2V0OiAwO1xuICBiYWNrZ3JvdW5kOiBjb2xvci1taXgoaW4gc3JnYiwgdmFyKC0tdnctYmFzZSkgNTUlLCB0cmFuc3BhcmVudCk7XG4gIGJhY2tkcm9wLWZpbHRlcjogYmx1cigycHgpO1xuICBkaXNwbGF5OiBmbGV4O1xuICBhbGlnbi1pdGVtczogZmxleC1lbmQ7XG4gIHotaW5kZXg6IDU7XG59XG4udnctb3ZlcmxheS1jYXJkIHtcbiAgd2lkdGg6IDEwMCU7XG4gIG1heC1oZWlnaHQ6IDg1JTtcbiAgb3ZlcmZsb3cteTogYXV0bztcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIGJvcmRlci10b3A6IDFweCBzb2xpZCB2YXIoLS12dy1iYXNlLWJvcmRlcik7XG4gIGJvcmRlci1yYWRpdXM6IHZhcigtLXZ3LWNvbXBhY3Qtc2hlZXQtcmFkaXVzKSB2YXIoLS12dy1jb21wYWN0LXNoZWV0LXJhZGl1cykgMCAwO1xuICBwYWRkaW5nOiAxOHB4O1xuICBkaXNwbGF5OiBmbGV4O1xuICBmbGV4LWRpcmVjdGlvbjogY29sdW1uO1xuICBnYXA6IDEycHg7XG59XG4udnctb3ZlcmxheS10aXRsZSB7IGZvbnQtd2VpZ2h0OiA2MDA7IGZvbnQtc2l6ZTogMTVweDsgfVxuLnZ3LW92ZXJsYXktYm9keSB7IGZvbnQtc2l6ZTogMTNweDsgY29sb3I6IHZhcigtLXZ3LWJhc2Utc3VidGxlKTsgbWF4LWhlaWdodDogMjQwcHg7IG92ZXJmbG93LXk6IGF1dG87IH1cbi52dy1vdmVybGF5LWFjdGlvbnMgeyBkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDsgfVxuLnZ3LXN0YXJzIHsgZGlzcGxheTogZmxleDsgZ2FwOiA2cHg7IGp1c3RpZnktY29udGVudDogY2VudGVyOyB9XG4udnctc3RhciB7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IHBhZGRpbmc6IDNweDsgfVxuLnZ3LXN0YXJbZGF0YS1vbl0geyBjb2xvcjogI2Y1OWUwYjsgfVxuLnZ3LXN0YXIgOmlzKHN2ZykgeyBmaWxsOiBub25lOyB9XG4udnctc3RhcltkYXRhLW9uXSA6aXMoc3ZnKSB7IGZpbGw6IGN1cnJlbnRDb2xvcjsgfVxuLnZ3LXRleHRhcmVhIHtcbiAgd2lkdGg6IDEwMCU7XG4gIG1pbi1oZWlnaHQ6IDcycHg7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZ3LWJhc2UtYm9yZGVyKTtcbiAgYm9yZGVyLXJhZGl1czogdmFyKC0tdnctaW5wdXQtcmFkaXVzKTtcbiAgYmFja2dyb3VuZDogdmFyKC0tdnctYmFzZSk7XG4gIHBhZGRpbmc6IDhweCAxMnB4O1xuICByZXNpemU6IHZlcnRpY2FsO1xuICBvdXRsaW5lOiBub25lO1xufVxuLnZ3LWNvbnZvLWlkIHsgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGdhcDogNnB4OyBmb250LXNpemU6IDExcHg7IGNvbG9yOiB2YXIoLS12dy1iYXNlLXN1YnRsZSk7IH1cbi52dy1jb252by1pZCBjb2RlIHsgZm9udC1mYW1pbHk6IHVpLW1vbm9zcGFjZSwgU0ZNb25vLVJlZ3VsYXIsIE1lbmxvLCBtb25vc3BhY2U7IH1cbi52dy1zaGVldC1jb250YWluZXIgeyBwb3NpdGlvbjogcmVsYXRpdmU7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGZsZXg6IDE7IG1pbi1oZWlnaHQ6IDA7IH1cbi52dy1oaWRkZW4geyBkaXNwbGF5OiBub25lICFpbXBvcnRhbnQ7IH1cbmA7XG4iLCAiLy8gQ2Fub25pY2FsIHdpZGdldCB0ZXh0IGtleXMgKyBFbmdsaXNoIGRlZmF1bHRzLlxuLy9cbi8vIFNJTkdMRSBTT1VSQ0UgT0YgVFJVVEggZm9yIHRoZSBvdmVycmlkYWJsZSBVSSBzdHJpbmdzLiBUaHJlZSBjb25zdW1lcnM6XG4vLyAgIDEuIHRoZSB3aWRnZXQgcnVudGltZSAodGhpcyBwYWNrYWdlKSBcdTIwMTQgZmFsbHMgYmFjayB0byB0aGVzZSBkZWZhdWx0cyxcbi8vICAgMi4gdGhlIGRhc2hib2FyZCBzZXR0aW5ncyBVSSAoZnJvbnRlbmQvc3JjLy4uLi93aWRnZXQgdGFiKSBcdTIwMTQgaW1wb3J0cyB0aGlzXG4vLyAgICAgIGZpbGUgZGlyZWN0bHkgYW5kIHJlbmRlcnMgdGhlIGRlZmF1bHRzIGFzIHBsYWNlaG9sZGVycyxcbi8vICAgMy4gYmFja2VuZCB2YWxpZGF0aW9uIFx1MjAxNCB2b3NvcHVsc2UvYmluL3Zvc29wdWxzZS1hcGkvc3JjL3JvdXRlcy93aWRnZXQucnNcbi8vICAgICAgbWlycm9ycyB0aGUgS0VZIFNFVCBhcyBgV0lER0VUX1RFWFRfS0VZU2A7IGEgdW5pdCB0ZXN0IHRoZXJlIHBpbnMgdGhlXG4vLyAgICAgIGNvdW50LiBDaGFuZ2luZyBrZXlzIGhlcmUgcmVxdWlyZXMgY2hhbmdpbmcgdGhlIFJ1c3QgbGlzdCBpbiB0aGUgc2FtZVxuLy8gICAgICBjaGFuZ2Utc2V0LlxuLy9cbi8vIEtleXMgYW5kIGRlZmF1bHRzIG1pcnJvciB0aGUgdmVuZG9yIGNvbnZhaSB3aWRnZXQncyB0ZXh0X2NvbnRlbnRzIG1hcC5cblxuZXhwb3J0IGNvbnN0IFdJREdFVF9URVhUX0RFRkFVTFRTID0ge1xuICBtYWluX2xhYmVsOiBcIk5lZWQgaGVscD9cIixcbiAgc3RhcnRfY2FsbDogXCJTdGFydCBhIGNhbGxcIixcbiAgc3RhcnRfY2hhdDogXCJTdGFydCBhIGNoYXRcIixcbiAgbmV3X2NhbGw6IFwiTmV3IGNhbGxcIixcbiAgZW5kX2NhbGw6IFwiRW5kXCIsXG4gIG11dGVfbWljcm9waG9uZTogXCJNdXRlIG1pY3JvcGhvbmVcIixcbiAgY2hhbmdlX2xhbmd1YWdlOiBcIkNoYW5nZSBsYW5ndWFnZVwiLFxuICBjb2xsYXBzZTogXCJDb2xsYXBzZVwiLFxuICBleHBhbmQ6IFwiRXhwYW5kXCIsXG4gIGNvcGllZDogXCJDb3BpZWQhXCIsXG4gIGFjY2VwdF90ZXJtczogXCJBY2NlcHRcIixcbiAgZGlzbWlzc190ZXJtczogXCJDYW5jZWxcIixcbiAgbGlzdGVuaW5nX3N0YXR1czogXCJMaXN0ZW5pbmdcIixcbiAgc3BlYWtpbmdfc3RhdHVzOiBcIlRhbGsgdG8gaW50ZXJydXB0XCIsXG4gIGNvbm5lY3Rpbmdfc3RhdHVzOiBcIkNvbm5lY3RpbmdcIixcbiAgY2hhdHRpbmdfc3RhdHVzOiBcIkNoYXR0aW5nIHdpdGggQUkgQWdlbnRcIixcbiAgaW5wdXRfbGFiZWw6IFwiVGV4dCBtZXNzYWdlIGlucHV0XCIsXG4gIGlucHV0X3BsYWNlaG9sZGVyOiBcIlNlbmQgYSBtZXNzYWdlXCIsXG4gIGlucHV0X3BsYWNlaG9sZGVyX3RleHRfb25seTogXCJTZW5kIGEgbWVzc2FnZVwiLFxuICBpbnB1dF9wbGFjZWhvbGRlcl9uZXdfY29udmVyc2F0aW9uOiBcIlN0YXJ0IGEgbmV3IGNvbnZlcnNhdGlvblwiLFxuICB1c2VyX2VuZGVkX2NvbnZlcnNhdGlvbjogXCJZb3UgZW5kZWQgdGhlIGNvbnZlcnNhdGlvblwiLFxuICBhZ2VudF9lbmRlZF9jb252ZXJzYXRpb246IFwiVGhlIGFnZW50IGVuZGVkIHRoZSBjb252ZXJzYXRpb25cIixcbiAgY29udmVyc2F0aW9uX2lkOiBcIkNvbnZlcnNhdGlvbiBJRFwiLFxuICBlcnJvcl9vY2N1cnJlZDogXCJBbiBlcnJvciBvY2N1cnJlZFwiLFxuICBjb3B5X2lkOiBcIkNvcHkgSURcIixcbiAgaW5pdGlhdGVfZmVlZGJhY2s6IFwiSG93IHdhcyB0aGlzIGNvbnZlcnNhdGlvbj9cIixcbiAgcmVxdWVzdF9mb2xsb3dfdXBfZmVlZGJhY2s6IFwiVGVsbCB1cyBtb3JlXCIsXG4gIHRoYW5rc19mb3JfZmVlZGJhY2s6IFwiVGhhbmsgeW91IGZvciB5b3VyIGZlZWRiYWNrIVwiLFxuICB0aGFua3NfZm9yX2ZlZWRiYWNrX2RldGFpbHM6XG4gICAgXCJZb3VyIGZlZWRiYWNrIGhlbHBzIHVzIGltcHJvdmUgb3VyIHNlcnZpY2UgYW5kIGJldHRlciBhc3Npc3QgeW91LlwiLFxuICBmb2xsb3dfdXBfZmVlZGJhY2tfcGxhY2Vob2xkZXI6IFwiVGVsbCB1cyBtb3JlIGFib3V0IHlvdXIgZXhwZXJpZW5jZS4uLlwiLFxuICBzdWJtaXQ6IFwiU3VibWl0XCIsXG4gIGdvX2JhY2s6IFwiR28gYmFja1wiLFxuICBzZW5kX21lc3NhZ2U6IFwiU2VuZFwiLFxuICB0ZXh0X21vZGU6IFwiU3dpdGNoIHRvIHRleHQgbW9kZVwiLFxuICB2b2ljZV9tb2RlOiBcIlN3aXRjaCB0byB2b2ljZSBtb2RlXCIsXG4gIHN3aXRjaGVkX3RvX3RleHRfbW9kZTogXCJTd2l0Y2hlZCB0byB0ZXh0IG1vZGVcIixcbiAgc3dpdGNoZWRfdG9fdm9pY2VfbW9kZTogXCJTd2l0Y2hlZCB0byB2b2ljZSBtb2RlXCIsXG4gIGNvcHk6IFwiQ29weVwiLFxuICBkb3dubG9hZDogXCJEb3dubG9hZFwiLFxuICB3cmFwOiBcIldyYXBcIixcbiAgYWdlbnRfd29ya2luZzogXCJXb3JraW5nLi4uXCIsXG4gIGFnZW50X2RvbmU6IFwiQ29tcGxldGVkXCIsXG4gIGFnZW50X2Vycm9yOiBcIkVycm9yIG9jY3VycmVkXCIsXG4gIGF0dGFjaF9maWxlOiBcIkF0dGFjaCBmaWxlXCIsXG4gIHJlbW92ZV9maWxlOiBcIlJlbW92ZSBmaWxlXCIsXG4gIGZpbGVfdXBsb2FkX2Vycm9yOiBcIkZhaWxlZCB0byB1cGxvYWQgZmlsZS5cIixcbiAgZmlsZV90eXBlX3Vuc3VwcG9ydGVkOiBcIlVuc3VwcG9ydGVkIGZpbGUgdHlwZS4gQWNjZXB0ZWQgdHlwZXM6XCIsXG4gIGZpbGVfdG9vX2xhcmdlOiBcIkZpbGUgc2l6ZSBleGNlZWRzIHRoZSBtYXhpbXVtIGxpbWl0LlwiLFxuICBmaWxlX2xpbWl0X3JlYWNoZWQ6IFwiTWF4aW11bSBudW1iZXIgb2YgZmlsZXMgZm9yIHRoaXMgY29udmVyc2F0aW9uIHJlYWNoZWQuXCIsXG4gIHR5cGluZ19pbmRpY2F0b3I6IFwiQWdlbnQgaXMgdHlwaW5nIC4uLlwiLFxuICAvLyBBZ2VudC1pbnRlZ3JhdGlvbiBFNyBcdTAwQTc0LjMgKFZPU08tNzYwKTogdGhlIGNhbGxlciB3YWl0cyBpbiB0aGUgYWdlbnQnc1xuICAvLyBxdWV1ZSAodmVuZG9yIHdpZGdldCBcdTIyNjUgMC4xNy4wIHNob3dzIGEgd2FpdGluZyBsaW5lIGFuZCBkaXNhYmxlcyBpbnB1dCkuXG4gIHF1ZXVlZF9zdGF0dXM6IFwiV2FpdGluZyBmb3IgYW4gYXZhaWxhYmxlIGFnZW50XHUyMDI2XCIsXG4gIHF1ZXVlX3RpbWVkX291dDogXCJObyBhZ2VudCBiZWNhbWUgYXZhaWxhYmxlIFx1MjAxNCBwbGVhc2UgdHJ5IGFnYWluIGxhdGVyXCIsXG59IGFzIGNvbnN0O1xuXG5leHBvcnQgdHlwZSBXaWRnZXRUZXh0S2V5ID0ga2V5b2YgdHlwZW9mIFdJREdFVF9URVhUX0RFRkFVTFRTO1xuXG5leHBvcnQgY29uc3QgV0lER0VUX1RFWFRfS0VZUyA9IE9iamVjdC5rZXlzKFxuICBXSURHRVRfVEVYVF9ERUZBVUxUUyxcbikgYXMgV2lkZ2V0VGV4dEtleVtdO1xuXG4vKiogUmVzb2x2ZSBhIHRleHQga2V5IGFnYWluc3QgcGVyLWFnZW50IG92ZXJyaWRlcywgZmFsbGluZyBiYWNrIHRvIGRlZmF1bHRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUZXh0KFxuICBvdmVycmlkZXM6IFBhcnRpYWw8UmVjb3JkPFdpZGdldFRleHRLZXksIHN0cmluZz4+IHwgdW5kZWZpbmVkLFxuICBrZXk6IFdpZGdldFRleHRLZXksXG4pOiBzdHJpbmcge1xuICBjb25zdCB2ID0gb3ZlcnJpZGVzPy5ba2V5XTtcbiAgcmV0dXJuIHYgIT09IHVuZGVmaW5lZCAmJiB2ICE9PSBcIlwiID8gdiA6IFdJREdFVF9URVhUX0RFRkFVTFRTW2tleV07XG59XG4iLCAiLy8gUGx1Z2dhYmxlIHBsYXRmb3JtIGdsb2JhbHMgKEU0IHBsYW4gXHUwMEE3NC4zKS4gVGhlIGJyb3dzZXIgZGVmYXVsdHMgQVJFIHRoZVxuLy8gZ2xvYmFscywgcmVhZCBhdCBjYWxsIHRpbWUgKG5ldmVyIGNhcHR1cmVkIGF0IGltcG9ydCksIHNvIHRoZSBicm93c2VyXG4vLyBidWlsZCBpcyBiZWhhdmlvdXItaWRlbnRpY2FsIHRvIHRoZSB3aWRnZXQncyBvcmlnaW5hbCB2b2ljZS50czsgdGhlIFJlYWN0XG4vLyBOYXRpdmUgcGFja2FnZSBjYWxscyBgc2V0UGxhdGZvcm1gIHdpdGggcmVhY3QtbmF0aXZlLXdlYnJ0YydzIGNsYXNzZXMuXG5pbXBvcnQgdHlwZSB7IFZvbHVtZVByb3ZpZGVyIH0gZnJvbSBcIi4vdm9sdW1lLXByb3ZpZGVyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGxhdGZvcm0ge1xuICBSVENQZWVyQ29ubmVjdGlvbjogdHlwZW9mIFJUQ1BlZXJDb25uZWN0aW9uO1xuICBSVENTZXNzaW9uRGVzY3JpcHRpb24/OiB0eXBlb2YgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uO1xuICBtZWRpYURldmljZXM6ICgpID0+IE1lZGlhRGV2aWNlcyB8IHVuZGVmaW5lZDtcbiAgZmV0Y2g6IHR5cGVvZiBmZXRjaDtcbiAgc2V0VGltZW91dDogKGhhbmRsZXI6ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IFJldHVyblR5cGU8dHlwZW9mIGdsb2JhbFRoaXMuc2V0VGltZW91dD47XG4gIC8qKiBgY2xpZW50LXJlYWR5LmFib3V0LnBsYXRmb3JtYCAoRTQgcGxhbiBcdTAwQTc0LjYpLiBEZWZhdWx0IGBcIndlYlwiYC4gKi9cbiAgbmFtZT86IFwid2ViXCIgfCBcInJlYWN0LW5hdGl2ZVwiIHwgXCJub2RlXCI7XG4gIC8qKiBWb2x1bWUgLyBmcmVxdWVuY3kgcmVhZHMgZm9yIGEgc3RyZWFtIChRMjApLiBEZWZhdWx0OiBhbiBBbmFseXNlck5vZGVcbiAgICogIHdoZXJlIFdlYiBBdWRpbyBleGlzdHM7IFJlYWN0IE5hdGl2ZSBwbHVncyBhIG5vLW9wIHByb3ZpZGVyLiAqL1xuICB2b2x1bWVQcm92aWRlcj86IChzdHJlYW06IE1lZGlhU3RyZWFtKSA9PiBWb2x1bWVQcm92aWRlcjtcbiAgLyoqIE5hdGl2ZSBhdWRpbyBzZXNzaW9uIGFyb3VuZCBhIHZvaWNlIHNlc3Npb24gKFJlYWN0IE5hdGl2ZTogc3BlYWtlclxuICAgKiAgcm91dGluZykuIGBzdGFydGAgYmVmb3JlIGNvbm5lY3Rpbmc7IGBzdG9wYCBvbiBldmVyeSBlbmQgQU5EIG9uIGFcbiAgICogIGZhaWxlZCBjb25uZWN0LiBEZWZhdWx0OiBub25lLiAqL1xuICBhdWRpb1Nlc3Npb24/OiB7IHN0YXJ0KCk6IHZvaWQ7IHN0b3AoKTogdm9pZCB9O1xufVxuXG5jb25zdCBicm93c2VyRGVmYXVsdHMgPSAoKTogUGxhdGZvcm0gPT4gKHtcbiAgUlRDUGVlckNvbm5lY3Rpb246IGdsb2JhbFRoaXMuUlRDUGVlckNvbm5lY3Rpb24sXG4gIFJUQ1Nlc3Npb25EZXNjcmlwdGlvbjogZ2xvYmFsVGhpcy5SVENTZXNzaW9uRGVzY3JpcHRpb24sXG4gIG1lZGlhRGV2aWNlczogKCkgPT4gZ2xvYmFsVGhpcy5uYXZpZ2F0b3I/Lm1lZGlhRGV2aWNlcyxcbiAgZmV0Y2g6ICguLi5hcmdzOiBQYXJhbWV0ZXJzPHR5cGVvZiBmZXRjaD4pID0+IGdsb2JhbFRoaXMuZmV0Y2goLi4uYXJncyksXG4gIHNldFRpbWVvdXQ6IChoYW5kbGVyLCBtcykgPT4gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KGhhbmRsZXIsIG1zKSxcbn0pO1xuXG5sZXQgb3ZlcnJpZGVzOiBQYXJ0aWFsPFBsYXRmb3JtPiA9IHt9O1xuXG4vKiogUmVwbGFjZSBzb21lIHBsYXRmb3JtIGdsb2JhbHMgKFJlYWN0IE5hdGl2ZTogcmVhY3QtbmF0aXZlLXdlYnJ0YykuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0UGxhdGZvcm0obmV4dDogUGFydGlhbDxQbGF0Zm9ybT4pOiB2b2lkIHtcbiAgb3ZlcnJpZGVzID0geyAuLi5vdmVycmlkZXMsIC4uLm5leHQgfTtcbn1cblxuLyoqIFRoZSBlZmZlY3RpdmUgcGxhdGZvcm06IGJyb3dzZXIgZ2xvYmFscyAocmVhZCBub3cpICsgYW55IG92ZXJyaWRlcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF0Zm9ybSgpOiBQbGF0Zm9ybSB7XG4gIHJldHVybiB7IC4uLmJyb3dzZXJEZWZhdWx0cygpLCAuLi5vdmVycmlkZXMgfTtcbn1cblxuLyoqXG4gKiBNaWNyb3Bob25lIGNhcHR1cmUgcHJvZmlsZSAoUTIxLCBzdGF0ZWQgaW4gZXZlcnkgUkVBRE1FKTogZWNob1xuICogY2FuY2VsbGF0aW9uIE9OIChzdG9wcyBhZ2VudCBUVFMgZWNob2luZyBpbnRvIHRoZSBtaWMpOyBicm93c2VyIG5vaXNlXG4gKiBzdXBwcmVzc2lvbiBhbmQgYXV0b21hdGljIGdhaW4gY29udHJvbCBPRkYgXHUyMDE0IHRoZSBzYW1lIHByb2ZpbGUgYXMgdGhlXG4gKiBkYXNoYm9hcmQgcHJldmlldy5cbiAqL1xuZXhwb3J0IGNvbnN0IE1JQ19DT05TVFJBSU5UUyA9IHtcbiAgYXVkaW86IHsgZWNob0NhbmNlbGxhdGlvbjogdHJ1ZSwgbm9pc2VTdXBwcmVzc2lvbjogZmFsc2UsIGF1dG9HYWluQ29udHJvbDogZmFsc2UgfSxcbiAgdmlkZW86IGZhbHNlLFxufSBhcyBjb25zdDtcbiIsICIvLyBTbWFsbFdlYlJUQyB2b2ljZSBjbGllbnQgZm9yIHRoZSB3aWRnZXQgXHUyMDE0IGEgdHJpbW1lZCwgZGVwZW5kZW5jeS1mcmVlXG4vLyBhZGFwdGF0aW9uIG9mIHRoZSBkYXNoYm9hcmQncyBgZnJvbnRlbmQvc3JjL2xpYi9waXBlY2F0L2NsaWVudC50c2Bcbi8vIChzYW1lIHNpZ25hbGluZyBoYW5kc2hha2UsIE9wdXMgZm10cCB0dW5pbmcsIFJUVkkgY2xpZW50LXJlYWR5IGxhdGNoLFxuLy8gYW5kIHJlbmVnb3RpYXRpb24gaGFuZGxpbmcpLCBtaW51cyBkYXNoYm9hcmQgYXV0aC90ZW5hbnQgaGVhZGVyczogdGhlXG4vLyB3aWRnZXQncyBzaWduYWxpbmcgY2FwYWJpbGl0eSBJUyB0aGUgdW5ndWVzc2FibGUgYHNlc3Npb25faWRgIG1pbnRlZCBieVxuLy8gdGhlIHB1YmxpYyBzZXNzaW9uIGVuZHBvaW50LlxuXG5pbXBvcnQgdHlwZSB7IFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3IgfSBmcm9tIFwiLi93aWRnZXQtYXBpXCI7XG5pbXBvcnQgeyBNSUNfQ09OU1RSQUlOVFMsIHBsYXRmb3JtIH0gZnJvbSBcIi4vcGxhdGZvcm1cIjtcblxuZXhwb3J0IHR5cGUgVm9pY2VTdGF0ZSA9IFwiaWRsZVwiIHwgXCJjb25uZWN0aW5nXCIgfCBcImNvbm5lY3RlZFwiIHwgXCJkaXNjb25uZWN0ZWRcIiB8IFwiZXJyb3JcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSdHZpTWVzc2FnZSB7XG4gIGxhYmVsPzogc3RyaW5nO1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHtcbiAgICB0ZXh0Pzogc3RyaW5nO1xuICAgIGZpbmFsPzogYm9vbGVhbjtcbiAgICBzcG9rZW4/OiBib29sZWFuO1xuICAgIGFnZ3JlZ2F0ZWRfYnk/OiBzdHJpbmc7XG4gIH07XG4gIG1lc3NhZ2U/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHsgdHlwZT86IHN0cmluZyB9O1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xufVxuXG4vKiogUm9sZSBkZXJpdmVkIGZyb20gYW4gUlRWSSBtZXNzYWdlIHR5cGU7IG51bGwgZm9yIG5vbi10cmFuc2NyaXB0IGZyYW1lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0cmFuc2NyaXB0Um9sZShtc2c6IFJ0dmlNZXNzYWdlKTogXCJhZ2VudFwiIHwgXCJ1c2VyXCIgfCBudWxsIHtcbiAgc3dpdGNoIChtc2cudHlwZSkge1xuICAgIGNhc2UgXCJib3QtdHJhbnNjcmlwdGlvblwiOlxuICAgIGNhc2UgXCJib3QtbGxtLXRleHRcIjpcbiAgICBjYXNlIFwiYm90LXR0cy10ZXh0XCI6XG4gICAgY2FzZSBcImJvdC1vdXRwdXRcIjpcbiAgICAgIHJldHVybiBcImFnZW50XCI7XG4gICAgY2FzZSBcInVzZXItdHJhbnNjcmlwdGlvblwiOlxuICAgICAgcmV0dXJuIFwidXNlclwiO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIFdoZXRoZXIgYSBmcmFtZSBzaG91bGQgYXBwZW5kIHRvIHRoZSB2aXNpYmxlIHRyYW5zY3JpcHQuIE1pcnJvcnMgdGhlXG4gKiBkYXNoYm9hcmQncyBkZWR1cGUgcnVsZTogdGhlIGJhY2tlbmQgZW1pdHMgc2V2ZXJhbCBvdmVybGFwcGluZyBhZ2VudFxuICogc3RyZWFtcyBmb3Igb25lIHV0dGVyYW5jZTsgT05MWSB0aGUgc3Bva2VuIHNlbnRlbmNlLWFnZ3JlZ2F0ZWRcbiAqIGBib3Qtb3V0cHV0YCBmaXJlcyBleGFjdGx5IG9uY2UgcGVyIHNwb2tlbiBzZW50ZW5jZSAoZ3JlZXRpbmcgaW5jbHVkZWQpLlxuICogVXNlciBzaWRlOiBmaW5hbCB0cmFuc2NyaXB0aW9ucyBvbmx5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNSZW5kZXJhYmxlVHJhbnNjcmlwdChtc2c6IFJ0dmlNZXNzYWdlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHJvbGUgPSB0cmFuc2NyaXB0Um9sZShtc2cpO1xuICBpZiAoIXJvbGUpIHJldHVybiBmYWxzZTtcbiAgaWYgKHJvbGUgPT09IFwiYWdlbnRcIikge1xuICAgIHJldHVybiAoXG4gICAgICBtc2cudHlwZSA9PT0gXCJib3Qtb3V0cHV0XCIgJiZcbiAgICAgIG1zZy5kYXRhPy5zcG9rZW4gPT09IHRydWUgJiZcbiAgICAgIG1zZy5kYXRhPy5hZ2dyZWdhdGVkX2J5ID09PSBcInNlbnRlbmNlXCJcbiAgICApO1xuICB9XG4gIHJldHVybiBtc2cuZGF0YT8uZmluYWwgPT09IHRydWU7XG59XG5cbi8qKiBgZGF0YS50eXBlYCBvZiB0aGUgd29ya2VyJ3MgZW5kLW9mLXNlc3Npb24gYW5ub3VuY2VtZW50IChWT1NPLTY1OCkuICovXG5leHBvcnQgY29uc3QgU0VTU0lPTl9FTkRFRF9NRVNTQUdFX1RZUEUgPSBcInNlc3Npb24tZW5kZWRcIjtcblxuLyoqXG4gKiBUcnVlIHdoZW4gYG1zZ2AgaXMgdGhlIHdvcmtlciBhbm5vdW5jaW5nIHRoYXQgaXQgZW5kZWQgdGhlIHNlc3Npb24gb25cbiAqIHB1cnBvc2UgXHUyMDE0IHRoZSBSVFZJIGBzZXJ2ZXItbWVzc2FnZWAgaXQgd3JpdGVzIHJpZ2h0IGJlZm9yZSBpdCBjbG9zZXMgdGhlXG4gKiBwZWVyIG9uIGl0cyBncmFjZWZ1bCBlbmQgcGF0aCAoRW5kIG5vZGUsIGBlbmRfY2FsbGAsIGNhbGxlZSBzY3JlZW4pLlxuICogTWlycm9ycyBgZnJvbnRlbmQvc3JjL2xpYi9waXBlY2F0L3Nlc3Npb24tZW5kLnRzYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU2Vzc2lvbkVuZGVkTWVzc2FnZShtc2c6IHtcbiAgbGFiZWw/OiB1bmtub3duO1xuICB0eXBlPzogdW5rbm93bjtcbiAgZGF0YT86IHVua25vd247XG4gIFtrZXk6IHN0cmluZ106IHVua25vd247XG59KTogYm9vbGVhbiB7XG4gIC8vIFJUVkkgb25seTogYHZvc28tZGVidWdgIGVudmVsb3BlcyBzaGFyZSB0aGlzIGRhdGEgY2hhbm5lbCBhbmQgbXVzdFxuICAvLyBuZXZlciBsYXRjaCBhbiBlbmQgKHRoYXQgd291bGQgaGlkZSBhIGdlbnVpbmUgdHJhbnNwb3J0IGZhaWx1cmUpLlxuICBpZiAobXNnLmxhYmVsICE9PSBcInJ0dmktYWlcIiB8fCBtc2cudHlwZSAhPT0gXCJzZXJ2ZXItbWVzc2FnZVwiKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGRhdGEgPSBtc2cuZGF0YTtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJlxuICAgIGRhdGEgIT09IG51bGwgJiZcbiAgICAoZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikudHlwZSA9PT0gU0VTU0lPTl9FTkRFRF9NRVNTQUdFX1RZUEVcbiAgKTtcbn1cblxuLyoqIGBkYXRhLnR5cGVgIG9mIHRoZSBSVFZJIGBzZXJ2ZXItbWVzc2FnZWAgdHdpbiBvZiB0aGUgdmVuZG9yJ3NcbiAqICBgcXVldWVfc3RhdHVzYCBldmVudCAoYWdlbnQtaW50ZWdyYXRpb24gRTcgXHUwMEE3NC4zKS4gKi9cbmV4cG9ydCBjb25zdCBRVUVVRV9TVEFUVVNfTUVTU0FHRV9UWVBFID0gXCJxdWV1ZV9zdGF0dXNcIjtcbi8qKiBgc2Vzc2lvbi1lbmRlZC5yZWFzb25gIGFmdGVyIGEgd2FpdCB0aGF0IHRpbWVkIG91dC4gKi9cbmV4cG9ydCBjb25zdCBRVUVVRV9USU1FT1VUX1JFQVNPTiA9IFwicXVldWVfdGltZW91dFwiO1xuXG4vKipcbiAqIFRoZSBxdWV1ZSB0cmFuc2l0aW9uIGFuIFJUVkkgZW52ZWxvcGUgY2FycmllcywgaWYgYW55OiBgXCJ3YWl0aW5nXCJgLFxuICogYFwiYWRtaXR0ZWRcImAgb3IgYFwidGltZWRfb3V0XCJgIGZyb20gYHNlcnZlci1tZXNzYWdlIHt0eXBlOiBcInF1ZXVlX3N0YXR1c1wiLFxuICogc3RhdHVzfWA7IGBcInRpbWVkX291dFwiYCBhbHNvIGZyb20gYHNlc3Npb24tZW5kZWQge3JlYXNvbjogXCJxdWV1ZV90aW1lb3V0XCJ9YC5cbiAqIEFueXRoaW5nIGVsc2UgKG90aGVyIGVudmVsb3BlcywgYSBmb3JlaWduIGxhYmVsKSBpcyBgbnVsbGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBxdWV1ZVRyYW5zaXRpb24obXNnOiB7XG4gIGxhYmVsPzogdW5rbm93bjtcbiAgdHlwZT86IHVua25vd247XG4gIGRhdGE/OiB1bmtub3duO1xufSk6IFwid2FpdGluZ1wiIHwgXCJhZG1pdHRlZFwiIHwgXCJ0aW1lZF9vdXRcIiB8IG51bGwge1xuICBpZiAobXNnLmxhYmVsICE9PSBcInJ0dmktYWlcIiB8fCBtc2cudHlwZSAhPT0gXCJzZXJ2ZXItbWVzc2FnZVwiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZGF0YSA9IG1zZy5kYXRhO1xuICBpZiAodHlwZW9mIGRhdGEgIT09IFwib2JqZWN0XCIgfHwgZGF0YSA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJlY29yZCA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmIChyZWNvcmQudHlwZSA9PT0gUVVFVUVfU1RBVFVTX01FU1NBR0VfVFlQRSkge1xuICAgIGNvbnN0IHN0YXR1cyA9IHJlY29yZC5zdGF0dXM7XG4gICAgaWYgKHN0YXR1cyA9PT0gXCJ3YWl0aW5nXCIgfHwgc3RhdHVzID09PSBcImFkbWl0dGVkXCIgfHwgc3RhdHVzID09PSBcInRpbWVkX291dFwiKSByZXR1cm4gc3RhdHVzO1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmIChyZWNvcmQudHlwZSA9PT0gXCJzZXNzaW9uLWVuZGVkXCIgJiYgcmVjb3JkLnJlYXNvbiA9PT0gUVVFVUVfVElNRU9VVF9SRUFTT04pIHtcbiAgICByZXR1cm4gXCJ0aW1lZF9vdXRcIjtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqXG4gKiBUZXJtaW5hbCBzdGF0ZSBmb3IgYW4gUlRDUGVlckNvbm5lY3Rpb24gYGZhaWxlZGA6IGFmdGVyIHRoZSB3b3JrZXIncyBvd25cbiAqIGVuZCBhbm5vdW5jZW1lbnQgaXQgaXMgdGhlIERUTFMgY2xvc2Ugb2YgYSBzZXNzaW9uIHRoYXQgZW5kZWQgb24gcHVycG9zZVxuICogKGFuIG9yZGluYXJ5IFwiZGlzY29ubmVjdGVkXCIpOyB3aXRoIG5vIGFubm91bmNlbWVudCBpdCBpcyBhIHJlYWwgZXJyb3IuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwZWVyRmFpbHVyZVN0YXRlKHNlcnZlckVuZGVkOiBib29sZWFuKTogXCJkaXNjb25uZWN0ZWRcIiB8IFwiZXJyb3JcIiB7XG4gIHJldHVybiBzZXJ2ZXJFbmRlZCA/IFwiZGlzY29ubmVjdGVkXCIgOiBcImVycm9yXCI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVm9pY2VDbGllbnRPcHRpb25zIHtcbiAgb25TdGF0ZUNoYW5nZT86IChzdGF0ZTogVm9pY2VTdGF0ZSkgPT4gdm9pZDtcbiAgb25SZW1vdGVBdWRpbz86IChzdHJlYW06IE1lZGlhU3RyZWFtKSA9PiB2b2lkO1xuICBvbkFwcE1lc3NhZ2U/OiAobXNnOiBSdHZpTWVzc2FnZSkgPT4gdm9pZDtcbiAgb25FcnJvcj86IChlcnI6IEVycm9yKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgY2xhc3MgVm9pY2VDbGllbnQge1xuICAvKiogVGhlIHdvcmtlciBhbm5vdW5jZWQgaXQgZW5kZWQgdGhlIHNlc3Npb24gb24gcHVycG9zZSAoc2VlIGBpc1Nlc3Npb25FbmRlZE1lc3NhZ2VgKS4gKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJFbmRlZCA9IGZhbHNlO1xuICBwcml2YXRlIHBjOiBSVENQZWVyQ29ubmVjdGlvbiB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGRjOiBSVENEYXRhQ2hhbm5lbCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxvY2FsU3RyZWFtOiBNZWRpYVN0cmVhbSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBjSWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBWb2ljZVN0YXRlID0gXCJpZGxlXCI7XG4gIHByaXZhdGUgZGlzcG9zZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBhdWRpb1JlbmRlcmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGNsaWVudFJlYWR5U2VudCA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByb3RlY3RlZCByZWFkb25seSBzZXNzaW9uOiBWb2ljZVNlc3Npb25EZXNjcmlwdG9yLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0czogVm9pY2VDbGllbnRPcHRpb25zLFxuICApIHt9XG5cbiAgLyoqXG4gICAqIEEgY2xpZW50IHRoYXQgcmVkZWVtcyBhIGNvbnZlcnNhdGlvbiB0b2tlbiAoYEdFVFxuICAgKiAvdjEvY29udmFpL2NvbnZlcnNhdGlvbi90b2tlbmAsIEUyIEQtNCAvIEU0IFE2KSBpbnN0ZWFkIG9mIGEgbWludGVkXG4gICAqIHNlc3Npb246IHRoZSBmaXJzdCBvZmZlciBjYXJyaWVzIGBjb252ZXJzYXRpb25fdG9rZW5gLCBhbmQgdGhlIGFuc3dlcidzXG4gICAqIHNlc3Npb24gZGVzY3JpcHRvciAoYHNlc3Npb25faWRgLCB0aGUgZGlzY29ubmVjdCBwcm9vZiwgYGNvbnZlcnNhdGlvbl9pZGApXG4gICAqIGlzIGFkb3B0ZWQgYmVmb3JlIGFueXRoaW5nIGVsc2UgdXNlcyBpdC4gSW5zaWRlIDE1IG1pbnV0ZXMgdGhlIHNhbWUgdG9rZW5cbiAgICogcmUtam9pbnMgdGhlIHNhbWUgY29udmVyc2F0aW9uIChRMjkpLlxuICAgKi9cbiAgc3RhdGljIGZyb21Db252ZXJzYXRpb25Ub2tlbjxUIGV4dGVuZHMgVm9pY2VDbGllbnQ+KFxuICAgIHRoaXM6IG5ldyAoc2Vzc2lvbjogVm9pY2VTZXNzaW9uRGVzY3JpcHRvciwgb3B0czogVm9pY2VDbGllbnRPcHRpb25zKSA9PiBULFxuICAgIHRva2VuOiBzdHJpbmcsXG4gICAgd2hlcmU6IHsgc2lnbmFsaW5nVXJsOiBzdHJpbmc7IGljZVNlcnZlcnM/OiBWb2ljZVNlc3Npb25EZXNjcmlwdG9yW1wiaWNlX3NlcnZlcnNcIl0gfSxcbiAgICBvcHRzOiBWb2ljZUNsaWVudE9wdGlvbnMsXG4gICk6IFQge1xuICAgIHJldHVybiBuZXcgdGhpcyhcbiAgICAgIHtcbiAgICAgICAgc2Vzc2lvbl9pZDogXCJcIixcbiAgICAgICAgY29udmVyc2F0aW9uX2lkOiBcIlwiLFxuICAgICAgICBzaWduYWxpbmdfdXJsOiB3aGVyZS5zaWduYWxpbmdVcmwsXG4gICAgICAgIGljZV9zZXJ2ZXJzOiB3aGVyZS5pY2VTZXJ2ZXJzLFxuICAgICAgICBjb252ZXJzYXRpb25fdG9rZW46IHRva2VuLFxuICAgICAgfSxcbiAgICAgIG9wdHMsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBQcm90ZWN0ZWQgZXh0ZW5zaW9uIHBvaW50cyAoRTQgUTEyKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbiAgLy8gRXZlcnkgZGVmYXVsdCByZXByb2R1Y2VzIHRoZSB3aWRnZXQncyBiZWhhdmlvdXIgYnl0ZS1mb3ItYnl0ZSAodGhlXG4gIC8vIGdvbGRlbiBhdWRpby1wYXRoIHRlc3QpLiBTdGFmZi1vbmx5IGJlaGF2aW91ciAoZGFzaGJvYXJkIGF1dGggaGVhZGVycyxcbiAgLy8gcmVjZWl2ZS1vbmx5IGxpc3Rlbi1pbiwgXHUyMDI2KSBsaXZlcyBpbiBhIHN1YmNsYXNzIE9VVFNJREUgdGhpcyBwYWNrYWdlLlxuXG4gIC8qKiBIZWFkZXJzIGFkZGVkIHRvIHRoZSBvZmZlciBQT1NUIGFmdGVyIENvbnRlbnQtVHlwZSwgYmVmb3JlIHRoZSB0cmFjZSBoZWFkZXJzLiAqL1xuICBwcm90ZWN0ZWQgZXh0cmFPZmZlckhlYWRlcnMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgLyoqIEhlYWRlcnMgb2YgdGhlIGRpc2Nvbm5lY3QgUE9TVC4gKi9cbiAgcHJvdGVjdGVkIGRpc2Nvbm5lY3RIZWFkZXJzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH07XG4gIH1cblxuICAvKiogV2hlcmUgdGhlIGRpc2Nvbm5lY3QgUE9TVCBnb2VzLiAqL1xuICBwcm90ZWN0ZWQgZGlzY29ubmVjdEVuZHBvaW50KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGRpc2Nvbm5lY3RVcmwodGhpcy5zZXNzaW9uLnNpZ25hbGluZ191cmwpO1xuICB9XG5cbiAgLyoqIEJvZHkgb2YgdGhlIGRpc2Nvbm5lY3QgUE9TVCBcdTIwMTQgdGhlIG93bmVyc2hpcCBwcm9vZiAoVk9TTy0xOTEpLiAqL1xuICBwcm90ZWN0ZWQgZGlzY29ubmVjdEJvZHkoKTogeyBzZXNzaW9uX2lkOiBzdHJpbmc7IHNlc3Npb25fdG9rZW4/OiBzdHJpbmcgfSB7XG4gICAgcmV0dXJuIHsgc2Vzc2lvbl9pZDogdGhpcy5zZXNzaW9uLnNlc3Npb25faWQsIHNlc3Npb25fdG9rZW46IHRoaXMuc2Vzc2lvbi5zZXNzaW9uX3Rva2VuIH07XG4gIH1cblxuICAvKiogQ29uc29sZSB0ZXh0IHdoZW4gdGhlIGRpc2Nvbm5lY3QgUE9TVCBpcyBza2lwcGVkIChubyB0b2tlbikgb3IgcmVqZWN0ZWQuICovXG4gIHByb3RlY3RlZCBkaXNjb25uZWN0V2FybmluZyhraW5kOiBcInNraXBwZWRcIiB8IFwicmVqZWN0ZWRcIiwgc3RhdHVzPzogbnVtYmVyKTogc3RyaW5nIHtcbiAgICByZXR1cm4ga2luZCA9PT0gXCJza2lwcGVkXCJcbiAgICAgID8gXCJXaWRnZXQgdm9pY2UgZGlzY29ubmVjdCBza2lwcGVkOiBubyBzZXNzaW9uX3Rva2VuXCJcbiAgICAgIDogYFdpZGdldCB2b2ljZSBkaXNjb25uZWN0IHJlamVjdGVkOiAke3N0YXR1c31gO1xuICB9XG5cbiAgLyoqIFRoZSBlcnJvciBhIG5vbi0yeHggc2lnbmFsaW5nIGFuc3dlciByYWlzZXMuICovXG4gIHByb3RlY3RlZCBzaWduYWxpbmdGYWlsdXJlKHN0YXR1czogbnVtYmVyLCBzdGF0dXNUZXh0OiBzdHJpbmcsIGJvZHk6IHVua25vd24pOiBFcnJvciB7XG4gICAgY29uc3QgZGV0YWlsID1cbiAgICAgIGJvZHkgJiYgdHlwZW9mIGJvZHkgPT09IFwib2JqZWN0XCIgJiYgdHlwZW9mIChib2R5IGFzIHsgZGV0YWlsPzogdW5rbm93biB9KS5kZXRhaWwgPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyAoYm9keSBhcyB7IGRldGFpbDogc3RyaW5nIH0pLmRldGFpbFxuICAgICAgICA6IHN0YXR1c1RleHQ7XG4gICAgcmV0dXJuIG5ldyBFcnJvcihgU2lnbmFsaW5nIGZhaWxlZCAoJHtzdGF0dXN9KTogJHtkZXRhaWx9YCk7XG4gIH1cblxuICAvKiogVGhlIGxvY2FsIGNhcHR1cmUgdG8gcHVibGlzaDsgYG51bGxgIHB1Ymxpc2hlcyBub3RoaW5nLiAqL1xuICBwcm90ZWN0ZWQgYXN5bmMgbG9jYWxNZWRpYSgpOiBQcm9taXNlPE1lZGlhU3RyZWFtIHwgbnVsbD4ge1xuICAgIHJldHVybiAocGxhdGZvcm0oKS5tZWRpYURldmljZXMoKSBhcyBNZWRpYURldmljZXMpLmdldFVzZXJNZWRpYShNSUNfQ09OU1RSQUlOVFMpO1xuICB9XG5cbiAgLyoqIEF0dGFjaCB0aGUgbG9jYWwgY2FwdHVyZSAob3IgYSByZWNlaXZlIHBhdGgpIHRvIHRoZSBwZWVyIGJlZm9yZSB0aGUgb2ZmZXIuICovXG4gIHByb3RlY3RlZCBjb25maWd1cmVUcmFuc2NlaXZlcnMocGM6IFJUQ1BlZXJDb25uZWN0aW9uLCBzdHJlYW06IE1lZGlhU3RyZWFtIHwgbnVsbCk6IHZvaWQge1xuICAgIGlmICghc3RyZWFtKSByZXR1cm47XG4gICAgZm9yIChjb25zdCB0cmFjayBvZiBzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKSkgcGMuYWRkVHJhY2sodHJhY2ssIHN0cmVhbSk7XG4gIH1cblxuICAvKiogYGRhdGFgIG9mIHRoZSBSVFZJIGBjbGllbnQtcmVhZHlgIGZyYW1lIChub25lIGJ5IGRlZmF1bHQgXHUyMDE0IHRoZSB3aWRnZXQncyBmcmFtZSkuICovXG4gIHByb3RlY3RlZCBjbGllbnRSZWFkeURhdGEoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICAvKiogVGhlIHdvcmtlcidzIGBzZXNzaW9uLWVuZGVkYCBhbm5vdW5jZW1lbnQgYXJyaXZlZCAoYHJlYXNvbmAgd2hlbiBhIHN0cmluZykuICovXG4gIHByb3RlY3RlZCBvblNlc3Npb25FbmRlZEZyYW1lKF9yZWFzb246IHN0cmluZyB8IG51bGwpOiB2b2lkIHt9XG5cbiAgLyoqIFRoZSBwZWVyIGNsb3NlZCBhZnRlciB0aGF0IGFubm91bmNlbWVudDsgdGhlIGNsaWVudCBoYXMgcmVsZWFzZWQgaXQuICovXG4gIHByb3RlY3RlZCBvbkFubm91bmNlZEVuZENsb3NlZCgpOiB2b2lkIHt9XG5cbiAgLyoqIFRoZSBsaXZlIHBlZXIgY29ubmVjdGlvbiAoYG51bGxgIHdoZW4gbm90IGNvbm5lY3RlZCkuICovXG4gIHByb3RlY3RlZCBwZWVyKCk6IFJUQ1BlZXJDb25uZWN0aW9uIHwgbnVsbCB7XG4gICAgcmV0dXJuIHRoaXMucGM7XG4gIH1cblxuICAvKiogVGhlIHB1Ymxpc2hlZCBsb2NhbCBjYXB0dXJlIChgbnVsbGAgd2hlbiBub25lKS4gKi9cbiAgcHJvdGVjdGVkIG1pYygpOiBNZWRpYVN0cmVhbSB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmxvY2FsU3RyZWFtO1xuICB9XG5cbiAgLyoqIFNlbmQgb25lIEpTT04gZnJhbWUgb24gdGhlIGRhdGEgY2hhbm5lbDsgYGZhbHNlYCB3aGVuIGl0IGlzIG5vdCBvcGVuLiAqL1xuICBwcm90ZWN0ZWQgc2VuZEZyYW1lKGZyYW1lOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IGJvb2xlYW4ge1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGZyYW1lKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBnZXRTdGF0ZSgpOiBWb2ljZVN0YXRlIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0U3RhdGUobmV4dDogVm9pY2VTdGF0ZSkge1xuICAgIGlmICh0aGlzLnN0YXRlID09PSBuZXh0KSByZXR1cm47XG4gICAgdGhpcy5zdGF0ZSA9IG5leHQ7XG4gICAgdGhpcy5vcHRzLm9uU3RhdGVDaGFuZ2U/LihuZXh0KTtcbiAgfVxuXG4gIGFzeW5jIGNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc3RhdGUgIT09IFwiaWRsZVwiKSB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjb25uZWN0IGZyb20gXCIke3RoaXMuc3RhdGV9XCJgKTtcbiAgICB0aGlzLnNldFN0YXRlKFwiY29ubmVjdGluZ1wiKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgaWNlU2VydmVycyA9ICh0aGlzLnNlc3Npb24uaWNlX3NlcnZlcnMgPz8gW10pLm1hcCgocykgPT4gKHtcbiAgICAgICAgdXJsczogcy51cmxzLFxuICAgICAgICB1c2VybmFtZTogcy51c2VybmFtZSxcbiAgICAgICAgY3JlZGVudGlhbDogcy5jcmVkZW50aWFsLFxuICAgICAgfSkpO1xuICAgICAgY29uc3QgcGMgPSBuZXcgKHBsYXRmb3JtKCkuUlRDUGVlckNvbm5lY3Rpb24pKHtcbiAgICAgICAgaWNlU2VydmVyczpcbiAgICAgICAgICBpY2VTZXJ2ZXJzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgID8gaWNlU2VydmVyc1xuICAgICAgICAgICAgOiBbeyB1cmxzOiBcInN0dW46c3R1bi5sLmdvb2dsZS5jb206MTkzMDJcIiB9XSxcbiAgICAgIH0pO1xuICAgICAgdGhpcy5wYyA9IHBjO1xuXG4gICAgICBwYy5hZGRFdmVudExpc3RlbmVyKFwiY29ubmVjdGlvbnN0YXRlY2hhbmdlXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZGlzcG9zZWQpIHJldHVybjtcbiAgICAgICAgY29uc3QgY3MgPSBwYy5jb25uZWN0aW9uU3RhdGU7XG4gICAgICAgIGlmIChjcyA9PT0gXCJjb25uZWN0ZWRcIikgdGhpcy5zZXRTdGF0ZShcImNvbm5lY3RlZFwiKTtcbiAgICAgICAgZWxzZSBpZiAoY3MgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgICAgICAvLyBBZnRlciB0aGUgd29ya2VyJ3MgYHNlc3Npb24tZW5kZWRgIGFubm91bmNlbWVudCB0aGlzIGlzIHRoZVxuICAgICAgICAgIC8vIGV4cGVjdGVkIGNsb3NlIG9mIGEgZmluaXNoZWQgY2FsbCwgbm90IGEgZmFpbHVyZSAoVk9TTy02NTgpLlxuICAgICAgICAgIGNvbnN0IG5leHQgPSBwZWVyRmFpbHVyZVN0YXRlKHRoaXMuc2VydmVyRW5kZWQpO1xuICAgICAgICAgIHRoaXMuc2V0U3RhdGUobmV4dCk7XG4gICAgICAgICAgaWYgKG5leHQgPT09IFwiZXJyb3JcIikgdGhpcy5vcHRzLm9uRXJyb3I/LihuZXcgRXJyb3IoXCJXZWJSVEMgY29ubmVjdGlvbiBmYWlsZWRcIikpO1xuICAgICAgICAgIC8vIEFubm91bmNlZCBlbmQ6IHRoZSBzZXNzaW9uIGlzIG92ZXIgb24gYm90aCBlbmRzIFx1MjAxNCByZWxlYXNlIHRoZVxuICAgICAgICAgIC8vIG1pYyBhbmQgdGhlIHBlZXIgbm93ICh0aGUgd2lkZ2V0J3MgZW5kQ2FsbCBydW5zIGxvY2FsIGNsZWFudXBcbiAgICAgICAgICAvLyB0b287IGJvdGggYXJlIGlkZW1wb3RlbnQpLlxuICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdm9pZCB0aGlzLmNsZWFudXAoKTtcbiAgICAgICAgICAgIHRoaXMub25Bbm5vdW5jZWRFbmRDbG9zZWQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoY3MgPT09IFwiY2xvc2VkXCIgfHwgY3MgPT09IFwiZGlzY29ubmVjdGVkXCIpIHtcbiAgICAgICAgICB0aGlzLnNldFN0YXRlKFwiZGlzY29ubmVjdGVkXCIpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcGMuYWRkRXZlbnRMaXN0ZW5lcihcInRyYWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5kaXNwb3NlZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBbc3RyZWFtXSA9IGV2ZW50LnN0cmVhbXM7XG4gICAgICAgIGlmIChzdHJlYW0pIHRoaXMub3B0cy5vblJlbW90ZUF1ZGlvPy4oc3RyZWFtKTtcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBkYyA9IHBjLmNyZWF0ZURhdGFDaGFubmVsKFwicGlwZWNhdFwiKTtcbiAgICAgIHRoaXMuZGMgPSBkYztcbiAgICAgIGRjLmFkZEV2ZW50TGlzdGVuZXIoXCJvcGVuXCIsICgpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLmRpc3Bvc2VkKSB0aGlzLm1heWJlU2VuZENsaWVudFJlYWR5KCk7XG4gICAgICB9KTtcbiAgICAgIGRjLmFkZEV2ZW50TGlzdGVuZXIoXCJtZXNzYWdlXCIsIChldmVudCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5kaXNwb3NlZCB8fCB0eXBlb2YgZXZlbnQuZGF0YSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoZXZlbnQuZGF0YSkgYXMgUnR2aU1lc3NhZ2U7XG4gICAgICAgICAgaWYgKGlzU2Vzc2lvbkVuZGVkTWVzc2FnZShwYXJzZWQpKSB7XG4gICAgICAgICAgICB0aGlzLnNlcnZlckVuZGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHJlYXNvbiA9IChwYXJzZWQuZGF0YSBhcyB7IHJlYXNvbj86IHVua25vd24gfSB8IHVuZGVmaW5lZCk/LnJlYXNvbjtcbiAgICAgICAgICAgIHRoaXMub25TZXNzaW9uRW5kZWRGcmFtZSh0eXBlb2YgcmVhc29uID09PSBcInN0cmluZ1wiID8gcmVhc29uIDogbnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChwYXJzZWQudHlwZSA9PT0gXCJzaWduYWxsaW5nXCIgJiYgcGFyc2VkLm1lc3NhZ2U/LnR5cGUgPT09IFwicmVuZWdvdGlhdGVcIikge1xuICAgICAgICAgICAgdm9pZCB0aGlzLnJlbmVnb3RpYXRlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMub3B0cy5vbkFwcE1lc3NhZ2U/LihwYXJzZWQpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyByYXcga2VlcC1hbGl2ZXMgZXRjLlxuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gQUVDIG9uIChzdG9wcyBhZ2VudCBUVFMgZWNob2luZyBpbnRvIHRoZSBtaWMpOyBBR0MgKyBicm93c2VyIG5vaXNlXG4gICAgICAvLyBzdXBwcmVzc2lvbiBvZmYgXHUyMDE0IHNhbWUgY2FwdHVyZSBwcm9maWxlIGFzIHRoZSBkYXNoYm9hcmQgcHJldmlldyAoUTIxKS5cbiAgICAgIGNvbnN0IHN0cmVhbSA9IGF3YWl0IHRoaXMubG9jYWxNZWRpYSgpO1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbSA9IHN0cmVhbTtcbiAgICAgIHRoaXMuY29uZmlndXJlVHJhbnNjZWl2ZXJzKHBjLCBzdHJlYW0pO1xuXG4gICAgICBhd2FpdCB0aGlzLm5lZ290aWF0ZShmYWxzZSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnNldFN0YXRlKFwiZXJyb3JcIik7XG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXAoKTtcbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoXCJXZWJSVEMgY29ubmVjdGlvbiBmYWlsZWRcIik7XG4gICAgICB0aGlzLm9wdHMub25FcnJvcj8uKGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbmVnb3RpYXRlKGlzUmVuZWdvdGlhdGlvbjogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBjID0gdGhpcy5wYztcbiAgICBpZiAoIXBjKSB0aHJvdyBuZXcgRXJyb3IoXCJQZWVyQ29ubmVjdGlvbiBnb25lXCIpO1xuICAgIGNvbnN0IG9mZmVyID0gYXdhaXQgcGMuY3JlYXRlT2ZmZXIoe1xuICAgICAgdm9pY2VBY3Rpdml0eURldGVjdGlvbjogZmFsc2UsXG4gICAgfSBhcyBSVENPZmZlck9wdGlvbnMpO1xuICAgIGlmIChvZmZlci5zZHApIG9mZmVyLnNkcCA9IHR1bmVPcHVzRm10cChvZmZlci5zZHApO1xuICAgIGF3YWl0IHBjLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIGF3YWl0IHdhaXRGb3JJY2VHYXRoZXJpbmcocGMpO1xuICAgIGNvbnN0IGxvY2FsID0gcGMubG9jYWxEZXNjcmlwdGlvbjtcbiAgICBpZiAoIWxvY2FsKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBsb2NhbCBTRFBcIik7XG5cbiAgICBjb25zdCB0b2tlbiA9ICF0aGlzLnNlc3Npb24uc2Vzc2lvbl9pZCAmJiB0aGlzLnNlc3Npb24uY29udmVyc2F0aW9uX3Rva2VuO1xuICAgIGNvbnN0IGJvZHk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0gdG9rZW5cbiAgICAgID8geyBjb252ZXJzYXRpb25fdG9rZW46IHRva2VuLCBzZHA6IGxvY2FsLnNkcCwgdHlwZTogbG9jYWwudHlwZSB9XG4gICAgICA6IHtcbiAgICAgICAgICBzZHA6IGxvY2FsLnNkcCxcbiAgICAgICAgICB0eXBlOiBsb2NhbC50eXBlLFxuICAgICAgICAgIHNlc3Npb25faWQ6IHRoaXMuc2Vzc2lvbi5zZXNzaW9uX2lkLFxuICAgICAgICAgIHJlcXVlc3RfZGF0YTogeyBzZXNzaW9uX2lkOiB0aGlzLnNlc3Npb24uc2Vzc2lvbl9pZCB9LFxuICAgICAgICB9O1xuICAgIGlmICh0aGlzLnBjSWQpIGJvZHkucGNfaWQgPSB0aGlzLnBjSWQ7XG4gICAgaWYgKGlzUmVuZWdvdGlhdGlvbikgYm9keS5yZXN0YXJ0X3BjID0gZmFsc2U7XG5cbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAuLi50aGlzLmV4dHJhT2ZmZXJIZWFkZXJzKCksXG4gICAgfTtcbiAgICBhZGRUcmFjZUhlYWRlcnMoaGVhZGVycywgdGhpcy5zZXNzaW9uLnRyYWNlX2NvbnRleHQpO1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IHBsYXRmb3JtKCkuZmV0Y2godGhpcy5zZXNzaW9uLnNpZ25hbGluZ191cmwsIHtcbiAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICBoZWFkZXJzLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoYm9keSksXG4gICAgfSk7XG4gICAgaWYgKCFyZXMub2spIHtcbiAgICAgIGxldCBwYXJzZWQ6IHVua25vd24gPSBudWxsO1xuICAgICAgdHJ5IHtcbiAgICAgICAgcGFyc2VkID0gYXdhaXQgcmVzLmpzb24oKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBrZWVwIHN0YXR1c1RleHRcbiAgICAgIH1cbiAgICAgIHRocm93IHRoaXMuc2lnbmFsaW5nRmFpbHVyZShyZXMuc3RhdHVzLCByZXMuc3RhdHVzVGV4dCwgcGFyc2VkKTtcbiAgICB9XG4gICAgY29uc3QgYW5zd2VyID0gKGF3YWl0IHJlcy5qc29uKCkpIGFzIHtcbiAgICAgIHNkcDogc3RyaW5nO1xuICAgICAgdHlwZTogUlRDU2RwVHlwZTtcbiAgICAgIHBjX2lkOiBzdHJpbmc7XG4gICAgfSAmIFBhcnRpYWw8Vm9pY2VTZXNzaW9uRGVzY3JpcHRvcj47XG4gICAgdGhpcy5wY0lkID0gYW5zd2VyLnBjX2lkO1xuICAgIC8vIEEgdG9rZW4gb2ZmZXIncyBhbnN3ZXIgbmFtZXMgdGhlIHNlc3Npb24gaXQgcmVkZWVtZWQgaW50byAoRTQgUDEpLlxuICAgIGlmICh0b2tlbiAmJiBhbnN3ZXIuc2Vzc2lvbl9pZCkgT2JqZWN0LmFzc2lnbih0aGlzLnNlc3Npb24sIGFuc3dlckRlc2NyaXB0b3IoYW5zd2VyKSk7XG4gICAgYXdhaXQgcGMuc2V0UmVtb3RlRGVzY3JpcHRpb24oeyBzZHA6IGFuc3dlci5zZHAsIHR5cGU6IGFuc3dlci50eXBlIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZW5lZ290aWF0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMucGMgfHwgdGhpcy5kaXNwb3NlZCkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLm5lZ290aWF0ZSh0cnVlKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMub3B0cy5vbkVycm9yPy4oZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIgOiBuZXcgRXJyb3IoXCJSZW5lZ290aWF0aW9uIGZhaWxlZFwiKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFJlcG9ydCB0aGF0IHRoZSByZW1vdGUgPGF1ZGlvPiBpcyBhY3R1YWxseSBwbGF5aW5nIFx1MjAxNCByZWxlYXNlcyB0aGVcbiAgICogIHNlcnZlci1oZWxkIGdyZWV0aW5nIHZpYSB0aGUgUlRWSSBjbGllbnQtcmVhZHkgaGFuZHNoYWtlLiAqL1xuICBub3RpZnlBdWRpb1JlbmRlcmluZygpOiB2b2lkIHtcbiAgICB0aGlzLmF1ZGlvUmVuZGVyaW5nID0gdHJ1ZTtcbiAgICB0aGlzLm1heWJlU2VuZENsaWVudFJlYWR5KCk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZCB0eXBlZCB0ZXh0IGFzIGEgUkVBTCB1c2VyIHR1cm4gb24gdGhlIGxpdmUgY2FsbCAoUlRWSVxuICAgKiBgc2VuZC10ZXh0YCBvdmVyIHRoZSBkYXRhIGNoYW5uZWwgXHUyMDE0IHRoZSBzZXJ2ZXIgaW5qZWN0cyBpdCBpbnRvIHRoZVxuICAgKiBwaXBlbGluZSdzIExMTSBjb250ZXh0IGFuZCBydW5zIGEgY29tcGxldGlvbiwgaW50ZXJydXB0aW5nIHRoZSBib3RcbiAgICogaWYgaXQgaXMgbWlkLXV0dGVyYW5jZSkuIFJldHVybnMgYGZhbHNlYCB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdFxuICAgKiBvcGVuIG9yIHRoZSB0ZXh0IGlzIGJsYW5rOyB0aGUgY2FsbGVyIGtlZXBzIHRoZSBjb21wb3NlcidzIHRleHQuXG4gICAqL1xuICBzZW5kVXNlclRleHQodGV4dDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHRleHQudHJpbSgpO1xuICAgIGlmICghdHJpbW1lZCkgcmV0dXJuIGZhbHNlO1xuICAgIGlmICghdGhpcy5kYyB8fCB0aGlzLmRjLnJlYWR5U3RhdGUgIT09IFwib3BlblwiKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5kYy5zZW5kKEpTT04uc3RyaW5naWZ5KGJ1aWxkU2VuZFRleHRFbnZlbG9wZSh0cmltbWVkKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIEFuc3dlciBhIGNsaWVudCB0b29sIGNhbGwgdGhlIGFnZW50IG1hZGUgb24gdGhpcyBjYWxsIChSVFZJXG4gICAqIGBsbG0tZnVuY3Rpb24tY2FsbC1yZXN1bHRgOyB0aGUgdmVuZG9yJ3MgYGNsaWVudF90b29sX3Jlc3VsdGApLiBMYXRlLFxuICAgKiBkdXBsaWNhdGUgb3IgdW5rbm93biBpZHMgYXJlIGlnbm9yZWQgc2VydmVyLXNpZGUuIFJldHVybnMgYGZhbHNlYCB3aGVuXG4gICAqIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZENsaWVudFRvb2xSZXN1bHQodG9vbENhbGxJZDogc3RyaW5nLCByZXN1bHQ6IHN0cmluZywgaXNFcnJvciA9IGZhbHNlKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmRjLnNlbmQoSlNPTi5zdHJpbmdpZnkoYnVpbGRGdW5jdGlvbkNhbGxSZXN1bHRFbnZlbG9wZSh0b29sQ2FsbElkLCByZXN1bHQsIGlzRXJyb3IpKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvKipcbiAgICogQXBwcm92ZSBvciBkZW55IGFuIE1DUCB0b29sIGNhbGwgdGhlIGFnZW50IGlzIHdhaXRpbmcgb24gKFJUVklcbiAgICogYG1jcC10b29sLWFwcHJvdmFsLXJlc3VsdGA7IHRoZSB2ZW5kb3IncyBgbWNwX3Rvb2xfYXBwcm92YWxfcmVzdWx0YCxcbiAgICogRTMgXHUwMEE3NC42KS4gTGF0ZSAvIHVua25vd24gaWRzIGFyZSBpZ25vcmVkIHNlcnZlci1zaWRlLiBSZXR1cm5zIGBmYWxzZWBcbiAgICogd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRNY3BUb29sQXBwcm92YWwodG9vbENhbGxJZDogc3RyaW5nLCBpc0FwcHJvdmVkOiBib29sZWFuKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybiBmYWxzZTtcbiAgICB0aGlzLmRjLnNlbmQoSlNPTi5zdHJpbmdpZnkoYnVpbGRNY3BUb29sQXBwcm92YWxFbnZlbG9wZSh0b29sQ2FsbElkLCBpc0FwcHJvdmVkKSkpO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLyoqXG4gICAqIFB1c2ggYmFja2dyb3VuZCBjb250ZXh0IGludG8gdGhlIGxpdmUgY29udmVyc2F0aW9uIHdpdGhvdXQgYSB0dXJuXG4gICAqIChSVFZJIGBhcHBlbmQtdG8tY29udGV4dGA7IHRoZSB2ZW5kb3IncyBgY29udGV4dHVhbF91cGRhdGVgKS4gVGhlIGFnZW50XG4gICAqIGRvZXMgbm90IHNwZWFrOyBpdCByZWFkcyB0aGUgbm90ZSBvbiBpdHMgbmV4dCByZXBseS4gQSBsYXRlciB1cGRhdGVcbiAgICogd2l0aCB0aGUgc2FtZSBgY29udGV4dElkYCByZXBsYWNlcyB0aGUgZWFybGllciBvbmUuIFJldHVybnMgYGZhbHNlYFxuICAgKiB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZENvbnRleHR1YWxVcGRhdGUodGV4dDogc3RyaW5nLCBjb250ZXh0SWQ/OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBpZiAoIXRoaXMuZGMgfHwgdGhpcy5kYy5yZWFkeVN0YXRlICE9PSBcIm9wZW5cIikgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuZGMuc2VuZChKU09OLnN0cmluZ2lmeShidWlsZEFwcGVuZFRvQ29udGV4dEVudmVsb3BlKHRleHQsIGNvbnRleHRJZCkpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBhZ2VudCB0aGUgdXNlciBpcyBhY3RpdmUgd2l0aG91dCBhIHR1cm4gKFJUVkkgYHVzZXItYWN0aXZpdHlgO1xuICAgKiB0aGUgdmVuZG9yJ3MgYHVzZXJfYWN0aXZpdHlgLCBFMiBELTkpOiByZXNldHMgdGhlIGlkbGUgY2xvY2suIFJldHVybnNcbiAgICogYGZhbHNlYCB3aGVuIHRoZSBjaGFubmVsIGlzIG5vdCBvcGVuLlxuICAgKi9cbiAgc2VuZFVzZXJBY3Rpdml0eSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zZW5kRnJhbWUoYnVpbGRVc2VyQWN0aXZpdHlFbnZlbG9wZSgpKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQZXItcmVzcG9uc2UgZmVlZGJhY2sgKFJUVkkgYGZlZWRiYWNrIHtzY29yZSwgZXZlbnRfaWR9YDsgdGhlIHZlbmRvcidzXG4gICAqIGBmZWVkYmFja2AsIEU0IFExNik6IGBsaWtlYCAvIGBkaXNsaWtlYCwgYG51bGxgIGNsZWFycyBpdC4gU3RvcmVkIGluIHRoZVxuICAgKiBPTkUgZmVlZGJhY2sgc3RvcmUgKEUyIEQtMTApLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgY2hhbm5lbCBpcyBub3Qgb3Blbi5cbiAgICovXG4gIHNlbmRGZWVkYmFjayhzY29yZTogXCJsaWtlXCIgfCBcImRpc2xpa2VcIiB8IG51bGwsIGV2ZW50SWQ6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnNlbmRGcmFtZShidWlsZEZlZWRiYWNrRW52ZWxvcGUoc2NvcmUsIGV2ZW50SWQpKTtcbiAgfVxuXG4gIHByaXZhdGUgbWF5YmVTZW5kQ2xpZW50UmVhZHkoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xpZW50UmVhZHlTZW50IHx8ICF0aGlzLmF1ZGlvUmVuZGVyaW5nKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLmRjIHx8IHRoaXMuZGMucmVhZHlTdGF0ZSAhPT0gXCJvcGVuXCIpIHJldHVybjtcbiAgICBjb25zdCBkYXRhID0gdGhpcy5jbGllbnRSZWFkeURhdGEoKTtcbiAgICB0aGlzLmRjLnNlbmQoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICAgICAgdHlwZTogXCJjbGllbnQtcmVhZHlcIixcbiAgICAgICAgaWQ6IGBjbGllbnQtcmVhZHktJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgICAgICAuLi4oZGF0YSA/IHsgZGF0YSB9IDoge30pLFxuICAgICAgfSksXG4gICAgKTtcbiAgICB0aGlzLmNsaWVudFJlYWR5U2VudCA9IHRydWU7XG4gIH1cblxuICBzZXRNaWNyb3Bob25lRW5hYmxlZChlbmFibGVkOiBib29sZWFuKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmxvY2FsU3RyZWFtKSByZXR1cm47XG4gICAgZm9yIChjb25zdCB0cmFjayBvZiB0aGlzLmxvY2FsU3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkpIHRyYWNrLmVuYWJsZWQgPSBlbmFibGVkO1xuICB9XG5cbiAgYXN5bmMgZGlzY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRpc3Bvc2VkID0gdHJ1ZTtcbiAgICAvLyBPd25lcnNoaXAgcHJvb2YgKFZPU08tMTkxKTogdGhlIHdvcmtlciByZWplY3RzIHRlYXJkb3duIHdpdGhvdXQgdGhlXG4gICAgLy8gdG9rZW4gbWludGVkIGFsb25nc2lkZSB0aGlzIHNlc3Npb24uIEEgdG9rZW4tbGVzcyBkZXNjcmlwdG9yIChvbGRlclxuICAgIC8vIEFQSSBkdXJpbmcgZGVwbG95IHNrZXcpIHdvdWxkIGJlIGEgZ3VhcmFudGVlZCA0MDEgXHUyMDE0IHNraXAgdGhlIHJlcXVlc3RcbiAgICAvLyBhbmQgbGV0IHRoZSBzZXJ2ZXIgc2lkZSBmYWxsIGJhY2sgdG8gSUNFLXRpbWVvdXQgdGVhcmRvd24uIEFmdGVyIHRoZVxuICAgIC8vIHdvcmtlcidzIG93biBlbmQgYW5ub3VuY2VtZW50IHRoZXJlIGlzIG5vdGhpbmcgbGVmdCB0byB0ZWFyIGRvd24uXG4gICAgY29uc3QgcHJvb2YgPSB0aGlzLmRpc2Nvbm5lY3RCb2R5KCk7XG4gICAgaWYgKHRoaXMuc2VydmVyRW5kZWQpIHtcbiAgICAgIC8vIFRoZSB3b3JrZXIgYW5ub3VuY2VkIHRoZSBlbmQgYW5kIHRvcmUgdGhlIHNlc3Npb24gZG93biBpdHNlbGY6XG4gICAgICAvLyBub3RoaW5nIHRvIHJlcXVlc3QsIG5vdGhpbmcgdG8gd2FybiBhYm91dC5cbiAgICB9IGVsc2UgaWYgKCFwcm9vZi5zZXNzaW9uX3Rva2VuKSB7XG4gICAgICBjb25zb2xlLndhcm4odGhpcy5kaXNjb25uZWN0V2FybmluZyhcInNraXBwZWRcIikpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXMgPSBhd2FpdCBwbGF0Zm9ybSgpLmZldGNoKHRoaXMuZGlzY29ubmVjdEVuZHBvaW50KCksIHtcbiAgICAgICAgICBtZXRob2Q6IFwiUE9TVFwiLFxuICAgICAgICAgIGhlYWRlcnM6IHRoaXMuZGlzY29ubmVjdEhlYWRlcnMoKSxcbiAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShwcm9vZiksXG4gICAgICAgICAga2VlcGFsaXZlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKCFyZXMub2spIHtcbiAgICAgICAgICAvLyBBIHJlamVjdGVkIGRpc2Nvbm5lY3QgbGVhdmVzIHRoZSBzZXJ2ZXIgc2Vzc2lvbiB0byBJQ0UgdGltZW91dC5cbiAgICAgICAgICBjb25zb2xlLndhcm4odGhpcy5kaXNjb25uZWN0V2FybmluZyhcInJlamVjdGVkXCIsIHJlcy5zdGF0dXMpKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGJlc3QgZWZmb3J0XG4gICAgICB9XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuY2xlYW51cCgpO1xuICAgIHRoaXMuc2V0U3RhdGUoXCJkaXNjb25uZWN0ZWRcIik7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNsZWFudXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGM/LmNsb3NlKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gICAgdGhpcy5kYyA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMucGM/LmNsb3NlKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvKiBpZ25vcmUgKi9cbiAgICB9XG4gICAgdGhpcy5wYyA9IG51bGw7XG4gICAgaWYgKHRoaXMubG9jYWxTdHJlYW0pIHtcbiAgICAgIGZvciAoY29uc3QgdHJhY2sgb2YgdGhpcy5sb2NhbFN0cmVhbS5nZXRUcmFja3MoKSkgdHJhY2suc3RvcCgpO1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbSA9IG51bGw7XG4gICAgfVxuICB9XG59XG5cbi8qKiBSVFZJIGBzZW5kLXRleHRgIGVudmVsb3BlIGZvciBvbmUgdHlwZWQgdXNlciB0dXJuLiBFeHBvcnRlZCBmb3IgdGVzdHNcbiAqICAoYW5kIG1pcnJvcmVkIGJ5IHRoZSBkYXNoYm9hcmQgcHJldmlldydzIGNvbXBvc2VyIFx1MjAxNCB0aGUgdHdvIHNlbmRlcnNcbiAqICBtdXN0IGVtaXQgdGhlIHNhbWUgd2lyZSBzaGFwZSB0aGUgcHJldmlldyBwaXBlbGluZSBwYXJzZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU2VuZFRleHRFbnZlbG9wZShjb250ZW50OiBzdHJpbmcpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwic2VuZC10ZXh0XCIsXG4gICAgaWQ6IGBzZW5kLXRleHQtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHtcbiAgICAgIGNvbnRlbnQsXG4gICAgICBvcHRpb25zOiB7IHJ1bl9pbW1lZGlhdGVseTogdHJ1ZSwgYXVkaW9fcmVzcG9uc2U6IHRydWUgfSxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogUlRWSSBgbGxtLWZ1bmN0aW9uLWNhbGwtcmVzdWx0YCBlbnZlbG9wZSBcdTIwMTQgdGhlIGFwcCdzIGFuc3dlciB0byBhblxuICogIGBsbG0tZnVuY3Rpb24tY2FsbGAgKEUzIFx1MDBBNzQuMS41KS4gVGhlIHZlbmRvcidzIHRocmVlIGZpZWxkcyBvbmx5OyB0aGVcbiAqICBzZXJ2ZXIgcmVzb2x2ZXMgdGhlIHBlbmRpbmcgY2FsbCBieSBgdG9vbF9jYWxsX2lkYC4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRnVuY3Rpb25DYWxsUmVzdWx0RW52ZWxvcGUoXG4gIHRvb2xDYWxsSWQ6IHN0cmluZyxcbiAgcmVzdWx0OiBzdHJpbmcsXG4gIGlzRXJyb3I6IGJvb2xlYW4sXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwibGxtLWZ1bmN0aW9uLWNhbGwtcmVzdWx0XCIsXG4gICAgaWQ6IGB0b29sLXJlc3VsdC0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfWAsXG4gICAgZGF0YTogeyB0b29sX2NhbGxfaWQ6IHRvb2xDYWxsSWQsIHJlc3VsdCwgaXNfZXJyb3I6IGlzRXJyb3IgfSxcbiAgfTtcbn1cblxuLyoqIFJUVkkgYG1jcC10b29sLWFwcHJvdmFsLXJlc3VsdGAgZW52ZWxvcGUgKEUzIFx1MDBBNzQuNikuIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1jcFRvb2xBcHByb3ZhbEVudmVsb3BlKFxuICB0b29sQ2FsbElkOiBzdHJpbmcsXG4gIGlzQXBwcm92ZWQ6IGJvb2xlYW4sXG4pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB7XG4gICAgbGFiZWw6IFwicnR2aS1haVwiLFxuICAgIHR5cGU6IFwibWNwLXRvb2wtYXBwcm92YWwtcmVzdWx0XCIsXG4gICAgaWQ6IGBtY3AtYXBwcm92YWwtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHsgdG9vbF9jYWxsX2lkOiB0b29sQ2FsbElkLCBpc19hcHByb3ZlZDogaXNBcHByb3ZlZCB9LFxuICB9O1xufVxuXG4vKiogVGhlIGBkYXRhYCBvZiBhbiBSVFZJIGBtY3AtdG9vbC1jYWxsYCBtZXNzYWdlLCBvciBgbnVsbGAgZm9yIGFueSBvdGhlclxuICogIHR5cGUgKEUzIFx1MDBBNzQuNikuIFRoZSBjYWxsZXIgcGFyc2VzIGl0IHdpdGggYG1jcFRvb2xDYWxsRnJvbVJlY29yZGAuICovXG5leHBvcnQgZnVuY3Rpb24gbWNwVG9vbENhbGxEYXRhRnJvbVJ0dmkobXNnOiBSdHZpTWVzc2FnZSk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG4gIGlmIChtc2cudHlwZSAhPT0gXCJtY3AtdG9vbC1jYWxsXCIpIHJldHVybiBudWxsO1xuICBjb25zdCBkYXRhID0gbXNnLmRhdGEgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gIHJldHVybiBkYXRhID8/IG51bGw7XG59XG5cbi8qKiBSVFZJIGBhcHBlbmQtdG8tY29udGV4dGAgZW52ZWxvcGUgKEUzIFx1MDBBNzQuMikuIGBjb250ZXh0X2lkYCBvbmx5IHdoZW5cbiAqICBnaXZlbi4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQXBwZW5kVG9Db250ZXh0RW52ZWxvcGUoXG4gIHRleHQ6IHN0cmluZyxcbiAgY29udGV4dElkPzogc3RyaW5nLFxuKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICBjb25zdCBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHsgdGV4dCB9O1xuICBpZiAoY29udGV4dElkICE9PSB1bmRlZmluZWQpIGRhdGEuY29udGV4dF9pZCA9IGNvbnRleHRJZDtcbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgdHlwZTogXCJhcHBlbmQtdG8tY29udGV4dFwiLFxuICAgIGlkOiBgY29udGV4dC0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfWAsXG4gICAgZGF0YSxcbiAgfTtcbn1cblxuLyoqIFRoZSBhZ2VudCdzIGNsaWVudCB0b29sIGNhbGwgb24gdGhlIGRhdGEgY2hhbm5lbCAoYGxsbS1mdW5jdGlvbi1jYWxsYCksXG4gKiAgZGVjb2RlZDsgYG51bGxgIGZvciBldmVyeSBvdGhlciBtZXNzYWdlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsaWVudFRvb2xDYWxsRnJvbVJ0dmkobXNnOiBSdHZpTWVzc2FnZSk6IHtcbiAgdG9vbE5hbWU6IHN0cmluZztcbiAgdG9vbENhbGxJZDogc3RyaW5nO1xuICBwYXJhbWV0ZXJzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgZXhwZWN0c1Jlc3BvbnNlOiBib29sZWFuO1xuICByZXNwb25zZVRpbWVvdXRTZWNzPzogbnVtYmVyO1xufSB8IG51bGwge1xuICBpZiAobXNnLnR5cGUgIT09IFwibGxtLWZ1bmN0aW9uLWNhbGxcIikgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGRhdGEgPSBtc2cuZGF0YSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgY29uc3QgdG9vbE5hbWUgPSBkYXRhPy5mdW5jdGlvbl9uYW1lO1xuICBjb25zdCB0b29sQ2FsbElkID0gZGF0YT8udG9vbF9jYWxsX2lkO1xuICBpZiAodHlwZW9mIHRvb2xOYW1lICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB0b29sQ2FsbElkICE9PSBcInN0cmluZ1wiKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYXJncyA9IGRhdGE/LmFyZ3M7XG4gIGNvbnN0IHBhcmFtZXRlcnMgPVxuICAgIHR5cGVvZiBhcmdzID09PSBcIm9iamVjdFwiICYmIGFyZ3MgIT09IG51bGwgJiYgIUFycmF5LmlzQXJyYXkoYXJncylcbiAgICAgID8gKGFyZ3MgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICA6IHt9O1xuICBjb25zdCB0aW1lb3V0ID0gZGF0YT8ucmVzcG9uc2VfdGltZW91dF9zZWNzO1xuICByZXR1cm4ge1xuICAgIHRvb2xOYW1lLFxuICAgIHRvb2xDYWxsSWQsXG4gICAgcGFyYW1ldGVycyxcbiAgICAvLyBBYnNlbnQgb24gYSBwcmUtRTMgZW1pdHRlcjogYXNzdW1lIHRoZSBhZ2VudCB3YWl0cyAoc2FmZSBkZWZhdWx0IFx1MjAxNFxuICAgIC8vIGFuIGFuc3dlciBub2JvZHkgd2FpdHMgZm9yIGlzIGRyb3BwZWQgc2lsZW50bHkpLlxuICAgIGV4cGVjdHNSZXNwb25zZTogZGF0YT8uZXhwZWN0c19yZXNwb25zZSAhPT0gZmFsc2UsXG4gICAgLi4uKHR5cGVvZiB0aW1lb3V0ID09PSBcIm51bWJlclwiID8geyByZXNwb25zZVRpbWVvdXRTZWNzOiB0aW1lb3V0IH0gOiB7fSksXG4gIH07XG59XG5cbi8qKiBSVFZJIGB1c2VyLWFjdGl2aXR5YCBlbnZlbG9wZSAoRTIgRC05KS4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVXNlckFjdGl2aXR5RW52ZWxvcGUoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4ge1xuICAgIGxhYmVsOiBcInJ0dmktYWlcIixcbiAgICB0eXBlOiBcInVzZXItYWN0aXZpdHlcIixcbiAgICBpZDogYHVzZXItYWN0aXZpdHktJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICB9O1xufVxuXG4vKiogUlRWSSBgZmVlZGJhY2tgIGVudmVsb3BlIChFNCBRMTYgXHUyMTkyIEUyIEQtMTAgc3RvcmUpLiBFeHBvcnRlZCBmb3IgdGVzdHMuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRGZWVkYmFja0VudmVsb3BlKFxuICBzY29yZTogXCJsaWtlXCIgfCBcImRpc2xpa2VcIiB8IG51bGwsXG4gIGV2ZW50SWQ6IG51bWJlcixcbik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHtcbiAgICBsYWJlbDogXCJydHZpLWFpXCIsXG4gICAgdHlwZTogXCJmZWVkYmFja1wiLFxuICAgIGlkOiBgZmVlZGJhY2stJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX1gLFxuICAgIGRhdGE6IHsgc2NvcmUsIGV2ZW50X2lkOiBldmVudElkIH0sXG4gIH07XG59XG5cbi8qKiBUaGUgZGVzY3JpcHRvciBrZXlzIGEgdG9rZW4gb2ZmZXIncyBhbnN3ZXIgY2Fycmllcy4gKi9cbmZ1bmN0aW9uIGFuc3dlckRlc2NyaXB0b3IoYW5zd2VyOiBQYXJ0aWFsPFZvaWNlU2Vzc2lvbkRlc2NyaXB0b3I+KTogUGFydGlhbDxWb2ljZVNlc3Npb25EZXNjcmlwdG9yPiB7XG4gIGNvbnN0IHsgc2Vzc2lvbl9pZCwgc2Vzc2lvbl90b2tlbiwgY29udmVyc2F0aW9uX2lkIH0gPSBhbnN3ZXI7XG4gIHJldHVybiB7IHNlc3Npb25faWQsIHNlc3Npb25fdG9rZW4sIGNvbnZlcnNhdGlvbl9pZDogY29udmVyc2F0aW9uX2lkID8/IFwiXCIgfTtcbn1cblxuZnVuY3Rpb24gYWRkVHJhY2VIZWFkZXJzKFxuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICBjb250ZXh0OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkLFxuKTogdm9pZCB7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBbXCJ0cmFjZXBhcmVudFwiLCBcInRyYWNlc3RhdGVcIl0gYXMgY29uc3QpIHtcbiAgICBjb25zdCB2YWx1ZSA9IGNvbnRleHQ/LltuYW1lXTtcbiAgICBpZiAodmFsdWUpIGhlYWRlcnNbbmFtZV0gPSB2YWx1ZTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkaXNjb25uZWN0VXJsKHNpZ25hbGluZ1VybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChzaWduYWxpbmdVcmwpO1xuICB1cmwucGF0aG5hbWUgPSB1cmwucGF0aG5hbWUucmVwbGFjZSgvXFwvYXBpXFwvb2ZmZXJcXC8/JC8sIFwiL2FwaS9kaXNjb25uZWN0XCIpO1xuICB1cmwuc2VhcmNoID0gXCJcIjtcbiAgdXJsLmhhc2ggPSBcIlwiO1xuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbi8qKiBSZXNvbHZlIG9uY2UgSUNFIGdhdGhlcmluZyBjb21wbGV0ZXMsIG9yIGFmdGVyIGEgc2hvcnQgY2FwLiAqL1xuZnVuY3Rpb24gd2FpdEZvckljZUdhdGhlcmluZyhwYzogUlRDUGVlckNvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKHBjLmljZUdhdGhlcmluZ1N0YXRlID09PSBcImNvbXBsZXRlXCIpIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgdGltZW91dCA9IHBsYXRmb3JtKCkuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBwYy5yZW1vdmVFdmVudExpc3RlbmVyKFwiaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2VcIiwgY2hlY2spO1xuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0sIDI1MCk7XG4gICAgY29uc3QgY2hlY2sgPSAoKSA9PiB7XG4gICAgICBpZiAocGMuaWNlR2F0aGVyaW5nU3RhdGUgPT09IFwiY29tcGxldGVcIikge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgIHBjLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZVwiLCBjaGVjayk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoXCJpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZVwiLCBjaGVjayk7XG4gIH0pO1xufVxuXG4vKiogRm9yY2UgYHVzZWR0eD0wO3VzZWluYmFuZGZlYz0xYCBvbnRvIGV2ZXJ5IE9wdXMgbS1saW5lIChzZWUgdGhlXG4gKiAgZGFzaGJvYXJkIGNsaWVudCBmb3IgdGhlIGZ1bGwgcmF0aW9uYWxlOiBEVFggY2xpcHMgcXVpZXQgd29yZCBvbnNldHM7XG4gKiAgRkVDIGxldHMgdGhlIGJyb3dzZXIgcmVjb25zdHJ1Y3QgZHJvcHBlZCBwYWNrZXRzKS4gRXhwb3J0ZWQgZm9yIHRlc3RzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHR1bmVPcHVzRm10cChzZHA6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG9wdXNQdHMgPSBbLi4uc2RwLm1hdGNoQWxsKC9eYT1ydHBtYXA6KFxcZCspXFxzK29wdXNcXC9cXGQrL2dpbSldLm1hcCgobSkgPT4gbVsxXSk7XG4gIGlmIChvcHVzUHRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHNkcDtcblxuICBjb25zdCBoYXZlRm10cCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCBsaW5lcyA9IHNkcC5zcGxpdCgvXFxyXFxufFxcbi8pO1xuICBjb25zdCBvdXQgPSBsaW5lcy5tYXAoKGxpbmUpID0+IHtcbiAgICBjb25zdCBtID0gbGluZS5tYXRjaCgvXmE9Zm10cDooXFxkKylcXHMrKC4qKSQvaSk7XG4gICAgaWYgKCFtIHx8ICFvcHVzUHRzLmluY2x1ZGVzKG1bMV0pKSByZXR1cm4gbGluZTtcbiAgICBoYXZlRm10cC5hZGQobVsxXSEpO1xuICAgIHJldHVybiBgYT1mbXRwOiR7bVsxXX0gJHt3aXRoT3B1c0RpcmVjdGl2ZXMobVsyXSA/PyBcIlwiKX1gO1xuICB9KTtcblxuICBjb25zdCBtaXNzaW5nID0gb3B1c1B0cy5maWx0ZXIoKHB0KSA9PiBwdCAhPT0gdW5kZWZpbmVkICYmICFoYXZlRm10cC5oYXMocHQpKTtcbiAgaWYgKG1pc3NpbmcubGVuZ3RoID09PSAwKSByZXR1cm4gb3V0LmpvaW4oXCJcXHJcXG5cIik7XG5cbiAgY29uc3Qgd2l0aEZtdHA6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgbGluZSBvZiBvdXQpIHtcbiAgICB3aXRoRm10cC5wdXNoKGxpbmUpO1xuICAgIGNvbnN0IHJtID0gbGluZS5tYXRjaCgvXmE9cnRwbWFwOihcXGQrKVxccytvcHVzXFwvXFxkKy9pKTtcbiAgICBpZiAocm0gJiYgbWlzc2luZy5pbmNsdWRlcyhybVsxXSkpIHtcbiAgICAgIHdpdGhGbXRwLnB1c2goYGE9Zm10cDoke3JtWzFdfSB1c2VkdHg9MDt1c2VpbmJhbmRmZWM9MWApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gd2l0aEZtdHAuam9pbihcIlxcclxcblwiKTtcbn1cblxuZnVuY3Rpb24gd2l0aE9wdXNEaXJlY3RpdmVzKHBhcmFtczogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IG5leHQgPSAvdXNlZHR4PS9pLnRlc3QocGFyYW1zKVxuICAgID8gcGFyYW1zLnJlcGxhY2UoL3VzZWR0eD1cXGQrL2ksIFwidXNlZHR4PTBcIilcbiAgICA6IGAke3BhcmFtc307dXNlZHR4PTBgO1xuICBuZXh0ID0gL3VzZWluYmFuZGZlYz0vaS50ZXN0KG5leHQpXG4gICAgPyBuZXh0LnJlcGxhY2UoL3VzZWluYmFuZGZlYz1cXGQrL2ksIFwidXNlaW5iYW5kZmVjPTFcIilcbiAgICA6IGAke25leHR9O3VzZWluYmFuZGZlYz0xYDtcbiAgcmV0dXJuIG5leHQ7XG59XG4iLCAiZXhwb3J0ICogZnJvbSBcIi4uLy4uL2FpLWFnZW50L3NyYy9pbnRlcm5hbC92b2ljZS1jbGllbnRcIjtcbiIsICIvLyBDbGllbnQgdG9vbHMgXHUyMDE0IHRoZSBlbWJlZGRpbmcgcGFnZSdzIGhhbmRsZXJzIGZvciB0aGUgYWdlbnQncyBgY2xpZW50YFxuLy8gdG9vbHMgKEUzIFx1MDBBNzQuMS44LCBWT1NPLTc1NikuIFRoZSBhZ2VudCBjYWxscyBgbG9va3VwX3BvbGljeWAsIHRoZSBwYWdlXG4vLyBydW5zIGl0cyBoYW5kbGVyIGFuZCB0aGUgYW5zd2VyIGlzIHNlbnQgYmFjazsgdGhlIHNhbWUgcmVnaXN0cnkgc2VydmVzIGFcbi8vIHZvaWNlIGNhbGwgKFJUVkkgYGxsbS1mdW5jdGlvbi1jYWxsYCBvdmVyIHRoZSBkYXRhIGNoYW5uZWwpIGFuZCBhIGNoYXRcbi8vIHNlc3Npb24gKFNTRSBgY2xpZW50X3Rvb2xfY2FsbGAgKyBgUE9TVCBcdTIwMjYvdG9vbC1yZXN1bHRgKS5cbi8vXG4vLyBMaXRlcmFscyBmb2xsb3cgdGhlIHZlbmRvcidzIEpTIFNESyBzbyBhIHBhZ2UgcG9ydGVkIGZyb20gaXQgYmVoYXZlcyB0aGVcbi8vIHNhbWU6IGFuIHVucmVnaXN0ZXJlZCB0b29sIGFuc3dlcnMgYXQgb25jZSB3aXRoIGFuIGVycm9yICh1bmxlc3MgdGhlXG4vLyBwYWdlIHNldCBgb25VbmhhbmRsZWRDbGllbnRUb29sQ2FsbGAsIGluIHdoaWNoIGNhc2Ugbm90aGluZyBpcyBzZW50IGFuZFxuLy8gdGhlIGFnZW50J3Mgb3duIHRpbWVvdXQgYXBwbGllcyksIGEgaGFuZGxlciByZXR1cm5pbmcgYHVuZGVmaW5lZGAgc2VuZHNcbi8vIFwiQ2xpZW50IHRvb2wgZXhlY3V0aW9uIHN1Y2Nlc3NmdWwuXCIsIG9iamVjdHMgYXJlIEpTT04tc3RyaW5naWZpZWQsIGFuZCBhXG4vLyB0aHJvd24gZXJyb3IgYmVjb21lcyBgaXNfZXJyb3I6IHRydWVgIHdpdGggdGhlIG1lc3NhZ2UuXG5cbi8qKiBBIHBhZ2Utc2lkZSB0b29sIGltcGxlbWVudGF0aW9uOiBwYXJhbWV0ZXJzIGluLCByZXN1bHQgb3V0LiAqL1xuZXhwb3J0IHR5cGUgQ2xpZW50VG9vbEhhbmRsZXIgPSAoXG4gIHBhcmFtZXRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LFxuKSA9PiB1bmtub3duIHwgUHJvbWlzZTx1bmtub3duPjtcblxuLyoqIFRoZSBjYWxsIHRoZSBhZ2VudCBtYWRlLCBhcyB0aGUgcGFnZSBzZWVzIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBDbGllbnRUb29sQ2FsbCB7XG4gIHRvb2xOYW1lOiBzdHJpbmc7XG4gIHRvb2xDYWxsSWQ6IHN0cmluZztcbiAgcGFyYW1ldGVyczogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGV4cGVjdHNSZXNwb25zZTogYm9vbGVhbjtcbiAgcmVzcG9uc2VUaW1lb3V0U2Vjcz86IG51bWJlcjtcbn1cblxuLyoqIEFuIE1DUCB0b29sIGNhbGwgdGhhdCBuZWVkcyB0aGUgcGFnZSdzIGFwcHJvdmFsIChFMyBcdTAwQTc0LjY7IHRoZSB2ZW5kb3Inc1xuICogIGBtY3BfdG9vbF9jYWxsYCB3aXRoIGBzdGF0ZTogXCJhd2FpdGluZ19hcHByb3ZhbFwiYCkuIFRoZSBwYWdlIGFuc3dlcnMgd2l0aFxuICogIGBhcHByb3ZlTWNwVG9vbCh0b29sQ2FsbElkLCBpc0FwcHJvdmVkKWAgd2l0aGluIGBhcHByb3ZhbFRpbWVvdXRTZWNzYFxuICogICgzMCBzKSBvciB0aGUgYWdlbnQgaXMgdG9sZCB0aGUgYXBwcm92YWwgdGltZWQgb3V0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBNY3BUb29sQ2FsbCB7XG4gIHNlcnZpY2VJZDogc3RyaW5nO1xuICB0b29sQ2FsbElkOiBzdHJpbmc7XG4gIHRvb2xOYW1lOiBzdHJpbmc7XG4gIHBhcmFtZXRlcnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBzdGF0ZTogc3RyaW5nO1xuICBhcHByb3ZhbFRpbWVvdXRTZWNzPzogbnVtYmVyO1xuICByZXN1bHQ/OiBzdHJpbmc7XG4gIGVycm9yTWVzc2FnZT86IHN0cmluZztcbn1cblxuLyoqIFBhcnNlIG9uZSBgbWNwX3Rvb2xfY2FsbGAtc2hhcGVkIHJlY29yZCAoU1NFIGZyYW1lIG9yIFJUVkkgYGRhdGFgKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtY3BUb29sQ2FsbEZyb21SZWNvcmQoZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQpOiBNY3BUb29sQ2FsbCB8IG51bGwge1xuICBjb25zdCB0b29sQ2FsbElkID0gZGF0YT8udG9vbF9jYWxsX2lkO1xuICBjb25zdCB0b29sTmFtZSA9IGRhdGE/LnRvb2xfbmFtZTtcbiAgY29uc3Qgc3RhdGUgPSBkYXRhPy5zdGF0ZTtcbiAgaWYgKHR5cGVvZiB0b29sQ2FsbElkICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiB0b29sTmFtZSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2Ygc3RhdGUgIT09IFwic3RyaW5nXCIpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBwYXJhbXMgPSBkYXRhPy5wYXJhbWV0ZXJzO1xuICBjb25zdCBwYXJhbWV0ZXJzID1cbiAgICB0eXBlb2YgcGFyYW1zID09PSBcIm9iamVjdFwiICYmIHBhcmFtcyAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheShwYXJhbXMpXG4gICAgICA/IChwYXJhbXMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICA6IHt9O1xuICByZXR1cm4ge1xuICAgIHNlcnZpY2VJZDogdHlwZW9mIGRhdGE/LnNlcnZpY2VfaWQgPT09IFwic3RyaW5nXCIgPyBkYXRhLnNlcnZpY2VfaWQgOiBcIlwiLFxuICAgIHRvb2xDYWxsSWQsXG4gICAgdG9vbE5hbWUsXG4gICAgcGFyYW1ldGVycyxcbiAgICBzdGF0ZSxcbiAgICAuLi4odHlwZW9mIGRhdGE/LmFwcHJvdmFsX3RpbWVvdXRfc2VjcyA9PT0gXCJudW1iZXJcIlxuICAgICAgPyB7IGFwcHJvdmFsVGltZW91dFNlY3M6IGRhdGEuYXBwcm92YWxfdGltZW91dF9zZWNzIH1cbiAgICAgIDoge30pLFxuICAgIC4uLih0eXBlb2YgZGF0YT8ucmVzdWx0ID09PSBcInN0cmluZ1wiID8geyByZXN1bHQ6IGRhdGEucmVzdWx0IH0gOiB7fSksXG4gICAgLi4uKHR5cGVvZiBkYXRhPy5lcnJvcl9tZXNzYWdlID09PSBcInN0cmluZ1wiID8geyBlcnJvck1lc3NhZ2U6IGRhdGEuZXJyb3JfbWVzc2FnZSB9IDoge30pLFxuICB9O1xufVxuXG4vKiogVGhlIGFuc3dlciBzZW50IGJhY2sgb3ZlciBlaXRoZXIgY2hhbm5lbC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2xpZW50VG9vbEFuc3dlciB7XG4gIHJlc3VsdDogc3RyaW5nO1xuICBpc0Vycm9yOiBib29sZWFuO1xufVxuXG5leHBvcnQgY29uc3QgQ0xJRU5UX1RPT0xfU1VDQ0VTU19MSVRFUkFMID0gXCJDbGllbnQgdG9vbCBleGVjdXRpb24gc3VjY2Vzc2Z1bC5cIjtcblxuLyoqIFRoZSB2ZW5kb3IgU0RLJ3MgdGV4dCBmb3IgYSB0b29sIHRoZSBwYWdlIGRpZCBub3QgcmVnaXN0ZXIuICovXG5leHBvcnQgZnVuY3Rpb24gdW5kZWZpbmVkQ2xpZW50VG9vbExpdGVyYWwobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGBDbGllbnQgdG9vbCB3aXRoIG5hbWUgJHtuYW1lfSBpcyBub3QgZGVmaW5lZCBvbiBjbGllbnRgO1xufVxuXG4vKiogU3RyaW5naWZ5IGEgaGFuZGxlcidzIHJldHVybiB2YWx1ZSB0aGUgd2F5IHRoZSB2ZW5kb3IgU0RLIGRvZXMuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaW5naWZ5Q2xpZW50VG9vbFJlc3VsdCh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gQ0xJRU5UX1RPT0xfU1VDQ0VTU19MSVRFUkFMO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSBcInN0cmluZ1wiKSByZXR1cm4gdmFsdWU7XG4gIHRyeSB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSdW4gb25lIGNsaWVudCB0b29sIGNhbGwgYWdhaW5zdCB0aGUgcGFnZSdzIHJlZ2lzdHJ5LiBSZXNvbHZlcyB0byB0aGVcbiAqIGFuc3dlciB0byBzZW5kLCBvciBgbnVsbGAgd2hlbiB0aGUgdG9vbCBpcyB1bnJlZ2lzdGVyZWQgQU5EIHRoZSBwYWdlXG4gKiBpbnN0YWxsZWQgYG9uVW5oYW5kbGVkYCAodGhlbiB0aGUgaG9vayBvd25zIHRoZSBjYWxsIGFuZCBub3RoaW5nIGlzIHNlbnQpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcnVuQ2xpZW50VG9vbChcbiAgaGFuZGxlcnM6IFJlY29yZDxzdHJpbmcsIENsaWVudFRvb2xIYW5kbGVyPixcbiAgY2FsbDogQ2xpZW50VG9vbENhbGwsXG4gIG9uVW5oYW5kbGVkPzogKGNhbGw6IENsaWVudFRvb2xDYWxsKSA9PiB2b2lkLFxuKTogUHJvbWlzZTxDbGllbnRUb29sQW5zd2VyIHwgbnVsbD4ge1xuICBjb25zdCBoYW5kbGVyID0gaGFuZGxlcnNbY2FsbC50b29sTmFtZV07XG4gIGlmICh0eXBlb2YgaGFuZGxlciAhPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgaWYgKG9uVW5oYW5kbGVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICBvblVuaGFuZGxlZChjYWxsKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiB0aGUgaG9vaydzIGZhaWx1cmUgaXMgdGhlIHBhZ2UncyBidXNpbmVzcyAqL1xuICAgICAgfVxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB7IHJlc3VsdDogdW5kZWZpbmVkQ2xpZW50VG9vbExpdGVyYWwoY2FsbC50b29sTmFtZSksIGlzRXJyb3I6IHRydWUgfTtcbiAgfVxuICB0cnkge1xuICAgIGNvbnN0IHZhbHVlID0gYXdhaXQgaGFuZGxlcihjYWxsLnBhcmFtZXRlcnMpO1xuICAgIHJldHVybiB7IHJlc3VsdDogc3RyaW5naWZ5Q2xpZW50VG9vbFJlc3VsdCh2YWx1ZSksIGlzRXJyb3I6IGZhbHNlIH07XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycik7XG4gICAgcmV0dXJuIHsgcmVzdWx0OiBgQ2xpZW50IHRvb2wgZXhlY3V0aW9uIGZhaWxlZDogJHttZXNzYWdlfWAsIGlzRXJyb3I6IHRydWUgfTtcbiAgfVxufVxuIiwgIi8vIFRoZSB2ZW5kb3IncyBlbGVtZW50IGF0dHJpYnV0ZXMsIG1hcHBlZCBvbnRvIG91cnMgKEU0IHBsYW4gXHUwMEE3NC44LCBvd25lclxuLy8gcnVsaW5ncyBROSAvIFEyNSkuIFB1cmUgZnVuY3Rpb25zIG92ZXIgYW4gYXR0cmlidXRlIHJlYWRlciBzbyBldmVyeSBydWxlIGlzXG4vLyB1bml0LXRlc3RlZCB3aXRob3V0IGEgRE9NLiBFdmVyeXRoaW5nIGhlcmUgaXMgQURESVRJVkU6IGFuIGVsZW1lbnQgd2l0aG91dFxuLy8gdGhlc2UgYXR0cmlidXRlcyByZW5kZXJzIGV4YWN0bHkgYXMgYmVmb3JlICh0aGUgZGVmYXVsdHMgQVJFIHRvZGF5J3Ncbi8vIHJlbmRlcmluZyksIGFuZCBhbiBleHBsaWNpdCBgb3ZlcnJpZGVzYCBhdHRyaWJ1dGUgLyBwcm9wZXJ0eSB3aW5zIG92ZXIgdGhlXG4vLyBwZXIta2V5IGBvdmVycmlkZS0qYCBhdHRyaWJ1dGVzLlxuaW1wb3J0IHR5cGUgeyBXaWRnZXRQbGFjZW1lbnQsIFdpZGdldFJ1bnRpbWVDb25maWcsIFdpZGdldFZhcmlhbnQgfSBmcm9tIFwiLi9jb25maWdcIjtcbmltcG9ydCB7IFdJREdFVF9URVhUX0tFWVMsIHR5cGUgV2lkZ2V0VGV4dEtleSB9IGZyb20gXCIuL3RleHQtZGVmYXVsdHNcIjtcblxuZXhwb3J0IHR5cGUgQXR0cmlidXRlUmVhZGVyID0gKG5hbWU6IHN0cmluZykgPT4gc3RyaW5nIHwgbnVsbDtcbmV4cG9ydCB0eXBlIERlYnVnU2luayA9IChldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQ7XG5cbi8qKiBgXCJ0cnVlXCJgIC8gYFwiZmFsc2VcImAgXHUyMTkyIGJvb2xlYW47IGFueXRoaW5nIGVsc2UgKGFic2VudCBpbmNsdWRlZCkgXHUyMTkyIHVuZGVmaW5lZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUJvb2wodmFsdWU6IHN0cmluZyB8IG51bGwpOiBib29sZWFuIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZhbHVlID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh2YWx1ZSA9PT0gXCJmYWxzZVwiKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogUTkgXHUyMDE0IHRoZSBmb3VyIGRpc3BsYXkgYXR0cmlidXRlcyBcdTIxOTIgdGhlIHJ1bnRpbWUgY29uZmlnIGtleSBlYWNoIG92ZXJsYXlzXG4gKiBhZnRlciBgbWVyZ2VDb25maWcoKWAuIERlZmF1bHRzIGtlZXAgdG9kYXkncyByZW5kZXJpbmc6IHRoZSBzdGF0dXMgbGluZSBhbmRcbiAqIHRoZSBjb2xsYXBzZWQgYXZhdGFyIGFyZSBzaG93biwgdGhlIHJlc2l6ZSBidXR0b24gZm9sbG93cyB0aGUgc2VydmVyIGNvbmZpZyxcbiAqIG5vIGxhbmd1YWdlIHNlbGVjdG9yIG9uIHRoZSBjb2xsYXBzZWQgdHJpZ2dlci5cbiAqL1xuZXhwb3J0IGNvbnN0IERJU1BMQVlfQVRUUklCVVRFUyA9IFtcbiAgW1wic2hvdy1hZ2VudC1zdGF0dXNcIiwgXCJzaG93X2FnZW50X3N0YXR1c1wiXSxcbiAgW1wic2hvdy1yZXNpemUtYnV0dG9uXCIsIFwicmVzaXplX2J1dHRvbl9lbmFibGVkXCJdLFxuICBbXCJzaG93LWxhbmd1YWdlLXNlbGVjdG9yLW9uLXRyaWdnZXJcIiwgXCJzaG93X2xhbmd1YWdlX3NlbGVjdG9yX29uX3RyaWdnZXJcIl0sXG4gIFtcInNob3ctYXZhdGFyLXdoZW4tY29sbGFwc2VkXCIsIFwic2hvd19hdmF0YXJfd2hlbl9jb2xsYXBzZWRcIl0sXG5dIGFzIGNvbnN0IHNhdGlzZmllcyBSZWFkb25seUFycmF5PHJlYWRvbmx5IFtzdHJpbmcsIGtleW9mIFdpZGdldFJ1bnRpbWVDb25maWddPjtcblxuY29uc3QgVkFSSUFOVFM6IHJlYWRvbmx5IFdpZGdldFZhcmlhbnRbXSA9IFtcInRpbnlcIiwgXCJjb21wYWN0XCIsIFwiZnVsbFwiXTtcbmNvbnN0IFBMQUNFTUVOVFM6IHJlYWRvbmx5IFdpZGdldFBsYWNlbWVudFtdID0gW1xuICBcInRvcC1sZWZ0XCIsXG4gIFwidG9wXCIsXG4gIFwidG9wLXJpZ2h0XCIsXG4gIFwiYm90dG9tLWxlZnRcIixcbiAgXCJib3R0b21cIixcbiAgXCJib3R0b20tcmlnaHRcIixcbl07XG5cbi8qKlxuICogUTI1IFx1MjAxNCB0aGUgdmVuZG9yJ3MgYHRleHQtY29udGVudHNgIGtleXMgdGhhdCBkaWZmZXIgZnJvbSBvdXJzLiBFdmVyeSBrZXkgb2ZcbiAqIG91cnMgdGhhdCB0aGUgdmVuZG9yIHNoYXJlcyAoV0lER0VUX1RFWFRfS0VZUyB3ZXJlIGNvcGllZCBmcm9tIHRoZSB2ZW5kb3Inc1xuICogbWFwLCB0ZXh0LWRlZmF1bHRzLnRzKSBtYXBzIHRvIGl0c2VsZjsgdGhlc2UgYXJlIHRoZSByZW5hbWVzLiBLZXlzIGluXG4gKiBuZWl0aGVyIHNldCAodGhlIHZlbmRvcidzIGZpbGUtaW5wdXQgLyByaWNoLWNvbnRlbnQgLyBzaG9ydCBxdWV1ZSBjb3B5KSBhcmVcbiAqIHJlcG9ydGVkIHRocm91Z2ggdGhlIGRlYnVnIHNpbmsgYW5kIGlnbm9yZWQuXG4gKi9cbmV4cG9ydCBjb25zdCBWRU5ET1JfVEVYVF9SRU5BTUVTOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBXaWRnZXRUZXh0S2V5Pj4gPSB7XG4gIHF1ZXVlX3dhaXRpbmdfc3RhdHVzOiBcInF1ZXVlZF9zdGF0dXNcIixcbn07XG5cbmNvbnN0IE9VUl9URVhUX0tFWVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFdJREdFVF9URVhUX0tFWVMpO1xuXG4vKiogQSBgdGV4dC1jb250ZW50c2AgSlNPTiBvYmplY3QgKHZlbmRvciBvciBvdXIga2V5IG5hbWVzKSBcdTIxOTIgb3VyIHRleHQgb3ZlcnJpZGVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hcFRleHRDb250ZW50cyhyYXc6IHN0cmluZyB8IG51bGwsIGRlYnVnOiBEZWJ1Z1NpbmspOiBQYXJ0aWFsPFJlY29yZDxXaWRnZXRUZXh0S2V5LCBzdHJpbmc+PiB7XG4gIGlmICghcmF3KSByZXR1cm4ge307XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xuICB9IGNhdGNoIHtcbiAgICBkZWJ1Zyh7IHR5cGU6IFwiaW52YWxpZF90ZXh0X2NvbnRlbnRzXCIgfSk7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGlmICghcGFyc2VkIHx8IHR5cGVvZiBwYXJzZWQgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShwYXJzZWQpKSB7XG4gICAgZGVidWcoeyB0eXBlOiBcImludmFsaWRfdGV4dF9jb250ZW50c1wiIH0pO1xuICAgIHJldHVybiB7fTtcbiAgfVxuICBjb25zdCBvdXQ6IFBhcnRpYWw8UmVjb3JkPFdpZGdldFRleHRLZXksIHN0cmluZz4+ID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHBhcnNlZCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikpIHtcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSBjb250aW51ZTtcbiAgICBjb25zdCB0YXJnZXQgPSBPVVJfVEVYVF9LRVlTLmhhcyhrZXkpID8gKGtleSBhcyBXaWRnZXRUZXh0S2V5KSA6IFZFTkRPUl9URVhUX1JFTkFNRVNba2V5XTtcbiAgICBpZiAodGFyZ2V0KSBvdXRbdGFyZ2V0XSA9IHZhbHVlO1xuICAgIGVsc2UgZGVidWcoeyB0eXBlOiBcInVubWFwcGVkX3RleHRfY29udGVudHNfa2V5XCIsIGtleSB9KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIFRoZSBmZXRjaGVkIChtZXJnZWQpIGNvbmZpZyB3aXRoIHRoZSBlbGVtZW50J3MgYXR0cmlidXRlcyBsYWlkIG92ZXIgaXQ6XG4gKiB0aGUgZm91ciBkaXNwbGF5IGF0dHJpYnV0ZXMgKFE5KSwgYHZhcmlhbnRgLCBgcGxhY2VtZW50YCwgYHRlcm1zLWtleWAgYW5kXG4gKiBgdGV4dC1jb250ZW50c2AgKFEyNSkuIEFuIGludmFsaWQgdmFsdWUgaXMgaWdub3JlZCAodGhlIGNvbmZpZyBzdGF5cykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvdmVybGF5QXR0cmlidXRlcyhcbiAgY2ZnOiBXaWRnZXRSdW50aW1lQ29uZmlnLFxuICBhdHRyOiBBdHRyaWJ1dGVSZWFkZXIsXG4gIGRlYnVnOiBEZWJ1Z1NpbmssXG4pOiBXaWRnZXRSdW50aW1lQ29uZmlnIHtcbiAgY29uc3Qgb3V0OiBXaWRnZXRSdW50aW1lQ29uZmlnID0geyAuLi5jZmcgfTtcbiAgZm9yIChjb25zdCBbbmFtZSwga2V5XSBvZiBESVNQTEFZX0FUVFJJQlVURVMpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQm9vbChhdHRyKG5hbWUpKTtcbiAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgb3V0W2tleV0gPSB2YWx1ZTtcbiAgfVxuICBjb25zdCB2YXJpYW50ID0gYXR0cihcInZhcmlhbnRcIik7XG4gIGlmICh2YXJpYW50ICYmIChWQVJJQU5UUyBhcyByZWFkb25seSBzdHJpbmdbXSkuaW5jbHVkZXModmFyaWFudCkpIG91dC52YXJpYW50ID0gdmFyaWFudCBhcyBXaWRnZXRWYXJpYW50O1xuICBjb25zdCBwbGFjZW1lbnQgPSBhdHRyKFwicGxhY2VtZW50XCIpO1xuICBpZiAocGxhY2VtZW50ICYmIChQTEFDRU1FTlRTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyhwbGFjZW1lbnQpKSB7XG4gICAgb3V0LnBsYWNlbWVudCA9IHBsYWNlbWVudCBhcyBXaWRnZXRQbGFjZW1lbnQ7XG4gIH1cbiAgY29uc3QgdGVybXNLZXkgPSBhdHRyKFwidGVybXMta2V5XCIpO1xuICBpZiAodGVybXNLZXkpIG91dC50ZXJtcyA9IHsgLi4ub3V0LnRlcm1zLCBsb2NhbF9zdG9yYWdlX2tleTogdGVybXNLZXkgfTtcbiAgY29uc3QgdGV4dCA9IG1hcFRleHRDb250ZW50cyhhdHRyKFwidGV4dC1jb250ZW50c1wiKSwgZGVidWcpO1xuICBpZiAoT2JqZWN0LmtleXModGV4dCkubGVuZ3RoID4gMCkgb3V0LnRleHQgPSB7IC4uLm91dC50ZXh0LCAuLi50ZXh0IH07XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qKiBUaGUgdmVuZG9yJ3MgYG92ZXJyaWRlLSpgIGF0dHJpYnV0ZXMgXHUyMTkyIG91ciBmbGF0IG92ZXJyaWRlIGtleXMgKHRoZSBcdTAwQTc0LjQgdGFibGUpLiAqL1xuZXhwb3J0IGNvbnN0IE9WRVJSSURFX0FUVFJJQlVURVMgPSBbXG4gIFtcIm92ZXJyaWRlLXByb21wdFwiLCBcInN5c3RlbV9wcm9tcHRcIiwgXCJzdHJpbmdcIl0sXG4gIFtcIm92ZXJyaWRlLWxsbVwiLCBcImxsbVwiLCBcInN0cmluZ1wiXSxcbiAgW1wib3ZlcnJpZGUtZmlyc3QtbWVzc2FnZVwiLCBcImZpcnN0X21lc3NhZ2VcIiwgXCJzdHJpbmdcIl0sXG4gIFtcIm92ZXJyaWRlLWxhbmd1YWdlXCIsIFwibGFuZ3VhZ2VcIiwgXCJzdHJpbmdcIl0sXG4gIFtcIm92ZXJyaWRlLXZvaWNlLWlkXCIsIFwidm9pY2VcIiwgXCJzdHJpbmdcIl0sXG4gIFtcIm92ZXJyaWRlLXNwZWVkXCIsIFwidm9pY2Vfc3BlZWRcIiwgXCJudW1iZXJcIl0sXG4gIFtcIm92ZXJyaWRlLXN0YWJpbGl0eVwiLCBcInZvaWNlX3N0YWJpbGl0eVwiLCBcIm51bWJlclwiXSxcbiAgW1wib3ZlcnJpZGUtc2ltaWxhcml0eS1ib29zdFwiLCBcInZvaWNlX3NpbWlsYXJpdHlcIiwgXCJudW1iZXJcIl0sXG4gIFtcIm92ZXJyaWRlLXRleHQtb25seVwiLCBcInRleHRfb25seVwiLCBcImJvb2xlYW5cIl0sXG5dIGFzIGNvbnN0O1xuXG4vKiogVGhlIHBlci1rZXkgb3ZlcnJpZGUgYXR0cmlidXRlcyBhcyBvbmUgb3ZlcnJpZGVzIG9iamVjdCwgb3IgYG51bGxgIHdoZW4gbm9uZSBpcyBzZXQuICovXG5leHBvcnQgZnVuY3Rpb24gYXR0cmlidXRlT3ZlcnJpZGVzKGF0dHI6IEF0dHJpYnV0ZVJlYWRlcik6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB7XG4gIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcbiAgZm9yIChjb25zdCBbbmFtZSwga2V5LCBraW5kXSBvZiBPVkVSUklERV9BVFRSSUJVVEVTKSB7XG4gICAgY29uc3QgcmF3ID0gYXR0cihuYW1lKTtcbiAgICBpZiAocmF3ID09PSBudWxsIHx8IHJhdyA9PT0gXCJcIikgY29udGludWU7XG4gICAgaWYgKGtpbmQgPT09IFwibnVtYmVyXCIpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gTnVtYmVyKHJhdyk7XG4gICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHZhbHVlKSkgb3V0W2tleV0gPSB2YWx1ZTtcbiAgICB9IGVsc2UgaWYgKGtpbmQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQm9vbChyYXcpO1xuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIG91dFtrZXldID0gdmFsdWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIG91dFtrZXldID0gcmF3O1xuICAgIH1cbiAgfVxuICByZXR1cm4gT2JqZWN0LmtleXMob3V0KS5sZW5ndGggPiAwID8gb3V0IDogbnVsbDtcbn1cblxuLyoqIFEzMCBcdTIwMTQgYHZvc28td2lkZ2V0OmV4cGFuZCB7ZGV0YWlsLmFjdGlvbn1gIFx1MjE5MiB0aGUgbmV4dCBleHBhbmRlZCBzdGF0ZSAoYG51bGxgID0gaWdub3JlKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRBY3Rpb24oYWN0aW9uOiB1bmtub3duLCBleHBhbmRlZDogYm9vbGVhbiwgY29sbGFwc2libGU6IGJvb2xlYW4pOiBib29sZWFuIHwgbnVsbCB7XG4gIGlmIChhY3Rpb24gPT09IFwiZXhwYW5kXCIpIHJldHVybiB0cnVlO1xuICBpZiAoYWN0aW9uID09PSBcImNvbGxhcHNlXCIpIHJldHVybiBjb2xsYXBzaWJsZSA/IGZhbHNlIDogbnVsbDtcbiAgaWYgKGFjdGlvbiA9PT0gXCJ0b2dnbGVcIikgcmV0dXJuIGV4cGFuZGVkID8gKGNvbGxhcHNpYmxlID8gZmFsc2UgOiBudWxsKSA6IHRydWU7XG4gIHJldHVybiBudWxsO1xufVxuXG4vKiogUTIyIFx1MjAxNCB0aGUgaW5ib3VuZCBldmVudHMgdGhlIGVsZW1lbnQgZm9yd2FyZHMgb25seSB1bmRlciBgYWxsb3ctZXZlbnRzPVwidHJ1ZVwiYC4gKi9cbmV4cG9ydCBjb25zdCBHQVRFRF9JTkJPVU5EX0VWRU5UUyA9IFtcbiAgXCJ2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2VcIixcbiAgXCJ2b3NvLXdpZGdldDp1c2VyLWFjdGl2aXR5XCIsXG4gIFwidm9zby13aWRnZXQ6Y29udGV4dHVhbC11cGRhdGVcIixcbl0gYXMgY29uc3Q7XG5cbi8qKiBUaGUgdW5nYXRlZCBVSSBldmVudCAoUTMwKSwgaGVhcmQgb24gdGhlIGVsZW1lbnQgQU5EIG9uIGBkb2N1bWVudGAuICovXG5leHBvcnQgY29uc3QgRVhQQU5EX0VWRU5UID0gXCJ2b3NvLXdpZGdldDpleHBhbmRcIjtcblxuLyoqIERpc3BhdGNoZWQgKGJ1YmJsaW5nLCBjb21wb3NlZCkgYmVmb3JlIGV2ZXJ5IHNlc3Npb24gc3RhcnQ7IGxpc3RlbmVycyBtdXRhdGUgYGRldGFpbC5jb25maWdgLiAqL1xuZXhwb3J0IGNvbnN0IENBTExfRVZFTlQgPSBcInZvc28td2lkZ2V0OmNhbGxcIjtcblxuZXhwb3J0IHR5cGUgSW5ib3VuZEFjdGlvbiA9XG4gIHwgeyBraW5kOiBcInVzZXItbWVzc2FnZVwiOyBtZXNzYWdlOiBzdHJpbmcgfVxuICB8IHsga2luZDogXCJ1c2VyLWFjdGl2aXR5XCIgfVxuICB8IHsga2luZDogXCJjb250ZXh0dWFsLXVwZGF0ZVwiOyBtZXNzYWdlOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBRMjIgXHUyMDE0IHdoYXQgb25lIGluYm91bmQgZXZlbnQgYXNrcyBmb3IsIG9yIGBudWxsYDogbm90aGluZyBpcyBmb3J3YXJkZWRcbiAqIHVubGVzcyB0aGUgZWxlbWVudCBjYXJyaWVzIGBhbGxvdy1ldmVudHM9XCJ0cnVlXCJgICh0aGUgdmVuZG9yJ3MgZGVmYXVsdCBrZWVwc1xuICogdGhpcmQtcGFydHkgc2NyaXB0cyBmcm9tIHN0ZWVyaW5nIGEgY29udmVyc2F0aW9uKTsgYSBtZXNzYWdlIGV2ZW50IG5lZWRzIGFcbiAqIG5vbi1ibGFuayBgZGV0YWlsLm1lc3NhZ2VgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaW5ib3VuZEFjdGlvbih0eXBlOiBzdHJpbmcsIGFsbG93RXZlbnRzOiBzdHJpbmcgfCBudWxsLCBkZXRhaWw6IHVua25vd24pOiBJbmJvdW5kQWN0aW9uIHwgbnVsbCB7XG4gIGlmIChhbGxvd0V2ZW50cyAhPT0gXCJ0cnVlXCIpIHJldHVybiBudWxsO1xuICBjb25zdCByYXcgPSAoZGV0YWlsIGFzIHsgbWVzc2FnZT86IHVua25vd24gfSB8IG51bGwgfCB1bmRlZmluZWQpPy5tZXNzYWdlO1xuICBjb25zdCBtZXNzYWdlID0gdHlwZW9mIHJhdyA9PT0gXCJzdHJpbmdcIiA/IHJhdy50cmltKCkgOiBcIlwiO1xuICBzd2l0Y2ggKHR5cGUpIHtcbiAgICBjYXNlIFwidm9zby13aWRnZXQ6dXNlci1tZXNzYWdlXCI6XG4gICAgICByZXR1cm4gbWVzc2FnZSA/IHsga2luZDogXCJ1c2VyLW1lc3NhZ2VcIiwgbWVzc2FnZSB9IDogbnVsbDtcbiAgICBjYXNlIFwidm9zby13aWRnZXQ6dXNlci1hY3Rpdml0eVwiOlxuICAgICAgcmV0dXJuIHsga2luZDogXCJ1c2VyLWFjdGl2aXR5XCIgfTtcbiAgICBjYXNlIFwidm9zby13aWRnZXQ6Y29udGV4dHVhbC11cGRhdGVcIjpcbiAgICAgIHJldHVybiBtZXNzYWdlID8geyBraW5kOiBcImNvbnRleHR1YWwtdXBkYXRlXCIsIG1lc3NhZ2UgfSA6IG51bGw7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCAiLy8gPHZvc28td2lkZ2V0PiBcdTIwMTQgdGhlIGVtYmVkZGFibGUgdm9pY2UvY2hhdCB3aWRnZXQgY3VzdG9tIGVsZW1lbnQuXG4vL1xuLy8gQXR0cmlidXRlczpcbi8vICAgYWdlbnQtaWQgICAgIChyZXF1aXJlZCkgcHVibGljIHdpZGdldCBpZCwgYHdndF88MzIgaGV4PmBcbi8vICAgc2VydmVyLXVybCAgIChvcHRpb25hbCkgQVBJIG9yaWdpbiBvdmVycmlkZTsgZGVmYXVsdCA9IHRoZSBvcmlnaW4gdGhlXG4vLyAgICAgICAgICAgICAgICBlbWJlZCBzY3JpcHQgd2FzIGxvYWRlZCBmcm9tICh3aWRnZXQuanMgb24gdm9zb3B1bHNlLWFwaSlcbi8vICAgY29uZmlnLWpzb24gIChvcHRpb25hbCkgZnVsbCBQdWJsaWNXaWRnZXRDb25maWcgSlNPTiBcdTIwMTQgdXNlZCBieSB0aGVcbi8vICAgICAgICAgICAgICAgIGRhc2hib2FyZCdzIHNldHRpbmdzIGxpdmUgcHJldmlldyB0byByZW5kZXIgVU5TQVZFRFxuLy8gICAgICAgICAgICAgICAgc2V0dGluZ3Mgd2l0aG91dCBhIGZldGNoXG4vLyAgIHByZXZpZXcgICAgICAob3B0aW9uYWwpIFwidHJ1ZVwiIFx1MjE5MiBwb3NpdGlvbiBhYnNvbHV0ZWx5IGluc2lkZSB0aGUgcGFyZW50XG4vLyAgICAgICAgICAgICAgICBjb250YWluZXIsIGZvcmNlZCBib3R0b20tcmlnaHQgKHRoZSBzZXR0aW5ncyBwYWdlJ3Mgbm90ZTpcbi8vICAgICAgICAgICAgICAgIHRoZSBwcmV2aWV3IGlzIGFsd2F5cyBib3R0b20tcmlnaHQpXG4vLyAgIGF1dGgtdG9rZW4gICAob3B0aW9uYWwpIGRhc2hib2FyZCBhY2Nlc3MgdG9rZW4sIHNldCBPTkxZIGJ5IHRoZVxuLy8gICAgICAgICAgICAgICAgc2V0dGluZ3MgcGFnZSdzIGxpdmUgcHJldmlldyBzbyBhIERJU0FCTEVEIHdpZGdldCBzdGlsbFxuLy8gICAgICAgICAgICAgICAgcHJldmlld3MgZm9yIGF1dGhlbnRpY2F0ZWQgdGVuYW50IG1lbWJlcnMuIEN1c3RvbWVyXG4vLyAgICAgICAgICAgICAgICBlbWJlZHMgbXVzdCBuZXZlciBzZXQgaXQuXG4vL1xuLy8gVGhlIHZlbmRvcidzIGF0dHJpYnV0ZXMgKEU0IFx1MDBBNzQuOCwgYWxsIGFkZGl0aXZlIFx1MjAxNCBzZWUgYXR0cmlidXRlcy50cyk6XG4vLyAgIHNob3ctYWdlbnQtc3RhdHVzIC8gc2hvdy1yZXNpemUtYnV0dG9uIC8gc2hvdy1sYW5ndWFnZS1zZWxlY3Rvci1vbi10cmlnZ2VyXG4vLyAgIC8gc2hvdy1hdmF0YXItd2hlbi1jb2xsYXBzZWQgKFwidHJ1ZVwiIHwgXCJmYWxzZVwiLCBROSksIHZhcmlhbnQsIHBsYWNlbWVudCxcbi8vICAgbGFuZ3VhZ2UsIHRlcm1zLWtleSwgdGV4dC1jb250ZW50cyAoSlNPTiwgUTI1KSwgb3ZlcnJpZGUtKiAocGVyIGtleSksXG4vLyAgIHVzZXItaWQsIGFsbG93LWV2ZW50cyAoXCJ0cnVlXCIgXHUyMTkyIHRoZSB2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2UgL1xuLy8gICB1c2VyLWFjdGl2aXR5IC8gY29udGV4dHVhbC11cGRhdGUgZXZlbnRzIGFyZSBmb3J3YXJkZWQsIFEyMiksXG4vLyAgIHNpZ25lZC11cmwgKGFjY2VwdGVkLCBub3QgdXNlZCB1bnRpbCB0aGUgV2ViU29ja2V0IHRyYW5zcG9ydCBcdTIwMTQgRTQtYikuXG4vLyBFdmVudHM6IGB2b3NvLXdpZGdldDpjYWxsIHtkZXRhaWwuY29uZmlnfWAgYmVmb3JlIGV2ZXJ5IHN0YXJ0IChsaXN0ZW5lcnNcbi8vIG1heSBtdXRhdGUgaXQpOyBgdm9zby13aWRnZXQ6ZXhwYW5kIHtkZXRhaWwuYWN0aW9ufWAgaXMgaGVhcmQgdW5nYXRlZCBvbiB0aGVcbi8vIGVsZW1lbnQgYW5kIG9uIGRvY3VtZW50IChRMzApLlxuLy9cbi8vIEFsbCBVSSBpcyBpbnNpZGUgYSBjbG9zZWQgc2hhZG93IHJvb3Q7IHN0eWxpbmcgZmxvd3MgdGhyb3VnaCAtLXZ3LSpcbi8vIGN1c3RvbSBwcm9wZXJ0aWVzIChzZWUgY29uZmlnLnRzIC8gc3R5bGVzLnRzKS5cblxuaW1wb3J0IHtcbiAgV2lkZ2V0QXBpLFxuICBXaWRnZXRBcGlFcnJvcixcbiAgdHlwZSBDaGF0RXZlbnQsXG4gIHR5cGUgQ29udmVyc2F0aW9uT3ZlcnJpZGVzLFxuICBEeW5hbWljVmFyaWFibGVzLFxuICB0eXBlIFB1YmxpY1dpZGdldENvbmZpZyxcbiAgdHlwZSBVcGxvYWRlZEF0dGFjaG1lbnQsXG59IGZyb20gXCIuL2FwaVwiO1xuaW1wb3J0IHsgYXR0YWNobWVudEFjY2VwdEF0dHJpYnV0ZSwgdmFsaWRhdGVBdHRhY2htZW50IH0gZnJvbSBcIi4vYXR0YWNobWVudHNcIjtcbmltcG9ydCB7XG4gIGJ1aWxkQ3NzVmFycyxcbiAgbWVyZ2VDb25maWcsXG4gIHR5cGUgV2lkZ2V0UnVudGltZUNvbmZpZyxcbn0gZnJvbSBcIi4vY29uZmlnXCI7XG5pbXBvcnQgeyBJQ09OUyB9IGZyb20gXCIuL2ljb25zXCI7XG5pbXBvcnQgeyBjcmVhdGVPcmIsIHR5cGUgT3JiSGFuZGxlLCB0eXBlIE9yYlN0YXRlIH0gZnJvbSBcIi4vb3JiXCI7XG5pbXBvcnQgeyBwYXJzZU1hcmtkb3duLCBzdHJpcEF1ZGlvVGFncyB9IGZyb20gXCIuL21hcmtkb3duXCI7XG5pbXBvcnQgeyByZW5kZXJNYXJrZG93biB9IGZyb20gXCIuL21kLWRvbVwiO1xuaW1wb3J0IHtcbiAgREVGQVVMVF9PVVRQVVRfRk9STUFULFxuICBvdXRwdXRGb3JtYXRGcm9tRnJhbWUsXG4gIHJlbmRlckFnZW50VGV4dCxcbiAgdHlwZSBPdXRwdXRGb3JtYXQsXG59IGZyb20gXCIuL291dHB1dC1mb3JtYXRcIjtcbmltcG9ydCB7IFdJREdFVF9DU1MgfSBmcm9tIFwiLi9zdHlsZXNcIjtcbmltcG9ydCB7IHJlc29sdmVUZXh0LCB0eXBlIFdpZGdldFRleHRLZXkgfSBmcm9tIFwiLi90ZXh0LWRlZmF1bHRzXCI7XG5pbXBvcnQge1xuICBjbGllbnRUb29sQ2FsbEZyb21SdHZpLFxuICBpc1JlbmRlcmFibGVUcmFuc2NyaXB0LFxuICBtY3BUb29sQ2FsbERhdGFGcm9tUnR2aSxcbiAgdHJhbnNjcmlwdFJvbGUsXG4gIFZvaWNlQ2xpZW50LFxuICBxdWV1ZVRyYW5zaXRpb24sXG4gIHR5cGUgUnR2aU1lc3NhZ2UsXG59IGZyb20gXCIuL3ZvaWNlXCI7XG5pbXBvcnQge1xuICBtY3BUb29sQ2FsbEZyb21SZWNvcmQsXG4gIHJ1bkNsaWVudFRvb2wsXG4gIHR5cGUgQ2xpZW50VG9vbENhbGwsXG4gIHR5cGUgQ2xpZW50VG9vbEhhbmRsZXIsXG4gIHR5cGUgTWNwVG9vbENhbGwsXG59IGZyb20gXCIuL2NsaWVudC10b29sc1wiO1xuaW1wb3J0IHtcbiAgYXR0cmlidXRlT3ZlcnJpZGVzLFxuICBDQUxMX0VWRU5ULFxuICBFWFBBTkRfRVZFTlQsXG4gIGV4cGFuZEFjdGlvbixcbiAgR0FURURfSU5CT1VORF9FVkVOVFMsXG4gIGluYm91bmRBY3Rpb24sXG4gIG92ZXJsYXlBdHRyaWJ1dGVzLFxufSBmcm9tIFwiLi9hdHRyaWJ1dGVzXCI7XG5cbi8qKlxuICogVk9TTy04MjUgb3duZXIgcnVsaW5nOiB0aGUgT05FIHNlcnZlciB0ZXh0IHRoZSB3aWRnZXQgc2hvd3MgdGhlIHZpc2l0b3IgXHUyMDE0XG4gKiB0aGUgYmlsbGluZy1ob2xkIHNlbnRlbmNlIG9mIGEgNDAyIHZvaWNlLW1pbnQgcmVmdXNhbCwgYWxyZWFkeSByZW5kZXJlZFxuICogc2VydmVyLXNpZGUgaW4gdGhlIHNlc3Npb24gbGFuZ3VhZ2UuIEV2ZXJ5IG90aGVyIGVycm9yIGJvZHkgc3RheXMgb24gdGhlXG4gKiBjb25zb2xlIChWT1NPLTc1NCBEMjEpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmlsbGluZ0hvbGRTZW50ZW5jZShlcnI6IHVua25vd24pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKCEoZXJyIGluc3RhbmNlb2YgV2lkZ2V0QXBpRXJyb3IpIHx8IGVyci5zdGF0dXMgIT09IDQwMikgcmV0dXJuIG51bGw7XG4gIHJldHVybiBlcnIubWVzc2FnZS50cmltKCkgfHwgbnVsbDtcbn1cblxudHlwZSBNb2RlID0gXCJpZGxlXCIgfCBcInZvaWNlXCIgfCBcImNoYXRcIjtcbnR5cGUgVm9pY2VTdGF0dXMgPSBcImNvbm5lY3RpbmdcIiB8IFwicXVldWVkXCIgfCBcImxpc3RlbmluZ1wiIHwgXCJzcGVha2luZ1wiO1xuXG5pbnRlcmZhY2UgRW5kZWRJbmZvIHtcbiAgYnk6IFwidXNlclwiIHwgXCJhZ2VudFwiO1xuICBjb252ZXJzYXRpb25JZDogc3RyaW5nIHwgbnVsbDtcbn1cblxuLyoqIGB2b3NvLXdpZGdldDpjYWxsYCBgZGV0YWlsLmNvbmZpZ2AgXHUyMDE0IHdoYXQgdGhlIG5leHQgc2Vzc2lvbiBzdGFydHMgd2l0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV2lkZ2V0Q2FsbENvbmZpZyB7XG4gIGFnZW50SWQ6IHN0cmluZztcbiAgbGFuZ3VhZ2U6IHN0cmluZyB8IG51bGw7XG4gIG92ZXJyaWRlczogQ29udmVyc2F0aW9uT3ZlcnJpZGVzIHwgbnVsbDtcbiAgZHluYW1pY1ZhcmlhYmxlczogRHluYW1pY1ZhcmlhYmxlcyB8IG51bGw7XG4gIGNsaWVudFRvb2xzOiBSZWNvcmQ8c3RyaW5nLCBDbGllbnRUb29sSGFuZGxlcj47XG4gIHVzZXJJZDogc3RyaW5nIHwgbnVsbDtcbiAgdGV4dE9ubHk6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBWb3NvV2lkZ2V0RWxlbWVudCBleHRlbmRzIEhUTUxFbGVtZW50IHtcbiAgc3RhdGljIG9ic2VydmVkQXR0cmlidXRlcyA9IFtcbiAgICBcImFnZW50LWlkXCIsXG4gICAgXCJjb25maWctanNvblwiLFxuICAgIC8vIEU0IFx1MDBBNzQuOCBkaXNwbGF5IGF0dHJpYnV0ZXMgKHJlLXJlbmRlciBvbiBjaGFuZ2UpLlxuICAgIFwic2hvdy1hZ2VudC1zdGF0dXNcIixcbiAgICBcInNob3ctcmVzaXplLWJ1dHRvblwiLFxuICAgIFwic2hvdy1sYW5ndWFnZS1zZWxlY3Rvci1vbi10cmlnZ2VyXCIsXG4gICAgXCJzaG93LWF2YXRhci13aGVuLWNvbGxhcHNlZFwiLFxuICAgIFwidmFyaWFudFwiLFxuICAgIFwicGxhY2VtZW50XCIsXG4gICAgXCJsYW5ndWFnZVwiLFxuICAgIFwidGVybXMta2V5XCIsXG4gICAgXCJ0ZXh0LWNvbnRlbnRzXCIsXG4gIF07XG5cbiAgcHJpdmF0ZSBzaGFkb3c6IFNoYWRvd1Jvb3Q7XG4gIHByaXZhdGUgYXBpOiBXaWRnZXRBcGkgfCBudWxsID0gbnVsbDtcbiAgLyoqXG4gICAqIFBlci1jYWxsIGNvbnZlcnNhdGlvbiBvdmVycmlkZXMgc2VudCBvbiBldmVyeSBzZXNzaW9uL2NoYXQgc3RhcnQuIFNldFxuICAgKiB2aWEgdGhlIGBvdmVycmlkZXNgIGF0dHJpYnV0ZSAoYSBKU09OIG9iamVjdCBzdHJpbmcpIG9yIHRoZSBgb3ZlcnJpZGVzYFxuICAgKiBKUyBwcm9wZXJ0eSAoYGVsLm92ZXJyaWRlcyA9IHsgZmlyc3RfbWVzc2FnZTogXCJcdTIwMjZcIiB9YCk7IHRoZSBwcm9wZXJ0eVxuICAgKiB3aW5zLiBHYXRlZCBzZXJ2ZXItc2lkZSBieSB0aGUgYWdlbnQncyBHdWFyZHJhaWxzIG92ZXJyaWRlIHRvZ2dsZXMuXG4gICAqL1xuICBvdmVycmlkZXM6IENvbnZlcnNhdGlvbk92ZXJyaWRlcyB8IG51bGwgPSBudWxsO1xuICAvKipcbiAgICogUGVyLXNlc3Npb24gYHt7bmFtZX19YCB2YWx1ZXMgc2VudCBvbiBldmVyeSBzZXNzaW9uL2NoYXQgc3RhcnQgKHRoZVxuICAgKiB2ZW5kb3IgSlMgU0RLJ3MgYGR5bmFtaWNWYXJpYWJsZXNgLCBFMyBcdTAwQTc0LjMpLiBTZXQgdmlhIHRoZVxuICAgKiBgZHluYW1pYy12YXJpYWJsZXNgIGF0dHJpYnV0ZSAoYSBKU09OIG9iamVjdCBzdHJpbmcpIG9yIHRoZVxuICAgKiBgZHluYW1pY1ZhcmlhYmxlc2AgSlMgcHJvcGVydHkgKGBlbC5keW5hbWljVmFyaWFibGVzID0geyBjdXN0b21lcl9uYW1lOlxuICAgKiBcIkRhbmFcIiB9YCk7IHRoZSBwcm9wZXJ0eSB3aW5zLiBHYXRlZCBzZXJ2ZXItc2lkZSBieSB0aGUgYWdlbnQnc1xuICAgKiBTZWN1cml0eSBcdTIxOTIgT3ZlcnJpZGVzIFwiRHluYW1pYyB2YXJpYWJsZXNcIiB0b2dnbGUuXG4gICAqL1xuICBkeW5hbWljVmFyaWFibGVzOiBEeW5hbWljVmFyaWFibGVzIHwgbnVsbCA9IG51bGw7XG4gIC8qKlxuICAgKiBUaGUgcGFnZSdzIGltcGxlbWVudGF0aW9ucyBvZiB0aGUgYWdlbnQncyAqKmNsaWVudCoqIHRvb2xzLCBrZXllZCBieVxuICAgKiB0b29sIG5hbWUgKEUzIFx1MDBBNzQuMS44KTogYGVsLmNsaWVudFRvb2xzID0geyBsb29rdXBfcG9saWN5OiBhc3luYyAocCkgPT5cbiAgICogY3JtLmxvb2t1cChwLnBvbGljeV9udW1iZXIpIH1gLiBTZXJ2ZWQgb24gdm9pY2UgKFJUVkkpIGFuZCBjaGF0IChTU0UgK1xuICAgKiBIVFRQKSBhbGlrZS4gQW4gdW5yZWdpc3RlcmVkIHRvb2wgaXMgYW5zd2VyZWQgYXQgb25jZSB3aXRoIGFuIGVycm9yXG4gICAqIHVubGVzcyBgb25VbmhhbmRsZWRDbGllbnRUb29sQ2FsbGAgaXMgc2V0LlxuICAgKi9cbiAgY2xpZW50VG9vbHM6IFJlY29yZDxzdHJpbmcsIENsaWVudFRvb2xIYW5kbGVyPiA9IHt9O1xuICAvKiogVGFrZSBvdmVyIGNhbGxzIGZvciB0b29scyBub3QgaW4gYGNsaWVudFRvb2xzYCAobm90aGluZyBpcyBzZW50OyB0aGVcbiAgICogIGFnZW50J3MgUmVzcG9uc2UgdGltZW91dCBhcHBsaWVzKS4gKi9cbiAgb25VbmhhbmRsZWRDbGllbnRUb29sQ2FsbDogKChjYWxsOiBDbGllbnRUb29sQ2FsbCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgLyoqXG4gICAqIEV2ZXJ5IHN0YXRlIG9mIGFuIE1DUCB0b29sIGNhbGwgdGhlIGFnZW50IG1ha2VzIHRocm91Z2ggYW4gKipBc2sqKlxuICAgKiBzZXJ2ZXIgb3IgdG9vbCAoRTMgXHUwMEE3NC42KTogYGF3YWl0aW5nX2FwcHJvdmFsYCBmaXJzdCBcdTIwMTQgYW5zd2VyIGl0IHdpdGhcbiAgICogYGVsLmFwcHJvdmVNY3BUb29sKGNhbGwudG9vbENhbGxJZCwgdHJ1ZSB8IGZhbHNlKWAgd2l0aGluXG4gICAqIGBjYWxsLmFwcHJvdmFsVGltZW91dFNlY3NgICgzMCBzKSBcdTIwMTQgdGhlbiBgbG9hZGluZ2AgYW5kIGBzdWNjZXNzYCAvXG4gICAqIGBmYWlsdXJlYC4gV2l0aG91dCBhIGhhbmRsZXIgdGhlIHBhZ2UgKipkZW5pZXMqKiBldmVyeSBhc2sgYXQgb25jZVxuICAgKiAoZmFpbCBjbG9zZWQ6IGEgc3RyYW5nZXIncyBlbWJlZCBuZXZlciBydW5zIGFuIGFwcHJvdmFsLWdhdGVkIHRvb2wpLlxuICAgKi9cbiAgb25NY3BUb29sQ2FsbDogKChjYWxsOiBNY3BUb29sQ2FsbCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgLyoqIERpYWdub3N0aWNzIHRoZSBlbGVtZW50IHJlcG9ydHMgaW5zdGVhZCBvZiBmYWlsaW5nIChhbiB1bm1hcHBlZFxuICAgKiAgYHRleHQtY29udGVudHNgIGtleSwgYW4gZXZlbnQgd2l0aCBubyBsaXZlIHNlc3Npb24sIFx1MjAyNikuIERlZmF1bHQ6IHRoZVxuICAgKiAgY29uc29sZSdzIGRlYnVnIGxldmVsLiAqL1xuICBvbkRlYnVnOiAoKGV2ZW50OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgLyoqIFRoZSB2ZW5kb3IncyBgdXNlcklkYCAoYWxzbyB0aGUgYHVzZXItaWRgIGF0dHJpYnV0ZTsgdGhlIHByb3BlcnR5IHdpbnMpLlxuICAgKiAgQ2FycmllZCBvbiBgdm9zby13aWRnZXQ6Y2FsbGAgYGRldGFpbC5jb25maWdgOyB0aGUgd2lkZ2V0IG1pbnQgZG9lcyBub3RcbiAgICogIHRha2UgYSB1c2VyIGlkIHlldCwgc28gaXQgaXMgbm90IHNlbnQuICovXG4gIHVzZXJJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2ZnOiBXaWRnZXRSdW50aW1lQ29uZmlnID0gbWVyZ2VDb25maWcodW5kZWZpbmVkKTtcbiAgcHJpdmF0ZSBhZ2VudE5hbWUgPSBcIlwiO1xuICBwcml2YXRlIGxhbmd1YWdlczogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBhdmF0YXJVcmw6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxvYWRlZCA9IGZhbHNlO1xuXG4gIC8vIFVJIHN0YXRlXG4gIHByaXZhdGUgZXhwYW5kZWQgPSBmYWxzZTtcbiAgLyoqIEZpcnN0LXJlbmRlciBsYXRjaCBcdTIwMTQgVUkgc3RhdGUgZm9sbG93cyBjb25maWcgb25seSBiZWZvcmUgdGhpcyBpcyBzZXQuICovXG4gIHByaXZhdGUgZXZlclJlbmRlcmVkID0gZmFsc2U7XG4gIHByaXZhdGUgbGFyZ2UgPSBmYWxzZTtcbiAgcHJpdmF0ZSBtb2RlOiBNb2RlID0gXCJpZGxlXCI7XG4gIHByaXZhdGUgdm9pY2VTdGF0dXM6IFZvaWNlU3RhdHVzID0gXCJjb25uZWN0aW5nXCI7XG4gIC8qKiBUaGUgcXVldWUtdGltZW91dCBsaW5lIGlzIHNob3duIG9uY2UgcGVyIGNhbGwgKHRoZSBgcXVldWVfc3RhdHVzYCBhbmRcbiAgICogIHRoZSBgc2Vzc2lvbi1lbmRlZGAgYW5ub3VuY2VtZW50cyBib3RoIG5hbWUgaXQpLiAqL1xuICBwcml2YXRlIHF1ZXVlVGltZWRPdXRTaG93biA9IGZhbHNlO1xuICBwcml2YXRlIG11dGVkID0gZmFsc2U7XG4gIHByaXZhdGUgdHJhbnNjcmlwdFZpc2libGUgPSB0cnVlO1xuICBwcml2YXRlIHNlbGVjdGVkTGFuZ3VhZ2U6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGVuZGVkOiBFbmRlZEluZm8gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0ZXJtc0FjY2VwdGVkVGhpc1Nlc3Npb24gPSBmYWxzZTtcbiAgcHJpdmF0ZSBwZW5kaW5nQWZ0ZXJUZXJtczogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgLy8gU2Vzc2lvbnNcbiAgcHJpdmF0ZSB2b2ljZTogVm9pY2VDbGllbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB2b2ljZUNvbnZlcnNhdGlvbklkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjaGF0U2Vzc2lvbklkOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjaGF0Q29udmVyc2F0aW9uSWQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICAvKiogQWdlbnQtYnViYmxlIHJlbmRlcmluZyBmb3IgdGhlIENVUlJFTlQgY2hhdCBzZXNzaW9uIFx1MjAxNCB0aGUgbGVhZGluZ1xuICAgKiAgYHNlc3Npb25gIGZyYW1lJ3MgYG91dHB1dF9mb3JtYXRgIChhZ2VudCBiZWhhdmlvciBwYW5lbCwgV2lkZ2V0IHJvdykuXG4gICAqICBNYXJrZG93biB1bnRpbCB0aGUgZnJhbWUgYXJyaXZlcyAodG9kYXkncyBiZWhhdmlvdXIpLiBWb2ljZSB0cmFuc2NyaXB0c1xuICAgKiAgbmV2ZXIgcmVhZCBpdDogdGhleSBwYXNzIGBcIm1hcmtkb3duXCJgIGV4cGxpY2l0bHkuICovXG4gIHByaXZhdGUgY2hhdE91dHB1dEZvcm1hdDogT3V0cHV0Rm9ybWF0ID0gREVGQVVMVF9PVVRQVVRfRk9STUFUO1xuICBwcml2YXRlIGNoYXRCdXN5ID0gZmFsc2U7XG4gIHByaXZhdGUgc3RyZWFtRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RyZWFtVGV4dCA9IFwiXCI7XG4gIC8qKiBVcGxvYWRzIHN0YWdlZCBmb3IgdGhlIE5FWFQgY2hhdCBtZXNzYWdlIChjaGlwcyBpbiB0aGUgY29tcG9zZXIpLiAqL1xuICBwcml2YXRlIHBlbmRpbmdBdHRhY2htZW50czogVXBsb2FkZWRBdHRhY2htZW50W10gPSBbXTtcbiAgLyoqIEV2ZXJ5IHVwbG9hZCBtYWRlIHRoaXMgY29udmVyc2F0aW9uIFx1MjAxNCBtaXJyb3JzIHRoZSBiYWNrZW5kIGNhcC4gKi9cbiAgcHJpdmF0ZSB1cGxvYWRzVGhpc0NvbnZlcnNhdGlvbiA9IDA7XG5cbiAgLy8gRE9NIHJlZnNcbiAgcHJpdmF0ZSByb290RWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBsYXVuY2hlckVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgc2hlZXRFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGJvZHlFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGludHJvRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBoZWFkZXJTdGF0dXNFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGhlYWRlck5hbWVFbCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGhlYWRlckF2YXRhckVsITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgZm9vdGVyRWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBvdmVybGF5SG9zdCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGF1ZGlvRWwhOiBIVE1MQXVkaW9FbGVtZW50O1xuICBwcml2YXRlIHR5cGluZ0VsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG9yYnM6IE9yYkhhbmRsZVtdID0gW107XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnNoYWRvdyA9IHRoaXMuYXR0YWNoU2hhZG93KHsgbW9kZTogXCJvcGVuXCIgfSk7XG4gICAgLy8gUTIyOiB0aGUgZ2F0ZWQgaW5ib3VuZCBldmVudHMsIGhlYXJkIG9uIHRoZSBlbGVtZW50IGl0c2VsZi5cbiAgICBmb3IgKGNvbnN0IHR5cGUgb2YgR0FURURfSU5CT1VORF9FVkVOVFMpIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcih0eXBlLCB0aGlzLm9uSW5ib3VuZEV2ZW50KTtcbiAgICAvLyBRMzA6IHRoZSB1bmdhdGVkIGV4cGFuZCBldmVudCwgb24gdGhlIGVsZW1lbnQgKGFuZCBvbiBkb2N1bWVudCBiZWxvdykuXG4gICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKEVYUEFORF9FVkVOVCwgdGhpcy5vbkV4cGFuZEV2ZW50KTtcbiAgfVxuXG4gIGNvbm5lY3RlZENhbGxiYWNrKCk6IHZvaWQge1xuICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoRVhQQU5EX0VWRU5ULCB0aGlzLm9uRXhwYW5kRXZlbnQpO1xuICAgIGlmICghdGhpcy5sb2FkZWQpIHtcbiAgICAgIHRoaXMubG9hZGVkID0gdHJ1ZTtcbiAgICAgIHZvaWQgdGhpcy5ib290c3RyYXAoKTtcbiAgICB9XG4gIH1cblxuICBkaXNjb25uZWN0ZWRDYWxsYmFjaygpOiB2b2lkIHtcbiAgICBkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKEVYUEFORF9FVkVOVCwgdGhpcy5vbkV4cGFuZEV2ZW50KTtcbiAgICB0aGlzLmRlc3Ryb3lPcmJzKCk7XG4gICAgdm9pZCB0aGlzLnRlYXJkb3duU2Vzc2lvbnMoXCJ1c2VyXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBkZWJ1ZyhldmVudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkIHtcbiAgICBpZiAodGhpcy5vbkRlYnVnKSB0aGlzLm9uRGVidWcoZXZlbnQpO1xuICAgIGVsc2UgY29uc29sZS5kZWJ1ZyhcIlt2b3NvLXdpZGdldF1cIiwgZXZlbnQpO1xuICB9XG5cbiAgLyoqIFEyMjogYGFsbG93LWV2ZW50cz1cInRydWVcImAgZm9yd2FyZHMgYSBwYWdlJ3MgbWVzc2FnZSAvIGFjdGl2aXR5IC8gY29udGV4dCBpbnRvIHRoZSBsaXZlIHNlc3Npb24uICovXG4gIHByaXZhdGUgcmVhZG9ubHkgb25JbmJvdW5kRXZlbnQgPSAoZXZlbnQ6IEV2ZW50KTogdm9pZCA9PiB7XG4gICAgY29uc3QgYWN0aW9uID0gaW5ib3VuZEFjdGlvbihldmVudC50eXBlLCB0aGlzLmdldEF0dHJpYnV0ZShcImFsbG93LWV2ZW50c1wiKSwgKGV2ZW50IGFzIEN1c3RvbUV2ZW50KS5kZXRhaWwpO1xuICAgIGlmICghYWN0aW9uKSByZXR1cm47XG4gICAgaWYgKGFjdGlvbi5raW5kID09PSBcImNvbnRleHR1YWwtdXBkYXRlXCIpIHtcbiAgICAgIHZvaWQgdGhpcy5zZW5kQ29udGV4dHVhbFVwZGF0ZShhY3Rpb24ubWVzc2FnZSkudGhlbigoc2VudCkgPT4ge1xuICAgICAgICBpZiAoIXNlbnQpIHRoaXMuZGVidWcoeyB0eXBlOiBcIm5vX2xpdmVfc2Vzc2lvblwiLCBldmVudDogZXZlbnQudHlwZSB9KTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoYWN0aW9uLmtpbmQgPT09IFwidXNlci1hY3Rpdml0eVwiKSB7XG4gICAgICBpZiAodGhpcy52b2ljZSkgdGhpcy52b2ljZS5zZW5kVXNlckFjdGl2aXR5KCk7XG4gICAgICAvLyBUZXh0IHNlc3Npb25zIGhhdmUgbm8gZGVhZC1haXIgY2xvY2sgdG8gcmVzZXQgKHZvaWNlL2NoYXQgdGltaW5nIHJ1bGUgRS0xKS5cbiAgICAgIGVsc2UgdGhpcy5kZWJ1Zyh7IHR5cGU6IHRoaXMuY2hhdFNlc3Npb25JZCA/IFwidXNlcl9hY3Rpdml0eV90ZXh0X3Nlc3Npb25cIiA6IFwibm9fbGl2ZV9zZXNzaW9uXCIsIGV2ZW50OiBldmVudC50eXBlIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy52b2ljZSkge1xuICAgICAgaWYgKHRoaXMudm9pY2Uuc2VuZFVzZXJUZXh0KGFjdGlvbi5tZXNzYWdlKSkgdGhpcy5hcHBlbmRNZXNzYWdlKFwidXNlclwiLCBhY3Rpb24ubWVzc2FnZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmNoYXRTZXNzaW9uSWQgJiYgIXRoaXMuY2hhdEJ1c3kpIHtcbiAgICAgIHZvaWQgdGhpcy5zZW5kQ2hhdChhY3Rpb24ubWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZGVidWcoeyB0eXBlOiB0aGlzLmNoYXRCdXN5ID8gXCJzZXNzaW9uX2J1c3lcIiA6IFwibm9fbGl2ZV9zZXNzaW9uXCIsIGV2ZW50OiBldmVudC50eXBlIH0pO1xuICAgIH1cbiAgfTtcblxuICAvKiogUTMwOiBleHBhbmQgLyBjb2xsYXBzZSAvIHRvZ2dsZSwgb25jZSBwZXIgZXZlbnQgKGBfdm9zb0V2ZW50SGFuZGxlZGApLiAqL1xuICBwcml2YXRlIHJlYWRvbmx5IG9uRXhwYW5kRXZlbnQgPSAoZXZlbnQ6IEV2ZW50KTogdm9pZCA9PiB7XG4gICAgY29uc3QgZGV0YWlsID0gKGV2ZW50IGFzIEN1c3RvbUV2ZW50KS5kZXRhaWwgYXMgeyBhY3Rpb24/OiB1bmtub3duOyBfdm9zb0V2ZW50SGFuZGxlZD86IGJvb2xlYW4gfSB8IG51bGw7XG4gICAgaWYgKCFkZXRhaWwgfHwgdHlwZW9mIGRldGFpbCAhPT0gXCJvYmplY3RcIiB8fCBkZXRhaWwuX3Zvc29FdmVudEhhbmRsZWQpIHJldHVybjtcbiAgICBkZXRhaWwuX3Zvc29FdmVudEhhbmRsZWQgPSB0cnVlO1xuICAgIGlmICghdGhpcy5ldmVyUmVuZGVyZWQpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gZXhwYW5kQWN0aW9uKGRldGFpbC5hY3Rpb24sIHRoaXMuZXhwYW5kZWQsIHRoaXMuY29sbGFwc2libGUpO1xuICAgIGlmIChuZXh0ID09PSBudWxsIHx8IG5leHQgPT09IHRoaXMuZXhwYW5kZWQpIHJldHVybjtcbiAgICB0aGlzLmV4cGFuZGVkID0gbmV4dDtcbiAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICB9O1xuXG4gIC8qKlxuICAgKiBUaGUgdmVuZG9yJ3MgY2FsbCBob29rOiBkaXNwYXRjaCBgdm9zby13aWRnZXQ6Y2FsbGAgKGJ1YmJsaW5nLCBjb21wb3NlZClcbiAgICogd2l0aCB0aGUgY29uZmlnIHRoZSBzZXNzaW9uIGlzIGFib3V0IHRvIHN0YXJ0IHdpdGg7IGxpc3RlbmVycyBtYXkgbXV0YXRlXG4gICAqIGBkZXRhaWwuY29uZmlnYCBpbiBwbGFjZSAoZS5nLiBgY2xpZW50VG9vbHNgKSwgYW5kIHRoZSBzdGFydCB1c2VzIGl0LlxuICAgKi9cbiAgcHJpdmF0ZSBkaXNwYXRjaENhbGwodGV4dE9ubHk6IGJvb2xlYW4pOiBXaWRnZXRDYWxsQ29uZmlnIHtcbiAgICBjb25zdCBjb25maWc6IFdpZGdldENhbGxDb25maWcgPSB7XG4gICAgICBhZ2VudElkOiB0aGlzLmdldEF0dHJpYnV0ZShcImFnZW50LWlkXCIpID8/IFwiXCIsXG4gICAgICBsYW5ndWFnZTogdGhpcy5zZWxlY3RlZExhbmd1YWdlLFxuICAgICAgb3ZlcnJpZGVzOiB0aGlzLnJlc29sdmVPdmVycmlkZXMoKSxcbiAgICAgIGR5bmFtaWNWYXJpYWJsZXM6IHRoaXMucmVzb2x2ZUR5bmFtaWNWYXJpYWJsZXMoKSxcbiAgICAgIGNsaWVudFRvb2xzOiB0aGlzLmNsaWVudFRvb2xzLFxuICAgICAgdXNlcklkOiB0aGlzLnVzZXJJZCA/PyB0aGlzLmdldEF0dHJpYnV0ZShcInVzZXItaWRcIiksXG4gICAgICB0ZXh0T25seSxcbiAgICB9O1xuICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgQ3VzdG9tRXZlbnQoQ0FMTF9FVkVOVCwgeyBidWJibGVzOiB0cnVlLCBjb21wb3NlZDogdHJ1ZSwgZGV0YWlsOiB7IGNvbmZpZyB9IH0pKTtcbiAgICBpZiAoY29uZmlnLmNsaWVudFRvb2xzICYmIHR5cGVvZiBjb25maWcuY2xpZW50VG9vbHMgPT09IFwib2JqZWN0XCIpIHRoaXMuY2xpZW50VG9vbHMgPSBjb25maWcuY2xpZW50VG9vbHM7XG4gICAgcmV0dXJuIGNvbmZpZztcbiAgfVxuXG4gIGF0dHJpYnV0ZUNoYW5nZWRDYWxsYmFjaygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubG9hZGVkKSByZXR1cm47XG4gICAgdm9pZCB0aGlzLmJvb3RzdHJhcCgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIGJvb3RzdHJhcCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICAvKiogVGhlIGR5bmFtaWMgdmFyaWFibGVzIHRvIHNlbmQ6IHRoZSBKUyBwcm9wZXJ0eSwgZWxzZSB0aGUgcGFyc2VkIGF0dHJpYnV0ZS4gKi9cbiAgcHJpdmF0ZSByZXNvbHZlRHluYW1pY1ZhcmlhYmxlcygpOiBEeW5hbWljVmFyaWFibGVzIHwgbnVsbCB7XG4gICAgaWYgKHRoaXMuZHluYW1pY1ZhcmlhYmxlcykgcmV0dXJuIHRoaXMuZHluYW1pY1ZhcmlhYmxlcztcbiAgICBjb25zdCBhdHRyID0gdGhpcy5nZXRBdHRyaWJ1dGUoXCJkeW5hbWljLXZhcmlhYmxlc1wiKTtcbiAgICBpZiAoIWF0dHIpIHJldHVybiBudWxsO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQ6IHVua25vd24gPSBKU09OLnBhcnNlKGF0dHIpO1xuICAgICAgcmV0dXJuIHBhcnNlZCAmJiB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHBhcnNlZClcbiAgICAgICAgPyAocGFyc2VkIGFzIER5bmFtaWNWYXJpYWJsZXMpXG4gICAgICAgIDogbnVsbDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBUaGUgb3ZlcnJpZGVzIHRvIHNlbmQ6IHRoZSBKUyBwcm9wZXJ0eSwgZWxzZSB0aGUgcGFyc2VkIGF0dHJpYnV0ZSBcdTIwMTRcbiAgICogIGxhaWQgb3ZlciB0aGUgcGVyLWtleSBgb3ZlcnJpZGUtKmAgYXR0cmlidXRlcyAoRTQgXHUwMEE3NC44OyB0aGUgZXhwbGljaXRcbiAgICogIG9iamVjdCB3aW5zIG9uIGEgY29uZmxpY3QpLiAqL1xuICBwcml2YXRlIHJlc29sdmVPdmVycmlkZXMoKTogQ29udmVyc2F0aW9uT3ZlcnJpZGVzIHwgbnVsbCB7XG4gICAgY29uc3QgcGVyS2V5ID0gYXR0cmlidXRlT3ZlcnJpZGVzKChuYW1lKSA9PiB0aGlzLmdldEF0dHJpYnV0ZShuYW1lKSkgYXMgQ29udmVyc2F0aW9uT3ZlcnJpZGVzIHwgbnVsbDtcbiAgICBjb25zdCBleHBsaWNpdCA9IHRoaXMuZXhwbGljaXRPdmVycmlkZXMoKTtcbiAgICBpZiAoIXBlcktleSkgcmV0dXJuIGV4cGxpY2l0O1xuICAgIHJldHVybiB7IC4uLnBlcktleSwgLi4uKGV4cGxpY2l0ID8/IHt9KSB9O1xuICB9XG5cbiAgcHJpdmF0ZSBleHBsaWNpdE92ZXJyaWRlcygpOiBDb252ZXJzYXRpb25PdmVycmlkZXMgfCBudWxsIHtcbiAgICBpZiAodGhpcy5vdmVycmlkZXMpIHJldHVybiB0aGlzLm92ZXJyaWRlcztcbiAgICBjb25zdCBhdHRyID0gdGhpcy5nZXRBdHRyaWJ1dGUoXCJvdmVycmlkZXNcIik7XG4gICAgaWYgKCFhdHRyKSByZXR1cm4gbnVsbDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkOiB1bmtub3duID0gSlNPTi5wYXJzZShhdHRyKTtcbiAgICAgIHJldHVybiBwYXJzZWQgJiYgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJiAhQXJyYXkuaXNBcnJheShwYXJzZWQpXG4gICAgICAgID8gKHBhcnNlZCBhcyBDb252ZXJzYXRpb25PdmVycmlkZXMpXG4gICAgICAgIDogbnVsbDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZU9yaWdpbigpOiBzdHJpbmcge1xuICAgIGNvbnN0IGF0dHIgPSB0aGlzLmdldEF0dHJpYnV0ZShcInNlcnZlci11cmxcIik7XG4gICAgaWYgKGF0dHIpIHJldHVybiBhdHRyLnJlcGxhY2UoL1xcLyQvLCBcIlwiKTtcbiAgICAvLyBUaGUgbnBtIC8gQ0ROIGJ1bmRsZSAoRTQgUTgpOiB0aGUgc2NyaXB0J3Mgb3JpZ2luIGlzIHRoZSBDRE4sIG5vdCBvdXIgQVBJLlxuICAgIGlmIChCVUlMRF9ERUZBVUxUX09SSUdJTikgcmV0dXJuIEJVSUxEX0RFRkFVTFRfT1JJR0lOO1xuICAgIGlmIChTQ1JJUFRfT1JJR0lOKSByZXR1cm4gU0NSSVBUX09SSUdJTjtcbiAgICByZXR1cm4gd2luZG93LmxvY2F0aW9uLm9yaWdpbjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYm9vdHN0cmFwKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHB1YmxpY0lkID0gdGhpcy5nZXRBdHRyaWJ1dGUoXCJhZ2VudC1pZFwiKSA/PyBcIlwiO1xuICAgIC8vIGBhdXRoLXRva2VuYCBpcyB0aGUgc2V0dGluZ3MgcHJldmlldydzIGNyZWRlbnRpYWwgZm9yIHByZXZpZXdpbmcgYVxuICAgIC8vIERJU0FCTEVEIHdpZGdldCBcdTIwMTQgY3VzdG9tZXIgZW1iZWRzIG5ldmVyIHNldCBpdC5cbiAgICBjb25zdCBhdXRoVG9rZW4gPSB0aGlzLmdldEF0dHJpYnV0ZShcImF1dGgtdG9rZW5cIik7XG4gICAgdGhpcy5hcGkgPSBwdWJsaWNJZFxuICAgICAgPyBuZXcgV2lkZ2V0QXBpKHRoaXMucmVzb2x2ZU9yaWdpbigpLCBwdWJsaWNJZCwgYXV0aFRva2VuKVxuICAgICAgOiBudWxsO1xuXG4gICAgY29uc3QgaW5saW5lID0gdGhpcy5nZXRBdHRyaWJ1dGUoXCJjb25maWctanNvblwiKTtcbiAgICBsZXQgc2VydmVyOiBQdWJsaWNXaWRnZXRDb25maWcgfCBudWxsID0gbnVsbDtcbiAgICBpZiAoaW5saW5lKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzZXJ2ZXIgPSBKU09OLnBhcnNlKGlubGluZSkgYXMgUHVibGljV2lkZ2V0Q29uZmlnO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHNlcnZlciA9IG51bGw7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghc2VydmVyICYmIHRoaXMuYXBpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzZXJ2ZXIgPSBhd2FpdCB0aGlzLmFwaS5mZXRjaENvbmZpZygpO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIERpc2FibGVkL3Vua25vd24gd2lkZ2V0OiByZW5kZXIgbm90aGluZyAoYW4gZW1iZWQgb24gYSBwYWdlXG4gICAgICAgIC8vIG11c3QgbmV2ZXIgYnJlYWsgdGhlIGhvc3Qgc2l0ZSkuXG4gICAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBXaWRnZXRBcGlFcnJvciAmJiBlcnIuc3RhdHVzID09PSA0MDQpIHJldHVybjtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXNlcnZlcikgcmV0dXJuO1xuXG4gICAgLy8gRTQgXHUwMEE3NC44OiB0aGUgZWxlbWVudCdzIGF0dHJpYnV0ZXMgb3ZlcmxheSB0aGUgZmV0Y2hlZCBjb25maWcuXG4gICAgY29uc3QgbmV4dENmZyA9IG92ZXJsYXlBdHRyaWJ1dGVzKFxuICAgICAgbWVyZ2VDb25maWcoc2VydmVyLmNvbmZpZyBhcyBQYXJ0aWFsPFdpZGdldFJ1bnRpbWVDb25maWc+KSxcbiAgICAgIChuYW1lKSA9PiB0aGlzLmdldEF0dHJpYnV0ZShuYW1lKSxcbiAgICAgIChldmVudCkgPT4gdGhpcy5kZWJ1ZyhldmVudCksXG4gICAgKTtcbiAgICAvLyBGQVNUIFBBVEg6IHdoZW4gb25seSBjb2xvcnMvcmFkaWkgY2hhbmdlZCAodGhlIHNldHRpbmdzIHBhZ2Unc1xuICAgIC8vIGNvbnRpbnVvdXMgaW5wdXRzIFx1MjAxNCBjb2xvciBwaWNrZXJzLCBweCBzdGVwcGVycyksIHVwZGF0ZSB0aGUgQ1NTXG4gICAgLy8gY3VzdG9tIHByb3BlcnRpZXMgaW4gcGxhY2UgaW5zdGVhZCBvZiB0ZWFyaW5nIGRvd24gYW5kIHJlLXJlbmRlcmluZ1xuICAgIC8vIHRoZSB3aG9sZSB3aWRnZXQuIFRoaXMgaXMgd2hhdCBtYWtlcyB0aGUgbGl2ZSBwcmV2aWV3IHRyYWNrIHRob3NlXG4gICAgLy8gY29udHJvbHMgaW5zdGFudGx5LCB3aXRoIG5vIGZsaWNrZXIgYW5kIG5vIHN0YXRlIGxvc3MuXG4gICAgaWYgKHRoaXMuZXZlclJlbmRlcmVkICYmIHRoaXMucm9vdEVsKSB7XG4gICAgICBjb25zdCBzdHJ1Y3R1cmFsID0gKGM6IFdpZGdldFJ1bnRpbWVDb25maWcpID0+XG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHsgLi4uYywgY29sb3JzOiBudWxsLCByYWRpaTogbnVsbCB9KTtcbiAgICAgIGNvbnN0IG9yYlVuY2hhbmdlZCA9XG4gICAgICAgIEpTT04uc3RyaW5naWZ5KG5leHRDZmcuYXZhdGFyKSA9PT0gSlNPTi5zdHJpbmdpZnkodGhpcy5jZmcuYXZhdGFyKTtcbiAgICAgIGlmIChcbiAgICAgICAgc3RydWN0dXJhbChuZXh0Q2ZnKSA9PT0gc3RydWN0dXJhbCh0aGlzLmNmZykgJiZcbiAgICAgICAgb3JiVW5jaGFuZ2VkICYmXG4gICAgICAgIChzZXJ2ZXIuYWdlbnRfbmFtZSB8fCBcIkFJIEFnZW50XCIpID09PSB0aGlzLmFnZW50TmFtZSAmJlxuICAgICAgICBKU09OLnN0cmluZ2lmeShzZXJ2ZXIubGFuZ3VhZ2VzID8/IFtdKSA9PT0gSlNPTi5zdHJpbmdpZnkodGhpcy5sYW5ndWFnZXMpXG4gICAgICApIHtcbiAgICAgICAgdGhpcy5jZmcgPSBuZXh0Q2ZnO1xuICAgICAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYnVpbGRDc3NWYXJzKG5leHRDZmcpKSkge1xuICAgICAgICAgIHRoaXMucm9vdEVsLnN0eWxlLnNldFByb3BlcnR5KG5hbWUsIHZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jZmcgPSBuZXh0Q2ZnO1xuICAgIHRoaXMuYWdlbnROYW1lID0gc2VydmVyLmFnZW50X25hbWUgfHwgXCJBSSBBZ2VudFwiO1xuICAgIHRoaXMubGFuZ3VhZ2VzID0gc2VydmVyLmxhbmd1YWdlcyA/PyBbXTtcbiAgICB0aGlzLmF2YXRhclVybCA9XG4gICAgICBzZXJ2ZXIuYXZhdGFyX3VybCAmJiB0aGlzLmFwaVxuICAgICAgICA/IHRoaXMuYXBpLnJlc29sdmVVcmwoc2VydmVyLmF2YXRhcl91cmwpXG4gICAgICAgIDogc2VydmVyLmF2YXRhcl91cmwgPz8gbnVsbDtcbiAgICAvLyBUaGUgYGxhbmd1YWdlYCBhdHRyaWJ1dGUgcGlja3MgdGhlIHN0YXJ0IGxhbmd1YWdlIHdoZW4gdGhlIGFnZW50IGhhcyBpdC5cbiAgICBjb25zdCBwcmVmZXJyZWQgPSB0aGlzLmdldEF0dHJpYnV0ZShcImxhbmd1YWdlXCIpO1xuICAgIHRoaXMuc2VsZWN0ZWRMYW5ndWFnZSA9XG4gICAgICBwcmVmZXJyZWQgJiYgdGhpcy5sYW5ndWFnZXMuaW5jbHVkZXMocHJlZmVycmVkKSA/IHByZWZlcnJlZCA6IHRoaXMubGFuZ3VhZ2VzWzBdID8/IG51bGw7XG4gICAgLy8gVUkgc3RhdGUgZm9sbG93cyB0aGUgY29uZmlnIG9ubHkgb24gdGhlIEZJUlNUIHJlbmRlci4gUmUtYm9vdHN0cmFwc1xuICAgIC8vICh0aGUgc2V0dGluZ3MgcHJldmlldyBwdXNoaW5nIGEgbmV3IGNvbmZpZy1qc29uIG9uIGV2ZXJ5IGVkaXQpIG11c3RcbiAgICAvLyBwcmVzZXJ2ZSB3aGF0IHRoZSB1c2VyIGlzIGxvb2tpbmcgYXQgXHUyMDE0IGNvbGxhcHNpbmcgdGhlIHNoZWV0IG9uIGVhY2hcbiAgICAvLyBjb2xvciB0d2VhayBtYWRlIHRoZSBsaXZlIHByZXZpZXcgZmVlbCBkZWFkLlxuICAgIGlmICghdGhpcy5ldmVyUmVuZGVyZWQpIHtcbiAgICAgIHRoaXMuZXhwYW5kZWQgPVxuICAgICAgICB0aGlzLmNmZy5leHBhbmRlZF9iZWhhdmlvciA9PT0gXCJzdGFydHNfZXhwYW5kZWRcIiB8fFxuICAgICAgICB0aGlzLmNmZy5leHBhbmRlZF9iZWhhdmlvciA9PT0gXCJhbHdheXNfZXhwYW5kZWRcIjtcbiAgICAgIHRoaXMudHJhbnNjcmlwdFZpc2libGUgPSB0aGlzLmNmZy50cmFuc2NyaXB0X2VuYWJsZWQ7XG4gICAgfSBlbHNlIGlmICh0aGlzLmNmZy5leHBhbmRlZF9iZWhhdmlvciA9PT0gXCJhbHdheXNfZXhwYW5kZWRcIikge1xuICAgICAgdGhpcy5leHBhbmRlZCA9IHRydWU7XG4gICAgfVxuICAgIHRoaXMuZXZlclJlbmRlcmVkID0gdHJ1ZTtcblxuICAgIHRoaXMucmVuZGVyU2tlbGV0b24oKTtcbiAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSB0ZXh0KGtleTogV2lkZ2V0VGV4dEtleSk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHJlc29sdmVUZXh0KHRoaXMuY2ZnLnRleHQsIGtleSk7XG4gIH1cblxuICBwcml2YXRlIGdldCBjb2xsYXBzaWJsZSgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5jZmcuY29sbGFwc2libGUgJiYgdGhpcy5jZmcuZXhwYW5kZWRfYmVoYXZpb3IgIT09IFwiYWx3YXlzX2V4cGFuZGVkXCI7XG4gIH1cblxuICBwcml2YXRlIGdldCBjYW5Td2l0Y2hNb2RlcygpOiBib29sZWFuIHtcbiAgICAvLyBDaGF0IGlzIGFsd2F5cyBhdmFpbGFibGUgKHNpbmdsZSBcIkNoYXQgKHRleHQtb25seSkgbW9kZVwiIHRvZ2dsZTpcbiAgICAvLyB0ZXh0LW9ubHkgT0ZGID0gdm9pY2UgQU5EIGNoYXQsIE9OID0gY2hhdCBvbmx5KSwgc28gc3dpdGNoaW5nXG4gICAgLy8gZXhpc3RzIGV4YWN0bHkgd2hlbiB2b2ljZSBkb2VzLlxuICAgIHJldHVybiB0aGlzLmNmZy52b2ljZV9lbmFibGVkO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIHNrZWxldG9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgcmVuZGVyU2tlbGV0b24oKTogdm9pZCB7XG4gICAgdGhpcy5kZXN0cm95T3JicygpO1xuICAgIHRoaXMuc2hhZG93LnRleHRDb250ZW50ID0gXCJcIjtcbiAgICBjb25zdCBzdHlsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzdHlsZVwiKTtcbiAgICBzdHlsZS50ZXh0Q29udGVudCA9IFdJREdFVF9DU1M7XG4gICAgdGhpcy5zaGFkb3cuYXBwZW5kKHN0eWxlKTtcblxuICAgIHRoaXMucm9vdEVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aGlzLnJvb3RFbC5jbGFzc05hbWUgPSBcInZ3LXJvb3RcIjtcbiAgICBjb25zdCBwcmV2aWV3ID0gdGhpcy5nZXRBdHRyaWJ1dGUoXCJwcmV2aWV3XCIpID09PSBcInRydWVcIjtcbiAgICBpZiAocHJldmlldykge1xuICAgICAgdGhpcy5yb290RWwuc2V0QXR0cmlidXRlKFwiZGF0YS1wcmV2aWV3XCIsIFwiXCIpO1xuICAgICAgdGhpcy5yb290RWwuZGF0YXNldC5wbGFjZW1lbnQgPSBcImJvdHRvbS1yaWdodFwiOyAvLyBwcmV2aWV3IGlzIGFsd2F5cyBib3R0b20tcmlnaHRcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yb290RWwuZGF0YXNldC5wbGFjZW1lbnQgPSB0aGlzLmNmZy5wbGFjZW1lbnQ7XG4gICAgfVxuICAgIGNvbnN0IHZhcnMgPSBidWlsZENzc1ZhcnModGhpcy5jZmcpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh2YXJzKSkge1xuICAgICAgdGhpcy5yb290RWwuc3R5bGUuc2V0UHJvcGVydHkobmFtZSwgdmFsdWUpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jZmcuYXZhdGFyLmtpbmQgPT09IFwib3JiXCIpIHtcbiAgICAgIHRoaXMucm9vdEVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS12dy1vcmItMVwiLCB0aGlzLmNmZy5hdmF0YXIuY29sb3JfMSk7XG4gICAgICB0aGlzLnJvb3RFbC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdnctb3JiLTJcIiwgdGhpcy5jZmcuYXZhdGFyLmNvbG9yXzIpO1xuICAgIH1cblxuICAgIC8vIExhdW5jaGVyXG4gICAgdGhpcy5sYXVuY2hlckVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICB0aGlzLmxhdW5jaGVyRWwuY2xhc3NOYW1lID0gXCJ2dy1sYXVuY2hlclwiO1xuICAgIHRoaXMubGF1bmNoZXJFbC5kYXRhc2V0LnZhcmlhbnQgPSB0aGlzLmNmZy52YXJpYW50O1xuICAgIHRoaXMubGF1bmNoZXJFbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRoaXMudGV4dChcImV4cGFuZFwiKSk7XG4gICAgLy8gUTkgYHNob3ctYXZhdGFyLXdoZW4tY29sbGFwc2VkPVwiZmFsc2VcImAgZHJvcHMgaXQgKHRoZSB0aW55IGxhdW5jaGVyIElTIGl0cyBhdmF0YXIpLlxuICAgIGlmICh0aGlzLmNmZy5zaG93X2F2YXRhcl93aGVuX2NvbGxhcHNlZCB8fCB0aGlzLmNmZy52YXJpYW50ID09PSBcInRpbnlcIikge1xuICAgICAgdGhpcy5sYXVuY2hlckVsLmFwcGVuZChcbiAgICAgICAgdGhpcy5idWlsZEF2YXRhcihcbiAgICAgICAgICB0aGlzLmNmZy52YXJpYW50ID09PSBcImZ1bGxcIiA/IDQwIDogdGhpcy5jZmcudmFyaWFudCA9PT0gXCJ0aW55XCIgPyA0NCA6IDI2LFxuICAgICAgICApLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICBsYWJlbC5jbGFzc05hbWUgPSBcInZ3LWxhdW5jaGVyLWxhYmVsXCI7XG4gICAgbGFiZWwudGV4dENvbnRlbnQgPSB0aGlzLnRleHQoXCJtYWluX2xhYmVsXCIpO1xuICAgIHRoaXMubGF1bmNoZXJFbC5hcHBlbmQobGFiZWwpO1xuICAgIGlmICh0aGlzLmNmZy52YXJpYW50ICE9PSBcInRpbnlcIikge1xuICAgICAgY29uc3QgaWNvbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgICAgaWNvbi5pbm5lckhUTUwgPSBJQ09OUy5waG9uZTtcbiAgICAgIGljb24uc3R5bGUuZGlzcGxheSA9IFwiaW5saW5lLWZsZXhcIjtcbiAgICAgIHRoaXMubGF1bmNoZXJFbC5hcHBlbmQoaWNvbik7XG4gICAgfVxuICAgIHRoaXMubGF1bmNoZXJFbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5leHBhbmRlZCA9IHRydWU7XG4gICAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICAgIH0pO1xuXG4gICAgLy8gU2hlZXRcbiAgICB0aGlzLnNoZWV0RWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRoaXMuc2hlZXRFbC5jbGFzc05hbWUgPSBcInZ3LXNoZWV0XCI7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGhlYWRlci5jbGFzc05hbWUgPSBcInZ3LWhlYWRlclwiO1xuICAgIHRoaXMuaGVhZGVyQXZhdGFyRWwgPSB0aGlzLmJ1aWxkQXZhdGFyKDM0KTtcbiAgICBoZWFkZXIuYXBwZW5kKHRoaXMuaGVhZGVyQXZhdGFyRWwpO1xuICAgIGNvbnN0IG1ldGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIG1ldGEuY2xhc3NOYW1lID0gXCJ2dy1oZWFkZXItbWV0YVwiO1xuICAgIHRoaXMuaGVhZGVyTmFtZUVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aGlzLmhlYWRlck5hbWVFbC5jbGFzc05hbWUgPSBcInZ3LWhlYWRlci1uYW1lXCI7XG4gICAgdGhpcy5oZWFkZXJOYW1lRWwudGV4dENvbnRlbnQgPSB0aGlzLmFnZW50TmFtZTtcbiAgICB0aGlzLmhlYWRlclN0YXR1c0VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICB0aGlzLmhlYWRlclN0YXR1c0VsLmNsYXNzTmFtZSA9IFwidnctaGVhZGVyLXN0YXR1c1wiO1xuICAgIG1ldGEuYXBwZW5kKHRoaXMuaGVhZGVyTmFtZUVsLCB0aGlzLmhlYWRlclN0YXR1c0VsKTtcbiAgICBoZWFkZXIuYXBwZW5kKG1ldGEpO1xuICAgIGhlYWRlci5hcHBlbmQodGhpcy5idWlsZEhlYWRlckFjdGlvbnMoKSk7XG4gICAgdGhpcy5zaGVldEVsLmFwcGVuZChoZWFkZXIpO1xuXG4gICAgY29uc3QgY29udGFpbmVyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBjb250YWluZXIuY2xhc3NOYW1lID0gXCJ2dy1zaGVldC1jb250YWluZXJcIjtcblxuICAgIHRoaXMuaW50cm9FbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGhpcy5pbnRyb0VsLmNsYXNzTmFtZSA9IFwidnctaW50cm9cIjtcbiAgICBjb250YWluZXIuYXBwZW5kKHRoaXMuaW50cm9FbCk7XG5cbiAgICB0aGlzLmJvZHlFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGhpcy5ib2R5RWwuY2xhc3NOYW1lID0gXCJ2dy1ib2R5XCI7XG4gICAgY29udGFpbmVyLmFwcGVuZCh0aGlzLmJvZHlFbCk7XG5cbiAgICB0aGlzLm92ZXJsYXlIb3N0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBjb250YWluZXIuYXBwZW5kKHRoaXMub3ZlcmxheUhvc3QpO1xuXG4gICAgdGhpcy5zaGVldEVsLmFwcGVuZChjb250YWluZXIpO1xuXG4gICAgdGhpcy5mb290ZXJFbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgdGhpcy5mb290ZXJFbC5jbGFzc05hbWUgPSBcInZ3LWZvb3RlclwiO1xuICAgIHRoaXMuc2hlZXRFbC5hcHBlbmQodGhpcy5mb290ZXJFbCk7XG5cbiAgICB0aGlzLmF1ZGlvRWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYXVkaW9cIik7XG4gICAgdGhpcy5hdWRpb0VsLmF1dG9wbGF5ID0gdHJ1ZTtcbiAgICB0aGlzLmF1ZGlvRWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgIHRoaXMuc2hlZXRFbC5hcHBlbmQodGhpcy5hdWRpb0VsKTtcblxuICAgIC8vIFE5IGBzaG93LWxhbmd1YWdlLXNlbGVjdG9yLW9uLXRyaWdnZXJgOiBwaWNrIHRoZSBsYW5ndWFnZSB3aGlsZSBjb2xsYXBzZWQuXG4gICAgdGhpcy50cmlnZ2VyTGFuZ1NlbGVjdCA9XG4gICAgICB0aGlzLmNmZy5zaG93X2xhbmd1YWdlX3NlbGVjdG9yX29uX3RyaWdnZXIgJiZcbiAgICAgIHRoaXMuY2ZnLmxhbmd1YWdlX2Ryb3Bkb3duX2VuYWJsZWQgJiZcbiAgICAgIHRoaXMubGFuZ3VhZ2VzLmxlbmd0aCA+IDFcbiAgICAgICAgPyB0aGlzLmJ1aWxkTGFuZ3VhZ2VTZWxlY3QoKVxuICAgICAgICA6IG51bGw7XG4gICAgaWYgKHRoaXMudHJpZ2dlckxhbmdTZWxlY3QpIHtcbiAgICAgIHRoaXMudHJpZ2dlckxhbmdTZWxlY3QuY2xhc3NMaXN0LmFkZChcInZ3LWxhbmctdHJpZ2dlclwiKTtcbiAgICAgIHRoaXMucm9vdEVsLmFwcGVuZCh0aGlzLnNoZWV0RWwsIHRoaXMudHJpZ2dlckxhbmdTZWxlY3QsIHRoaXMubGF1bmNoZXJFbCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucm9vdEVsLmFwcGVuZCh0aGlzLnNoZWV0RWwsIHRoaXMubGF1bmNoZXJFbCk7XG4gICAgfVxuICAgIHRoaXMuc2hhZG93LmFwcGVuZCh0aGlzLnJvb3RFbCk7XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkQXZhdGFyKHNpemUgPSAzNCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgZWwuY2xhc3NOYW1lID0gXCJ2dy1hdmF0YXJcIjtcbiAgICBjb25zdCBraW5kID0gdGhpcy5jZmcuYXZhdGFyLmtpbmQ7XG4gICAgY29uc3Qgc3JjID1cbiAgICAgIGtpbmQgPT09IFwidXJsXCJcbiAgICAgICAgPyAodGhpcy5jZmcuYXZhdGFyIGFzIHsgdXJsPzogc3RyaW5nIH0pLnVybCB8fCBudWxsXG4gICAgICAgIDoga2luZCA9PT0gXCJpbWFnZVwiXG4gICAgICAgICAgPyB0aGlzLmF2YXRhclVybFxuICAgICAgICAgIDogbnVsbDtcbiAgICBpZiAoc3JjKSB7XG4gICAgICBjb25zdCBpbWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW1nXCIpO1xuICAgICAgaW1nLnNyYyA9IHNyYztcbiAgICAgIGltZy5hbHQgPSBcIlwiO1xuICAgICAgZWwuYXBwZW5kKGltZyk7XG4gICAgICByZXR1cm4gZWw7XG4gICAgfVxuICAgIGlmIChraW5kID09PSBcInVybFwiIHx8IGtpbmQgPT09IFwiaW1hZ2VcIikge1xuICAgICAgLy8gTGluay9pbWFnZSBzZWxlY3RlZCBidXQgbm8gc291cmNlIHlldCBcdTIwMTQgc2hvdyB0aGUgbW9kZSdzIGdseXBoIG9uXG4gICAgICAvLyB0aGUgbmV1dHJhbCBncmFkaWVudCBpbnN0ZWFkIG9mIHNpbGVudGx5IGZhbGxpbmcgYmFjayB0byB0aGUgb3JiLFxuICAgICAgLy8gc28gdGhlIHNldHRpbmdzIHByZXZpZXcgdmlzaWJseSB0cmFja3MgdGhlIGF2YXRhciB0eXBlLlxuICAgICAgY29uc3QgZ2x5cGggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgIGdseXBoLmNsYXNzTmFtZSA9IFwidnctYXZhdGFyLWdseXBoXCI7XG4gICAgICBnbHlwaC5pbm5lckhUTUwgPSBraW5kID09PSBcInVybFwiID8gSUNPTlMubGluayA6IElDT05TLmltYWdlO1xuICAgICAgZWwuYXBwZW5kKGdseXBoKTtcbiAgICAgIHJldHVybiBlbDtcbiAgICB9XG4gICAgLy8gT3JiOiB0aGUgc2FtZSB3aXJlZnJhbWUgb3JiIHRoZSBkYXNoYm9hcmQgcHJldmlldyByZW5kZXJzIChzZWVcbiAgICAvLyBvcmIudHMpLCBjb2xvcmVkIGJ5IHRoZSBjb25maWd1cmVkIGdyYWRpZW50IHBhaXIuXG4gICAgZWwuc3R5bGUuYmFja2dyb3VuZCA9IFwibm9uZVwiO1xuICAgIGNvbnN0IGNvbG9ycyA9IHRoaXMuY2ZnLmF2YXRhciBhcyB7IGNvbG9yXzE6IHN0cmluZzsgY29sb3JfMjogc3RyaW5nIH07XG4gICAgY29uc3Qgb3JiID0gY3JlYXRlT3JiKHNpemUsIGNvbG9ycy5jb2xvcl8xLCBjb2xvcnMuY29sb3JfMik7XG4gICAgdGhpcy5vcmJzLnB1c2gob3JiKTtcbiAgICBlbC5hcHBlbmQob3JiLmVsKTtcbiAgICByZXR1cm4gZWw7XG4gIH1cblxuICBwcml2YXRlIHNldE9yYlN0YXRlKHN0YXRlOiBPcmJTdGF0ZSk6IHZvaWQge1xuICAgIGZvciAoY29uc3Qgb3JiIG9mIHRoaXMub3Jicykgb3JiLnNldFN0YXRlKHN0YXRlKTtcbiAgfVxuXG4gIHByaXZhdGUgZGVzdHJveU9yYnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBvcmIgb2YgdGhpcy5vcmJzKSBvcmIuZGVzdHJveSgpO1xuICAgIHRoaXMub3JicyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBidWlsZEhlYWRlckFjdGlvbnMoKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGFjdGlvbnMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGFjdGlvbnMuY2xhc3NOYW1lID0gXCJ2dy1oZWFkZXItYWN0aW9uc1wiO1xuXG4gICAgdGhpcy5sYW5nU2VsZWN0ID0gbnVsbDtcbiAgICBpZiAodGhpcy5jZmcubGFuZ3VhZ2VfZHJvcGRvd25fZW5hYmxlZCAmJiB0aGlzLmxhbmd1YWdlcy5sZW5ndGggPiAxKSB7XG4gICAgICBjb25zdCBzZWxlY3QgPSB0aGlzLmJ1aWxkTGFuZ3VhZ2VTZWxlY3QoKTtcbiAgICAgIGFjdGlvbnMuYXBwZW5kKHNlbGVjdCk7XG4gICAgICB0aGlzLmxhbmdTZWxlY3QgPSBzZWxlY3Q7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY2FuU3dpdGNoTW9kZXMpIHtcbiAgICAgIHRoaXMubW9kZUJ0biA9IHRoaXMuaWNvbkJ1dHRvbihJQ09OUy5rZXlib2FyZCwgdGhpcy50ZXh0KFwidGV4dF9tb2RlXCIpLCAoKSA9PiB7XG4gICAgICAgIHZvaWQgdGhpcy50b2dnbGVNb2RlKCk7XG4gICAgICB9KTtcbiAgICAgIGFjdGlvbnMuYXBwZW5kKHRoaXMubW9kZUJ0bik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY2ZnLnJlc2l6ZV9idXR0b25fZW5hYmxlZCkge1xuICAgICAgdGhpcy5yZXNpemVCdG4gPSB0aGlzLmljb25CdXR0b24oSUNPTlMuZXhwYW5kLCB0aGlzLnRleHQoXCJleHBhbmRcIiksICgpID0+IHtcbiAgICAgICAgdGhpcy5sYXJnZSA9ICF0aGlzLmxhcmdlO1xuICAgICAgICBpZiAodGhpcy5sYXJnZSkgdGhpcy5zaGVldEVsLnNldEF0dHJpYnV0ZShcImRhdGEtbGFyZ2VcIiwgXCJcIik7XG4gICAgICAgIGVsc2UgdGhpcy5zaGVldEVsLnJlbW92ZUF0dHJpYnV0ZShcImRhdGEtbGFyZ2VcIik7XG4gICAgICAgIHRoaXMucmVzaXplQnRuIS5pbm5lckhUTUwgPSB0aGlzLmxhcmdlID8gSUNPTlMuc2hyaW5rIDogSUNPTlMuZXhwYW5kO1xuICAgICAgfSk7XG4gICAgICBhY3Rpb25zLmFwcGVuZCh0aGlzLnJlc2l6ZUJ0bik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29sbGFwc2libGUpIHtcbiAgICAgIGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICB0aGlzLmljb25CdXR0b24oSUNPTlMuY2hldnJvbkRvd24sIHRoaXMudGV4dChcImNvbGxhcHNlXCIpLCAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5leHBhbmRlZCA9IGZhbHNlO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hyb21lKCk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICB9XG4gICAgcmV0dXJuIGFjdGlvbnM7XG4gIH1cblxuICBwcml2YXRlIGxhbmdTZWxlY3Q6IEhUTUxTZWxlY3RFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdHJpZ2dlckxhbmdTZWxlY3Q6IEhUTUxTZWxlY3RFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIFRoZSBsYW5ndWFnZSBkcm9wZG93biAoaGVhZGVyIGFuZCwgd2l0aCBROSwgdGhlIGNvbGxhcHNlZCB0cmlnZ2VyKSBcdTIwMTQgYm90aCBzdGF5IGluIHN5bmMuICovXG4gIHByaXZhdGUgYnVpbGRMYW5ndWFnZVNlbGVjdCgpOiBIVE1MU2VsZWN0RWxlbWVudCB7XG4gICAgY29uc3Qgc2VsZWN0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNlbGVjdFwiKTtcbiAgICBzZWxlY3QuY2xhc3NOYW1lID0gXCJ2dy1sYW5nXCI7XG4gICAgc2VsZWN0LnRpdGxlID0gdGhpcy50ZXh0KFwiY2hhbmdlX2xhbmd1YWdlXCIpO1xuICAgIHNlbGVjdC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRoaXMudGV4dChcImNoYW5nZV9sYW5ndWFnZVwiKSk7XG4gICAgZm9yIChjb25zdCBsYW5nIG9mIHRoaXMubGFuZ3VhZ2VzKSB7XG4gICAgICBjb25zdCBvcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwib3B0aW9uXCIpO1xuICAgICAgb3B0LnZhbHVlID0gbGFuZztcbiAgICAgIG9wdC50ZXh0Q29udGVudCA9IGxhbmc7XG4gICAgICBzZWxlY3QuYXBwZW5kKG9wdCk7XG4gICAgfVxuICAgIGlmICh0aGlzLnNlbGVjdGVkTGFuZ3VhZ2UpIHNlbGVjdC52YWx1ZSA9IHRoaXMuc2VsZWN0ZWRMYW5ndWFnZTtcbiAgICBzZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnNlbGVjdGVkTGFuZ3VhZ2UgPSBzZWxlY3QudmFsdWU7XG4gICAgICBmb3IgKGNvbnN0IG90aGVyIG9mIFt0aGlzLmxhbmdTZWxlY3QsIHRoaXMudHJpZ2dlckxhbmdTZWxlY3RdKSB7XG4gICAgICAgIGlmIChvdGhlciAmJiBvdGhlciAhPT0gc2VsZWN0KSBvdGhlci52YWx1ZSA9IHNlbGVjdC52YWx1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gc2VsZWN0O1xuICB9XG4gIHByaXZhdGUgbW9kZUJ0bjogSFRNTEJ1dHRvbkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNpemVCdG46IEhUTUxCdXR0b25FbGVtZW50IHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSBpY29uQnV0dG9uKFxuICAgIGljb246IHN0cmluZyxcbiAgICB0aXRsZTogc3RyaW5nLFxuICAgIG9uQ2xpY2s6ICgpID0+IHZvaWQsXG4gICk6IEhUTUxCdXR0b25FbGVtZW50IHtcbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgIGJ0bi5jbGFzc05hbWUgPSBcInZ3LWljb25idG5cIjtcbiAgICBidG4udGl0bGUgPSB0aXRsZTtcbiAgICBidG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCB0aXRsZSk7XG4gICAgYnRuLmlubmVySFRNTCA9IGljb247IC8vIHN0YXRpYyB0cnVzdGVkIG1hcmt1cFxuICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgb25DbGljayk7XG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBjaHJvbWUgdXBkYXRlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIHVwZGF0ZUNocm9tZSgpOiB2b2lkIHtcbiAgICB0aGlzLmxhdW5jaGVyRWwuY2xhc3NMaXN0LnRvZ2dsZShcInZ3LWhpZGRlblwiLCB0aGlzLmV4cGFuZGVkKTtcbiAgICB0aGlzLnNoZWV0RWwuY2xhc3NMaXN0LnRvZ2dsZShcInZ3LWhpZGRlblwiLCAhdGhpcy5leHBhbmRlZCk7XG5cbiAgICAvLyBTdGF0dXMgbGluZVxuICAgIHRoaXMuaGVhZGVyU3RhdHVzRWwudGV4dENvbnRlbnQgPSBcIlwiO1xuICAgIGNvbnN0IGRvdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIGRvdC5jbGFzc05hbWUgPSBcInZ3LXN0YXR1cy1kb3RcIjtcbiAgICBjb25zdCBzdGF0dXNUZXh0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgaWYgKHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiKSB7XG4gICAgICBkb3Quc2V0QXR0cmlidXRlKFwiZGF0YS1saXZlXCIsIFwiXCIpO1xuICAgICAgc3RhdHVzVGV4dC50ZXh0Q29udGVudCA9XG4gICAgICAgIHRoaXMudm9pY2VTdGF0dXMgPT09IFwiY29ubmVjdGluZ1wiXG4gICAgICAgICAgPyB0aGlzLnRleHQoXCJjb25uZWN0aW5nX3N0YXR1c1wiKVxuICAgICAgICAgIDogdGhpcy52b2ljZVN0YXR1cyA9PT0gXCJxdWV1ZWRcIlxuICAgICAgICAgICAgPyB0aGlzLnRleHQoXCJxdWV1ZWRfc3RhdHVzXCIpXG4gICAgICAgICAgICA6IHRoaXMudm9pY2VTdGF0dXMgPT09IFwic3BlYWtpbmdcIlxuICAgICAgICAgICAgICA/IHRoaXMudGV4dChcInNwZWFraW5nX3N0YXR1c1wiKVxuICAgICAgICAgICAgICA6IHRoaXMudGV4dChcImxpc3RlbmluZ19zdGF0dXNcIik7XG4gICAgfSBlbHNlIGlmICh0aGlzLm1vZGUgPT09IFwiY2hhdFwiKSB7XG4gICAgICBkb3Quc2V0QXR0cmlidXRlKFwiZGF0YS1saXZlXCIsIFwiXCIpO1xuICAgICAgc3RhdHVzVGV4dC50ZXh0Q29udGVudCA9IHRoaXMudGV4dChcImNoYXR0aW5nX3N0YXR1c1wiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgc3RhdHVzVGV4dC50ZXh0Q29udGVudCA9IHRoaXMuYWdlbnROYW1lO1xuICAgIH1cbiAgICB0aGlzLmhlYWRlclN0YXR1c0VsLmFwcGVuZChkb3QsIHN0YXR1c1RleHQpO1xuICAgIC8vIFE5IGBzaG93LWFnZW50LXN0YXR1cz1cImZhbHNlXCJgIGhpZGVzIHRoZSBzdGF0dXMgbGluZS5cbiAgICB0aGlzLmhlYWRlclN0YXR1c0VsLmNsYXNzTGlzdC50b2dnbGUoXCJ2dy1oaWRkZW5cIiwgIXRoaXMuY2ZnLnNob3dfYWdlbnRfc3RhdHVzKTtcbiAgICB0aGlzLmhlYWRlckF2YXRhckVsLnRvZ2dsZUF0dHJpYnV0ZShcbiAgICAgIFwiZGF0YS1zcGVha2luZ1wiLFxuICAgICAgdGhpcy5tb2RlID09PSBcInZvaWNlXCIgJiYgdGhpcy52b2ljZVN0YXR1cyA9PT0gXCJzcGVha2luZ1wiLFxuICAgICk7XG4gICAgdGhpcy5zZXRPcmJTdGF0ZShcbiAgICAgIHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiXG4gICAgICAgID8gdGhpcy52b2ljZVN0YXR1cyA9PT0gXCJxdWV1ZWRcIlxuICAgICAgICAgID8gXCJjb25uZWN0aW5nXCJcbiAgICAgICAgICA6IHRoaXMudm9pY2VTdGF0dXNcbiAgICAgICAgOiB0aGlzLm1vZGUgPT09IFwiY2hhdFwiXG4gICAgICAgICAgPyBcImxpc3RlbmluZ1wiXG4gICAgICAgICAgOiBcImlkbGVcIixcbiAgICApO1xuICAgIC8vIEhvc3QtZWxlbWVudCBtaXJyb3Igb2YgdGhlIGxpdmUgc3RhdGUgZm9yIGVtYmVkZGluZyBwYWdlcyBhbmQgdGhlXG4gICAgLy8gUGxheXdyaWdodCBzcGVjIChgZG9jcy9xYS9hZ2VudC1pbnRlZ3JhdGlvbi1lNy1xYS5tZGAgXHUwMEE3MikuXG4gICAgdGhpcy5zZXRBdHRyaWJ1dGUoXCJkYXRhLXZ3LW1vZGVcIiwgdGhpcy5tb2RlKTtcbiAgICBpZiAodGhpcy5tb2RlID09PSBcInZvaWNlXCIpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKFwiZGF0YS12dy12b2ljZS1zdGF0dXNcIiwgdGhpcy52b2ljZVN0YXR1cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVtb3ZlQXR0cmlidXRlKFwiZGF0YS12dy12b2ljZS1zdGF0dXNcIik7XG4gICAgfVxuXG4gICAgLy8gSW50cm8gdnMgY29udmVyc2F0aW9uIGJvZHlcbiAgICBjb25zdCBpbkNvbnZlcnNhdGlvbiA9IHRoaXMubW9kZSAhPT0gXCJpZGxlXCIgfHwgdGhpcy5ib2R5RWwuY2hpbGROb2Rlcy5sZW5ndGggPiAwO1xuICAgIHRoaXMuaW50cm9FbC5jbGFzc0xpc3QudG9nZ2xlKFwidnctaGlkZGVuXCIsIGluQ29udmVyc2F0aW9uKTtcbiAgICBjb25zdCBib2R5SGlkZGVuID1cbiAgICAgIHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiICYmICF0aGlzLnRyYW5zY3JpcHRWaXNpYmxlID8gdHJ1ZSA6ICFpbkNvbnZlcnNhdGlvbjtcbiAgICB0aGlzLmJvZHlFbC5jbGFzc0xpc3QudG9nZ2xlKFwidnctaGlkZGVuXCIsIGJvZHlIaWRkZW4pO1xuICAgIGlmICghaW5Db252ZXJzYXRpb24pIHRoaXMucmVuZGVySW50cm8oKTtcblxuICAgIGlmICh0aGlzLmxhbmdTZWxlY3QpIHtcbiAgICAgIHRoaXMubGFuZ1NlbGVjdC5kaXNhYmxlZCA9IHRoaXMubW9kZSAhPT0gXCJpZGxlXCI7XG4gICAgfVxuICAgIGlmICh0aGlzLnRyaWdnZXJMYW5nU2VsZWN0KSB7XG4gICAgICB0aGlzLnRyaWdnZXJMYW5nU2VsZWN0LmNsYXNzTGlzdC50b2dnbGUoXCJ2dy1oaWRkZW5cIiwgdGhpcy5leHBhbmRlZCk7XG4gICAgICB0aGlzLnRyaWdnZXJMYW5nU2VsZWN0LmRpc2FibGVkID0gdGhpcy5tb2RlICE9PSBcImlkbGVcIjtcbiAgICB9XG4gICAgaWYgKHRoaXMubW9kZUJ0bikge1xuICAgICAgdGhpcy5tb2RlQnRuLnRpdGxlID1cbiAgICAgICAgdGhpcy5tb2RlID09PSBcInZvaWNlXCIgPyB0aGlzLnRleHQoXCJ0ZXh0X21vZGVcIikgOiB0aGlzLnRleHQoXCJ2b2ljZV9tb2RlXCIpO1xuICAgICAgdGhpcy5tb2RlQnRuLmlubmVySFRNTCA9IHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiID8gSUNPTlMua2V5Ym9hcmQgOiBJQ09OUy5waG9uZTtcbiAgICAgIHRoaXMubW9kZUJ0bi5jbGFzc0xpc3QudG9nZ2xlKFwidnctaGlkZGVuXCIsIHRoaXMubW9kZSA9PT0gXCJpZGxlXCIpO1xuICAgIH1cblxuICAgIHRoaXMucmVuZGVyRm9vdGVyKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckludHJvKCk6IHZvaWQge1xuICAgIHRoaXMuaW50cm9FbC50ZXh0Q29udGVudCA9IFwiXCI7XG4gICAgY29uc3QgYXZhdGFyID0gdGhpcy5idWlsZEF2YXRhcig2NCk7XG4gICAgY29uc3QgdGl0bGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIHRpdGxlLmNsYXNzTmFtZSA9IFwidnctaW50cm8tdGl0bGVcIjtcbiAgICB0aXRsZS50ZXh0Q29udGVudCA9IHRoaXMudGV4dChcIm1haW5fbGFiZWxcIik7XG4gICAgdGhpcy5pbnRyb0VsLmFwcGVuZChhdmF0YXIsIHRpdGxlKTtcblxuICAgIGlmICh0aGlzLmNmZy52b2ljZV9lbmFibGVkKSB7XG4gICAgICBjb25zdCBjYWxsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIGNhbGwuY2xhc3NOYW1lID0gXCJ2dy1jdGFcIjtcbiAgICAgIGNhbGwuaW5uZXJIVE1MID0gYCR7SUNPTlMucGhvbmV9PHNwYW4+PC9zcGFuPmA7XG4gICAgICAoY2FsbC5sYXN0RWxlbWVudENoaWxkIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCA9IHRoaXMudGV4dChcInN0YXJ0X2NhbGxcIik7XG4gICAgICBjYWxsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmd1YXJkVGVybXMoKCkgPT4gdm9pZCB0aGlzLnN0YXJ0Q2FsbCgpKSk7XG4gICAgICB0aGlzLmludHJvRWwuYXBwZW5kKGNhbGwpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jZmcudGV4dF9lbmFibGVkKSB7XG4gICAgICBjb25zdCBjaGF0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIGNoYXQuY2xhc3NOYW1lID0gYHZ3LWN0YSR7dGhpcy5jZmcudm9pY2VfZW5hYmxlZCA/IFwiIHZ3LWN0YS1zZWNvbmRhcnlcIiA6IFwiXCJ9YDtcbiAgICAgIGNoYXQuaW5uZXJIVE1MID0gYCR7SUNPTlMuY2hhdH08c3Bhbj48L3NwYW4+YDtcbiAgICAgIChjaGF0Lmxhc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwic3RhcnRfY2hhdFwiKTtcbiAgICAgIGNoYXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZ3VhcmRUZXJtcygoKSA9PiB2b2lkIHRoaXMuc3RhcnRDaGF0KCkpKTtcbiAgICAgIHRoaXMuaW50cm9FbC5hcHBlbmQoY2hhdCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJGb290ZXIoKTogdm9pZCB7XG4gICAgdGhpcy5mb290ZXJFbC50ZXh0Q29udGVudCA9IFwiXCI7XG5cbiAgICBpZiAodGhpcy5tb2RlID09PSBcInZvaWNlXCIpIHtcbiAgICAgIGNvbnN0IHJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICByb3cuY2xhc3NOYW1lID0gXCJ2dy1jYWxscm93XCI7XG4gICAgICBpZiAodGhpcy5jZmcubXV0ZV9idXR0b25fZW5hYmxlZCkge1xuICAgICAgICBjb25zdCBtdXRlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgICAgbXV0ZS5jbGFzc05hbWUgPSBcInZ3LWNhbGxidG5cIjtcbiAgICAgICAgbXV0ZS50aXRsZSA9IHRoaXMudGV4dChcIm11dGVfbWljcm9waG9uZVwiKTtcbiAgICAgICAgbXV0ZS5pbm5lckhUTUwgPSB0aGlzLm11dGVkID8gSUNPTlMubWljT2ZmIDogSUNPTlMubWljO1xuICAgICAgICBtdXRlLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5tdXRlZCA9ICF0aGlzLm11dGVkO1xuICAgICAgICAgIHRoaXMudm9pY2U/LnNldE1pY3JvcGhvbmVFbmFibGVkKCF0aGlzLm11dGVkKTtcbiAgICAgICAgICB0aGlzLnJlbmRlckZvb3RlcigpO1xuICAgICAgICB9KTtcbiAgICAgICAgcm93LmFwcGVuZChtdXRlKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmNmZy50cmFuc2NyaXB0X2VuYWJsZWQpIHtcbiAgICAgICAgY29uc3QgdHJhbnNjcmlwdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICAgIHRyYW5zY3JpcHQuY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgICAgIHRyYW5zY3JpcHQuaW5uZXJIVE1MID0gSUNPTlMuY2hhdDtcbiAgICAgICAgdHJhbnNjcmlwdC50aXRsZSA9IFwiVHJhbnNjcmlwdFwiO1xuICAgICAgICBpZiAodGhpcy50cmFuc2NyaXB0VmlzaWJsZSkgdHJhbnNjcmlwdC5zZXRBdHRyaWJ1dGUoXCJkYXRhLWFjY2VudFwiLCBcIlwiKTtcbiAgICAgICAgdHJhbnNjcmlwdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICAgIHRoaXMudHJhbnNjcmlwdFZpc2libGUgPSAhdGhpcy50cmFuc2NyaXB0VmlzaWJsZTtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICAgICAgICB9KTtcbiAgICAgICAgcm93LmFwcGVuZCh0cmFuc2NyaXB0KTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGVuZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICBlbmQuY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgICBlbmQuc2V0QXR0cmlidXRlKFwiZGF0YS1kYW5nZXJcIiwgXCJcIik7XG4gICAgICBlbmQuaW5uZXJIVE1MID0gYCR7SUNPTlMucGhvbmVPZmZ9PHNwYW4+PC9zcGFuPmA7XG4gICAgICAoZW5kLmxhc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwiZW5kX2NhbGxcIik7XG4gICAgICBlbmQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHZvaWQgdGhpcy5lbmRDYWxsKFwidXNlclwiKSk7XG4gICAgICByb3cuYXBwZW5kKGVuZCk7XG4gICAgICB0aGlzLmZvb3RlckVsLmFwcGVuZChyb3cpO1xuICAgICAgLy8gVHlwZWQgdGV4dCBkdXJpbmcgdGhlIGxpdmUgY2FsbDogdGhlIGNvbXBvc2VyIHN0YXlzIGFjdGl2ZSB3aGVuXG4gICAgICAvLyB0aGUgdG9nZ2xlIGlzIG9uIFx1MjAxNCBzdWJtaXNzaW9ucyBiZWNvbWUgcmVhbCB1c2VyIHR1cm5zIHZpYSB0aGVcbiAgICAgIC8vIFJUVkkgc2VuZC10ZXh0IGVudmVsb3BlICh0aGUgcGlwZWxpbmUgaW50ZXJydXB0cyB0aGUgYm90IHdoZW4gaXRcbiAgICAgIC8vIGlzIG1pZC11dHRlcmFuY2UsIGFwcGVuZHMgdGhlIHRleHQgYXMgYSB1c2VyIG1lc3NhZ2UsIGFuZCBydW5zIGFcbiAgICAgIC8vIGNvbXBsZXRpb24pLlxuICAgICAgaWYgKHRoaXMuY2ZnLnNlbmRfdGV4dF93aGlsZV9vbl9jYWxsKSB7XG4gICAgICAgIGNvbnN0IGlucHV0Um93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgaW5wdXRSb3cuY2xhc3NOYW1lID0gXCJ2dy1pbnB1dHJvd1wiO1xuICAgICAgICBjb25zdCBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcbiAgICAgICAgaW5wdXQuY2xhc3NOYW1lID0gXCJ2dy1pbnB1dFwiO1xuICAgICAgICBpbnB1dC5wbGFjZWhvbGRlciA9IHRoaXMudGV4dChcImlucHV0X3BsYWNlaG9sZGVyXCIpO1xuICAgICAgICBpbnB1dC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRoaXMudGV4dChcImlucHV0X2xhYmVsXCIpKTtcbiAgICAgICAgY29uc3Qgc2VuZCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICAgIHNlbmQuY2xhc3NOYW1lID0gXCJ2dy1zZW5kYnRuXCI7XG4gICAgICAgIHNlbmQudGl0bGUgPSB0aGlzLnRleHQoXCJzZW5kX21lc3NhZ2VcIik7XG4gICAgICAgIHNlbmQuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCB0aGlzLnRleHQoXCJzZW5kX21lc3NhZ2VcIikpO1xuICAgICAgICBzZW5kLmlubmVySFRNTCA9IElDT05TLnNlbmQ7XG4gICAgICAgIC8vIFdhaXRpbmcgaW4gdGhlIHF1ZXVlIChFNyBcdTAwQTc0LjMpOiBub3RoaW5nIHR5cGVkIHJlYWNoZXMgdGhlIGFnZW50XG4gICAgICAgIC8vICh0aGUgd29ya2VyIGRyb3BzIGl0IFx1MjAxNCB2ZW5kb3IgcGFyaXR5KSwgc28gdGhlIGNvbXBvc2VyIGlzIG9mZi5cbiAgICAgICAgY29uc3QgcXVldWVkID0gdGhpcy52b2ljZVN0YXR1cyA9PT0gXCJxdWV1ZWRcIjtcbiAgICAgICAgaW5wdXQuZGlzYWJsZWQgPSBxdWV1ZWQ7XG4gICAgICAgIHNlbmQuZGlzYWJsZWQgPSBxdWV1ZWQ7XG4gICAgICAgIGNvbnN0IHN1Ym1pdCA9ICgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy52b2ljZVN0YXR1cyA9PT0gXCJxdWV1ZWRcIikgcmV0dXJuO1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgICAgIGlmICghdmFsdWUpIHJldHVybjtcbiAgICAgICAgICBpZiAodGhpcy52b2ljZT8uc2VuZFVzZXJUZXh0KHZhbHVlKSkge1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBcIlwiO1xuICAgICAgICAgICAgdGhpcy5hcHBlbmRNZXNzYWdlKFwidXNlclwiLCB2YWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBzZW5kLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBzdWJtaXQpO1xuICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZSkgPT4ge1xuICAgICAgICAgIGlmIChlLmtleSA9PT0gXCJFbnRlclwiICYmICFlLnNoaWZ0S2V5KSB7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBzdWJtaXQoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dFJvdy5hcHBlbmQoaW5wdXQsIHNlbmQpO1xuICAgICAgICB0aGlzLmZvb3RlckVsLmFwcGVuZChpbnB1dFJvdyk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubW9kZSA9PT0gXCJjaGF0XCIpIHtcbiAgICAgIC8vIFN0YWdlZC1hdHRhY2htZW50IGNoaXBzICh1cGxvYWRzIHJpZGluZyB0aGUgbmV4dCBtZXNzYWdlKS5cbiAgICAgIGlmICh0aGlzLnBlbmRpbmdBdHRhY2htZW50cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGNoaXBzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgY2hpcHMuY2xhc3NOYW1lID0gXCJ2dy1jaGlwc1wiO1xuICAgICAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnQgb2YgdGhpcy5wZW5kaW5nQXR0YWNobWVudHMpIHtcbiAgICAgICAgICBjb25zdCBjaGlwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgY2hpcC5jbGFzc05hbWUgPSBcInZ3LWNoaXBcIjtcbiAgICAgICAgICBjb25zdCBuYW1lID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIik7XG4gICAgICAgICAgbmFtZS5jbGFzc05hbWUgPSBcInZ3LWNoaXAtbmFtZVwiO1xuICAgICAgICAgIG5hbWUudGV4dENvbnRlbnQgPSBhdHRhY2htZW50LmZpbGVuYW1lO1xuICAgICAgICAgIGNvbnN0IHJlbW92ZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICAgICAgcmVtb3ZlLmNsYXNzTmFtZSA9IFwidnctY2hpcC1yZW1vdmVcIjtcbiAgICAgICAgICByZW1vdmUudGl0bGUgPSB0aGlzLnRleHQoXCJyZW1vdmVfZmlsZVwiKTtcbiAgICAgICAgICByZW1vdmUuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCB0aGlzLnRleHQoXCJyZW1vdmVfZmlsZVwiKSk7XG4gICAgICAgICAgcmVtb3ZlLmlubmVySFRNTCA9IElDT05TLng7XG4gICAgICAgICAgcmVtb3ZlLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdBdHRhY2htZW50cyA9IHRoaXMucGVuZGluZ0F0dGFjaG1lbnRzLmZpbHRlcihcbiAgICAgICAgICAgICAgKGEpID0+IGEuYXR0YWNobWVudF9pZCAhPT0gYXR0YWNobWVudC5hdHRhY2htZW50X2lkLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyRm9vdGVyKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgY2hpcC5hcHBlbmQobmFtZSwgcmVtb3ZlKTtcbiAgICAgICAgICBjaGlwcy5hcHBlbmQoY2hpcCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5mb290ZXJFbC5hcHBlbmQoY2hpcHMpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByb3cgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgcm93LmNsYXNzTmFtZSA9IFwidnctaW5wdXRyb3dcIjtcblxuICAgICAgLy8gQXR0YWNoIGJ1dHRvbiArIGhpZGRlbiBwaWNrZXIuXG4gICAgICBjb25zdCBwaWNrZXIgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiaW5wdXRcIik7XG4gICAgICBwaWNrZXIudHlwZSA9IFwiZmlsZVwiO1xuICAgICAgcGlja2VyLmFjY2VwdCA9IGF0dGFjaG1lbnRBY2NlcHRBdHRyaWJ1dGUoKTtcbiAgICAgIHBpY2tlci5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICBwaWNrZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZpbGUgPSBwaWNrZXIuZmlsZXM/LlswXTtcbiAgICAgICAgcGlja2VyLnZhbHVlID0gXCJcIjtcbiAgICAgICAgaWYgKGZpbGUpIHZvaWQgdGhpcy5hdHRhY2hGaWxlKGZpbGUpO1xuICAgICAgfSk7XG4gICAgICBjb25zdCBhdHRhY2ggPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgICAgYXR0YWNoLmNsYXNzTmFtZSA9IFwidnctc2VuZGJ0biB2dy1hdHRhY2hidG5cIjtcbiAgICAgIGF0dGFjaC50aXRsZSA9IHRoaXMudGV4dChcImF0dGFjaF9maWxlXCIpO1xuICAgICAgYXR0YWNoLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgdGhpcy50ZXh0KFwiYXR0YWNoX2ZpbGVcIikpO1xuICAgICAgYXR0YWNoLmlubmVySFRNTCA9IElDT05TLnBhcGVyY2xpcDtcbiAgICAgIGF0dGFjaC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcGlja2VyLmNsaWNrKCkpO1xuXG4gICAgICBjb25zdCBpbnB1dCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJpbnB1dFwiKTtcbiAgICAgIGlucHV0LmNsYXNzTmFtZSA9IFwidnctaW5wdXRcIjtcbiAgICAgIGlucHV0LnBsYWNlaG9sZGVyID0gdGhpcy5jZmcudm9pY2VfZW5hYmxlZFxuICAgICAgICA/IHRoaXMudGV4dChcImlucHV0X3BsYWNlaG9sZGVyXCIpXG4gICAgICAgIDogdGhpcy50ZXh0KFwiaW5wdXRfcGxhY2Vob2xkZXJfdGV4dF9vbmx5XCIpO1xuICAgICAgaW5wdXQuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCB0aGlzLnRleHQoXCJpbnB1dF9sYWJlbFwiKSk7XG4gICAgICBjb25zdCBzZW5kID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIHNlbmQuY2xhc3NOYW1lID0gXCJ2dy1zZW5kYnRuXCI7XG4gICAgICBzZW5kLnRpdGxlID0gdGhpcy50ZXh0KFwic2VuZF9tZXNzYWdlXCIpO1xuICAgICAgc2VuZC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIHRoaXMudGV4dChcInNlbmRfbWVzc2FnZVwiKSk7XG4gICAgICBzZW5kLmlubmVySFRNTCA9IElDT05TLnNlbmQ7XG4gICAgICBjb25zdCBzdWJtaXQgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHRoaXMuY2hhdEJ1c3kpIHJldHVybjtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBcIlwiO1xuICAgICAgICB2b2lkIHRoaXMuc2VuZENoYXQodmFsdWUpO1xuICAgICAgfTtcbiAgICAgIHNlbmQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHN1Ym1pdCk7XG4gICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZSkgPT4ge1xuICAgICAgICBpZiAoZS5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZS5zaGlmdEtleSkge1xuICAgICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICBzdWJtaXQoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByb3cuYXBwZW5kKGF0dGFjaCwgcGlja2VyLCBpbnB1dCwgc2VuZCk7XG4gICAgICB0aGlzLmZvb3RlckVsLmFwcGVuZChyb3cpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmVuZGVkKSB7XG4gICAgICAvLyBDb252ZXJzYXRpb24gaWQgKyBuZXcgY2FsbC9jaGF0IENUQXMuXG4gICAgICBpZiAodGhpcy5jZmcuc2hvd19jb252ZXJzYXRpb25faWQgJiYgdGhpcy5lbmRlZC5jb252ZXJzYXRpb25JZCkge1xuICAgICAgICBjb25zdCBpZFJvdyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgIGlkUm93LmNsYXNzTmFtZSA9IFwidnctY29udm8taWRcIjtcbiAgICAgICAgY29uc3QgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgICAgbGFiZWwudGV4dENvbnRlbnQgPSBgJHt0aGlzLnRleHQoXCJjb252ZXJzYXRpb25faWRcIil9OmA7XG4gICAgICAgIGNvbnN0IGNvZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiY29kZVwiKTtcbiAgICAgICAgY29kZS50ZXh0Q29udGVudCA9IHRoaXMuZW5kZWQuY29udmVyc2F0aW9uSWQ7XG4gICAgICAgIGNvbnN0IGNvcHkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgICAgICBjb3B5LmNsYXNzTmFtZSA9IFwidnctaWNvbmJ0blwiO1xuICAgICAgICBjb3B5LnN0eWxlLndpZHRoID0gXCIyMnB4XCI7XG4gICAgICAgIGNvcHkuc3R5bGUuaGVpZ2h0ID0gXCIyMnB4XCI7XG4gICAgICAgIGNvcHkudGl0bGUgPSB0aGlzLnRleHQoXCJjb3B5X2lkXCIpO1xuICAgICAgICBjb3B5LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgdGhpcy50ZXh0KFwiY29weV9pZFwiKSk7XG4gICAgICAgIGNvcHkuaW5uZXJIVE1MID0gSUNPTlMuY29weTtcbiAgICAgICAgY29weS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICAgIHZvaWQgbmF2aWdhdG9yLmNsaXBib2FyZD8ud3JpdGVUZXh0KHRoaXMuZW5kZWQ/LmNvbnZlcnNhdGlvbklkID8/IFwiXCIpO1xuICAgICAgICAgIGNvcHkuaW5uZXJIVE1MID0gSUNPTlMuY2hlY2s7XG4gICAgICAgICAgY29weS50aXRsZSA9IHRoaXMudGV4dChcImNvcGllZFwiKTtcbiAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIGNvcHkuaW5uZXJIVE1MID0gSUNPTlMuY29weTtcbiAgICAgICAgICAgIGNvcHkudGl0bGUgPSB0aGlzLnRleHQoXCJjb3B5X2lkXCIpO1xuICAgICAgICAgIH0sIDE1MDApO1xuICAgICAgICB9KTtcbiAgICAgICAgaWRSb3cuYXBwZW5kKGxhYmVsLCBjb2RlLCBjb3B5KTtcbiAgICAgICAgdGhpcy5mb290ZXJFbC5hcHBlbmQoaWRSb3cpO1xuICAgICAgfVxuICAgICAgY29uc3Qgcm93ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHJvdy5jbGFzc05hbWUgPSBcInZ3LWNhbGxyb3dcIjtcbiAgICAgIGlmICh0aGlzLmNmZy52b2ljZV9lbmFibGVkKSB7XG4gICAgICAgIGNvbnN0IGFnYWluID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgICAgYWdhaW4uY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgICAgIGFnYWluLnNldEF0dHJpYnV0ZShcImRhdGEtYWNjZW50XCIsIFwiXCIpO1xuICAgICAgICBhZ2Fpbi5pbm5lckhUTUwgPSBgJHtJQ09OUy5waG9uZX08c3Bhbj48L3NwYW4+YDtcbiAgICAgICAgKGFnYWluLmxhc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQpLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwibmV3X2NhbGxcIik7XG4gICAgICAgIGFnYWluLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmd1YXJkVGVybXMoKCkgPT4gdm9pZCB0aGlzLnN0YXJ0Q2FsbCgpKSk7XG4gICAgICAgIHJvdy5hcHBlbmQoYWdhaW4pO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuY2ZnLnRleHRfZW5hYmxlZCkge1xuICAgICAgICBjb25zdCBjaGF0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgICAgY2hhdC5jbGFzc05hbWUgPSBcInZ3LWNhbGxidG5cIjtcbiAgICAgICAgY2hhdC5pbm5lckhUTUwgPSBgJHtJQ09OUy5jaGF0fTxzcGFuPjwvc3Bhbj5gO1xuICAgICAgICAoY2hhdC5sYXN0RWxlbWVudENoaWxkIGFzIEhUTUxFbGVtZW50KS50ZXh0Q29udGVudCA9IHRoaXMudGV4dChcInN0YXJ0X2NoYXRcIik7XG4gICAgICAgIGNoYXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZ3VhcmRUZXJtcygoKSA9PiB2b2lkIHRoaXMuc3RhcnRDaGF0KCkpKTtcbiAgICAgICAgcm93LmFwcGVuZChjaGF0KTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZm9vdGVyRWwuYXBwZW5kKHJvdyk7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIG1lc3NhZ2VzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXBwZW5kTWVzc2FnZShcbiAgICBraW5kOiBcImFnZW50XCIgfCBcInVzZXJcIiB8IFwic3lzdGVtXCIgfCBcImVycm9yXCIsXG4gICAgcmF3OiBzdHJpbmcsXG4gICAgZm9ybWF0OiBPdXRwdXRGb3JtYXQgPSB0aGlzLmNoYXRPdXRwdXRGb3JtYXQsXG4gICk6IHZvaWQge1xuICAgIGxldCB0ZXh0ID0gcmF3O1xuICAgIGlmICh0aGlzLmNmZy5oaWRlX2F1ZGlvX3RhZ3MgJiYga2luZCAhPT0gXCJzeXN0ZW1cIiAmJiBraW5kICE9PSBcImVycm9yXCIpIHtcbiAgICAgIHRleHQgPSBzdHJpcEF1ZGlvVGFncyh0ZXh0KTtcbiAgICAgIGlmICghdGV4dC50cmltKCkpIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGlmIChraW5kID09PSBcInN5c3RlbVwiKSB7XG4gICAgICBlbC5jbGFzc05hbWUgPSBcInZ3LXN5c3RlbVwiO1xuICAgICAgZWwudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgIH0gZWxzZSBpZiAoa2luZCA9PT0gXCJlcnJvclwiKSB7XG4gICAgICBlbC5jbGFzc05hbWUgPSBcInZ3LWVycm9yXCI7XG4gICAgICBlbC50ZXh0Q29udGVudCA9IHRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGVsLmNsYXNzTmFtZSA9IGB2dy1tc2cgdnctbXNnLSR7a2luZH1gO1xuICAgICAgY29uc3QgYnViYmxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIGJ1YmJsZS5jbGFzc05hbWUgPSBcInZ3LWJ1YmJsZVwiO1xuICAgICAgaWYgKGtpbmQgPT09IFwiYWdlbnRcIikge1xuICAgICAgICByZW5kZXJBZ2VudFRleHQoYnViYmxlLCB0ZXh0LCBmb3JtYXQsICh0KSA9PiB0aGlzLm1hcmtkb3duTm9kZSh0KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBidWJibGUudGV4dENvbnRlbnQgPSB0ZXh0O1xuICAgICAgfVxuICAgICAgZWwuYXBwZW5kKGJ1YmJsZSk7XG4gICAgfVxuICAgIHRoaXMuYm9keUVsLmFwcGVuZChlbCk7XG4gICAgdGhpcy5zY3JvbGxUb0JvdHRvbSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBlbmRBY3Rpb25JbmRpY2F0b3Ioc3RhdGU6IFwid29ya2luZ1wiIHwgXCJkb25lXCIgfCBcImVycm9yXCIsIG5hbWU/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuY2ZnLmFjdGlvbl9pbmRpY2F0b3JfZW5hYmxlZCkgcmV0dXJuO1xuICAgIGNvbnN0IGNoaXAgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgIGNoaXAuY2xhc3NOYW1lID0gXCJ2dy1hY3Rpb25cIjtcbiAgICBjaGlwLmRhdGFzZXQuc3RhdGUgPSBzdGF0ZTtcbiAgICBjb25zdCBsYWJlbCA9XG4gICAgICBzdGF0ZSA9PT0gXCJ3b3JraW5nXCJcbiAgICAgICAgPyB0aGlzLnRleHQoXCJhZ2VudF93b3JraW5nXCIpXG4gICAgICAgIDogc3RhdGUgPT09IFwiZG9uZVwiXG4gICAgICAgICAgPyB0aGlzLnRleHQoXCJhZ2VudF9kb25lXCIpXG4gICAgICAgICAgOiB0aGlzLnRleHQoXCJhZ2VudF9lcnJvclwiKTtcbiAgICBjaGlwLmlubmVySFRNTCA9IHN0YXRlID09PSBcIndvcmtpbmdcIiA/IElDT05TLnNwaW5uZXIgOiBzdGF0ZSA9PT0gXCJkb25lXCIgPyBJQ09OUy5jaGVjayA6IElDT05TLng7XG4gICAgY29uc3Qgc3BhbiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpO1xuICAgIHNwYW4udGV4dENvbnRlbnQgPSBuYW1lID8gYCR7bmFtZX0gXHUyMDE0ICR7bGFiZWx9YCA6IGxhYmVsO1xuICAgIGNoaXAuYXBwZW5kKHNwYW4pO1xuICAgIHRoaXMuYm9keUVsLmFwcGVuZChjaGlwKTtcbiAgICB0aGlzLnNjcm9sbFRvQm90dG9tKCk7XG4gIH1cblxuICBwcml2YXRlIHNldFR5cGluZyhvbjogYm9vbGVhbik6IHZvaWQge1xuICAgIGlmIChvbiAmJiAhdGhpcy50eXBpbmdFbCkge1xuICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgZWwuY2xhc3NOYW1lID0gXCJ2dy10eXBpbmdcIjtcbiAgICAgIGNvbnN0IGRvdHMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgIGRvdHMuY2xhc3NOYW1lID0gXCJ2dy10eXBpbmctZG90c1wiO1xuICAgICAgZG90cy5hcHBlbmQoXG4gICAgICAgIGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIpLFxuICAgICAgICBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKSxcbiAgICAgICAgZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcInNwYW5cIiksXG4gICAgICApO1xuICAgICAgY29uc3QgbGFiZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwic3BhblwiKTtcbiAgICAgIGxhYmVsLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwidHlwaW5nX2luZGljYXRvclwiKTtcbiAgICAgIGVsLmFwcGVuZChkb3RzLCBsYWJlbCk7XG4gICAgICB0aGlzLmJvZHlFbC5hcHBlbmQoZWwpO1xuICAgICAgdGhpcy50eXBpbmdFbCA9IGVsO1xuICAgICAgdGhpcy5zY3JvbGxUb0JvdHRvbSgpO1xuICAgIH0gZWxzZSBpZiAoIW9uICYmIHRoaXMudHlwaW5nRWwpIHtcbiAgICAgIHRoaXMudHlwaW5nRWwucmVtb3ZlKCk7XG4gICAgICB0aGlzLnR5cGluZ0VsID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNjcm9sbFRvQm90dG9tKCk6IHZvaWQge1xuICAgIHRoaXMuYm9keUVsLnNjcm9sbFRvcCA9IHRoaXMuYm9keUVsLnNjcm9sbEhlaWdodDtcbiAgfVxuXG4gIC8qKiBUaGUgT05FIG1hcmtkb3duIFx1MjE5MiBET00gcmVuZGVyIChhZ2VudCBidWJibGVzLCB0ZXJtcyBvdmVybGF5KS4gKi9cbiAgcHJpdmF0ZSBtYXJrZG93bk5vZGUodGV4dDogc3RyaW5nKTogTm9kZSB7XG4gICAgcmV0dXJuIHJlbmRlck1hcmtkb3duKHBhcnNlTWFya2Rvd24odGV4dCwgdGhpcy5jZmcubGlua19wb2xpY3kpLCB7XG4gICAgICBzeW50YXhUaGVtZTogdGhpcy5jZmcuc3ludGF4X3RoZW1lLFxuICAgICAgdGV4dDoge1xuICAgICAgICBjb3B5OiB0aGlzLnRleHQoXCJjb3B5XCIpLFxuICAgICAgICBjb3BpZWQ6IHRoaXMudGV4dChcImNvcGllZFwiKSxcbiAgICAgICAgZG93bmxvYWQ6IHRoaXMudGV4dChcImRvd25sb2FkXCIpLFxuICAgICAgICB3cmFwOiB0aGlzLnRleHQoXCJ3cmFwXCIpLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCB0ZXJtcyBnYXRlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgdGVybXNBbHJlYWR5QWNjZXB0ZWQoKTogYm9vbGVhbiB7XG4gICAgaWYgKCF0aGlzLmNmZy50ZXJtcy5lbmFibGVkIHx8ICF0aGlzLmNmZy50ZXJtcy5jb250ZW50LnRyaW0oKSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKHRoaXMudGVybXNBY2NlcHRlZFRoaXNTZXNzaW9uKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBrZXkgPSB0aGlzLmNmZy50ZXJtcy5sb2NhbF9zdG9yYWdlX2tleTtcbiAgICBpZiAoa2V5KSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAod2luZG93LmxvY2FsU3RvcmFnZS5nZXRJdGVtKGtleSkgPT09IFwiYWNjZXB0ZWRcIikgcmV0dXJuIHRydWU7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gc3RvcmFnZSB1bmF2YWlsYWJsZSBcdTIxOTIgc2Vzc2lvbiBtZW1vcnkgb25seVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIGd1YXJkVGVybXMocHJvY2VlZDogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnRlcm1zQWxyZWFkeUFjY2VwdGVkKCkpIHtcbiAgICAgIHByb2NlZWQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5wZW5kaW5nQWZ0ZXJUZXJtcyA9IHByb2NlZWQ7XG4gICAgdGhpcy5zaG93VGVybXNPdmVybGF5KCk7XG4gIH1cblxuICBwcml2YXRlIHNob3dUZXJtc092ZXJsYXkoKTogdm9pZCB7XG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSBcInZ3LW92ZXJsYXlcIjtcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBjYXJkLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1jYXJkXCI7XG4gICAgY29uc3QgYm9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgYm9keS5jbGFzc05hbWUgPSBcInZ3LW92ZXJsYXktYm9keVwiO1xuICAgIGJvZHkuYXBwZW5kKHRoaXMubWFya2Rvd25Ob2RlKHRoaXMuY2ZnLnRlcm1zLmNvbnRlbnQpKTtcbiAgICBjb25zdCBhY3Rpb25zID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBhY3Rpb25zLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1hY3Rpb25zXCI7XG4gICAgY29uc3QgY2FuY2VsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICBjYW5jZWwuY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgY2FuY2VsLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwiZGlzbWlzc190ZXJtc1wiKTtcbiAgICBjYW5jZWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMucGVuZGluZ0FmdGVyVGVybXMgPSBudWxsO1xuICAgICAgb3ZlcmxheS5yZW1vdmUoKTtcbiAgICB9KTtcbiAgICBjb25zdCBhY2NlcHQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYnV0dG9uXCIpO1xuICAgIGFjY2VwdC5jbGFzc05hbWUgPSBcInZ3LWNhbGxidG5cIjtcbiAgICBhY2NlcHQuc2V0QXR0cmlidXRlKFwiZGF0YS1hY2NlbnRcIiwgXCJcIik7XG4gICAgYWNjZXB0LnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwiYWNjZXB0X3Rlcm1zXCIpO1xuICAgIGFjY2VwdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy50ZXJtc0FjY2VwdGVkVGhpc1Nlc3Npb24gPSB0cnVlO1xuICAgICAgY29uc3Qga2V5ID0gdGhpcy5jZmcudGVybXMubG9jYWxfc3RvcmFnZV9rZXk7XG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgd2luZG93LmxvY2FsU3RvcmFnZS5zZXRJdGVtKGtleSwgXCJhY2NlcHRlZFwiKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gaWdub3JlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIG92ZXJsYXkucmVtb3ZlKCk7XG4gICAgICBjb25zdCBwcm9jZWVkID0gdGhpcy5wZW5kaW5nQWZ0ZXJUZXJtcztcbiAgICAgIHRoaXMucGVuZGluZ0FmdGVyVGVybXMgPSBudWxsO1xuICAgICAgcHJvY2VlZD8uKCk7XG4gICAgfSk7XG4gICAgYWN0aW9ucy5hcHBlbmQoY2FuY2VsLCBhY2NlcHQpO1xuICAgIGNhcmQuYXBwZW5kKGJvZHksIGFjdGlvbnMpO1xuICAgIG92ZXJsYXkuYXBwZW5kKGNhcmQpO1xuICAgIHRoaXMub3ZlcmxheUhvc3QuYXBwZW5kKG92ZXJsYXkpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIHZvaWNlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgc3RhcnRDYWxsKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5hcGkgfHwgdGhpcy5tb2RlID09PSBcInZvaWNlXCIpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLnRlYXJkb3duU2Vzc2lvbnMobnVsbCk7XG4gICAgdGhpcy5lbmRlZCA9IG51bGw7XG4gICAgdGhpcy5tb2RlID0gXCJ2b2ljZVwiO1xuICAgIHRoaXMudm9pY2VTdGF0dXMgPSBcImNvbm5lY3RpbmdcIjtcbiAgICB0aGlzLnF1ZXVlVGltZWRPdXRTaG93biA9IGZhbHNlO1xuICAgIHRoaXMubXV0ZWQgPSBmYWxzZTtcbiAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNhbGwgPSB0aGlzLmRpc3BhdGNoQ2FsbChmYWxzZSk7XG4gICAgICBjb25zdCBzZXNzaW9uID0gYXdhaXQgdGhpcy5hcGkuc3RhcnRWb2ljZVNlc3Npb24oXG4gICAgICAgIGNhbGwubGFuZ3VhZ2UsXG4gICAgICAgIGNhbGwub3ZlcnJpZGVzLFxuICAgICAgICBjYWxsLmR5bmFtaWNWYXJpYWJsZXMsXG4gICAgICApO1xuICAgICAgdGhpcy52b2ljZUNvbnZlcnNhdGlvbklkID0gc2Vzc2lvbi5jb252ZXJzYXRpb25faWQ7XG4gICAgICAvLyBUaGUgZG9vciBhbHJlYWR5IGtub3dzIChFNyBcdTAwQTc0LjIpOiBhIHF1ZXVlZCBzZXNzaW9uIHNob3dzIHRoZVxuICAgICAgLy8gd2FpdGluZyBsaW5lIGJlZm9yZSB0aGUgcGVlciBldmVuIGNvbm5lY3RzOyB0aGUgUlRWSVxuICAgICAgLy8gYHF1ZXVlX3N0YXR1c2AgdHdpbiBkcml2ZXMgZXZlcnkgbGF0ZXIgdHJhbnNpdGlvbi5cbiAgICAgIGlmIChzZXNzaW9uLnF1ZXVlPy5zdGF0dXMgPT09IFwid2FpdGluZ1wiKSB7XG4gICAgICAgIHRoaXMudm9pY2VTdGF0dXMgPSBcInF1ZXVlZFwiO1xuICAgICAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICAgICAgfVxuICAgICAgY29uc3QgY2xpZW50ID0gbmV3IFZvaWNlQ2xpZW50KHNlc3Npb24sIHtcbiAgICAgICAgb25TdGF0ZUNoYW5nZTogKHN0YXRlKSA9PiB7XG4gICAgICAgICAgaWYgKHN0YXRlID09PSBcImNvbm5lY3RlZFwiKSB7XG4gICAgICAgICAgICBpZiAodGhpcy52b2ljZVN0YXR1cyAhPT0gXCJxdWV1ZWRcIikgdGhpcy52b2ljZVN0YXR1cyA9IFwibGlzdGVuaW5nXCI7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdGUgPT09IFwiZGlzY29ubmVjdGVkXCIgfHwgc3RhdGUgPT09IFwiZXJyb3JcIikge1xuICAgICAgICAgICAgaWYgKHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiKSB2b2lkIHRoaXMuZW5kQ2FsbChcImFnZW50XCIpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgb25SZW1vdGVBdWRpbzogKHN0cmVhbSkgPT4ge1xuICAgICAgICAgIHRoaXMuYXVkaW9FbC5zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgICAgICAgdm9pZCB0aGlzLmF1ZGlvRWxcbiAgICAgICAgICAgIC5wbGF5KClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IGNsaWVudC5ub3RpZnlBdWRpb1JlbmRlcmluZygpKVxuICAgICAgICAgICAgLmNhdGNoKCgpID0+IGNsaWVudC5ub3RpZnlBdWRpb1JlbmRlcmluZygpKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25BcHBNZXNzYWdlOiAobXNnKSA9PiB0aGlzLm9uUnR2aU1lc3NhZ2UobXNnKSxcbiAgICAgICAgb25FcnJvcjogKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLm1vZGUgPT09IFwidm9pY2VcIikge1xuICAgICAgICAgICAgdGhpcy5hcHBlbmRNZXNzYWdlKFwiZXJyb3JcIiwgdGhpcy50ZXh0KFwiZXJyb3Jfb2NjdXJyZWRcIikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgdGhpcy52b2ljZSA9IGNsaWVudDtcbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLm1vZGUgPSBcImlkbGVcIjtcbiAgICAgIHRoaXMudm9pY2UgPSBudWxsO1xuICAgICAgY29uc3QgaG9sZCA9IGJpbGxpbmdIb2xkU2VudGVuY2UoZXJyKTtcbiAgICAgIGlmIChob2xkKSB7XG4gICAgICAgIC8vIFZPU08tODI1IGJpbGxpbmcgaG9sZDogdGhlIHJlZnVzYWwgaXMgYSBzZW50ZW5jZSBmb3IgdGhlIHZpc2l0b3JcbiAgICAgICAgLy8gKFwiXHUyMDI2YmlsbGluZyBpc3N1ZSBvbiB0aGlzIGFjY291bnRcdTIwMjZcIiksIHNob3duIGFzIHRoZSBhZ2VudCdzIGJ1YmJsZVxuICAgICAgICAvLyByYXRoZXIgdGhhbiBhbiBIVFRQIGVycm9yIGxpbmUuXG4gICAgICAgIHRoaXMuYXBwZW5kTWVzc2FnZShcImFnZW50XCIsIGhvbGQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5zaG93RXJyb3IoZXJyIGluc3RhbmNlb2YgV2lkZ2V0QXBpRXJyb3IgPyBgJHtlcnIuc3RhdHVzfSAke2Vyci5tZXNzYWdlfWAgOiBlcnIpO1xuICAgICAgfVxuICAgICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVzaCBiYWNrZ3JvdW5kIGNvbnRleHQgaW50byB0aGUgbGl2ZSBjb252ZXJzYXRpb24gd2l0aG91dCBhIHR1cm5cbiAgICogKEUzIFx1MDBBNzQuMjsgdGhlIHZlbmRvcidzIGBjb250ZXh0dWFsX3VwZGF0ZWApLiBXb3JrcyBvbiBhIHZvaWNlIGNhbGxcbiAgICogKGRhdGEgY2hhbm5lbCkgYW5kIGEgY2hhdCBzZXNzaW9uIChIVFRQKS4gQSBsYXRlciB1cGRhdGUgd2l0aCB0aGUgc2FtZVxuICAgKiBgY29udGV4dElkYCByZXBsYWNlcyB0aGUgZWFybGllciBvbmUuIFJlc29sdmVzIGBmYWxzZWAgd2hlbiBubyBzZXNzaW9uXG4gICAqIGlzIG9wZW4uXG4gICAqL1xuICBhc3luYyBzZW5kQ29udGV4dHVhbFVwZGF0ZSh0ZXh0OiBzdHJpbmcsIG9wdHM/OiB7IGNvbnRleHRJZD86IHN0cmluZyB9KTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKHRoaXMudm9pY2UpIHJldHVybiB0aGlzLnZvaWNlLnNlbmRDb250ZXh0dWFsVXBkYXRlKHRleHQsIG9wdHM/LmNvbnRleHRJZCk7XG4gICAgaWYgKHRoaXMuYXBpICYmIHRoaXMuY2hhdFNlc3Npb25JZCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5hcGkucG9zdENoYXRDb250ZXh0KHRoaXMuY2hhdFNlc3Npb25JZCwgdGV4dCwgb3B0cz8uY29udGV4dElkKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgY29uc29sZS53YXJuKFwiV2lkZ2V0IGNvbnRleHR1YWwgdXBkYXRlIHJlamVjdGVkOlwiLCBlcnIpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBcHByb3ZlIG9yIGRlbnkgYW4gTUNQIHRvb2wgY2FsbCB0aGUgYWdlbnQgaXMgd2FpdGluZyBvbiAoRTMgXHUwMEE3NC42KS4gV29ya3NcbiAgICogb24gYSB2b2ljZSBjYWxsIChkYXRhIGNoYW5uZWwpIGFuZCBhIGNoYXQgc2Vzc2lvbiAoSFRUUCkuIFJlc29sdmVzXG4gICAqIGBmYWxzZWAgd2hlbiBubyBzZXNzaW9uIGlzIG9wZW4gb3IgdGhlIGFuc3dlciB3YXMgbm90IGRlbGl2ZXJlZC5cbiAgICovXG4gIGFzeW5jIGFwcHJvdmVNY3BUb29sKHRvb2xDYWxsSWQ6IHN0cmluZywgaXNBcHByb3ZlZDogYm9vbGVhbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICh0aGlzLnZvaWNlKSByZXR1cm4gdGhpcy52b2ljZS5zZW5kTWNwVG9vbEFwcHJvdmFsKHRvb2xDYWxsSWQsIGlzQXBwcm92ZWQpO1xuICAgIGlmICh0aGlzLmFwaSAmJiB0aGlzLmNoYXRTZXNzaW9uSWQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBpLnBvc3RDaGF0VG9vbEFwcHJvdmFsKHRoaXMuY2hhdFNlc3Npb25JZCwgdG9vbENhbGxJZCwgaXNBcHByb3ZlZCk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihcIldpZGdldCBNQ1AgYXBwcm92YWwgcmVqZWN0ZWQ6XCIsIGVycik7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqIEhhbmQgYW4gYG1jcF90b29sX2NhbGxgIHN0YXRlIHRvIHRoZSBwYWdlOyBkZW55IGFuIGFzayBub2JvZHkgaGFuZGxlcy4gKi9cbiAgcHJpdmF0ZSBoYW5kbGVNY3BUb29sQ2FsbChjYWxsOiBNY3BUb29sQ2FsbCk6IHZvaWQge1xuICAgIGlmICh0aGlzLm9uTWNwVG9vbENhbGwpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMub25NY3BUb29sQ2FsbChjYWxsKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBjb25zb2xlLndhcm4oYFdpZGdldCBvbk1jcFRvb2xDYWxsICR7Y2FsbC50b29sTmFtZX06YCwgZXJyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGNhbGwuc3RhdGUgPT09IFwiYXdhaXRpbmdfYXBwcm92YWxcIikgdm9pZCB0aGlzLmFwcHJvdmVNY3BUb29sKGNhbGwudG9vbENhbGxJZCwgZmFsc2UpO1xuICB9XG5cbiAgLyoqIFJ1biB0aGUgcGFnZSdzIGhhbmRsZXIgZm9yIGEgY2xpZW50IHRvb2wgY2FsbCBhbmQgc2VuZCB0aGUgYW5zd2VyIG9uXG4gICAqICB0aGUgY2hhbm5lbCBpdCBhcnJpdmVkIG9uLiAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNsaWVudFRvb2xDYWxsKFxuICAgIGNhbGw6IENsaWVudFRvb2xDYWxsLFxuICAgIHNlbmQ6IChyZXN1bHQ6IHN0cmluZywgaXNFcnJvcjogYm9vbGVhbikgPT4gUHJvbWlzZTxib29sZWFuPiB8IGJvb2xlYW4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGFuc3dlciA9IGF3YWl0IHJ1bkNsaWVudFRvb2woXG4gICAgICB0aGlzLmNsaWVudFRvb2xzLFxuICAgICAgY2FsbCxcbiAgICAgIHRoaXMub25VbmhhbmRsZWRDbGllbnRUb29sQ2FsbCA/PyB1bmRlZmluZWQsXG4gICAgKTtcbiAgICBpZiAoIWFuc3dlcikgcmV0dXJuO1xuICAgIC8vIFRoZSBzZXJ2ZXIgaWdub3JlcyBhbiBhbnN3ZXIgdG8gYSBmaXJlLWFuZC1mb3JnZXQgdG9vbDsgc2VuZGluZyBpdFxuICAgIC8vIGNvc3RzIG5vdGhpbmcgYW5kIGtlZXBzIHRoZSBwYWdlJ3MgY29kZSBpZGVudGljYWwgZm9yIGJvdGgga2luZHMuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHNlbmQoYW5zd2VyLnJlc3VsdCwgYW5zd2VyLmlzRXJyb3IpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc29sZS53YXJuKGBXaWRnZXQgY2xpZW50IHRvb2wgJHtjYWxsLnRvb2xOYW1lfTogYW5zd2VyIG5vdCBkZWxpdmVyZWRgLCBlcnIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb25SdHZpTWVzc2FnZShtc2c6IFJ0dmlNZXNzYWdlKTogdm9pZCB7XG4gICAgY29uc3QgbWNwRGF0YSA9IG1jcFRvb2xDYWxsRGF0YUZyb21SdHZpKG1zZyk7XG4gICAgaWYgKG1jcERhdGEpIHtcbiAgICAgIGNvbnN0IG1jcENhbGwgPSBtY3BUb29sQ2FsbEZyb21SZWNvcmQobWNwRGF0YSk7XG4gICAgICBpZiAobWNwQ2FsbCkgdGhpcy5oYW5kbGVNY3BUb29sQ2FsbChtY3BDYWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50VG9vbENhbGwgPSBjbGllbnRUb29sQ2FsbEZyb21SdHZpKG1zZyk7XG4gICAgaWYgKGNsaWVudFRvb2xDYWxsKSB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLnZvaWNlO1xuICAgICAgdm9pZCB0aGlzLmhhbmRsZUNsaWVudFRvb2xDYWxsKGNsaWVudFRvb2xDYWxsLCAocmVzdWx0LCBpc0Vycm9yKSA9PlxuICAgICAgICBjbGllbnQgPyBjbGllbnQuc2VuZENsaWVudFRvb2xSZXN1bHQoY2xpZW50VG9vbENhbGwudG9vbENhbGxJZCwgcmVzdWx0LCBpc0Vycm9yKSA6IGZhbHNlLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdHJhbnNpdGlvbiA9IHF1ZXVlVHJhbnNpdGlvbihtc2cpO1xuICAgIGlmICh0cmFuc2l0aW9uKSB7XG4gICAgICB0aGlzLm9uUXVldWVUcmFuc2l0aW9uKHRyYW5zaXRpb24pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBzd2l0Y2ggKG1zZy50eXBlKSB7XG4gICAgICBjYXNlIFwiYm90LXN0YXJ0ZWQtc3BlYWtpbmdcIjpcbiAgICAgICAgdGhpcy52b2ljZVN0YXR1cyA9IFwic3BlYWtpbmdcIjtcbiAgICAgICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSBcImJvdC1zdG9wcGVkLXNwZWFraW5nXCI6XG4gICAgICAgIC8vIEEgcXVldWVkIGNhbGxlciBoZWFycyBob2xkIGF1ZGlvLCBub3QgdGhlIGFnZW50OiBzdGF5IHdhaXRpbmcuXG4gICAgICAgIGlmICh0aGlzLnZvaWNlU3RhdHVzICE9PSBcInF1ZXVlZFwiKSB0aGlzLnZvaWNlU3RhdHVzID0gXCJsaXN0ZW5pbmdcIjtcbiAgICAgICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSBcImJvdC1yZWFkeVwiOlxuICAgICAgICBpZiAodGhpcy52b2ljZVN0YXR1cyA9PT0gXCJjb25uZWN0aW5nXCIpIHtcbiAgICAgICAgICB0aGlzLnZvaWNlU3RhdHVzID0gXCJsaXN0ZW5pbmdcIjtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNocm9tZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBpZiAoaXNSZW5kZXJhYmxlVHJhbnNjcmlwdChtc2cpKSB7XG4gICAgICBjb25zdCByb2xlID0gdHJhbnNjcmlwdFJvbGUobXNnKTtcbiAgICAgIGNvbnN0IHRleHQgPSBtc2cuZGF0YT8udGV4dCA/PyBcIlwiO1xuICAgICAgaWYgKHJvbGUgJiYgdHlwZW9mIHRleHQgPT09IFwic3RyaW5nXCIgJiYgdGV4dC50cmltKCkpIHtcbiAgICAgICAgLy8gVm9pY2UgdHJhbnNjcmlwdHMgcmVuZGVyIG1hcmtkb3duIHJlZ2FyZGxlc3Mgb2YgdGhlIGNoYXQgc2Vzc2lvbidzXG4gICAgICAgIC8vIE91dHB1dCBmb3JtYXQgXHUyMDE0IHRoZSBmbGFnIHJpZGVzIHRoZSBjaGF0IGZyYW1lIG9ubHkgKHBsYW4gXHUwMEE3Ny42KS5cbiAgICAgICAgdGhpcy5hcHBlbmRNZXNzYWdlKHJvbGUsIHRleHQsIFwibWFya2Rvd25cIik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqIEU3IFx1MDBBNzQuMzogYHdhaXRpbmdgIFx1MjE5MiB0aGUgcXVldWVkIHN0YXRlIChpbnB1dCBvZmYsIGhvbGQgYXVkaW8gcGxheXMpO1xuICAgKiAgYGFkbWl0dGVkYCBcdTIxOTIgbGlzdGVuaW5nICh0aGUgZ3JlZXRpbmcgZm9sbG93cyk7IGB0aW1lZF9vdXRgIFx1MjE5MiB0aGVcbiAgICogIHNlc3Npb24gaXMgb3ZlciBcdTIwMTQgdGhlIGNvbmZpZ3VyZWQgcGVyLWxhbmd1YWdlIGxpbmUgaXMgc2hvd24gYW5kIHRoZVxuICAgKiAgcGVlciBjbG9zZSB0aGF0IGZvbGxvd3MgaXMgYW4gb3JkaW5hcnkgZW5kLCBub3QgYW4gZXJyb3IuICovXG4gIHByaXZhdGUgb25RdWV1ZVRyYW5zaXRpb24odHJhbnNpdGlvbjogXCJ3YWl0aW5nXCIgfCBcImFkbWl0dGVkXCIgfCBcInRpbWVkX291dFwiKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubW9kZSAhPT0gXCJ2b2ljZVwiKSByZXR1cm47XG4gICAgaWYgKHRyYW5zaXRpb24gPT09IFwid2FpdGluZ1wiKSB7XG4gICAgICB0aGlzLnZvaWNlU3RhdHVzID0gXCJxdWV1ZWRcIjtcbiAgICAgIHRoaXMudXBkYXRlQ2hyb21lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0cmFuc2l0aW9uID09PSBcImFkbWl0dGVkXCIpIHtcbiAgICAgIHRoaXMudm9pY2VTdGF0dXMgPSBcImxpc3RlbmluZ1wiO1xuICAgICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMucXVldWVUaW1lZE91dFNob3duKSByZXR1cm47XG4gICAgdGhpcy5xdWV1ZVRpbWVkT3V0U2hvd24gPSB0cnVlO1xuICAgIHRoaXMuYXBwZW5kTWVzc2FnZShcInN5c3RlbVwiLCB0aGlzLnRleHQoXCJxdWV1ZV90aW1lZF9vdXRcIikpO1xuICAgIHZvaWQgdGhpcy5lbmRDYWxsKFwiYWdlbnRcIik7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGVuZENhbGwoYnk6IFwidXNlclwiIHwgXCJhZ2VudFwiKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy52b2ljZTtcbiAgICB0aGlzLnZvaWNlID0gbnVsbDtcbiAgICB0aGlzLm1vZGUgPSBcImlkbGVcIjtcbiAgICB0aGlzLmVuZGVkID0geyBieSwgY29udmVyc2F0aW9uSWQ6IHRoaXMudm9pY2VDb252ZXJzYXRpb25JZCB9O1xuICAgIGlmIChjbGllbnQpIGF3YWl0IGNsaWVudC5kaXNjb25uZWN0KCk7XG4gICAgdGhpcy5hdWRpb0VsLnNyY09iamVjdCA9IG51bGw7XG4gICAgdGhpcy5hcHBlbmRNZXNzYWdlKFxuICAgICAgXCJzeXN0ZW1cIixcbiAgICAgIGJ5ID09PSBcInVzZXJcIlxuICAgICAgICA/IHRoaXMudGV4dChcInVzZXJfZW5kZWRfY29udmVyc2F0aW9uXCIpXG4gICAgICAgIDogdGhpcy50ZXh0KFwiYWdlbnRfZW5kZWRfY29udmVyc2F0aW9uXCIpLFxuICAgICk7XG4gICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICBpZiAodGhpcy5jZmcuZmVlZGJhY2tfZW5hYmxlZCAmJiB0aGlzLnZvaWNlQ29udmVyc2F0aW9uSWQpIHtcbiAgICAgIHRoaXMuc2hvd0ZlZWRiYWNrT3ZlcmxheSh0aGlzLnZvaWNlQ29udmVyc2F0aW9uSWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBjaGF0IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgYXN5bmMgc3RhcnRDaGF0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5hcGkgfHwgdGhpcy5tb2RlID09PSBcImNoYXRcIikgcmV0dXJuO1xuICAgIGF3YWl0IHRoaXMudGVhcmRvd25TZXNzaW9ucyhudWxsKTtcbiAgICB0aGlzLmVuZGVkID0gbnVsbDtcbiAgICB0aGlzLm1vZGUgPSBcImNoYXRcIjtcbiAgICB0aGlzLmNoYXRCdXN5ID0gdHJ1ZTtcbiAgICB0aGlzLmNoYXRDb252ZXJzYXRpb25JZCA9IG51bGw7XG4gICAgdGhpcy5jaGF0T3V0cHV0Rm9ybWF0ID0gREVGQVVMVF9PVVRQVVRfRk9STUFUO1xuICAgIHRoaXMucGVuZGluZ0F0dGFjaG1lbnRzID0gW107XG4gICAgdGhpcy51cGxvYWRzVGhpc0NvbnZlcnNhdGlvbiA9IDA7XG4gICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICB0aGlzLnNldFR5cGluZyh0cnVlKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY2FsbCA9IHRoaXMuZGlzcGF0Y2hDYWxsKHRydWUpO1xuICAgICAgYXdhaXQgdGhpcy5jb25zdW1lQ2hhdFN0cmVhbSh0aGlzLmFwaS5vcGVuQ2hhdChcbiAgICAgICAgICBjYWxsLmxhbmd1YWdlLFxuICAgICAgICAgIGNhbGwub3ZlcnJpZGVzLFxuICAgICAgICAgIGNhbGwuZHluYW1pY1ZhcmlhYmxlcyxcbiAgICAgICAgKSk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnNldFR5cGluZyhmYWxzZSk7XG4gICAgICB0aGlzLm1vZGUgPSBcImlkbGVcIjtcbiAgICAgIHRoaXMuc2hvd0Vycm9yKGVyciBpbnN0YW5jZW9mIFdpZGdldEFwaUVycm9yID8gYCR7ZXJyLnN0YXR1c30gJHtlcnIubWVzc2FnZX1gIDogZXJyKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jaGF0QnVzeSA9IGZhbHNlO1xuICAgICAgdGhpcy51cGRhdGVDaHJvbWUoKTtcbiAgICB9XG4gIH1cblxuICAvKiogVmFsaWRhdGUgKyB1cGxvYWQgb25lIHBpY2tlZCBmaWxlLCBzdGFnaW5nIGl0IGZvciB0aGUgbmV4dCBtZXNzYWdlLlxuICAgKiAgRXZlcnkgcmVqZWN0aW9uIHNwZWFrcyB0aHJvdWdoIHRoZSBjb25maWd1cmVkIGBmaWxlXypgIHRleHRzLiAqL1xuICBwcml2YXRlIGFzeW5jIGF0dGFjaEZpbGUoZmlsZTogRmlsZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5hcGkgfHwgIXRoaXMuY2hhdFNlc3Npb25JZCkgcmV0dXJuO1xuICAgIGNvbnN0IHJlamVjdGlvbiA9IHZhbGlkYXRlQXR0YWNobWVudChmaWxlLCB0aGlzLnVwbG9hZHNUaGlzQ29udmVyc2F0aW9uKTtcbiAgICBpZiAocmVqZWN0aW9uID09PSBcImZpbGVfdHlwZV91bnN1cHBvcnRlZFwiKSB7XG4gICAgICB0aGlzLmFwcGVuZE1lc3NhZ2UoXG4gICAgICAgIFwiZXJyb3JcIixcbiAgICAgICAgYCR7dGhpcy50ZXh0KFwiZmlsZV90eXBlX3Vuc3VwcG9ydGVkXCIpfSBwbmcsIGpwZWcsIHdlYnAsIGdpZiwgcGRmLCB0eHQsIGNzdiwgbWRgLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHJlamVjdGlvbikge1xuICAgICAgdGhpcy5hcHBlbmRNZXNzYWdlKFwiZXJyb3JcIiwgdGhpcy50ZXh0KHJlamVjdGlvbikpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgY29uc3QgdXBsb2FkZWQgPSBhd2FpdCB0aGlzLmFwaS51cGxvYWRBdHRhY2htZW50KHRoaXMuY2hhdFNlc3Npb25JZCwgZmlsZSk7XG4gICAgICB0aGlzLnVwbG9hZHNUaGlzQ29udmVyc2F0aW9uICs9IDE7XG4gICAgICB0aGlzLnBlbmRpbmdBdHRhY2htZW50cy5wdXNoKHVwbG9hZGVkKTtcbiAgICAgIHRoaXMucmVuZGVyRm9vdGVyKCk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnNob3dFcnJvcihcbiAgICAgICAgZXJyIGluc3RhbmNlb2YgV2lkZ2V0QXBpRXJyb3IgPyBgJHtlcnIuc3RhdHVzfSAke2Vyci5tZXNzYWdlfWAgOiBlcnIsXG4gICAgICAgIFwiZmlsZV91cGxvYWRfZXJyb3JcIixcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ2hhdCh0ZXh0OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuYXBpIHx8ICF0aGlzLmNoYXRTZXNzaW9uSWQpIHJldHVybjtcbiAgICBjb25zdCBhdHRhY2htZW50cyA9IHRoaXMucGVuZGluZ0F0dGFjaG1lbnRzO1xuICAgIHRoaXMucGVuZGluZ0F0dGFjaG1lbnRzID0gW107XG4gICAgaWYgKGF0dGFjaG1lbnRzLmxlbmd0aCA+IDApIHRoaXMucmVuZGVyRm9vdGVyKCk7XG4gICAgY29uc3QgZGlzcGxheSA9XG4gICAgICBhdHRhY2htZW50cy5sZW5ndGggPiAwXG4gICAgICAgID8gYCR7dGV4dH1cXG4ke2F0dGFjaG1lbnRzLm1hcCgoYSkgPT4gYFske2EuZmlsZW5hbWV9XWApLmpvaW4oXCJcXG5cIil9YFxuICAgICAgICA6IHRleHQ7XG4gICAgdGhpcy5hcHBlbmRNZXNzYWdlKFwidXNlclwiLCBkaXNwbGF5KTtcbiAgICB0aGlzLmNoYXRCdXN5ID0gdHJ1ZTtcbiAgICB0aGlzLnNldFR5cGluZyh0cnVlKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25zdW1lQ2hhdFN0cmVhbShcbiAgICAgICAgdGhpcy5hcGkuc2VuZENoYXRNZXNzYWdlKFxuICAgICAgICAgIHRoaXMuY2hhdFNlc3Npb25JZCxcbiAgICAgICAgICB0ZXh0LFxuICAgICAgICAgIGF0dGFjaG1lbnRzLm1hcCgoYSkgPT4gYS5hdHRhY2htZW50X2lkKSxcbiAgICAgICAgKSxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB0aGlzLnNldFR5cGluZyhmYWxzZSk7XG4gICAgICB0aGlzLnNob3dFcnJvcihlcnIgaW5zdGFuY2VvZiBXaWRnZXRBcGlFcnJvciA/IGAke2Vyci5zdGF0dXN9ICR7ZXJyLm1lc3NhZ2V9YCA6IGVycik7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuY2hhdEJ1c3kgPSBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbnN1bWVDaGF0U3RyZWFtKFxuICAgIHN0cmVhbTogQXN5bmNHZW5lcmF0b3I8Q2hhdEV2ZW50LCB2b2lkLCB1bmRlZmluZWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHN0cmVhbSkge1xuICAgICAgc3dpdGNoIChldmVudC50eXBlKSB7XG4gICAgICAgIGNhc2UgXCJzZXNzaW9uXCI6XG4gICAgICAgICAgLy8gSG93IHRoaXMgc2Vzc2lvbidzIGFnZW50IHJlcGxpZXMgcmVuZGVyIChXaWRnZXQgcm93IFx1MjE5MiBPdXRwdXRcbiAgICAgICAgICAvLyBmb3JtYXQpLiBNaXNzaW5nIFx1MjFEMiBtYXJrZG93biwgdG9kYXkncyBiZWhhdmlvdXIuXG4gICAgICAgICAgdGhpcy5jaGF0T3V0cHV0Rm9ybWF0ID0gb3V0cHV0Rm9ybWF0RnJvbUZyYW1lKGV2ZW50Lm91dHB1dF9mb3JtYXQpO1xuICAgICAgICAgIHRoaXMuY2hhdFNlc3Npb25JZCA9IGV2ZW50LnNlc3Npb25faWQgPz8gbnVsbDtcbiAgICAgICAgICAvLyBEdXJhYmxlIGNvbnZlcnNhdGlvbiBpZCAoY2FsbHMuY2FsbF9pZCkgXHUyMDE0IHNhbWUgaWRlbnRpdHkgdm9pY2VcbiAgICAgICAgICAvLyBjYXJyaWVzLCBzbyBzaG93LWNvbnZlcnNhdGlvbi1JRCArIGZlZWRiYWNrIHdvcmsgb24gY2hhdCB0b28uXG4gICAgICAgICAgdGhpcy5jaGF0Q29udmVyc2F0aW9uSWQgPSBldmVudC5jb252ZXJzYXRpb25faWQgPz8gbnVsbDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSBcImFzc2lzdGFudF90b2tlblwiOiB7XG4gICAgICAgICAgdGhpcy5zZXRUeXBpbmcoZmFsc2UpO1xuICAgICAgICAgIHRoaXMuc3RyZWFtVGV4dCArPSBldmVudC5kZWx0YSA/PyBcIlwiO1xuICAgICAgICAgIGlmICghdGhpcy5zdHJlYW1FbCkge1xuICAgICAgICAgICAgY29uc3QgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgZWwuY2xhc3NOYW1lID0gXCJ2dy1tc2cgdnctbXNnLWFnZW50XCI7XG4gICAgICAgICAgICBjb25zdCBidWJibGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgYnViYmxlLmNsYXNzTmFtZSA9IFwidnctYnViYmxlXCI7XG4gICAgICAgICAgICBlbC5hcHBlbmQoYnViYmxlKTtcbiAgICAgICAgICAgIHRoaXMuYm9keUVsLmFwcGVuZChlbCk7XG4gICAgICAgICAgICB0aGlzLnN0cmVhbUVsID0gYnViYmxlO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLnN0cmVhbUVsLnRleHRDb250ZW50ID0gdGhpcy5zdHJlYW1UZXh0O1xuICAgICAgICAgIHRoaXMuc2Nyb2xsVG9Cb3R0b20oKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiYXNzaXN0YW50X21lc3NhZ2VcIjoge1xuICAgICAgICAgIHRoaXMuZmluaXNoU3RyZWFtQnViYmxlKCk7XG4gICAgICAgICAgdGhpcy5zZXRUeXBpbmcoZmFsc2UpO1xuICAgICAgICAgIGlmIChldmVudC50ZXh0KSB0aGlzLmFwcGVuZE1lc3NhZ2UoXCJhZ2VudFwiLCBldmVudC50ZXh0KTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwiY2xpZW50X3Rvb2xfY2FsbFwiOiB7XG4gICAgICAgICAgLy8gRTMgXHUwMEE3NC4xLjc6IHRoZSBhZ2VudCBhc2tlZCB0aGUgcGFnZTsgcnVuIHRoZSBoYW5kbGVyIGFuZCBwb3N0XG4gICAgICAgICAgLy8gdGhlIGFuc3dlciB3aGlsZSB0aGUgdHVybiBzdHJlYW0gc3RheXMgb3Blbi5cbiAgICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSB0aGlzLmNoYXRTZXNzaW9uSWQ7XG4gICAgICAgICAgY29uc3QgYXBpID0gdGhpcy5hcGk7XG4gICAgICAgICAgaWYgKHR5cGVvZiBldmVudC50b29sX2NhbGxfaWQgPT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIGV2ZW50Lm5hbWUgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICAgIGNvbnN0IGNhbGw6IENsaWVudFRvb2xDYWxsID0ge1xuICAgICAgICAgICAgICB0b29sTmFtZTogZXZlbnQubmFtZSxcbiAgICAgICAgICAgICAgdG9vbENhbGxJZDogZXZlbnQudG9vbF9jYWxsX2lkLFxuICAgICAgICAgICAgICBwYXJhbWV0ZXJzOiBldmVudC5hcmdzID8/IHt9LFxuICAgICAgICAgICAgICBleHBlY3RzUmVzcG9uc2U6IGV2ZW50LmV4cGVjdHNfcmVzcG9uc2UgIT09IGZhbHNlLFxuICAgICAgICAgICAgICAuLi4odHlwZW9mIGV2ZW50LnRpbWVvdXRfc2VjcyA9PT0gXCJudW1iZXJcIlxuICAgICAgICAgICAgICAgID8geyByZXNwb25zZVRpbWVvdXRTZWNzOiBldmVudC50aW1lb3V0X3NlY3MgfVxuICAgICAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZvaWQgdGhpcy5oYW5kbGVDbGllbnRUb29sQ2FsbChjYWxsLCBhc3luYyAocmVzdWx0LCBpc0Vycm9yKSA9PiB7XG4gICAgICAgICAgICAgIGlmICghYXBpIHx8ICFzZXNzaW9uSWQpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgICAgYXdhaXQgYXBpLnBvc3RDaGF0VG9vbFJlc3VsdChzZXNzaW9uSWQsIGNhbGwudG9vbENhbGxJZCwgcmVzdWx0LCBpc0Vycm9yKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5hcHBlbmRBY3Rpb25JbmRpY2F0b3IoXCJ3b3JraW5nXCIsIGV2ZW50Lm5hbWUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJtY3BfdG9vbF9jYWxsXCI6IHtcbiAgICAgICAgICAvLyBFMyBcdTAwQTc0LjY6IGFuIEFzayBzZXJ2ZXIgLyB0b29sIFx1MjAxNCB0aGUgcGFnZSBhcHByb3ZlcyBvciBkZW5pZXNcbiAgICAgICAgICAvLyAoYGFwcHJvdmVNY3BUb29sYCksIHRoZSB0dXJuIHN0cmVhbSBzdGF5cyBvcGVuIG1lYW53aGlsZS5cbiAgICAgICAgICBjb25zdCBtY3BDYWxsID0gbWNwVG9vbENhbGxGcm9tUmVjb3JkKGV2ZW50IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KTtcbiAgICAgICAgICBpZiAobWNwQ2FsbCkge1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVNY3BUb29sQ2FsbChtY3BDYWxsKTtcbiAgICAgICAgICAgIGlmIChtY3BDYWxsLnN0YXRlID09PSBcImF3YWl0aW5nX2FwcHJvdmFsXCIpIHtcbiAgICAgICAgICAgICAgdGhpcy5hcHBlbmRBY3Rpb25JbmRpY2F0b3IoXCJ3b3JraW5nXCIsIG1jcENhbGwudG9vbE5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjYXNlIFwidG9vbF9jYWxsZWRcIjpcbiAgICAgICAgICAvLyBEbyBOT1QgY2xvc2UgdGhlIHN0cmVhbWluZyBidWJibGU6IHByb3ZpZGVycyBpbnRlcmxlYXZlIHRvb2xcbiAgICAgICAgICAvLyBjYWxscyB3aXRoIHRleHQgaW5zaWRlIG9uZSB0dXJuLCBhbmQgY2xvc2luZyBoZXJlIHNwbGl0IHRoZVxuICAgICAgICAgIC8vIHRhaWwgb2YgYSBzZW50ZW5jZSBpbnRvIGl0cyBvd24gYnViYmxlLiBUaGUgZGFzaGJvYXJkIGNoYXRcbiAgICAgICAgICAvLyBnbHVlcyB0cmFpbGluZyB0ZXh0IGZvciB0aGUgc2FtZSByZWFzb24gXHUyMDE0IGJ1YmJsZXMgZW5kIG9ubHkgYXRcbiAgICAgICAgICAvLyB0dXJuIGJvdW5kYXJpZXMgKHR1cm5fY29tcGxldGUgLyBlbmRlZCAvIGVycm9yKSBvciB3aGVuIGFcbiAgICAgICAgICAvLyBzY3JpcHRlZCBhc3Npc3RhbnRfbWVzc2FnZSBzdGFydHMgYSBkZWxpYmVyYXRlIG5ldyBidWJibGUuXG4gICAgICAgICAgdGhpcy5hcHBlbmRBY3Rpb25JbmRpY2F0b3IoXCJkb25lXCIsIGV2ZW50Lm5hbWUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwidHVybl9jb21wbGV0ZVwiOlxuICAgICAgICAgIHRoaXMuZmluaXNoU3RyZWFtQnViYmxlKCk7XG4gICAgICAgICAgdGhpcy5zZXRUeXBpbmcoZmFsc2UpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFwiZW5kZWRcIjoge1xuICAgICAgICAgIHRoaXMuZmluaXNoU3RyZWFtQnViYmxlKCk7XG4gICAgICAgICAgdGhpcy5zZXRUeXBpbmcoZmFsc2UpO1xuICAgICAgICAgIHRoaXMubW9kZSA9IFwiaWRsZVwiO1xuICAgICAgICAgIGNvbnN0IGNvbnZlcnNhdGlvbklkID0gdGhpcy5jaGF0Q29udmVyc2F0aW9uSWQ7XG4gICAgICAgICAgdGhpcy5lbmRlZCA9IHsgYnk6IFwiYWdlbnRcIiwgY29udmVyc2F0aW9uSWQgfTtcbiAgICAgICAgICBjb25zdCBzZXNzaW9uSWQgPSB0aGlzLmNoYXRTZXNzaW9uSWQ7XG4gICAgICAgICAgdGhpcy5jaGF0U2Vzc2lvbklkID0gbnVsbDtcbiAgICAgICAgICBpZiAoc2Vzc2lvbklkICYmIHRoaXMuYXBpKSB2b2lkIHRoaXMuYXBpLmNsb3NlQ2hhdChzZXNzaW9uSWQpO1xuICAgICAgICAgIHRoaXMuYXBwZW5kTWVzc2FnZShcInN5c3RlbVwiLCB0aGlzLnRleHQoXCJhZ2VudF9lbmRlZF9jb252ZXJzYXRpb25cIikpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hyb21lKCk7XG4gICAgICAgICAgLy8gU2FtZSBlbmQtb2YtY29udmVyc2F0aW9uIGZlZWRiYWNrIGZsb3cgYXMgdm9pY2UuXG4gICAgICAgICAgaWYgKHRoaXMuY2ZnLmZlZWRiYWNrX2VuYWJsZWQgJiYgY29udmVyc2F0aW9uSWQpIHtcbiAgICAgICAgICAgIHRoaXMuc2hvd0ZlZWRiYWNrT3ZlcmxheShjb252ZXJzYXRpb25JZCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJlcnJvclwiOlxuICAgICAgICAgIC8vIFRoZSBmcmFtZSdzIGBtZXNzYWdlYCBpcyBkZXZlbG9wZXIgdGV4dCAoc3RhdHVzIGxpbmUgK1xuICAgICAgICAgIC8vIHByb3ZpZGVyIGNvZGUpOyB0aGUgdmlzaXRvciBnZXRzIHRoZSBsb2NhbGl6ZWQgbGluZS5cbiAgICAgICAgICB0aGlzLmZpbmlzaFN0cmVhbUJ1YmJsZSgpO1xuICAgICAgICAgIHRoaXMuc2V0VHlwaW5nKGZhbHNlKTtcbiAgICAgICAgICB0aGlzLmFwcGVuZEFjdGlvbkluZGljYXRvck9uRXJyb3IoZXZlbnQubWVzc2FnZSwgZXZlbnQuY29kZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFR1cm4gZmluaXNoZWQgc3RyZWFtaW5nOyByZS1yZW5kZXIgdGhlIHN0cmVhbWVkIHRleHQgaW4gdGhlIHNlc3Npb24ncyBmb3JtYXQuXG4gICAgdGhpcy5maW5pc2hTdHJlYW1CdWJibGUoKTtcbiAgICB0aGlzLnNldFR5cGluZyhmYWxzZSk7XG4gIH1cblxuICAvKiogVGV4dCBzZW50IHRvIGEgcGVyc29uIChWT1NPLTc1NCBEMjEpOiBldmVyeSBmYWlsdXJlIHRoZSB2aXNpdG9yIHNlZXMgaXNcbiAgICogIHRoZSBjb25maWd1cmVkLCBwZXItbGFuZ3VhZ2UgYGVycm9yX29jY3VycmVkYCBsaW5lIChvciB0aGUgZ2l2ZW4gdGV4dFxuICAgKiAga2V5KSBcdTIwMTQgbmV2ZXIgYSBzZXJ2ZXIgYm9keSwgYW4gU1NFIGBlcnJvci5tZXNzYWdlYCBvciBhbiBleGNlcHRpb25cbiAgICogIHRleHQuIFRoZSByYXcgZGV0YWlsIGdvZXMgdG8gdGhlIGNvbnNvbGUgZm9yIHRoZSBlbWJlZGRpbmcgZGV2ZWxvcGVyLiAqL1xuICBwcml2YXRlIHNob3dFcnJvcihkZXRhaWw6IHVua25vd24sIGtleTogV2lkZ2V0VGV4dEtleSA9IFwiZXJyb3Jfb2NjdXJyZWRcIik6IHZvaWQge1xuICAgIGlmIChkZXRhaWwgIT09IHVuZGVmaW5lZCAmJiBkZXRhaWwgIT09IG51bGwgJiYgZGV0YWlsICE9PSBcIlwiKSB7XG4gICAgICBjb25zb2xlLmRlYnVnKFwiW3Zvc28td2lkZ2V0XSBlcnJvclwiLCBkZXRhaWwpO1xuICAgIH1cbiAgICB0aGlzLmFwcGVuZE1lc3NhZ2UoXCJlcnJvclwiLCB0aGlzLnRleHQoa2V5KSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGVuZEFjdGlvbkluZGljYXRvck9uRXJyb3IobWVzc2FnZT86IHN0cmluZywgY29kZT86IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuc2hvd0Vycm9yKGNvZGUgPyBgJHtjb2RlfTogJHttZXNzYWdlID8/IFwiXCJ9YCA6IG1lc3NhZ2UpO1xuICB9XG5cbiAgLyoqIFJlcGxhY2UgdGhlIHJhdyBzdHJlYW1lZCB0ZXh0IHdpdGggdGhlIHNlc3Npb24tZm9ybWF0IHJlbmRlclxuICAgKiAgKG1hcmtkb3duLCBvciBsaXRlcmFsIHRleHQgb24gYSBwbGFpbl90ZXh0IHNlc3Npb24pLiAqL1xuICBwcml2YXRlIGZpbmlzaFN0cmVhbUJ1YmJsZSgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuc3RyZWFtRWwpIHJldHVybjtcbiAgICBjb25zdCB0ZXh0ID0gdGhpcy5zdHJlYW1UZXh0O1xuICAgIGNvbnN0IGJ1YmJsZSA9IHRoaXMuc3RyZWFtRWw7XG4gICAgdGhpcy5zdHJlYW1FbCA9IG51bGw7XG4gICAgdGhpcy5zdHJlYW1UZXh0ID0gXCJcIjtcbiAgICBidWJibGUudGV4dENvbnRlbnQgPSBcIlwiO1xuICAgIGxldCBkaXNwbGF5ID0gdGV4dDtcbiAgICBpZiAodGhpcy5jZmcuaGlkZV9hdWRpb190YWdzKSBkaXNwbGF5ID0gc3RyaXBBdWRpb1RhZ3MoZGlzcGxheSk7XG4gICAgcmVuZGVyQWdlbnRUZXh0KGJ1YmJsZSwgZGlzcGxheSwgdGhpcy5jaGF0T3V0cHV0Rm9ybWF0LCAodCkgPT4gdGhpcy5tYXJrZG93bk5vZGUodCkpO1xuICAgIHRoaXMuc2Nyb2xsVG9Cb3R0b20oKTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBtb2RlIHN3aXRjaGluZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIHRvZ2dsZU1vZGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubW9kZSA9PT0gXCJ2b2ljZVwiKSB7XG4gICAgICBhd2FpdCB0aGlzLmVuZENhbGwoXCJ1c2VyXCIpO1xuICAgICAgdGhpcy5hcHBlbmRNZXNzYWdlKFwic3lzdGVtXCIsIHRoaXMudGV4dChcInN3aXRjaGVkX3RvX3RleHRfbW9kZVwiKSk7XG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0Q2hhdCgpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5tb2RlID09PSBcImNoYXRcIikge1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gdGhpcy5jaGF0U2Vzc2lvbklkO1xuICAgICAgdGhpcy5jaGF0U2Vzc2lvbklkID0gbnVsbDtcbiAgICAgIGlmIChzZXNzaW9uSWQgJiYgdGhpcy5hcGkpIHZvaWQgdGhpcy5hcGkuY2xvc2VDaGF0KHNlc3Npb25JZCk7XG4gICAgICB0aGlzLm1vZGUgPSBcImlkbGVcIjtcbiAgICAgIHRoaXMuYXBwZW5kTWVzc2FnZShcInN5c3RlbVwiLCB0aGlzLnRleHQoXCJzd2l0Y2hlZF90b192b2ljZV9tb2RlXCIpKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRDYWxsKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB0ZWFyZG93blNlc3Npb25zKGVuZGVkQnk6IFwidXNlclwiIHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnZvaWNlKSB7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLnZvaWNlO1xuICAgICAgdGhpcy52b2ljZSA9IG51bGw7XG4gICAgICBhd2FpdCBjbGllbnQuZGlzY29ubmVjdCgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5jaGF0U2Vzc2lvbklkICYmIHRoaXMuYXBpKSB7XG4gICAgICB2b2lkIHRoaXMuYXBpLmNsb3NlQ2hhdCh0aGlzLmNoYXRTZXNzaW9uSWQpO1xuICAgICAgdGhpcy5jaGF0U2Vzc2lvbklkID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKGVuZGVkQnkgJiYgdGhpcy5tb2RlICE9PSBcImlkbGVcIikge1xuICAgICAgdGhpcy5tb2RlID0gXCJpZGxlXCI7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIGZlZWRiYWNrIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgc2hvd0ZlZWRiYWNrT3ZlcmxheShjb252ZXJzYXRpb25JZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSBcInZ3LW92ZXJsYXlcIjtcbiAgICBjb25zdCBjYXJkID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICBjYXJkLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1jYXJkXCI7XG4gICAgb3ZlcmxheS5hcHBlbmQoY2FyZCk7XG4gICAgdGhpcy5vdmVybGF5SG9zdC5hcHBlbmQob3ZlcmxheSk7XG5cbiAgICBsZXQgcmF0aW5nID0gMDtcblxuICAgIGNvbnN0IHJlbmRlclJhdGUgPSAoKSA9PiB7XG4gICAgICBjYXJkLnRleHRDb250ZW50ID0gXCJcIjtcbiAgICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHRpdGxlLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS10aXRsZVwiO1xuICAgICAgdGl0bGUudGV4dENvbnRlbnQgPSB0aGlzLnRleHQoXCJpbml0aWF0ZV9mZWVkYmFja1wiKTtcbiAgICAgIGNvbnN0IHN0YXJzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHN0YXJzLmNsYXNzTmFtZSA9IFwidnctc3RhcnNcIjtcbiAgICAgIGZvciAobGV0IGkgPSAxOyBpIDw9IDU7IGkgKz0gMSkge1xuICAgICAgICBjb25zdCBzdGFyID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgICAgc3Rhci5jbGFzc05hbWUgPSBcInZ3LXN0YXJcIjtcbiAgICAgICAgc3Rhci5pbm5lckhUTUwgPSBJQ09OUy5zdGFyO1xuICAgICAgICBzdGFyLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgYCR7aX1gKTtcbiAgICAgICAgaWYgKGkgPD0gcmF0aW5nKSBzdGFyLnNldEF0dHJpYnV0ZShcImRhdGEtb25cIiwgXCJcIik7XG4gICAgICAgIHN0YXIuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgICByYXRpbmcgPSBpO1xuICAgICAgICAgIHZvaWQgdGhpcy5hcGk/LnN1Ym1pdEZlZWRiYWNrKGNvbnZlcnNhdGlvbklkLCByYXRpbmcsIG51bGwpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgICAgICAgcmVuZGVyQ29tbWVudCgpO1xuICAgICAgICB9KTtcbiAgICAgICAgc3RhcnMuYXBwZW5kKHN0YXIpO1xuICAgICAgfVxuICAgICAgY29uc3QgYWN0aW9ucyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBhY3Rpb25zLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1hY3Rpb25zXCI7XG4gICAgICBjb25zdCBza2lwID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIHNraXAuY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgICBza2lwLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwiZGlzbWlzc190ZXJtc1wiKTtcbiAgICAgIHNraXAuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG92ZXJsYXkucmVtb3ZlKCkpO1xuICAgICAgYWN0aW9ucy5hcHBlbmQoc2tpcCk7XG4gICAgICBjYXJkLmFwcGVuZCh0aXRsZSwgc3RhcnMsIGFjdGlvbnMpO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5kZXJDb21tZW50ID0gKCkgPT4ge1xuICAgICAgY2FyZC50ZXh0Q29udGVudCA9IFwiXCI7XG4gICAgICBjb25zdCB0aXRsZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICB0aXRsZS5jbGFzc05hbWUgPSBcInZ3LW92ZXJsYXktdGl0bGVcIjtcbiAgICAgIHRpdGxlLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwicmVxdWVzdF9mb2xsb3dfdXBfZmVlZGJhY2tcIik7XG4gICAgICBjb25zdCB0ZXh0YXJlYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJ0ZXh0YXJlYVwiKTtcbiAgICAgIHRleHRhcmVhLmNsYXNzTmFtZSA9IFwidnctdGV4dGFyZWFcIjtcbiAgICAgIHRleHRhcmVhLnBsYWNlaG9sZGVyID0gdGhpcy50ZXh0KFwiZm9sbG93X3VwX2ZlZWRiYWNrX3BsYWNlaG9sZGVyXCIpO1xuICAgICAgY29uc3QgYWN0aW9ucyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBhY3Rpb25zLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1hY3Rpb25zXCI7XG4gICAgICBjb25zdCBiYWNrID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIGJhY2suY2xhc3NOYW1lID0gXCJ2dy1jYWxsYnRuXCI7XG4gICAgICBiYWNrLnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwiZ29fYmFja1wiKTtcbiAgICAgIGJhY2suYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHJlbmRlclJhdGUpO1xuICAgICAgY29uc3Qgc3VibWl0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImJ1dHRvblwiKTtcbiAgICAgIHN1Ym1pdC5jbGFzc05hbWUgPSBcInZ3LWNhbGxidG5cIjtcbiAgICAgIHN1Ym1pdC5zZXRBdHRyaWJ1dGUoXCJkYXRhLWFjY2VudFwiLCBcIlwiKTtcbiAgICAgIHN1Ym1pdC50ZXh0Q29udGVudCA9IHRoaXMudGV4dChcInN1Ym1pdFwiKTtcbiAgICAgIHN1Ym1pdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB2b2lkIHRoaXMuYXBpXG4gICAgICAgICAgPy5zdWJtaXRGZWVkYmFjayhjb252ZXJzYXRpb25JZCwgcmF0aW5nLCB0ZXh0YXJlYS52YWx1ZS50cmltKCkgfHwgbnVsbClcbiAgICAgICAgICAuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgICAgICAgcmVuZGVyVGhhbmtzKCk7XG4gICAgICB9KTtcbiAgICAgIGFjdGlvbnMuYXBwZW5kKGJhY2ssIHN1Ym1pdCk7XG4gICAgICBjYXJkLmFwcGVuZCh0aXRsZSwgdGV4dGFyZWEsIGFjdGlvbnMpO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5kZXJUaGFua3MgPSAoKSA9PiB7XG4gICAgICBjYXJkLnRleHRDb250ZW50ID0gXCJcIjtcbiAgICAgIGNvbnN0IHRpdGxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgIHRpdGxlLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS10aXRsZVwiO1xuICAgICAgdGl0bGUudGV4dENvbnRlbnQgPSB0aGlzLnRleHQoXCJ0aGFua3NfZm9yX2ZlZWRiYWNrXCIpO1xuICAgICAgY29uc3QgYm9keSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBib2R5LmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1ib2R5XCI7XG4gICAgICBib2R5LnRleHRDb250ZW50ID0gdGhpcy50ZXh0KFwidGhhbmtzX2Zvcl9mZWVkYmFja19kZXRhaWxzXCIpO1xuICAgICAgY29uc3QgYWN0aW9ucyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICBhY3Rpb25zLmNsYXNzTmFtZSA9IFwidnctb3ZlcmxheS1hY3Rpb25zXCI7XG4gICAgICBjb25zdCBjbG9zZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIik7XG4gICAgICBjbG9zZS5jbGFzc05hbWUgPSBcInZ3LWNhbGxidG5cIjtcbiAgICAgIGNsb3NlLnNldEF0dHJpYnV0ZShcImRhdGEtYWNjZW50XCIsIFwiXCIpO1xuICAgICAgY2xvc2UudGV4dENvbnRlbnQgPSB0aGlzLnRleHQoXCJnb19iYWNrXCIpO1xuICAgICAgY2xvc2UuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG92ZXJsYXkucmVtb3ZlKCkpO1xuICAgICAgYWN0aW9ucy5hcHBlbmQoY2xvc2UpO1xuICAgICAgY2FyZC5hcHBlbmQodGl0bGUsIGJvZHksIGFjdGlvbnMpO1xuICAgIH07XG5cbiAgICByZW5kZXJSYXRlKCk7XG4gIH1cbn1cblxuZGVjbGFyZSBjb25zdCBfX1ZPU09fV0lER0VUX0RFRkFVTFRfT1JJR0lOX186IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuLyoqIFRoZSBucG0gLyBDRE4gYnVuZGxlJ3MgYnVpbGQtdGltZSBBUEkgb3JpZ2luOyBgbnVsbGAgaW4gdGhlIHNhbWUtaG9zdCBidW5kbGUuICovXG5jb25zdCBCVUlMRF9ERUZBVUxUX09SSUdJTjogc3RyaW5nIHwgbnVsbCA9XG4gIHR5cGVvZiBfX1ZPU09fV0lER0VUX0RFRkFVTFRfT1JJR0lOX18gPT09IFwic3RyaW5nXCIgPyBfX1ZPU09fV0lER0VUX0RFRkFVTFRfT1JJR0lOX18gOiBudWxsO1xuXG4vKiogT3JpZ2luIHRoZSBlbWJlZCBzY3JpcHQgd2FzIGxvYWRlZCBmcm9tLCBjYXB0dXJlZCBhdCBtb2R1bGUtZXZhbCB0aW1lXG4gKiAgKGRvY3VtZW50LmN1cnJlbnRTY3JpcHQgaXMgbnVsbCBsYXRlcikuICovXG5jb25zdCBTQ1JJUFRfT1JJR0lOOiBzdHJpbmcgfCBudWxsID0gKCgpID0+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBzcmMgPSAoZG9jdW1lbnQuY3VycmVudFNjcmlwdCBhcyBIVE1MU2NyaXB0RWxlbWVudCB8IG51bGwpPy5zcmM7XG4gICAgcmV0dXJuIHNyYyA/IG5ldyBVUkwoc3JjKS5vcmlnaW4gOiBudWxsO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufSkoKTtcbiIsICIvLyBFbnRyeSBwb2ludDogcmVnaXN0ZXIgdGhlIHdpZGdldCBlbGVtZW50IHVuZGVyIGJvdGggbmFtZXMgZXhhY3RseSBvbmNlLlxuLy9cbi8vIEVtYmVkIHNuaXBwZXQgKEhPU1QgPSB5b3VyIHZvc29wdWxzZS1hcGkgb3JpZ2luKTpcbi8vXG4vLyAgIDx2b3NvLXdpZGdldCBhZ2VudC1pZD1cIkFHRU5UX1BVQkxJQ19JRFwiPjwvdm9zby13aWRnZXQ+XG4vLyAgIDxzY3JpcHQgc3JjPVwiaHR0cHM6Ly9IT1NUL3dpZGdldC5qc1wiIGFzeW5jIHR5cGU9XCJ0ZXh0L2phdmFzY3JpcHRcIj48L3NjcmlwdD5cbi8vXG4vLyBgPGNvbnZvc28td2lkZ2V0PmAgaXMgdGhlIHNhbWUgZWxlbWVudCB1bmRlciB0aGUgbmV3IG5hbWUgKEU0IFE3KS4gVGhlXG4vLyBzYW1lLWhvc3QgYnVuZGxlIChkaXN0L3dpZGdldC5qcykgZGVyaXZlcyBpdHMgQVBJIG9yaWdpbiBmcm9tIHRoZSBzY3JpcHQnc1xuLy8gb3duIHNyYzsgdGhlIG5wbSAvIENETiBidW5kbGUgKGRpc3QvaW5kZXguanMsIEU0IFE4KSBkZWZhdWx0cyB0byB0aGVcbi8vIHByb2R1Y3Rpb24gQVBJLiBUaGUgZGFzaGJvYXJkJ3Mgc2V0dGluZ3MgbGl2ZSBwcmV2aWV3IGltcG9ydHMgdGhpcyBtb2R1bGVcbi8vIGRpcmVjdGx5IGFuZCBvdmVycmlkZXMgdGhlIG9yaWdpbiB2aWEgdGhlIGVsZW1lbnQncyBgc2VydmVyLXVybGAgYXR0cmlidXRlLlxuXG5pbXBvcnQgeyBWb3NvV2lkZ2V0RWxlbWVudCB9IGZyb20gXCIuL3dpZGdldFwiO1xuXG5leHBvcnQgeyBWb3NvV2lkZ2V0RWxlbWVudCB9O1xuZXhwb3J0IHR5cGUgeyBXaWRnZXRDYWxsQ29uZmlnIH0gZnJvbSBcIi4vd2lkZ2V0XCI7XG5cbi8qKiBUaGUgdGFncyB0aGUgYnVuZGxlIHJlZ2lzdGVycyBvbiBsb2FkIChFNCBRNykuICovXG5leHBvcnQgY29uc3QgV0lER0VUX1RBR1MgPSBbXCJ2b3NvLXdpZGdldFwiLCBcImNvbnZvc28td2lkZ2V0XCJdIGFzIGNvbnN0O1xuXG4vKipcbiAqIFJlZ2lzdGVyIHRoZSBlbGVtZW50IHVuZGVyIGB0YWdOYW1lYCAodGhlIHZlbmRvcidzIGByZWdpc3RlcldpZGdldGApLiBBXG4gKiBjdXN0b20tZWxlbWVudCBjb25zdHJ1Y3RvciBiYWNrcyBleGFjdGx5IG9uZSB0YWcsIHNvIGV2ZXJ5IHRhZyBhZnRlclxuICogYHZvc28td2lkZ2V0YCBnZXRzIGFuIEVNUFRZIHN1YmNsYXNzIFx1MjAxNCB0aGUgc2FtZSBlbGVtZW50LCBkcmlmdC10ZXN0ZWQuXG4gKiBBbHJlYWR5LXJlZ2lzdGVyZWQgdGFncyBhcmUgbGVmdCBhbG9uZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyV2lkZ2V0KHRhZ05hbWU6IHN0cmluZyA9IFwidm9zby13aWRnZXRcIik6IHZvaWQge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gXCJ1bmRlZmluZWRcIiB8fCAhKFwiY3VzdG9tRWxlbWVudHNcIiBpbiB3aW5kb3cpKSByZXR1cm47XG4gIGlmIChjdXN0b21FbGVtZW50cy5nZXQodGFnTmFtZSkpIHJldHVybjtcbiAgY3VzdG9tRWxlbWVudHMuZGVmaW5lKFxuICAgIHRhZ05hbWUsXG4gICAgdGFnTmFtZSA9PT0gXCJ2b3NvLXdpZGdldFwiID8gVm9zb1dpZGdldEVsZW1lbnQgOiBjbGFzcyBleHRlbmRzIFZvc29XaWRnZXRFbGVtZW50IHt9LFxuICApO1xufVxuXG5mb3IgKGNvbnN0IHRhZyBvZiBXSURHRVRfVEFHUykgcmVnaXN0ZXJXaWRnZXQodGFnKTtcbiIsICJpbXBvcnQgdGVzdCBmcm9tIFwibm9kZTp0ZXN0XCI7XG5pbXBvcnQgYXNzZXJ0IGZyb20gXCJub2RlOmFzc2VydC9zdHJpY3RcIjtcblxuLy8gRTQgUTcgXHUyMDE0IHRoZSBidW5kbGUgcmVnaXN0ZXJzIDx2b3NvLXdpZGdldD4gQU5EIDxjb252b3NvLXdpZGdldD4sIHRoZSBzYW1lXG4vLyBlbGVtZW50IChhbiBlbXB0eSBzdWJjbGFzczogYSBjb25zdHJ1Y3RvciBiYWNrcyBvbmUgdGFnIG9ubHkpLiBEcmlmdCB0ZXN0OlxuLy8gdGhlIGFsaWFzIGFkZHMgbm90aGluZyBvZiBpdHMgb3duLCBzbyBib3RoIHRhZ3MgcmVuZGVyIGlkZW50aWNhbGx5LlxuLy8gQSBtaW5pbWFsIERPTSBzdGFuZC1pbiBpcyBpbnN0YWxsZWQgQkVGT1JFIHRoZSBtb2R1bGUgZXZhbHVhdGVzLlxuXG5jb25zdCBkZWZpbmVkID0gbmV3IE1hcDxzdHJpbmcsIEN1c3RvbUVsZW1lbnRDb25zdHJ1Y3Rvcj4oKTtcblxuLyoqIEp1c3QgZW5vdWdoIG9mIGFuIGVsZW1lbnQgZm9yIHRoZSBjb25zdHJ1Y3RvciBhbmQgdGhlIGV2ZW50IHBhdGhzLiAqL1xuY2xhc3MgRmFrZUVsZW1lbnQge1xuICByZWFkb25seSBhdHRycyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHJlYWRvbmx5IGxpc3RlbmVycyA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTwoZXZlbnQ6IHVua25vd24pID0+IHZvaWQ+PigpO1xuICBhdHRhY2hTaGFkb3coKSB7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGdldEF0dHJpYnV0ZShuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5hdHRycy5nZXQobmFtZSkgPz8gbnVsbDtcbiAgfVxuICBzZXRBdHRyaWJ1dGUobmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgdGhpcy5hdHRycy5zZXQobmFtZSwgdmFsdWUpO1xuICB9XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogc3RyaW5nLCBmbjogKGV2ZW50OiB1bmtub3duKSA9PiB2b2lkKSB7XG4gICAgdGhpcy5saXN0ZW5lcnMuc2V0KHR5cGUsIFsuLi4odGhpcy5saXN0ZW5lcnMuZ2V0KHR5cGUpID8/IFtdKSwgZm5dKTtcbiAgfVxuICBkaXNwYXRjaEV2ZW50KGV2ZW50OiB7IHR5cGU6IHN0cmluZyB9KSB7XG4gICAgZm9yIChjb25zdCBmbiBvZiB0aGlzLmxpc3RlbmVycy5nZXQoZXZlbnQudHlwZSkgPz8gW10pIGZuKGV2ZW50KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG5jbGFzcyBGYWtlQ3VzdG9tRXZlbnQge1xuICBjb25zdHJ1Y3RvcihcbiAgICByZWFkb25seSB0eXBlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgaW5pdDogeyBidWJibGVzPzogYm9vbGVhbjsgY29tcG9zZWQ/OiBib29sZWFuOyBkZXRhaWw/OiB1bmtub3duIH0sXG4gICkge31cbiAgZ2V0IGRldGFpbCgpIHtcbiAgICByZXR1cm4gdGhpcy5pbml0LmRldGFpbDtcbiAgfVxufVxuXG5PYmplY3QuYXNzaWduKGdsb2JhbFRoaXMsIHtcbiAgSFRNTEVsZW1lbnQ6IEZha2VFbGVtZW50LFxuICBDdXN0b21FdmVudDogRmFrZUN1c3RvbUV2ZW50LFxuICB3aW5kb3c6IGdsb2JhbFRoaXMsXG4gIGN1c3RvbUVsZW1lbnRzOiB7XG4gICAgZ2V0OiAobmFtZTogc3RyaW5nKSA9PiBkZWZpbmVkLmdldChuYW1lKSxcbiAgICBkZWZpbmU6IChuYW1lOiBzdHJpbmcsIGN0b3I6IEN1c3RvbUVsZW1lbnRDb25zdHJ1Y3RvcikgPT4ge1xuICAgICAgaWYgKGRlZmluZWQuaGFzKG5hbWUpKSB0aHJvdyBuZXcgRXJyb3IoYCR7bmFtZX0gYWxyZWFkeSBkZWZpbmVkYCk7XG4gICAgICBkZWZpbmVkLnNldChuYW1lLCBjdG9yKTtcbiAgICB9LFxuICB9LFxufSk7XG5cbnRlc3QoXCJ3aWRnZXQgcmVnaXN0ZXJzIHZvc28td2lkZ2V0IGFuZCB0aGUgY29udm9zby13aWRnZXQgYWxpYXMgb24gbG9hZFwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IG1vZCA9IGF3YWl0IGltcG9ydChcIi4uL3NyYy9pbmRleFwiKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChbLi4uZGVmaW5lZC5rZXlzKCldLCBbXCJ2b3NvLXdpZGdldFwiLCBcImNvbnZvc28td2lkZ2V0XCJdKTtcbiAgYXNzZXJ0LmVxdWFsKGRlZmluZWQuZ2V0KFwidm9zby13aWRnZXRcIiksIG1vZC5Wb3NvV2lkZ2V0RWxlbWVudCk7XG4gIGNvbnN0IGFsaWFzID0gZGVmaW5lZC5nZXQoXCJjb252b3NvLXdpZGdldFwiKSE7XG4gIGFzc2VydC5lcXVhbChPYmplY3QuZ2V0UHJvdG90eXBlT2YoYWxpYXMpLCBtb2QuVm9zb1dpZGdldEVsZW1lbnQsIFwidGhlIGFsaWFzIGV4dGVuZHMgdGhlIGVsZW1lbnRcIik7XG4gIGFzc2VydC5kZWVwRXF1YWwoT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoYWxpYXMucHJvdG90eXBlKSwgW1wiY29uc3RydWN0b3JcIl0sIFwidGhlIGFsaWFzIGFkZHMgbm8gYmVoYXZpb3VyXCIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFxuICAgIChhbGlhcyBhcyB1bmtub3duIGFzIHsgb2JzZXJ2ZWRBdHRyaWJ1dGVzOiBzdHJpbmdbXSB9KS5vYnNlcnZlZEF0dHJpYnV0ZXMsXG4gICAgbW9kLlZvc29XaWRnZXRFbGVtZW50Lm9ic2VydmVkQXR0cmlidXRlcyxcbiAgKTtcbn0pO1xuXG50ZXN0KFwicmVnaXN0ZXJXaWRnZXQodGFnTmFtZSkgYWRkcyBhIGN1c3RvbSB0YWcgb25jZTsgcmVwZWF0cyBhcmUgbm8tb3BzXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgeyByZWdpc3RlcldpZGdldCwgVm9zb1dpZGdldEVsZW1lbnQgfSA9IGF3YWl0IGltcG9ydChcIi4uL3NyYy9pbmRleFwiKTtcbiAgcmVnaXN0ZXJXaWRnZXQoXCJhY21lLWFnZW50XCIpO1xuICByZWdpc3RlcldpZGdldChcImFjbWUtYWdlbnRcIik7XG4gIHJlZ2lzdGVyV2lkZ2V0KFwidm9zby13aWRnZXRcIik7XG4gIGFzc2VydC5lcXVhbChPYmplY3QuZ2V0UHJvdG90eXBlT2YoZGVmaW5lZC5nZXQoXCJhY21lLWFnZW50XCIpISksIFZvc29XaWRnZXRFbGVtZW50KTtcbiAgYXNzZXJ0LmVxdWFsKGRlZmluZWQuc2l6ZSwgMyk7XG59KTtcblxudGVzdChcInRoZSBlbGVtZW50IG9ic2VydmVzIHRoZSBmb3VyIGRpc3BsYXkgYXR0cmlidXRlcyAoUTkpIGFuZCBrZWVwcyBhZ2VudC1pZCAvIGNvbmZpZy1qc29uXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgeyBWb3NvV2lkZ2V0RWxlbWVudCB9ID0gYXdhaXQgaW1wb3J0KFwiLi4vc3JjL2luZGV4XCIpO1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgW1xuICAgIFwiYWdlbnQtaWRcIixcbiAgICBcImNvbmZpZy1qc29uXCIsXG4gICAgXCJzaG93LWFnZW50LXN0YXR1c1wiLFxuICAgIFwic2hvdy1yZXNpemUtYnV0dG9uXCIsXG4gICAgXCJzaG93LWxhbmd1YWdlLXNlbGVjdG9yLW9uLXRyaWdnZXJcIixcbiAgICBcInNob3ctYXZhdGFyLXdoZW4tY29sbGFwc2VkXCIsXG4gIF0pIHtcbiAgICBhc3NlcnQub2soVm9zb1dpZGdldEVsZW1lbnQub2JzZXJ2ZWRBdHRyaWJ1dGVzLmluY2x1ZGVzKG5hbWUpLCBuYW1lKTtcbiAgfVxufSk7XG5cbnRlc3QoXCJ2b3NvLXdpZGdldDpjYWxsOiBkaXNwYXRjaGVkIChidWJibGluZywgY29tcG9zZWQpIHdpdGggdGhlIHN0YXJ0IGNvbmZpZzsgbGlzdGVuZXIgbXV0YXRpb25zIGFyZSB1c2VkXCIsIGFzeW5jICgpID0+IHtcbiAgY29uc3QgeyBWb3NvV2lkZ2V0RWxlbWVudCB9ID0gYXdhaXQgaW1wb3J0KFwiLi4vc3JjL2luZGV4XCIpO1xuICBjb25zdCBlbCA9IG5ldyBWb3NvV2lkZ2V0RWxlbWVudCgpIGFzIHVua25vd24gYXMgRmFrZUVsZW1lbnQgJiB7XG4gICAgY2xpZW50VG9vbHM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIGRpc3BhdGNoQ2FsbDogKHRleHRPbmx5OiBib29sZWFuKSA9PiB7XG4gICAgICBhZ2VudElkOiBzdHJpbmc7XG4gICAgICBvdmVycmlkZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbDtcbiAgICAgIGNsaWVudFRvb2xzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgICAgIHRleHRPbmx5OiBib29sZWFuO1xuICAgICAgdXNlcklkOiBzdHJpbmcgfCBudWxsO1xuICAgIH07XG4gIH07XG4gIGVsLnNldEF0dHJpYnV0ZShcImFnZW50LWlkXCIsIFwid2d0XzAxMjNcIik7XG4gIGVsLnNldEF0dHJpYnV0ZShcIm92ZXJyaWRlLWZpcnN0LW1lc3NhZ2VcIiwgXCJIaSBmcm9tIHRoZSBhdHRyaWJ1dGVcIik7XG4gIGVsLnNldEF0dHJpYnV0ZShcIm92ZXJyaWRlc1wiLCBKU09OLnN0cmluZ2lmeSh7IGZpcnN0X21lc3NhZ2U6IFwiSGkgZnJvbSBvdmVycmlkZXNcIiB9KSk7XG4gIGVsLnNldEF0dHJpYnV0ZShcInVzZXItaWRcIiwgXCJjcm0tNDJcIik7XG4gIGNvbnN0IHNlZW46IEZha2VDdXN0b21FdmVudFtdID0gW107XG4gIGNvbnN0IGxvb2t1cCA9ICgpID0+IFwiZm91bmRcIjtcbiAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcInZvc28td2lkZ2V0OmNhbGxcIiwgKGV2ZW50KSA9PiB7XG4gICAgY29uc3QgZSA9IGV2ZW50IGFzIEZha2VDdXN0b21FdmVudDtcbiAgICBzZWVuLnB1c2goZSk7XG4gICAgKGUuZGV0YWlsIGFzIHsgY29uZmlnOiB7IGNsaWVudFRvb2xzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB9IH0pLmNvbmZpZy5jbGllbnRUb29scyA9IHsgbG9va3VwIH07XG4gIH0pO1xuICBjb25zdCBjb25maWcgPSBlbC5kaXNwYXRjaENhbGwoZmFsc2UpO1xuICBhc3NlcnQuZXF1YWwoc2Vlbi5sZW5ndGgsIDEpO1xuICBhc3NlcnQuZGVlcEVxdWFsKFtzZWVuWzBdIS5pbml0LmJ1YmJsZXMsIHNlZW5bMF0hLmluaXQuY29tcG9zZWRdLCBbdHJ1ZSwgdHJ1ZV0pO1xuICBhc3NlcnQuZXF1YWwoY29uZmlnLmFnZW50SWQsIFwid2d0XzAxMjNcIik7XG4gIGFzc2VydC5lcXVhbChjb25maWcudGV4dE9ubHksIGZhbHNlKTtcbiAgYXNzZXJ0LmVxdWFsKGNvbmZpZy51c2VySWQsIFwiY3JtLTQyXCIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGNvbmZpZy5vdmVycmlkZXMsIHsgZmlyc3RfbWVzc2FnZTogXCJIaSBmcm9tIG92ZXJyaWRlc1wiIH0sIFwidGhlIGV4cGxpY2l0IG92ZXJyaWRlcyBvYmplY3Qgd2luc1wiKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChlbC5jbGllbnRUb29scywgeyBsb29rdXAgfSwgXCJ0aGUgaW5qZWN0ZWQgY2xpZW50IHRvb2xzIHNlcnZlIHRoZSBzZXNzaW9uXCIpO1xufSk7XG5cbnRlc3QoXCJhbGxvdy1ldmVudHM6IHRoZSBlbGVtZW50IGZvcndhcmRzIG5vdGhpbmcgdW50aWwgYWxsb3ctZXZlbnRzPVxcXCJ0cnVlXFxcIlwiLCBhc3luYyAoKSA9PiB7XG4gIGNvbnN0IHsgVm9zb1dpZGdldEVsZW1lbnQgfSA9IGF3YWl0IGltcG9ydChcIi4uL3NyYy9pbmRleFwiKTtcbiAgY29uc3QgZWwgPSBuZXcgVm9zb1dpZGdldEVsZW1lbnQoKSBhcyB1bmtub3duIGFzIEZha2VFbGVtZW50ICYgeyBvbkRlYnVnOiAoKGU6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkKSB8IG51bGwgfTtcbiAgY29uc3QgZGVidWc6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PiA9IFtdO1xuICBlbC5vbkRlYnVnID0gKGUpID0+IGRlYnVnLnB1c2goZSk7XG4gIGVsLmRpc3BhdGNoRXZlbnQobmV3IEZha2VDdXN0b21FdmVudChcInZvc28td2lkZ2V0OnVzZXItbWVzc2FnZVwiLCB7IGRldGFpbDogeyBtZXNzYWdlOiBcImhpXCIgfSB9KSBhcyBuZXZlcik7XG4gIGFzc2VydC5kZWVwRXF1YWwoZGVidWcsIFtdLCBcImlnbm9yZWQgc2lsZW50bHkgd2l0aG91dCB0aGUgYXR0cmlidXRlXCIpO1xuICBlbC5zZXRBdHRyaWJ1dGUoXCJhbGxvdy1ldmVudHNcIiwgXCJ0cnVlXCIpO1xuICBlbC5kaXNwYXRjaEV2ZW50KG5ldyBGYWtlQ3VzdG9tRXZlbnQoXCJ2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2VcIiwgeyBkZXRhaWw6IHsgbWVzc2FnZTogXCJoaVwiIH0gfSkgYXMgbmV2ZXIpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGRlYnVnLCBbeyB0eXBlOiBcIm5vX2xpdmVfc2Vzc2lvblwiLCBldmVudDogXCJ2b3NvLXdpZGdldDp1c2VyLW1lc3NhZ2VcIiB9XSwgXCJoZWFyZCwgbm8gc2Vzc2lvbiB0byB0YWtlIGl0XCIpO1xufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7OztBQTBGQSxlQUFlLGVBQWUsS0FBK0I7QUFDM0QsTUFBSSxTQUFTLElBQUksY0FBYyxRQUFRLElBQUksTUFBTTtBQUNqRCxNQUFJO0FBQ0YsVUFBTSxPQUFRLE1BQU0sSUFBSSxLQUFLO0FBSTdCLFFBQUksT0FBTyxLQUFLLFdBQVcsU0FBVSxVQUFTLEtBQUs7QUFBQSxhQUMxQyxNQUFNLFFBQVEsS0FBSyxNQUFNLEtBQUssS0FBSyxPQUFPLENBQUMsR0FBRyxJQUFLLFVBQVMsS0FBSyxPQUFPLENBQUMsRUFBRTtBQUFBLGFBQzNFLEtBQUssTUFBTyxVQUFTLEtBQUs7QUFBQSxFQUNyQyxRQUFRO0FBQUEsRUFFUjtBQUNBLFFBQU0sSUFB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Q0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLEtBQUs7QUFDMUMsU0FBTyxDQUFDLEVBQUUsQ0FBQyxJQUFJLEdBQUcsRUFBRSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDO0FBQ3RDO0FBS0EsU0FBUyxVQUFVLFFBQW1FO0FBQ3BGLFFBQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxDQUFDLEtBQUs7QUFDL0IsUUFBTSxRQUNKO0FBQUEsSUFDRSxDQUFDLElBQUksR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQztBQUFBLElBQzdDLENBQUMsR0FBRyxJQUFJLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztBQUFBLElBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQUEsSUFDN0MsQ0FBQyxHQUFHLEdBQUcsRUFBRTtBQUFBLElBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUFBLElBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFBRyxDQUFDLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxFQUMvQyxFQUNBLElBQUksU0FBUztBQUNmLE1BQUksUUFBeUM7QUFBQSxJQUMzQyxDQUFDLEdBQUcsSUFBSSxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFBRyxDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUEsSUFDeEQsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUFBLElBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQztBQUFBLElBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQztBQUFBLElBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQztBQUFBLElBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQztBQUFBLElBQ3hELENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUFHLENBQUMsR0FBRyxHQUFHLENBQUM7QUFBQSxJQUNwRCxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxFQUFFO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsSUFBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO0FBQUEsRUFDeEQ7QUFFQSxXQUFTLElBQUksR0FBRyxJQUFJLFFBQVEsS0FBSyxHQUFHO0FBQ2xDLFVBQU0sV0FBVyxvQkFBSSxJQUFvQjtBQUN6QyxVQUFNLFdBQVcsQ0FBQyxHQUFXLE1BQXNCO0FBQ2pELFlBQU0sTUFBTSxJQUFJLElBQUksSUFBSSxRQUFRLElBQUksSUFBSSxRQUFRO0FBQ2hELFlBQU0sTUFBTSxTQUFTLElBQUksR0FBRztBQUM1QixVQUFJLFFBQVEsT0FBVyxRQUFPO0FBQzlCLFlBQU0sS0FBSyxNQUFNLENBQUM7QUFDbEIsWUFBTSxLQUFLLE1BQU0sQ0FBQztBQUNsQixZQUFNLE1BQU0sTUFBTTtBQUNsQixZQUFNO0FBQUEsUUFDSixVQUFVLEVBQUUsR0FBRyxDQUFDLElBQUksR0FBRyxDQUFDLEtBQUssSUFBSSxHQUFHLENBQUMsSUFBSSxHQUFHLENBQUMsS0FBSyxJQUFJLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQzNFO0FBQ0EsZUFBUyxJQUFJLEtBQUssR0FBRztBQUNyQixhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU0sT0FBd0MsQ0FBQztBQUMvQyxlQUFXLENBQUMsR0FBRyxHQUFHLENBQUMsS0FBSyxPQUFPO0FBQzdCLFlBQU0sS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUN4QixZQUFNLEtBQUssU0FBUyxHQUFHLENBQUM7QUFDeEIsWUFBTSxLQUFLLFNBQVMsR0FBRyxDQUFDO0FBQ3hCLFdBQUssS0FBSyxDQUFDLEdBQUcsSUFBSSxFQUFFLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksSUFBSSxFQUFFLENBQUM7QUFBQSxJQUMvRDtBQUNBLFlBQVE7QUFBQSxFQUNWO0FBRUEsUUFBTSxVQUFVLG9CQUFJLElBQVk7QUFDaEMsUUFBTSxRQUFpQyxDQUFDO0FBQ3hDLFFBQU0sVUFBVSxDQUFDLEdBQVcsTUFBYztBQUN4QyxVQUFNLE1BQU0sSUFBSSxJQUFJLElBQUksUUFBUSxJQUFJLElBQUksUUFBUTtBQUNoRCxRQUFJLFFBQVEsSUFBSSxHQUFHLEVBQUc7QUFDdEIsWUFBUSxJQUFJLEdBQUc7QUFDZixVQUFNLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztBQUFBLEVBQ25CO0FBQ0EsYUFBVyxDQUFDLEdBQUcsR0FBRyxDQUFDLEtBQUssT0FBTztBQUM3QixZQUFRLEdBQUcsQ0FBQztBQUNaLFlBQVEsR0FBRyxDQUFDO0FBQ1osWUFBUSxHQUFHLENBQUM7QUFBQSxFQUNkO0FBQ0EsU0FBTyxFQUFFLE9BQU8sTUFBTTtBQUN4QjtBQUdPLFNBQVMsVUFDZCxNQUNBLFFBQ0EsUUFDVztBQUNYLFFBQU0sU0FBUyxTQUFTLGNBQWMsUUFBUTtBQUM5QyxRQUFNLE1BQU0sS0FBSyxJQUFJLE9BQU8sb0JBQW9CLEdBQUcsQ0FBQztBQUNwRCxTQUFPLFFBQVEsT0FBTztBQUN0QixTQUFPLFNBQVMsT0FBTztBQUN2QixTQUFPLE1BQU0sUUFBUSxHQUFHLElBQUk7QUFDNUIsU0FBTyxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBQzdCLFNBQU8sTUFBTSxVQUFVO0FBQ3ZCLFFBQU0sTUFBTSxPQUFPLFdBQVcsSUFBSTtBQUVsQyxNQUFJLFFBQWtCO0FBQ3RCLE1BQUksTUFBTTtBQUNWLE1BQUksVUFBVTtBQUVkLFFBQU0sT0FBUSxPQUFPLE1BQU87QUFJNUIsUUFBTSxhQUFhLE9BQU87QUFLMUIsUUFBTSxFQUFFLE9BQU8sTUFBTSxJQUFJLFVBQVUsUUFBUSxLQUFLLElBQUksQ0FBQztBQUNyRCxRQUFNLFlBQTZDLE1BQU0sSUFBSSxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUU1RSxXQUFTLFVBQVUsS0FBcUI7QUFFdEMsWUFBUSxPQUFPO0FBQUEsTUFDYixLQUFLO0FBQ0gsZUFBTyxPQUFPLEtBQUssSUFBSSxNQUFNLElBQUssSUFBSTtBQUFBLE1BQ3hDLEtBQUs7QUFDSCxlQUFPLE9BQU8sS0FBSyxJQUFJLE1BQU0sSUFBSyxJQUFJO0FBQUEsTUFDeEMsS0FBSztBQUNILGVBQU8sT0FBTyxLQUFLLElBQUksTUFBTSxJQUFLLElBQUk7QUFBQSxNQUN4QyxLQUFLO0FBQUEsTUFDTDtBQUNFLGVBQU8sT0FBTyxLQUFLLElBQUksTUFBTSxJQUFLLElBQUk7QUFBQSxJQUMxQztBQUFBLEVBQ0Y7QUFFQSxXQUFTLE9BQU8sS0FBYTtBQUMzQixRQUFJLENBQUMsV0FBVyxDQUFDLElBQUs7QUFDdEIsVUFBTSxNQUFNLFVBQVUsR0FBRztBQUV6QixVQUFNLE1BQU0sTUFBTTtBQUNsQixVQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUc7QUFDekIsVUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHO0FBQ3pCLFFBQUksVUFBVSxHQUFHLEdBQUcsT0FBTyxLQUFLLE9BQU8sR0FBRztBQUcxQyxVQUFNLE9BQU8sSUFBSSxxQkFBcUIsTUFBTSxNQUFNLEdBQUcsTUFBTSxNQUFNLElBQUk7QUFDckUsU0FBSyxhQUFhLEdBQUcsR0FBRyxNQUFNLElBQUk7QUFDbEMsU0FBSyxhQUFhLE1BQU0sR0FBRyxNQUFNLElBQUk7QUFDckMsU0FBSyxhQUFhLEdBQUcsR0FBRyxNQUFNLElBQUk7QUFDbEMsUUFBSSxZQUFZO0FBQ2hCLFFBQUksU0FBUyxHQUFHLEdBQUcsT0FBTyxLQUFLLE9BQU8sR0FBRztBQUd6QyxhQUFTLElBQUksR0FBRyxJQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEMsWUFBTSxDQUFDLEtBQUssSUFBSSxHQUFHLElBQUksTUFBTSxDQUFDO0FBQzlCLFlBQU0sSUFBSTtBQUFBLFFBQ1IsTUFBTSxNQUFNLE1BQU07QUFBQSxRQUNsQixLQUFLLE1BQU0sTUFBTTtBQUFBLFFBQ2pCLE1BQU0sTUFBTSxNQUFNO0FBQUEsTUFDcEI7QUFDQSxZQUFNLElBQUksSUFBSSxJQUFJLE1BQU0sTUFBTSxNQUFNO0FBQ3BDLFlBQU0sS0FBSyxNQUFNLE9BQU8sTUFBTTtBQUM5QixZQUFNLEtBQUssQ0FBQyxNQUFNLE9BQU8sTUFBTTtBQUUvQixZQUFNLFFBQVEsS0FBSyxNQUFNLE1BQU07QUFDL0IsZ0JBQVUsQ0FBQyxJQUFJO0FBQUEsUUFDYixPQUFPLEtBQUssSUFBSSxhQUFhO0FBQUEsUUFDN0IsT0FBTyxLQUFLLElBQUksYUFBYTtBQUFBLFFBQzdCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxRQUFJLFlBQVksS0FBSyxJQUFJLEtBQUssT0FBTyxNQUFNLElBQUs7QUFDaEQsUUFBSSxjQUFjO0FBQ2xCLFFBQUksY0FBYztBQUNsQixRQUFJLFVBQVU7QUFDZCxlQUFXLENBQUMsR0FBRyxDQUFDLEtBQUssT0FBTztBQUMxQixZQUFNLEtBQUssVUFBVSxDQUFDO0FBQ3RCLFlBQU0sS0FBSyxVQUFVLENBQUM7QUFHdEIsVUFBSSxHQUFHLENBQUMsSUFBSSxTQUFTLEdBQUcsQ0FBQyxJQUFJLE1BQU87QUFDcEMsVUFBSSxPQUFPLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLFVBQUksT0FBTyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsQ0FBQztBQUFBLElBQ3pCO0FBQ0EsUUFBSSxPQUFPO0FBQ1gsUUFBSSxjQUFjO0FBRWxCLFVBQU0sc0JBQXNCLE1BQU07QUFBQSxFQUNwQztBQUNBLFFBQU0sc0JBQXNCLE1BQU07QUFFbEMsU0FBTztBQUFBLElBQ0wsSUFBSTtBQUFBLElBQ0osU0FBUyxNQUFnQjtBQUN2QixjQUFRO0FBQUEsSUFDVjtBQUFBLElBQ0EsVUFBVTtBQUNSLGdCQUFVO0FBQ1YsMkJBQXFCLEdBQUc7QUFBQSxJQUMxQjtBQUFBLEVBQ0Y7QUFDRjtBQXhPQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUN5Qk8sU0FBUyxjQUFjLEtBQWEsUUFBK0I7QUFDeEUsUUFBTSxTQUFvQixDQUFDO0FBQzNCLFFBQU0sUUFBUSxJQUFJLFFBQVEsVUFBVSxJQUFJLEVBQUUsTUFBTSxJQUFJO0FBQ3BELE1BQUksSUFBSTtBQUVSLFNBQU8sSUFBSSxNQUFNLFFBQVE7QUFDdkIsVUFBTSxPQUFPLE1BQU0sQ0FBQyxLQUFLO0FBRXpCLFFBQUksS0FBSyxLQUFLLE1BQU0sSUFBSTtBQUN0QixXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBR0EsVUFBTSxRQUFRLEtBQUssTUFBTSw2QkFBNkI7QUFDdEQsUUFBSSxPQUFPO0FBQ1QsWUFBTSxRQUFRLE1BQU0sQ0FBQyxLQUFLLElBQUksWUFBWTtBQUMxQyxZQUFNLE9BQWlCLENBQUM7QUFDeEIsV0FBSztBQUNMLGFBQU8sSUFBSSxNQUFNLFVBQVUsQ0FBQyxXQUFXLEtBQUssTUFBTSxDQUFDLEtBQUssRUFBRSxHQUFHO0FBQzNELGFBQUssS0FBSyxNQUFNLENBQUMsS0FBSyxFQUFFO0FBQ3hCLGFBQUs7QUFBQSxNQUNQO0FBQ0EsV0FBSztBQUNMLGFBQU8sS0FBSyxFQUFFLE1BQU0sY0FBYyxNQUFNLE1BQU0sS0FBSyxLQUFLLElBQUksRUFBRSxDQUFDO0FBQy9EO0FBQUEsSUFDRjtBQUdBLFVBQU0sVUFBVSxLQUFLLE1BQU0sbUJBQW1CO0FBQzlDLFFBQUksU0FBUztBQUNYLGFBQU8sS0FBSztBQUFBLFFBQ1YsTUFBTTtBQUFBLFFBQ04sUUFBUSxRQUFRLENBQUMsS0FBSyxLQUFLO0FBQUEsUUFDM0IsVUFBVSxZQUFZLFFBQVEsQ0FBQyxLQUFLLElBQUksTUFBTTtBQUFBLE1BQ2hELENBQUM7QUFDRCxXQUFLO0FBQ0w7QUFBQSxJQUNGO0FBR0EsVUFBTSxXQUFXLGNBQWMsSUFBSTtBQUNuQyxRQUFJLFVBQVU7QUFDWixZQUFNLFVBQVUsU0FBUztBQUN6QixZQUFNLFFBQXNCLENBQUM7QUFDN0IsYUFBTyxJQUFJLE1BQU0sUUFBUTtBQUN2QixjQUFNLElBQUksY0FBYyxNQUFNLENBQUMsS0FBSyxFQUFFO0FBQ3RDLFlBQUksQ0FBQyxLQUFLLEVBQUUsWUFBWSxRQUFTO0FBQ2pDLGNBQU0sS0FBSyxZQUFZLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDdEMsYUFBSztBQUFBLE1BQ1A7QUFDQSxhQUFPLEtBQUssRUFBRSxNQUFNLFFBQVEsU0FBUyxNQUFNLENBQUM7QUFDNUM7QUFBQSxJQUNGO0FBR0EsVUFBTSxPQUFpQixDQUFDLElBQUk7QUFDNUIsU0FBSztBQUNMLFdBQU8sSUFBSSxNQUFNLFFBQVE7QUFDdkIsWUFBTSxPQUFPLE1BQU0sQ0FBQyxLQUFLO0FBQ3pCLFVBQ0UsS0FBSyxLQUFLLE1BQU0sTUFDaEIsT0FBTyxLQUFLLElBQUksS0FDaEIsWUFBWSxLQUFLLElBQUksS0FDckIsY0FBYyxJQUFJLEdBQ2xCO0FBQ0E7QUFBQSxNQUNGO0FBQ0EsV0FBSyxLQUFLLElBQUk7QUFDZCxXQUFLO0FBQUEsSUFDUDtBQUNBLFdBQU8sS0FBSyxFQUFFLE1BQU0sYUFBYSxVQUFVLFlBQVksS0FBSyxLQUFLLElBQUksR0FBRyxNQUFNLEVBQUUsQ0FBQztBQUFBLEVBQ25GO0FBRUEsU0FBTztBQUNUO0FBRUEsU0FBUyxjQUNQLE1BQzJDO0FBQzNDLFFBQU0sS0FBSyxLQUFLLE1BQU0sdUJBQXVCO0FBQzdDLE1BQUksR0FBSSxRQUFPLEVBQUUsU0FBUyxPQUFPLE1BQU0sR0FBRyxDQUFDLEtBQUssR0FBRztBQUNuRCxRQUFNLEtBQUssS0FBSyxNQUFNLDZCQUE2QjtBQUNuRCxNQUFJLEdBQUksUUFBTyxFQUFFLFNBQVMsTUFBTSxNQUFNLEdBQUcsQ0FBQyxLQUFLLEdBQUc7QUFDbEQsU0FBTztBQUNUO0FBR08sU0FBUyxZQUFZLEtBQWEsUUFBZ0M7QUFDdkUsUUFBTSxNQUFrQixDQUFDO0FBQ3pCLE1BQUksT0FBTztBQUVYLFFBQU0sV0FBVyxDQUFDLE1BQWM7QUFDOUIsUUFBSSxNQUFNLEdBQUk7QUFDZCxVQUFNLE9BQU8sSUFBSSxJQUFJLFNBQVMsQ0FBQztBQUMvQixRQUFJLFFBQVEsS0FBSyxTQUFTLE9BQVEsTUFBSyxRQUFRO0FBQUEsUUFDMUMsS0FBSSxLQUFLLEVBQUUsTUFBTSxRQUFRLE1BQU0sRUFBRSxDQUFDO0FBQUEsRUFDekM7QUFFQSxTQUFPLEtBQUssU0FBUyxHQUFHO0FBRXRCLFVBQU0sV0FBbUUsQ0FBQztBQUUxRSxVQUFNLE9BQU8sS0FBSyxNQUFNLGFBQWE7QUFDckMsUUFBSSxRQUFRLEtBQUssVUFBVSxRQUFXO0FBQ3BDLGVBQVMsS0FBSztBQUFBLFFBQ1osT0FBTyxLQUFLO0FBQUEsUUFDWixLQUFLLEtBQUssQ0FBQyxFQUFFO0FBQUEsUUFDYixLQUFLLE1BQU0sSUFBSSxLQUFLLEVBQUUsTUFBTSxRQUFRLE1BQU0sS0FBSyxDQUFDLEtBQUssR0FBRyxDQUFDO0FBQUEsTUFDM0QsQ0FBQztBQUFBLElBQ0g7QUFFQSxVQUFNLE9BQU8sS0FBSyxNQUFNLDZCQUE2QjtBQUNyRCxRQUFJLFFBQVEsS0FBSyxVQUFVLFFBQVc7QUFDcEMsWUFBTSxPQUFPLEtBQUssQ0FBQyxLQUFLO0FBQ3hCLFlBQU0sUUFBUSxLQUFLLENBQUMsS0FBSztBQUN6QixlQUFTLEtBQUs7QUFBQSxRQUNaLE9BQU8sS0FBSztBQUFBLFFBQ1osS0FBSyxLQUFLLENBQUMsRUFBRTtBQUFBLFFBQ2IsS0FBSyxNQUFNO0FBQ1QsZ0JBQU0sVUFBVSxjQUFjLE1BQU0sTUFBTTtBQUMxQyxjQUFJLEtBQUs7QUFBQSxZQUNQLE1BQU07QUFBQSxZQUNOO0FBQUEsWUFDQSxVQUFVLFlBQVksT0FBTyxNQUFNO0FBQUEsWUFDbkM7QUFBQSxVQUNGLENBQUM7QUFBQSxRQUNIO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sU0FBUyxLQUFLLE1BQU0saUNBQWlDO0FBQzNELFFBQUksVUFBVSxPQUFPLFVBQVUsUUFBVztBQUN4QyxZQUFNLFFBQVEsT0FBTyxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUs7QUFDeEMsZUFBUyxLQUFLO0FBQUEsUUFDWixPQUFPLE9BQU87QUFBQSxRQUNkLEtBQUssT0FBTyxDQUFDLEVBQUU7QUFBQSxRQUNmLEtBQUssTUFDSCxJQUFJLEtBQUssRUFBRSxNQUFNLFVBQVUsVUFBVSxZQUFZLE9BQU8sTUFBTSxFQUFFLENBQUM7QUFBQSxNQUNyRSxDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sS0FBSyxLQUFLLE1BQU0sMERBQTBEO0FBQ2hGLFFBQUksTUFBTSxHQUFHLFVBQVUsUUFBVztBQUNoQyxZQUFNLFFBQVEsR0FBRyxDQUFDLEtBQUssR0FBRyxDQUFDLEtBQUs7QUFDaEMsZUFBUyxLQUFLO0FBQUEsUUFDWixPQUFPLEdBQUc7QUFBQSxRQUNWLEtBQUssR0FBRyxDQUFDLEVBQUU7QUFBQSxRQUNYLEtBQUssTUFBTSxJQUFJLEtBQUssRUFBRSxNQUFNLE1BQU0sVUFBVSxZQUFZLE9BQU8sTUFBTSxFQUFFLENBQUM7QUFBQSxNQUMxRSxDQUFDO0FBQUEsSUFDSDtBQUVBLFVBQU0sTUFBTSxLQUFLLE1BQU0sZUFBZTtBQUN0QyxRQUFJLE9BQU8sSUFBSSxVQUFVLFFBQVc7QUFDbEMsZUFBUyxLQUFLO0FBQUEsUUFDWixPQUFPLElBQUk7QUFBQSxRQUNYLEtBQUssSUFBSSxDQUFDLEVBQUU7QUFBQSxRQUNaLEtBQUssTUFDSCxJQUFJLEtBQUssRUFBRSxNQUFNLE9BQU8sVUFBVSxZQUFZLElBQUksQ0FBQyxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7QUFBQSxNQUN6RSxDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUksU0FBUyxXQUFXLEdBQUc7QUFDekIsZUFBUyxJQUFJO0FBQ2I7QUFBQSxJQUNGO0FBQ0EsYUFBUyxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUs7QUFDekMsVUFBTSxRQUFRLFNBQVMsQ0FBQztBQUN4QixhQUFTLEtBQUssTUFBTSxHQUFHLE1BQU0sS0FBSyxDQUFDO0FBQ25DLFVBQU0sSUFBSTtBQUNWLFdBQU8sS0FBSyxNQUFNLE1BQU0sUUFBUSxNQUFNLEdBQUc7QUFBQSxFQUMzQztBQUVBLFNBQU87QUFDVDtBQVFPLFNBQVMsZUFBZSxNQUFzQjtBQUNuRCxTQUFPLEtBQ0osUUFBUSw2QkFBNkIsRUFBRSxFQUN2QyxRQUFRLFVBQVUsR0FBRyxFQUNyQixRQUFRLGFBQWEsRUFBRTtBQUM1QjtBQXBOQTtBQUFBO0FBQUE7QUFRQTtBQUFBO0FBQUE7OztBQzBCQSxTQUFTLGFBQXVCO0FBQzlCLFNBQU8sQ0FBQyxTQUFTLE9BQU8sT0FBTyxZQUFZLFVBQVUsTUFBTSxRQUFRLE9BQU8sU0FBUyxNQUFNLFVBQVUsUUFBUSxXQUFXLFNBQVMsWUFBWSxPQUFPLFVBQVUsVUFBVSxjQUFjLE1BQU0sTUFBTSxTQUFTLFdBQVcsU0FBUyxRQUFRLFVBQVUsVUFBVSxRQUFRLE1BQU0sU0FBUyxTQUFTLFNBQVMsT0FBTyxTQUFTLFdBQVcsU0FBUyxRQUFRLFNBQVMsUUFBUSxhQUFhLFFBQVEsVUFBVSxPQUFPLEtBQUs7QUFDNVk7QUFNTyxTQUFTLGNBQWMsTUFBYyxNQUF5QjtBQUNuRSxRQUFNLEtBQUssSUFBSSxJQUFJLFNBQVMsSUFBSSxLQUFLLENBQUMsQ0FBQztBQUN2QyxRQUFNLGtCQUFrQixTQUFTO0FBQ2pDLFFBQU0sU0FBb0IsQ0FBQztBQUMzQixRQUFNLE9BQU8sQ0FBQyxLQUFjLFNBQWlCO0FBQzNDLFVBQU0sT0FBTyxPQUFPLE9BQU8sU0FBUyxDQUFDO0FBQ3JDLFFBQUksUUFBUSxLQUFLLFFBQVEsSUFBSyxNQUFLLFFBQVE7QUFBQSxRQUN0QyxRQUFPLEtBQUssRUFBRSxLQUFLLEtBQUssQ0FBQztBQUFBLEVBQ2hDO0FBSUEsUUFBTSxjQUFjLFNBQVMsWUFBWSxTQUFTLFFBQVEsU0FBUyxVQUFVLFNBQVM7QUFDdEYsUUFBTSxjQUFjLFNBQVM7QUFDN0IsUUFBTSxlQUFlLENBQUMsZUFBZSxDQUFDLGVBQWUsU0FBUyxTQUFTLFNBQVM7QUFFaEYsV0FBUyxZQUFZO0FBQ3JCLE1BQUk7QUFDSixVQUFRLElBQUksU0FBUyxLQUFLLElBQUksT0FBTyxNQUFNO0FBQ3pDLFVBQU0sQ0FBQyxNQUFNLEtBQUssS0FBSyxLQUFLLE1BQU0sS0FBSyxJQUFJO0FBQzNDLFFBQUksUUFBUSxRQUFXO0FBQ3JCLFlBQU0sWUFDSCxJQUFJLFdBQVcsR0FBRyxLQUFLLGVBQ3ZCLElBQUksV0FBVyxJQUFJLEtBQUssZ0JBQ3ZCLElBQUksV0FBVyxJQUFJLEtBQUssSUFBSSxXQUFXLElBQUksTUFBTTtBQUNyRCxXQUFLLFlBQVksUUFBUSxPQUFPLEdBQUc7QUFBQSxJQUNyQyxXQUFXLFFBQVEsUUFBVztBQUM1QixXQUFLLE9BQU8sR0FBRztBQUFBLElBQ2pCLFdBQVcsUUFBUSxRQUFXO0FBQzVCLFdBQUssT0FBTyxHQUFHO0FBQUEsSUFDakIsV0FBVyxTQUFTLFFBQVc7QUFDN0IsWUFBTSxRQUFRLGtCQUFrQixLQUFLLFlBQVksSUFBSTtBQUNyRCxXQUFLLEdBQUcsSUFBSSxLQUFLLElBQUksT0FBTyxPQUFPLElBQUk7QUFBQSxJQUN6QyxXQUFXLFVBQVUsUUFBVztBQUM5QixXQUFLLE9BQU8sS0FBSztBQUFBLElBQ25CLE9BQU87QUFDTCxXQUFLLE9BQU8sSUFBSTtBQUFBLElBQ2xCO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQWxGQSxJQWNNLFVBd0JBO0FBdENOO0FBQUE7QUFBQTtBQWNBLElBQU0sV0FBcUM7QUFBQSxNQUN6QyxZQUFZLFdBQVc7QUFBQSxNQUN2QixZQUFZLENBQUMsR0FBRyxXQUFXLEdBQUcsUUFBUSxhQUFhLFFBQVEsYUFBYSxXQUFXLFlBQVksU0FBUyxTQUFTLE1BQU0sV0FBVyxXQUFXO0FBQUEsTUFDN0ksSUFBSSxXQUFXO0FBQUEsTUFDZixJQUFJLENBQUMsR0FBRyxXQUFXLEdBQUcsUUFBUSxhQUFhLFFBQVEsVUFBVTtBQUFBLE1BQzdELEtBQUssV0FBVztBQUFBLE1BQ2hCLEtBQUssQ0FBQyxHQUFHLFdBQVcsR0FBRyxRQUFRLGFBQWEsUUFBUSxVQUFVO0FBQUEsTUFDOUQsUUFBUSxDQUFDLE9BQU8sVUFBVSxNQUFNLFFBQVEsUUFBUSxPQUFPLFNBQVMsTUFBTSxPQUFPLE9BQU8sTUFBTSxVQUFVLFFBQVEsTUFBTSxTQUFTLE9BQU8sVUFBVSxXQUFXLFFBQVEsVUFBVSxRQUFRLFNBQVMsWUFBWSxTQUFTLFNBQVMsVUFBVSxZQUFZLFVBQVUsT0FBTyxRQUFRLFNBQVMsUUFBUSxTQUFTLFNBQVMsU0FBUyxNQUFNO0FBQUEsTUFDelQsSUFBSSxDQUFDLE9BQU8sVUFBVSxNQUFNLFFBQVEsUUFBUSxPQUFPLFNBQVMsTUFBTSxPQUFPLE9BQU8sTUFBTSxVQUFVLFFBQVEsTUFBTSxTQUFTLE9BQU8sVUFBVSxXQUFXLFFBQVEsVUFBVSxRQUFRLFNBQVMsUUFBUSxTQUFTLE9BQU87QUFBQSxNQUM5TSxNQUFNLENBQUMsTUFBTSxPQUFPLE9BQU8sU0FBUyxVQUFVLE1BQU0sUUFBUSxTQUFTLFFBQVEsU0FBUyxPQUFPLE1BQU0sVUFBVSxTQUFTLFlBQVksVUFBVSxRQUFRLFNBQVMsUUFBUSxPQUFPLE9BQU8sT0FBTyxTQUFTLFFBQVEsUUFBUSxTQUFTLFNBQVMsU0FBUyxTQUFTLFFBQVEsT0FBTyxRQUFRLFVBQVUsT0FBTyxNQUFNLFFBQVEsT0FBTztBQUFBLE1BQ3BULElBQUksQ0FBQyxRQUFRLFVBQVUsTUFBTSxRQUFRLE9BQU8sU0FBUyxVQUFVLFFBQVEsV0FBVyxTQUFTLFlBQVksUUFBUSxVQUFVLGFBQWEsT0FBTyxRQUFRLE1BQU0sU0FBUyxVQUFVLFdBQVcsVUFBVSxPQUFPLFNBQVMsT0FBTyxRQUFRLE9BQU87QUFBQSxNQUN6TyxNQUFNLENBQUMsVUFBVSxXQUFXLGFBQWEsU0FBUyxhQUFhLFdBQVcsY0FBYyxVQUFVLE1BQU0sUUFBUSxPQUFPLFNBQVMsVUFBVSxRQUFRLE9BQU8sVUFBVSxTQUFTLFFBQVEsT0FBTyxRQUFRLFVBQVUsV0FBVyxVQUFVLFFBQVEsU0FBUyxRQUFRLFVBQVUsV0FBVyxPQUFPLFNBQVMsV0FBVyxTQUFTLFFBQVE7QUFBQSxNQUM1VCxLQUFLLENBQUMsVUFBVSxRQUFRLFNBQVMsVUFBVSxRQUFRLFVBQVUsVUFBVSxPQUFPLFVBQVUsVUFBVSxTQUFTLFNBQVMsUUFBUSxRQUFRLFFBQVEsU0FBUyxTQUFTLFNBQVMsTUFBTSxTQUFTLE1BQU0sU0FBUyxVQUFVLFNBQVMsVUFBVSxPQUFPLE1BQU0sT0FBTyxRQUFRLE1BQU0sWUFBWSxTQUFTLE9BQU8sVUFBVSxNQUFNLFFBQVEsV0FBVyxXQUFXLE9BQU8sV0FBVyxjQUFjLE9BQU87QUFBQSxNQUNyWCxNQUFNLENBQUMsTUFBTSxRQUFRLFFBQVEsUUFBUSxNQUFNLE9BQU8sU0FBUyxNQUFNLFFBQVEsUUFBUSxRQUFRLFlBQVksVUFBVSxTQUFTLFVBQVUsUUFBUSxRQUFRLElBQUk7QUFBQSxNQUN0SixJQUFJLENBQUMsTUFBTSxRQUFRLFFBQVEsUUFBUSxNQUFNLE9BQU8sU0FBUyxNQUFNLFFBQVEsUUFBUSxRQUFRLFlBQVksVUFBVSxTQUFTLFVBQVUsUUFBUSxRQUFRLElBQUk7QUFBQSxNQUNwSixNQUFNLENBQUMsUUFBUSxTQUFTLE1BQU07QUFBQSxNQUM5QixLQUFLLENBQUM7QUFBQSxNQUNOLE1BQU0sQ0FBQztBQUFBLElBQ1Q7QUFNQSxJQUFNLFdBQ0o7QUFBQTtBQUFBOzs7QUNsQkssU0FBUyxlQUNkLFFBQ0EsTUFDa0I7QUFDbEIsUUFBTSxPQUFPLFNBQVMsdUJBQXVCO0FBQzdDLGFBQVcsU0FBUyxRQUFRO0FBQzFCLFlBQVEsTUFBTSxNQUFNO0FBQUEsTUFDbEIsS0FBSyxhQUFhO0FBQ2hCLGNBQU0sSUFBSSxTQUFTLGNBQWMsR0FBRztBQUNwQyxVQUFFLE9BQU8sYUFBYSxNQUFNLFFBQVEsQ0FBQztBQUNyQyxhQUFLLE9BQU8sQ0FBQztBQUNiO0FBQUEsTUFDRjtBQUFBLE1BQ0EsS0FBSyxXQUFXO0FBQ2QsY0FBTSxJQUFJLFNBQVMsY0FBYyxJQUFJLEtBQUssSUFBSSxNQUFNLE9BQU8sQ0FBQyxDQUFDLEVBQUU7QUFDL0QsVUFBRSxPQUFPLGFBQWEsTUFBTSxRQUFRLENBQUM7QUFDckMsYUFBSyxPQUFPLENBQUM7QUFDYjtBQUFBLE1BQ0Y7QUFBQSxNQUNBLEtBQUssUUFBUTtBQUNYLGNBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTSxVQUFVLE9BQU8sSUFBSTtBQUMvRCxtQkFBVyxRQUFRLE1BQU0sT0FBTztBQUM5QixnQkFBTSxLQUFLLFNBQVMsY0FBYyxJQUFJO0FBQ3RDLGFBQUcsT0FBTyxhQUFhLElBQUksQ0FBQztBQUM1QixlQUFLLE9BQU8sRUFBRTtBQUFBLFFBQ2hCO0FBQ0EsYUFBSyxPQUFPLElBQUk7QUFDaEI7QUFBQSxNQUNGO0FBQUEsTUFDQSxLQUFLO0FBQ0gsYUFBSyxPQUFPLGdCQUFnQixNQUFNLE1BQU0sTUFBTSxNQUFNLElBQUksQ0FBQztBQUN6RDtBQUFBLElBQ0o7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxhQUFhLE9BQXFDO0FBQ3pELFFBQU0sT0FBTyxTQUFTLHVCQUF1QjtBQUM3QyxhQUFXLFFBQVEsT0FBTztBQUN4QixZQUFRLEtBQUssTUFBTTtBQUFBLE1BQ2pCLEtBQUs7QUFDSCxhQUFLLE9BQU8sU0FBUyxlQUFlLEtBQUssSUFBSSxDQUFDO0FBQzlDO0FBQUEsTUFDRixLQUFLLFVBQVU7QUFDYixjQUFNLEtBQUssU0FBUyxjQUFjLFFBQVE7QUFDMUMsV0FBRyxPQUFPLGFBQWEsS0FBSyxRQUFRLENBQUM7QUFDckMsYUFBSyxPQUFPLEVBQUU7QUFDZDtBQUFBLE1BQ0Y7QUFBQSxNQUNBLEtBQUssTUFBTTtBQUNULGNBQU0sS0FBSyxTQUFTLGNBQWMsSUFBSTtBQUN0QyxXQUFHLE9BQU8sYUFBYSxLQUFLLFFBQVEsQ0FBQztBQUNyQyxhQUFLLE9BQU8sRUFBRTtBQUNkO0FBQUEsTUFDRjtBQUFBLE1BQ0EsS0FBSyxPQUFPO0FBQ1YsY0FBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ3ZDLFdBQUcsT0FBTyxhQUFhLEtBQUssUUFBUSxDQUFDO0FBQ3JDLGFBQUssT0FBTyxFQUFFO0FBQ2Q7QUFBQSxNQUNGO0FBQUEsTUFDQSxLQUFLLFFBQVE7QUFDWCxjQUFNLEtBQUssU0FBUyxjQUFjLE1BQU07QUFDeEMsV0FBRyxjQUFjLEtBQUs7QUFDdEIsYUFBSyxPQUFPLEVBQUU7QUFDZDtBQUFBLE1BQ0Y7QUFBQSxNQUNBLEtBQUssUUFBUTtBQUNYLFlBQUksS0FBSyxTQUFTO0FBQ2hCLGdCQUFNLElBQUksU0FBUyxjQUFjLEdBQUc7QUFDcEMsWUFBRSxPQUFPLEtBQUs7QUFDZCxZQUFFLFNBQVM7QUFDWCxZQUFFLE1BQU07QUFDUixZQUFFLE9BQU8sYUFBYSxLQUFLLFFBQVEsQ0FBQztBQUNwQyxlQUFLLE9BQU8sQ0FBQztBQUFBLFFBQ2YsT0FBTztBQUVMLGVBQUssT0FBTyxhQUFhLEtBQUssUUFBUSxDQUFDO0FBQUEsUUFDekM7QUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsZ0JBQ1AsTUFDQSxNQUNBLE1BQ2E7QUFDYixRQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsT0FBSyxZQUFZO0FBQ2pCLE9BQUssUUFBUSxRQUFRLEtBQUs7QUFFMUIsUUFBTSxNQUFNLFNBQVMsY0FBYyxLQUFLO0FBQ3hDLE1BQUksWUFBWTtBQUNoQixRQUFNLFFBQVEsU0FBUyxjQUFjLE1BQU07QUFDM0MsUUFBTSxjQUFjLFFBQVE7QUFDNUIsTUFBSSxPQUFPLEtBQUs7QUFFaEIsUUFBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLFVBQVEsWUFBWTtBQUNwQixVQUFRO0FBQUEsSUFDTixXQUFXLE1BQU0sTUFBTSxLQUFLLEtBQUssTUFBTSxDQUFDLFFBQVE7QUFDOUMsWUFBTSxJQUFJLFVBQVUsV0FBVyxVQUFVLElBQUk7QUFDN0MsVUFBSSxDQUFDLEVBQUc7QUFDUixXQUFLLEVBQ0YsS0FBSyxNQUFNO0FBQ1YsWUFBSSxRQUFRLEtBQUssS0FBSztBQUN0QixZQUFJLFlBQVksTUFBTTtBQUN0QixtQkFBVyxNQUFNO0FBQ2YsY0FBSSxRQUFRLEtBQUssS0FBSztBQUN0QixjQUFJLFlBQVksTUFBTTtBQUFBLFFBQ3hCLEdBQUcsSUFBSTtBQUFBLE1BQ1QsQ0FBQyxFQUNBLE1BQU0sTUFBTTtBQUFBLE1BRWIsQ0FBQztBQUFBLElBQ0wsQ0FBQztBQUFBLElBQ0QsV0FBVyxNQUFNLFVBQVUsS0FBSyxLQUFLLFVBQVUsTUFBTTtBQUNuRCxZQUFNLE9BQU8sSUFBSSxLQUFLLENBQUMsSUFBSSxHQUFHLEVBQUUsTUFBTSxhQUFhLENBQUM7QUFDcEQsWUFBTSxNQUFNLElBQUksZ0JBQWdCLElBQUk7QUFDcEMsWUFBTSxJQUFJLFNBQVMsY0FBYyxHQUFHO0FBQ3BDLFFBQUUsT0FBTztBQUNULFFBQUUsV0FBVyxXQUFXLFFBQVEsS0FBSztBQUNyQyxRQUFFLE1BQU07QUFDUixVQUFJLGdCQUFnQixHQUFHO0FBQUEsSUFDekIsQ0FBQztBQUFBLElBQ0QsV0FBVyxNQUFNLE1BQU0sS0FBSyxLQUFLLE1BQU0sTUFBTTtBQUMzQyxVQUFJLEtBQUssYUFBYSxXQUFXLEVBQUcsTUFBSyxnQkFBZ0IsV0FBVztBQUFBLFVBQy9ELE1BQUssYUFBYSxhQUFhLEVBQUU7QUFBQSxJQUN4QyxDQUFDO0FBQUEsRUFDSDtBQUNBLE1BQUksT0FBTyxPQUFPO0FBQ2xCLE9BQUssT0FBTyxHQUFHO0FBRWYsUUFBTSxNQUFNLFNBQVMsY0FBYyxLQUFLO0FBQ3hDLFFBQU0sU0FBUyxTQUFTLGNBQWMsTUFBTTtBQUM1QyxhQUFXLFNBQVMsY0FBYyxNQUFNLElBQUksR0FBRztBQUM3QyxRQUFJLE1BQU0sUUFBUSxPQUFPO0FBQ3ZCLGFBQU8sT0FBTyxTQUFTLGVBQWUsTUFBTSxJQUFJLENBQUM7QUFBQSxJQUNuRCxPQUFPO0FBQ0wsWUFBTSxPQUFPLFNBQVMsY0FBYyxNQUFNO0FBQzFDLFdBQUssWUFBWSxNQUFNLE1BQU0sR0FBRztBQUNoQyxXQUFLLGNBQWMsTUFBTTtBQUN6QixhQUFPLE9BQU8sSUFBSTtBQUFBLElBQ3BCO0FBQUEsRUFDRjtBQUNBLE1BQUksT0FBTyxNQUFNO0FBQ2pCLE9BQUssT0FBTyxHQUFHO0FBQ2YsU0FBTztBQUNUO0FBRUEsU0FBUyxXQUNQLE1BQ0EsT0FDQSxTQUNtQjtBQUNuQixRQUFNLE1BQU0sU0FBUyxjQUFjLFFBQVE7QUFDM0MsTUFBSSxZQUFZO0FBQ2hCLE1BQUksTUFBTSxRQUFRO0FBQ2xCLE1BQUksTUFBTSxTQUFTO0FBQ25CLE1BQUksUUFBUTtBQUNaLE1BQUksYUFBYSxjQUFjLEtBQUs7QUFDcEMsTUFBSSxZQUFZO0FBQ2hCLE1BQUksaUJBQWlCLFNBQVMsTUFBTSxRQUFRLEdBQUcsQ0FBQztBQUNoRCxTQUFPO0FBQ1Q7QUE5TEE7QUFBQTtBQUFBO0FBT0E7QUFFQTtBQUFBO0FBQUE7OztBQ1FPLFNBQVMsc0JBQXNCLE9BQThCO0FBQ2xFLFNBQU8sVUFBVSxlQUFlLGVBQWU7QUFDakQ7QUFXTyxTQUFTLGdCQUNkLFFBQ0EsTUFDQSxRQUNBLFVBQ007QUFDTixNQUFJLFdBQVcsY0FBYztBQUMzQixXQUFPLGNBQWM7QUFDckI7QUFBQSxFQUNGO0FBQ0EsU0FBTyxPQUFPLFNBQVMsSUFBSSxDQUFDO0FBQzlCO0FBekNBLElBWWE7QUFaYjtBQUFBO0FBQUE7QUFZTyxJQUFNLHdCQUFzQztBQUFBO0FBQUE7OztBQ1puRCxJQUdhO0FBSGI7QUFBQTtBQUFBO0FBR08sSUFBTSxhQUFhO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7OztBQzJFbkIsU0FBUyxZQUNkQyxZQUNBLEtBQ1E7QUFDUixRQUFNLElBQUlBLGFBQVksR0FBRztBQUN6QixTQUFPLE1BQU0sVUFBYSxNQUFNLEtBQUssSUFBSSxxQkFBcUIsR0FBRztBQUNuRTtBQXBGQSxJQWFhLHNCQTREQTtBQXpFYjtBQUFBO0FBQUE7QUFhTyxJQUFNLHVCQUF1QjtBQUFBLE1BQ2xDLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxNQUNaLFVBQVU7QUFBQSxNQUNWLFVBQVU7QUFBQSxNQUNWLGlCQUFpQjtBQUFBLE1BQ2pCLGlCQUFpQjtBQUFBLE1BQ2pCLFVBQVU7QUFBQSxNQUNWLFFBQVE7QUFBQSxNQUNSLFFBQVE7QUFBQSxNQUNSLGNBQWM7QUFBQSxNQUNkLGVBQWU7QUFBQSxNQUNmLGtCQUFrQjtBQUFBLE1BQ2xCLGlCQUFpQjtBQUFBLE1BQ2pCLG1CQUFtQjtBQUFBLE1BQ25CLGlCQUFpQjtBQUFBLE1BQ2pCLGFBQWE7QUFBQSxNQUNiLG1CQUFtQjtBQUFBLE1BQ25CLDZCQUE2QjtBQUFBLE1BQzdCLG9DQUFvQztBQUFBLE1BQ3BDLHlCQUF5QjtBQUFBLE1BQ3pCLDBCQUEwQjtBQUFBLE1BQzFCLGlCQUFpQjtBQUFBLE1BQ2pCLGdCQUFnQjtBQUFBLE1BQ2hCLFNBQVM7QUFBQSxNQUNULG1CQUFtQjtBQUFBLE1BQ25CLDRCQUE0QjtBQUFBLE1BQzVCLHFCQUFxQjtBQUFBLE1BQ3JCLDZCQUNFO0FBQUEsTUFDRixnQ0FBZ0M7QUFBQSxNQUNoQyxRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsTUFDVCxjQUFjO0FBQUEsTUFDZCxXQUFXO0FBQUEsTUFDWCxZQUFZO0FBQUEsTUFDWix1QkFBdUI7QUFBQSxNQUN2Qix3QkFBd0I7QUFBQSxNQUN4QixNQUFNO0FBQUEsTUFDTixVQUFVO0FBQUEsTUFDVixNQUFNO0FBQUEsTUFDTixlQUFlO0FBQUEsTUFDZixZQUFZO0FBQUEsTUFDWixhQUFhO0FBQUEsTUFDYixhQUFhO0FBQUEsTUFDYixhQUFhO0FBQUEsTUFDYixtQkFBbUI7QUFBQSxNQUNuQix1QkFBdUI7QUFBQSxNQUN2QixnQkFBZ0I7QUFBQSxNQUNoQixvQkFBb0I7QUFBQSxNQUNwQixrQkFBa0I7QUFBQTtBQUFBO0FBQUEsTUFHbEIsZUFBZTtBQUFBLE1BQ2YsaUJBQWlCO0FBQUEsSUFDbkI7QUFJTyxJQUFNLG1CQUFtQixPQUFPO0FBQUEsTUFDckM7QUFBQSxJQUNGO0FBQUE7QUFBQTs7O0FDcENPLFNBQVMsV0FBcUI7QUFDbkMsU0FBTyxFQUFFLEdBQUcsZ0JBQWdCLEdBQUcsR0FBRyxVQUFVO0FBQzlDO0FBekNBLElBdUJNLGlCQVFGLFdBa0JTO0FBakRiO0FBQUE7QUFBQTtBQXVCQSxJQUFNLGtCQUFrQixPQUFpQjtBQUFBLE1BQ3ZDLG1CQUFtQixXQUFXO0FBQUEsTUFDOUIsdUJBQXVCLFdBQVc7QUFBQSxNQUNsQyxjQUFjLE1BQU0sV0FBVyxXQUFXO0FBQUEsTUFDMUMsT0FBTyxJQUFJLFNBQW1DLFdBQVcsTUFBTSxHQUFHLElBQUk7QUFBQSxNQUN0RSxZQUFZLENBQUMsU0FBUyxPQUFPLFdBQVcsV0FBVyxTQUFTLEVBQUU7QUFBQSxJQUNoRTtBQUVBLElBQUksWUFBK0IsQ0FBQztBQWtCN0IsSUFBTSxrQkFBa0I7QUFBQSxNQUM3QixPQUFPLEVBQUUsa0JBQWtCLE1BQU0sa0JBQWtCLE9BQU8saUJBQWlCLE1BQU07QUFBQSxNQUNqRixPQUFPO0FBQUEsSUFDVDtBQUFBO0FBQUE7OztBQzFCTyxTQUFTLGVBQWUsS0FBMkM7QUFDeEUsVUFBUSxJQUFJLE1BQU07QUFBQSxJQUNoQixLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNUO0FBQ0UsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQVNPLFNBQVMsdUJBQXVCLEtBQTJCO0FBQ2hFLFFBQU0sT0FBTyxlQUFlLEdBQUc7QUFDL0IsTUFBSSxDQUFDLEtBQU0sUUFBTztBQUNsQixNQUFJLFNBQVMsU0FBUztBQUNwQixXQUNFLElBQUksU0FBUyxnQkFDYixJQUFJLE1BQU0sV0FBVyxRQUNyQixJQUFJLE1BQU0sa0JBQWtCO0FBQUEsRUFFaEM7QUFDQSxTQUFPLElBQUksTUFBTSxVQUFVO0FBQzdCO0FBV08sU0FBUyxzQkFBc0IsS0FLMUI7QUFHVixNQUFJLElBQUksVUFBVSxhQUFhLElBQUksU0FBUyxpQkFBa0IsUUFBTztBQUNyRSxRQUFNLE9BQU8sSUFBSTtBQUNqQixTQUNFLE9BQU8sU0FBUyxZQUNoQixTQUFTLFFBQ1IsS0FBaUMsU0FBUztBQUUvQztBQWNPLFNBQVMsZ0JBQWdCLEtBSWdCO0FBQzlDLE1BQUksSUFBSSxVQUFVLGFBQWEsSUFBSSxTQUFTLGlCQUFrQixRQUFPO0FBQ3JFLFFBQU0sT0FBTyxJQUFJO0FBQ2pCLE1BQUksT0FBTyxTQUFTLFlBQVksU0FBUyxLQUFNLFFBQU87QUFDdEQsUUFBTSxTQUFTO0FBQ2YsTUFBSSxPQUFPLFNBQVMsMkJBQTJCO0FBQzdDLFVBQU0sU0FBUyxPQUFPO0FBQ3RCLFFBQUksV0FBVyxhQUFhLFdBQVcsY0FBYyxXQUFXLFlBQWEsUUFBTztBQUNwRixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksT0FBTyxTQUFTLG1CQUFtQixPQUFPLFdBQVcsc0JBQXNCO0FBQzdFLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUO0FBT08sU0FBUyxpQkFBaUIsYUFBZ0Q7QUFDL0UsU0FBTyxjQUFjLGlCQUFpQjtBQUN4QztBQTJiTyxTQUFTLHNCQUFzQixTQUEwQztBQUM5RSxTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGFBQWEsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxJQUN4QyxNQUFNO0FBQUEsTUFDSjtBQUFBLE1BQ0EsU0FBUyxFQUFFLGlCQUFpQixNQUFNLGdCQUFnQixLQUFLO0FBQUEsSUFDekQ7QUFBQSxFQUNGO0FBQ0Y7QUFLTyxTQUFTLGdDQUNkLFlBQ0EsUUFDQSxTQUN5QjtBQUN6QixTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGVBQWUsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxJQUMxQyxNQUFNLEVBQUUsY0FBYyxZQUFZLFFBQVEsVUFBVSxRQUFRO0FBQUEsRUFDOUQ7QUFDRjtBQUdPLFNBQVMsNkJBQ2QsWUFDQSxZQUN5QjtBQUN6QixTQUFPO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixJQUFJLGdCQUFnQixLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUFBLElBQzNDLE1BQU0sRUFBRSxjQUFjLFlBQVksYUFBYSxXQUFXO0FBQUEsRUFDNUQ7QUFDRjtBQUlPLFNBQVMsd0JBQXdCLEtBQWtEO0FBQ3hGLE1BQUksSUFBSSxTQUFTLGdCQUFpQixRQUFPO0FBQ3pDLFFBQU0sT0FBTyxJQUFJO0FBQ2pCLFNBQU8sUUFBUTtBQUNqQjtBQUlPLFNBQVMsNkJBQ2QsTUFDQSxXQUN5QjtBQUN6QixRQUFNLE9BQWdDLEVBQUUsS0FBSztBQUM3QyxNQUFJLGNBQWMsT0FBVyxNQUFLLGFBQWE7QUFDL0MsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sSUFBSSxXQUFXLEtBQUssSUFBSSxFQUFFLFNBQVMsRUFBRSxDQUFDO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQ0Y7QUFJTyxTQUFTLHVCQUF1QixLQU05QjtBQUNQLE1BQUksSUFBSSxTQUFTLG9CQUFxQixRQUFPO0FBQzdDLFFBQU0sT0FBTyxJQUFJO0FBQ2pCLFFBQU0sV0FBVyxNQUFNO0FBQ3ZCLFFBQU0sYUFBYSxNQUFNO0FBQ3pCLE1BQUksT0FBTyxhQUFhLFlBQVksT0FBTyxlQUFlLFNBQVUsUUFBTztBQUMzRSxRQUFNLE9BQU8sTUFBTTtBQUNuQixRQUFNLGFBQ0osT0FBTyxTQUFTLFlBQVksU0FBUyxRQUFRLENBQUMsTUFBTSxRQUFRLElBQUksSUFDM0QsT0FDRCxDQUFDO0FBQ1AsUUFBTSxVQUFVLE1BQU07QUFDdEIsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBO0FBQUE7QUFBQSxJQUdBLGlCQUFpQixNQUFNLHFCQUFxQjtBQUFBLElBQzVDLEdBQUksT0FBTyxZQUFZLFdBQVcsRUFBRSxxQkFBcUIsUUFBUSxJQUFJLENBQUM7QUFBQSxFQUN4RTtBQUNGO0FBR08sU0FBUyw0QkFBcUQ7QUFDbkUsU0FBTztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sSUFBSSxpQkFBaUIsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQSxFQUM5QztBQUNGO0FBR08sU0FBUyxzQkFDZCxPQUNBLFNBQ3lCO0FBQ3pCLFNBQU87QUFBQSxJQUNMLE9BQU87QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLElBQUksWUFBWSxLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUFBLElBQ3ZDLE1BQU0sRUFBRSxPQUFPLFVBQVUsUUFBUTtBQUFBLEVBQ25DO0FBQ0Y7QUFHQSxTQUFTLGlCQUFpQixRQUEwRTtBQUNsRyxRQUFNLEVBQUUsWUFBWSxlQUFlLGdCQUFnQixJQUFJO0FBQ3ZELFNBQU8sRUFBRSxZQUFZLGVBQWUsaUJBQWlCLG1CQUFtQixHQUFHO0FBQzdFO0FBRUEsU0FBUyxnQkFDUCxTQUNBLFNBQ007QUFDTixhQUFXLFFBQVEsQ0FBQyxlQUFlLFlBQVksR0FBWTtBQUN6RCxVQUFNLFFBQVEsVUFBVSxJQUFJO0FBQzVCLFFBQUksTUFBTyxTQUFRLElBQUksSUFBSTtBQUFBLEVBQzdCO0FBQ0Y7QUFFQSxTQUFTLGNBQWMsY0FBOEI7QUFDbkQsUUFBTSxNQUFNLElBQUksSUFBSSxZQUFZO0FBQ2hDLE1BQUksV0FBVyxJQUFJLFNBQVMsUUFBUSxvQkFBb0IsaUJBQWlCO0FBQ3pFLE1BQUksU0FBUztBQUNiLE1BQUksT0FBTztBQUNYLFNBQU8sSUFBSSxTQUFTO0FBQ3RCO0FBR0EsU0FBUyxvQkFBb0IsSUFBc0M7QUFDakUsTUFBSSxHQUFHLHNCQUFzQixXQUFZLFFBQU8sUUFBUSxRQUFRO0FBQ2hFLFNBQU8sSUFBSSxRQUFRLENBQUMsWUFBWTtBQUM5QixVQUFNLFVBQVUsU0FBUyxFQUFFLFdBQVcsTUFBTTtBQUMxQyxTQUFHLG9CQUFvQiwyQkFBMkIsS0FBSztBQUN2RCxjQUFRO0FBQUEsSUFDVixHQUFHLEdBQUc7QUFDTixVQUFNLFFBQVEsTUFBTTtBQUNsQixVQUFJLEdBQUcsc0JBQXNCLFlBQVk7QUFDdkMscUJBQWEsT0FBTztBQUNwQixXQUFHLG9CQUFvQiwyQkFBMkIsS0FBSztBQUN2RCxnQkFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQ0EsT0FBRyxpQkFBaUIsMkJBQTJCLEtBQUs7QUFBQSxFQUN0RCxDQUFDO0FBQ0g7QUFLTyxTQUFTLGFBQWEsS0FBcUI7QUFDaEQsUUFBTSxVQUFVLENBQUMsR0FBRyxJQUFJLFNBQVMsZ0NBQWdDLENBQUMsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztBQUNuRixNQUFJLFFBQVEsV0FBVyxFQUFHLFFBQU87QUFFakMsUUFBTSxXQUFXLG9CQUFJLElBQVk7QUFDakMsUUFBTSxRQUFRLElBQUksTUFBTSxTQUFTO0FBQ2pDLFFBQU0sTUFBTSxNQUFNLElBQUksQ0FBQyxTQUFTO0FBQzlCLFVBQU0sSUFBSSxLQUFLLE1BQU0sd0JBQXdCO0FBQzdDLFFBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxTQUFTLEVBQUUsQ0FBQyxDQUFDLEVBQUcsUUFBTztBQUMxQyxhQUFTLElBQUksRUFBRSxDQUFDLENBQUU7QUFDbEIsV0FBTyxVQUFVLEVBQUUsQ0FBQyxDQUFDLElBQUksbUJBQW1CLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztBQUFBLEVBQ3pELENBQUM7QUFFRCxRQUFNLFVBQVUsUUFBUSxPQUFPLENBQUMsT0FBTyxPQUFPLFVBQWEsQ0FBQyxTQUFTLElBQUksRUFBRSxDQUFDO0FBQzVFLE1BQUksUUFBUSxXQUFXLEVBQUcsUUFBTyxJQUFJLEtBQUssTUFBTTtBQUVoRCxRQUFNLFdBQXFCLENBQUM7QUFDNUIsYUFBVyxRQUFRLEtBQUs7QUFDdEIsYUFBUyxLQUFLLElBQUk7QUFDbEIsVUFBTSxLQUFLLEtBQUssTUFBTSw4QkFBOEI7QUFDcEQsUUFBSSxNQUFNLFFBQVEsU0FBUyxHQUFHLENBQUMsQ0FBQyxHQUFHO0FBQ2pDLGVBQVMsS0FBSyxVQUFVLEdBQUcsQ0FBQyxDQUFDLDBCQUEwQjtBQUFBLElBQ3pEO0FBQUEsRUFDRjtBQUNBLFNBQU8sU0FBUyxLQUFLLE1BQU07QUFDN0I7QUFFQSxTQUFTLG1CQUFtQixRQUF3QjtBQUNsRCxNQUFJLE9BQU8sV0FBVyxLQUFLLE1BQU0sSUFDN0IsT0FBTyxRQUFRLGVBQWUsVUFBVSxJQUN4QyxHQUFHLE1BQU07QUFDYixTQUFPLGlCQUFpQixLQUFLLElBQUksSUFDN0IsS0FBSyxRQUFRLHFCQUFxQixnQkFBZ0IsSUFDbEQsR0FBRyxJQUFJO0FBQ1gsU0FBTztBQUNUO0FBL3ZCQSxJQTZEYSw0QkEyQkEsMkJBRUEsc0JBNENBO0FBdEliO0FBQUE7QUFBQTtBQVFBO0FBcURPLElBQU0sNkJBQTZCO0FBMkJuQyxJQUFNLDRCQUE0QjtBQUVsQyxJQUFNLHVCQUF1QjtBQTRDN0IsSUFBTSxjQUFOLE1BQWtCO0FBQUEsTUFZdkIsWUFDcUIsU0FDRixNQUNqQjtBQUZtQjtBQUNGO0FBWm5CO0FBQUEsYUFBUSxjQUFjO0FBQ3RCLGFBQVEsS0FBK0I7QUFDdkMsYUFBUSxLQUE0QjtBQUNwQyxhQUFRLGNBQWtDO0FBQzFDLGFBQVEsT0FBc0I7QUFDOUIsYUFBUSxRQUFvQjtBQUM1QixhQUFRLFdBQVc7QUFDbkIsYUFBUSxpQkFBaUI7QUFDekIsYUFBUSxrQkFBa0I7QUFBQSxNQUt2QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVVILE9BQU8sc0JBRUwsT0FDQSxPQUNBLE1BQ0c7QUFDSCxlQUFPLElBQUk7QUFBQSxVQUNUO0FBQUEsWUFDRSxZQUFZO0FBQUEsWUFDWixpQkFBaUI7QUFBQSxZQUNqQixlQUFlLE1BQU07QUFBQSxZQUNyQixhQUFhLE1BQU07QUFBQSxZQUNuQixvQkFBb0I7QUFBQSxVQUN0QjtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVFVLG9CQUE0QztBQUNwRCxlQUFPLENBQUM7QUFBQSxNQUNWO0FBQUE7QUFBQSxNQUdVLG9CQUE0QztBQUNwRCxlQUFPLEVBQUUsZ0JBQWdCLG1CQUFtQjtBQUFBLE1BQzlDO0FBQUE7QUFBQSxNQUdVLHFCQUE2QjtBQUNyQyxlQUFPLGNBQWMsS0FBSyxRQUFRLGFBQWE7QUFBQSxNQUNqRDtBQUFBO0FBQUEsTUFHVSxpQkFBaUU7QUFDekUsZUFBTyxFQUFFLFlBQVksS0FBSyxRQUFRLFlBQVksZUFBZSxLQUFLLFFBQVEsY0FBYztBQUFBLE1BQzFGO0FBQUE7QUFBQSxNQUdVLGtCQUFrQixNQUE4QixRQUF5QjtBQUNqRixlQUFPLFNBQVMsWUFDWixzREFDQSxxQ0FBcUMsTUFBTTtBQUFBLE1BQ2pEO0FBQUE7QUFBQSxNQUdVLGlCQUFpQixRQUFnQixZQUFvQixNQUFzQjtBQUNuRixjQUFNLFNBQ0osUUFBUSxPQUFPLFNBQVMsWUFBWSxPQUFRLEtBQThCLFdBQVcsV0FDaEYsS0FBNEIsU0FDN0I7QUFDTixlQUFPLElBQUksTUFBTSxxQkFBcUIsTUFBTSxNQUFNLE1BQU0sRUFBRTtBQUFBLE1BQzVEO0FBQUE7QUFBQSxNQUdBLE1BQWdCLGFBQTBDO0FBQ3hELGVBQVEsU0FBUyxFQUFFLGFBQWEsRUFBbUIsYUFBYSxlQUFlO0FBQUEsTUFDakY7QUFBQTtBQUFBLE1BR1Usc0JBQXNCLElBQXVCLFFBQWtDO0FBQ3ZGLFlBQUksQ0FBQyxPQUFRO0FBQ2IsbUJBQVcsU0FBUyxPQUFPLGVBQWUsRUFBRyxJQUFHLFNBQVMsT0FBTyxNQUFNO0FBQUEsTUFDeEU7QUFBQTtBQUFBLE1BR1Usa0JBQXVEO0FBQy9ELGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQSxNQUdVLG9CQUFvQixTQUE4QjtBQUFBLE1BQUM7QUFBQTtBQUFBLE1BR25ELHVCQUE2QjtBQUFBLE1BQUM7QUFBQTtBQUFBLE1BRzlCLE9BQWlDO0FBQ3pDLGVBQU8sS0FBSztBQUFBLE1BQ2Q7QUFBQTtBQUFBLE1BR1UsTUFBMEI7QUFDbEMsZUFBTyxLQUFLO0FBQUEsTUFDZDtBQUFBO0FBQUEsTUFHVSxVQUFVLE9BQXlDO0FBQzNELFlBQUksQ0FBQyxLQUFLLE1BQU0sS0FBSyxHQUFHLGVBQWUsT0FBUSxRQUFPO0FBQ3RELGFBQUssR0FBRyxLQUFLLEtBQUssVUFBVSxLQUFLLENBQUM7QUFDbEMsZUFBTztBQUFBLE1BQ1Q7QUFBQSxNQUVBLFdBQXVCO0FBQ3JCLGVBQU8sS0FBSztBQUFBLE1BQ2Q7QUFBQSxNQUVRLFNBQVMsTUFBa0I7QUFDakMsWUFBSSxLQUFLLFVBQVUsS0FBTTtBQUN6QixhQUFLLFFBQVE7QUFDYixhQUFLLEtBQUssZ0JBQWdCLElBQUk7QUFBQSxNQUNoQztBQUFBLE1BRUEsTUFBTSxVQUF5QjtBQUM3QixZQUFJLEtBQUssVUFBVSxPQUFRLE9BQU0sSUFBSSxNQUFNLHdCQUF3QixLQUFLLEtBQUssR0FBRztBQUNoRixhQUFLLFNBQVMsWUFBWTtBQUMxQixZQUFJO0FBQ0YsZ0JBQU0sY0FBYyxLQUFLLFFBQVEsZUFBZSxDQUFDLEdBQUcsSUFBSSxDQUFDLE9BQU87QUFBQSxZQUM5RCxNQUFNLEVBQUU7QUFBQSxZQUNSLFVBQVUsRUFBRTtBQUFBLFlBQ1osWUFBWSxFQUFFO0FBQUEsVUFDaEIsRUFBRTtBQUNGLGdCQUFNLEtBQUssS0FBSyxTQUFTLEdBQUUsa0JBQW1CO0FBQUEsWUFDNUMsWUFDRSxXQUFXLFNBQVMsSUFDaEIsYUFDQSxDQUFDLEVBQUUsTUFBTSwrQkFBK0IsQ0FBQztBQUFBLFVBQ2pELENBQUM7QUFDRCxlQUFLLEtBQUs7QUFFVixhQUFHLGlCQUFpQix5QkFBeUIsTUFBTTtBQUNqRCxnQkFBSSxLQUFLLFNBQVU7QUFDbkIsa0JBQU0sS0FBSyxHQUFHO0FBQ2QsZ0JBQUksT0FBTyxZQUFhLE1BQUssU0FBUyxXQUFXO0FBQUEscUJBQ3hDLE9BQU8sVUFBVTtBQUd4QixvQkFBTSxPQUFPLGlCQUFpQixLQUFLLFdBQVc7QUFDOUMsbUJBQUssU0FBUyxJQUFJO0FBQ2xCLGtCQUFJLFNBQVMsUUFBUyxNQUFLLEtBQUssVUFBVSxJQUFJLE1BQU0sMEJBQTBCLENBQUM7QUFBQSxtQkFJMUU7QUFDSCxxQkFBSyxLQUFLLFFBQVE7QUFDbEIscUJBQUsscUJBQXFCO0FBQUEsY0FDNUI7QUFBQSxZQUNGLFdBQVcsT0FBTyxZQUFZLE9BQU8sZ0JBQWdCO0FBQ25ELG1CQUFLLFNBQVMsY0FBYztBQUFBLFlBQzlCO0FBQUEsVUFDRixDQUFDO0FBRUQsYUFBRyxpQkFBaUIsU0FBUyxDQUFDLFVBQVU7QUFDdEMsZ0JBQUksS0FBSyxTQUFVO0FBQ25CLGtCQUFNLENBQUNDLE9BQU0sSUFBSSxNQUFNO0FBQ3ZCLGdCQUFJQSxRQUFRLE1BQUssS0FBSyxnQkFBZ0JBLE9BQU07QUFBQSxVQUM5QyxDQUFDO0FBRUQsZ0JBQU0sS0FBSyxHQUFHLGtCQUFrQixTQUFTO0FBQ3pDLGVBQUssS0FBSztBQUNWLGFBQUcsaUJBQWlCLFFBQVEsTUFBTTtBQUNoQyxnQkFBSSxDQUFDLEtBQUssU0FBVSxNQUFLLHFCQUFxQjtBQUFBLFVBQ2hELENBQUM7QUFDRCxhQUFHLGlCQUFpQixXQUFXLENBQUMsVUFBVTtBQUN4QyxnQkFBSSxLQUFLLFlBQVksT0FBTyxNQUFNLFNBQVMsU0FBVTtBQUNyRCxnQkFBSTtBQUNGLG9CQUFNLFNBQVMsS0FBSyxNQUFNLE1BQU0sSUFBSTtBQUNwQyxrQkFBSSxzQkFBc0IsTUFBTSxHQUFHO0FBQ2pDLHFCQUFLLGNBQWM7QUFDbkIsc0JBQU0sU0FBVSxPQUFPLE1BQTJDO0FBQ2xFLHFCQUFLLG9CQUFvQixPQUFPLFdBQVcsV0FBVyxTQUFTLElBQUk7QUFBQSxjQUNyRTtBQUNBLGtCQUFJLE9BQU8sU0FBUyxnQkFBZ0IsT0FBTyxTQUFTLFNBQVMsZUFBZTtBQUMxRSxxQkFBSyxLQUFLLFlBQVk7QUFDdEI7QUFBQSxjQUNGO0FBQ0EsbUJBQUssS0FBSyxlQUFlLE1BQU07QUFBQSxZQUNqQyxRQUFRO0FBQUEsWUFFUjtBQUFBLFVBQ0YsQ0FBQztBQUlELGdCQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVc7QUFDckMsZUFBSyxjQUFjO0FBQ25CLGVBQUssc0JBQXNCLElBQUksTUFBTTtBQUVyQyxnQkFBTSxLQUFLLFVBQVUsS0FBSztBQUFBLFFBQzVCLFNBQVMsS0FBSztBQUNaLGVBQUssU0FBUyxPQUFPO0FBQ3JCLGdCQUFNLEtBQUssUUFBUTtBQUNuQixnQkFBTSxRQUFRLGVBQWUsUUFBUSxNQUFNLElBQUksTUFBTSwwQkFBMEI7QUFDL0UsZUFBSyxLQUFLLFVBQVUsS0FBSztBQUN6QixnQkFBTTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsTUFFQSxNQUFjLFVBQVUsaUJBQXlDO0FBQy9ELGNBQU0sS0FBSyxLQUFLO0FBQ2hCLFlBQUksQ0FBQyxHQUFJLE9BQU0sSUFBSSxNQUFNLHFCQUFxQjtBQUM5QyxjQUFNLFFBQVEsTUFBTSxHQUFHLFlBQVk7QUFBQSxVQUNqQyx3QkFBd0I7QUFBQSxRQUMxQixDQUFvQjtBQUNwQixZQUFJLE1BQU0sSUFBSyxPQUFNLE1BQU0sYUFBYSxNQUFNLEdBQUc7QUFDakQsY0FBTSxHQUFHLG9CQUFvQixLQUFLO0FBQ2xDLGNBQU0sb0JBQW9CLEVBQUU7QUFDNUIsY0FBTSxRQUFRLEdBQUc7QUFDakIsWUFBSSxDQUFDLE1BQU8sT0FBTSxJQUFJLE1BQU0sY0FBYztBQUUxQyxjQUFNLFFBQVEsQ0FBQyxLQUFLLFFBQVEsY0FBYyxLQUFLLFFBQVE7QUFDdkQsY0FBTSxPQUFnQyxRQUNsQyxFQUFFLG9CQUFvQixPQUFPLEtBQUssTUFBTSxLQUFLLE1BQU0sTUFBTSxLQUFLLElBQzlEO0FBQUEsVUFDRSxLQUFLLE1BQU07QUFBQSxVQUNYLE1BQU0sTUFBTTtBQUFBLFVBQ1osWUFBWSxLQUFLLFFBQVE7QUFBQSxVQUN6QixjQUFjLEVBQUUsWUFBWSxLQUFLLFFBQVEsV0FBVztBQUFBLFFBQ3REO0FBQ0osWUFBSSxLQUFLLEtBQU0sTUFBSyxRQUFRLEtBQUs7QUFDakMsWUFBSSxnQkFBaUIsTUFBSyxhQUFhO0FBRXZDLGNBQU0sVUFBa0M7QUFBQSxVQUN0QyxnQkFBZ0I7QUFBQSxVQUNoQixHQUFHLEtBQUssa0JBQWtCO0FBQUEsUUFDNUI7QUFDQSx3QkFBZ0IsU0FBUyxLQUFLLFFBQVEsYUFBYTtBQUNuRCxjQUFNLE1BQU0sTUFBTSxTQUFTLEVBQUUsTUFBTSxLQUFLLFFBQVEsZUFBZTtBQUFBLFVBQzdELFFBQVE7QUFBQSxVQUNSO0FBQUEsVUFDQSxNQUFNLEtBQUssVUFBVSxJQUFJO0FBQUEsUUFDM0IsQ0FBQztBQUNELFlBQUksQ0FBQyxJQUFJLElBQUk7QUFDWCxjQUFJLFNBQWtCO0FBQ3RCLGNBQUk7QUFDRixxQkFBUyxNQUFNLElBQUksS0FBSztBQUFBLFVBQzFCLFFBQVE7QUFBQSxVQUVSO0FBQ0EsZ0JBQU0sS0FBSyxpQkFBaUIsSUFBSSxRQUFRLElBQUksWUFBWSxNQUFNO0FBQUEsUUFDaEU7QUFDQSxjQUFNLFNBQVUsTUFBTSxJQUFJLEtBQUs7QUFLL0IsYUFBSyxPQUFPLE9BQU87QUFFbkIsWUFBSSxTQUFTLE9BQU8sV0FBWSxRQUFPLE9BQU8sS0FBSyxTQUFTLGlCQUFpQixNQUFNLENBQUM7QUFDcEYsY0FBTSxHQUFHLHFCQUFxQixFQUFFLEtBQUssT0FBTyxLQUFLLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxNQUN0RTtBQUFBLE1BRUEsTUFBYyxjQUE2QjtBQUN6QyxZQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssU0FBVTtBQUMvQixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxVQUFVLElBQUk7QUFBQSxRQUMzQixTQUFTLEtBQUs7QUFDWixlQUFLLEtBQUssVUFBVSxlQUFlLFFBQVEsTUFBTSxJQUFJLE1BQU0sc0JBQXNCLENBQUM7QUFBQSxRQUNwRjtBQUFBLE1BQ0Y7QUFBQTtBQUFBO0FBQUEsTUFJQSx1QkFBNkI7QUFDM0IsYUFBSyxpQkFBaUI7QUFDdEIsYUFBSyxxQkFBcUI7QUFBQSxNQUM1QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFTQSxhQUFhLE1BQXVCO0FBQ2xDLGNBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsWUFBSSxDQUFDLFFBQVMsUUFBTztBQUNyQixZQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxlQUFlLE9BQVEsUUFBTztBQUN0RCxhQUFLLEdBQUcsS0FBSyxLQUFLLFVBQVUsc0JBQXNCLE9BQU8sQ0FBQyxDQUFDO0FBQzNELGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFRQSxxQkFBcUIsWUFBb0IsUUFBZ0IsVUFBVSxPQUFnQjtBQUNqRixZQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxlQUFlLE9BQVEsUUFBTztBQUN0RCxhQUFLLEdBQUcsS0FBSyxLQUFLLFVBQVUsZ0NBQWdDLFlBQVksUUFBUSxPQUFPLENBQUMsQ0FBQztBQUN6RixlQUFPO0FBQUEsTUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BUUEsb0JBQW9CLFlBQW9CLFlBQThCO0FBQ3BFLFlBQUksQ0FBQyxLQUFLLE1BQU0sS0FBSyxHQUFHLGVBQWUsT0FBUSxRQUFPO0FBQ3RELGFBQUssR0FBRyxLQUFLLEtBQUssVUFBVSw2QkFBNkIsWUFBWSxVQUFVLENBQUMsQ0FBQztBQUNqRixlQUFPO0FBQUEsTUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFTQSxxQkFBcUIsTUFBYyxXQUE2QjtBQUM5RCxZQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxlQUFlLE9BQVEsUUFBTztBQUN0RCxhQUFLLEdBQUcsS0FBSyxLQUFLLFVBQVUsNkJBQTZCLE1BQU0sU0FBUyxDQUFDLENBQUM7QUFDMUUsZUFBTztBQUFBLE1BQ1Q7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFPQSxtQkFBNEI7QUFDMUIsZUFBTyxLQUFLLFVBQVUsMEJBQTBCLENBQUM7QUFBQSxNQUNuRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU9BLGFBQWEsT0FBa0MsU0FBMEI7QUFDdkUsZUFBTyxLQUFLLFVBQVUsc0JBQXNCLE9BQU8sT0FBTyxDQUFDO0FBQUEsTUFDN0Q7QUFBQSxNQUVRLHVCQUE2QjtBQUNuQyxZQUFJLEtBQUssbUJBQW1CLENBQUMsS0FBSyxlQUFnQjtBQUNsRCxZQUFJLENBQUMsS0FBSyxNQUFNLEtBQUssR0FBRyxlQUFlLE9BQVE7QUFDL0MsY0FBTSxPQUFPLEtBQUssZ0JBQWdCO0FBQ2xDLGFBQUssR0FBRztBQUFBLFVBQ04sS0FBSyxVQUFVO0FBQUEsWUFDYixPQUFPO0FBQUEsWUFDUCxNQUFNO0FBQUEsWUFDTixJQUFJLGdCQUFnQixLQUFLLElBQUksRUFBRSxTQUFTLEVBQUUsQ0FBQztBQUFBLFlBQzNDLEdBQUksT0FBTyxFQUFFLEtBQUssSUFBSSxDQUFDO0FBQUEsVUFDekIsQ0FBQztBQUFBLFFBQ0g7QUFDQSxhQUFLLGtCQUFrQjtBQUFBLE1BQ3pCO0FBQUEsTUFFQSxxQkFBcUIsU0FBd0I7QUFDM0MsWUFBSSxDQUFDLEtBQUssWUFBYTtBQUN2QixtQkFBVyxTQUFTLEtBQUssWUFBWSxlQUFlLEVBQUcsT0FBTSxVQUFVO0FBQUEsTUFDekU7QUFBQSxNQUVBLE1BQU0sYUFBNEI7QUFDaEMsYUFBSyxXQUFXO0FBTWhCLGNBQU0sUUFBUSxLQUFLLGVBQWU7QUFDbEMsWUFBSSxLQUFLLGFBQWE7QUFBQSxRQUd0QixXQUFXLENBQUMsTUFBTSxlQUFlO0FBQy9CLGtCQUFRLEtBQUssS0FBSyxrQkFBa0IsU0FBUyxDQUFDO0FBQUEsUUFDaEQsT0FBTztBQUNMLGNBQUk7QUFDRixrQkFBTSxNQUFNLE1BQU0sU0FBUyxFQUFFLE1BQU0sS0FBSyxtQkFBbUIsR0FBRztBQUFBLGNBQzVELFFBQVE7QUFBQSxjQUNSLFNBQVMsS0FBSyxrQkFBa0I7QUFBQSxjQUNoQyxNQUFNLEtBQUssVUFBVSxLQUFLO0FBQUEsY0FDMUIsV0FBVztBQUFBLFlBQ2IsQ0FBQztBQUNELGdCQUFJLENBQUMsSUFBSSxJQUFJO0FBRVgsc0JBQVEsS0FBSyxLQUFLLGtCQUFrQixZQUFZLElBQUksTUFBTSxDQUFDO0FBQUEsWUFDN0Q7QUFBQSxVQUNGLFFBQVE7QUFBQSxVQUVSO0FBQUEsUUFDRjtBQUNBLGNBQU0sS0FBSyxRQUFRO0FBQ25CLGFBQUssU0FBUyxjQUFjO0FBQUEsTUFDOUI7QUFBQSxNQUVBLE1BQWMsVUFBeUI7QUFDckMsWUFBSTtBQUNGLGVBQUssSUFBSSxNQUFNO0FBQUEsUUFDakIsUUFBUTtBQUFBLFFBRVI7QUFDQSxhQUFLLEtBQUs7QUFDVixZQUFJO0FBQ0YsZUFBSyxJQUFJLE1BQU07QUFBQSxRQUNqQixRQUFRO0FBQUEsUUFFUjtBQUNBLGFBQUssS0FBSztBQUNWLFlBQUksS0FBSyxhQUFhO0FBQ3BCLHFCQUFXLFNBQVMsS0FBSyxZQUFZLFVBQVUsRUFBRyxPQUFNLEtBQUs7QUFDN0QsZUFBSyxjQUFjO0FBQUEsUUFDckI7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBO0FBQUE7OztBQ25qQkE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUMyQ08sU0FBUyxzQkFBc0IsTUFBK0Q7QUFDbkcsUUFBTSxhQUFhLE1BQU07QUFDekIsUUFBTSxXQUFXLE1BQU07QUFDdkIsUUFBTSxRQUFRLE1BQU07QUFDcEIsTUFBSSxPQUFPLGVBQWUsWUFBWSxPQUFPLGFBQWEsWUFBWSxPQUFPLFVBQVUsVUFBVTtBQUMvRixXQUFPO0FBQUEsRUFDVDtBQUNBLFFBQU0sU0FBUyxNQUFNO0FBQ3JCLFFBQU0sYUFDSixPQUFPLFdBQVcsWUFBWSxXQUFXLFFBQVEsQ0FBQyxNQUFNLFFBQVEsTUFBTSxJQUNqRSxTQUNELENBQUM7QUFDUCxTQUFPO0FBQUEsSUFDTCxXQUFXLE9BQU8sTUFBTSxlQUFlLFdBQVcsS0FBSyxhQUFhO0FBQUEsSUFDcEU7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBLEdBQUksT0FBTyxNQUFNLDBCQUEwQixXQUN2QyxFQUFFLHFCQUFxQixLQUFLLHNCQUFzQixJQUNsRCxDQUFDO0FBQUEsSUFDTCxHQUFJLE9BQU8sTUFBTSxXQUFXLFdBQVcsRUFBRSxRQUFRLEtBQUssT0FBTyxJQUFJLENBQUM7QUFBQSxJQUNsRSxHQUFJLE9BQU8sTUFBTSxrQkFBa0IsV0FBVyxFQUFFLGNBQWMsS0FBSyxjQUFjLElBQUksQ0FBQztBQUFBLEVBQ3hGO0FBQ0Y7QUFXTyxTQUFTLDJCQUEyQixNQUFzQjtBQUMvRCxTQUFPLHlCQUF5QixJQUFJO0FBQ3RDO0FBR08sU0FBUywwQkFBMEIsT0FBd0I7QUFDaEUsTUFBSSxVQUFVLE9BQVcsUUFBTztBQUNoQyxNQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU87QUFDdEMsTUFBSTtBQUNGLFdBQU8sS0FBSyxVQUFVLEtBQUs7QUFBQSxFQUM3QixRQUFRO0FBQ04sV0FBTyxPQUFPLEtBQUs7QUFBQSxFQUNyQjtBQUNGO0FBT0EsZUFBc0IsY0FDcEIsVUFDQSxNQUNBLGFBQ2tDO0FBQ2xDLFFBQU0sVUFBVSxTQUFTLEtBQUssUUFBUTtBQUN0QyxNQUFJLE9BQU8sWUFBWSxZQUFZO0FBQ2pDLFFBQUksYUFBYTtBQUNmLFVBQUk7QUFDRixvQkFBWSxJQUFJO0FBQUEsTUFDbEIsUUFBUTtBQUFBLE1BRVI7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUNBLFdBQU8sRUFBRSxRQUFRLDJCQUEyQixLQUFLLFFBQVEsR0FBRyxTQUFTLEtBQUs7QUFBQSxFQUM1RTtBQUNBLE1BQUk7QUFDRixVQUFNLFFBQVEsTUFBTSxRQUFRLEtBQUssVUFBVTtBQUMzQyxXQUFPLEVBQUUsUUFBUSwwQkFBMEIsS0FBSyxHQUFHLFNBQVMsTUFBTTtBQUFBLEVBQ3BFLFNBQVMsS0FBSztBQUNaLFVBQU0sVUFBVSxlQUFlLFFBQVEsSUFBSSxVQUFVLE9BQU8sR0FBRztBQUMvRCxXQUFPLEVBQUUsUUFBUSxpQ0FBaUMsT0FBTyxJQUFJLFNBQVMsS0FBSztBQUFBLEVBQzdFO0FBQ0Y7QUExSEEsSUEyRWE7QUEzRWI7QUFBQTtBQUFBO0FBMkVPLElBQU0sOEJBQThCO0FBQUE7QUFBQTs7O0FDOURwQyxTQUFTLFVBQVUsT0FBMkM7QUFDbkUsTUFBSSxVQUFVLE9BQVEsUUFBTztBQUM3QixNQUFJLFVBQVUsUUFBUyxRQUFPO0FBQzlCLFNBQU87QUFDVDtBQXVDTyxTQUFTLGdCQUFnQixLQUFvQixPQUEwRDtBQUM1RyxNQUFJLENBQUMsSUFBSyxRQUFPLENBQUM7QUFDbEIsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLEtBQUssTUFBTSxHQUFHO0FBQUEsRUFDekIsUUFBUTtBQUNOLFVBQU0sRUFBRSxNQUFNLHdCQUF3QixDQUFDO0FBQ3ZDLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDQSxNQUFJLENBQUMsVUFBVSxPQUFPLFdBQVcsWUFBWSxNQUFNLFFBQVEsTUFBTSxHQUFHO0FBQ2xFLFVBQU0sRUFBRSxNQUFNLHdCQUF3QixDQUFDO0FBQ3ZDLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDQSxRQUFNLE1BQThDLENBQUM7QUFDckQsYUFBVyxDQUFDLEtBQUssS0FBSyxLQUFLLE9BQU8sUUFBUSxNQUFpQyxHQUFHO0FBQzVFLFFBQUksT0FBTyxVQUFVLFNBQVU7QUFDL0IsVUFBTSxTQUFTLGNBQWMsSUFBSSxHQUFHLElBQUssTUFBd0Isb0JBQW9CLEdBQUc7QUFDeEYsUUFBSSxPQUFRLEtBQUksTUFBTSxJQUFJO0FBQUEsUUFDckIsT0FBTSxFQUFFLE1BQU0sOEJBQThCLElBQUksQ0FBQztBQUFBLEVBQ3hEO0FBQ0EsU0FBTztBQUNUO0FBT08sU0FBUyxrQkFDZCxLQUNBLE1BQ0EsT0FDcUI7QUFDckIsUUFBTSxNQUEyQixFQUFFLEdBQUcsSUFBSTtBQUMxQyxhQUFXLENBQUMsTUFBTSxHQUFHLEtBQUssb0JBQW9CO0FBQzVDLFVBQU0sUUFBUSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQ2xDLFFBQUksVUFBVSxPQUFXLEtBQUksR0FBRyxJQUFJO0FBQUEsRUFDdEM7QUFDQSxRQUFNLFVBQVUsS0FBSyxTQUFTO0FBQzlCLE1BQUksV0FBWSxTQUErQixTQUFTLE9BQU8sRUFBRyxLQUFJLFVBQVU7QUFDaEYsUUFBTSxZQUFZLEtBQUssV0FBVztBQUNsQyxNQUFJLGFBQWMsV0FBaUMsU0FBUyxTQUFTLEdBQUc7QUFDdEUsUUFBSSxZQUFZO0FBQUEsRUFDbEI7QUFDQSxRQUFNLFdBQVcsS0FBSyxXQUFXO0FBQ2pDLE1BQUksU0FBVSxLQUFJLFFBQVEsRUFBRSxHQUFHLElBQUksT0FBTyxtQkFBbUIsU0FBUztBQUN0RSxRQUFNLE9BQU8sZ0JBQWdCLEtBQUssZUFBZSxHQUFHLEtBQUs7QUFDekQsTUFBSSxPQUFPLEtBQUssSUFBSSxFQUFFLFNBQVMsRUFBRyxLQUFJLE9BQU8sRUFBRSxHQUFHLElBQUksTUFBTSxHQUFHLEtBQUs7QUFDcEUsU0FBTztBQUNUO0FBZ0JPLFNBQVMsbUJBQW1CLE1BQXVEO0FBQ3hGLFFBQU0sTUFBK0IsQ0FBQztBQUN0QyxhQUFXLENBQUMsTUFBTSxLQUFLLElBQUksS0FBSyxxQkFBcUI7QUFDbkQsVUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyQixRQUFJLFFBQVEsUUFBUSxRQUFRLEdBQUk7QUFDaEMsUUFBSSxTQUFTLFVBQVU7QUFDckIsWUFBTSxRQUFRLE9BQU8sR0FBRztBQUN4QixVQUFJLE9BQU8sU0FBUyxLQUFLLEVBQUcsS0FBSSxHQUFHLElBQUk7QUFBQSxJQUN6QyxXQUFXLFNBQVMsV0FBVztBQUM3QixZQUFNLFFBQVEsVUFBVSxHQUFHO0FBQzNCLFVBQUksVUFBVSxPQUFXLEtBQUksR0FBRyxJQUFJO0FBQUEsSUFDdEMsT0FBTztBQUNMLFVBQUksR0FBRyxJQUFJO0FBQUEsSUFDYjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLE9BQU8sS0FBSyxHQUFHLEVBQUUsU0FBUyxJQUFJLE1BQU07QUFDN0M7QUFHTyxTQUFTLGFBQWEsUUFBaUIsVUFBbUIsYUFBc0M7QUFDckcsTUFBSSxXQUFXLFNBQVUsUUFBTztBQUNoQyxNQUFJLFdBQVcsV0FBWSxRQUFPLGNBQWMsUUFBUTtBQUN4RCxNQUFJLFdBQVcsU0FBVSxRQUFPLFdBQVksY0FBYyxRQUFRLE9BQVE7QUFDMUUsU0FBTztBQUNUO0FBMEJPLFNBQVMsY0FBYyxNQUFjLGFBQTRCLFFBQXVDO0FBQzdHLE1BQUksZ0JBQWdCLE9BQVEsUUFBTztBQUNuQyxRQUFNLE1BQU8sUUFBcUQ7QUFDbEUsUUFBTSxVQUFVLE9BQU8sUUFBUSxXQUFXLElBQUksS0FBSyxJQUFJO0FBQ3ZELFVBQVEsTUFBTTtBQUFBLElBQ1osS0FBSztBQUNILGFBQU8sVUFBVSxFQUFFLE1BQU0sZ0JBQWdCLFFBQVEsSUFBSTtBQUFBLElBQ3ZELEtBQUs7QUFDSCxhQUFPLEVBQUUsTUFBTSxnQkFBZ0I7QUFBQSxJQUNqQyxLQUFLO0FBQ0gsYUFBTyxVQUFVLEVBQUUsTUFBTSxxQkFBcUIsUUFBUSxJQUFJO0FBQUEsSUFDNUQ7QUFDRSxhQUFPO0FBQUEsRUFDWDtBQUNGO0FBekxBLElBeUJhLG9CQU9QLFVBQ0EsWUFnQk8scUJBSVAsZUF1RE8scUJBd0NBLHNCQU9BLGNBR0E7QUE5SmI7QUFBQTtBQUFBO0FBT0E7QUFrQk8sSUFBTSxxQkFBcUI7QUFBQSxNQUNoQyxDQUFDLHFCQUFxQixtQkFBbUI7QUFBQSxNQUN6QyxDQUFDLHNCQUFzQix1QkFBdUI7QUFBQSxNQUM5QyxDQUFDLHFDQUFxQyxtQ0FBbUM7QUFBQSxNQUN6RSxDQUFDLDhCQUE4Qiw0QkFBNEI7QUFBQSxJQUM3RDtBQUVBLElBQU0sV0FBcUMsQ0FBQyxRQUFRLFdBQVcsTUFBTTtBQUNyRSxJQUFNLGFBQXlDO0FBQUEsTUFDN0M7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFTTyxJQUFNLHNCQUErRDtBQUFBLE1BQzFFLHNCQUFzQjtBQUFBLElBQ3hCO0FBRUEsSUFBTSxnQkFBcUMsSUFBSSxJQUFJLGdCQUFnQjtBQXVENUQsSUFBTSxzQkFBc0I7QUFBQSxNQUNqQyxDQUFDLG1CQUFtQixpQkFBaUIsUUFBUTtBQUFBLE1BQzdDLENBQUMsZ0JBQWdCLE9BQU8sUUFBUTtBQUFBLE1BQ2hDLENBQUMsMEJBQTBCLGlCQUFpQixRQUFRO0FBQUEsTUFDcEQsQ0FBQyxxQkFBcUIsWUFBWSxRQUFRO0FBQUEsTUFDMUMsQ0FBQyxxQkFBcUIsU0FBUyxRQUFRO0FBQUEsTUFDdkMsQ0FBQyxrQkFBa0IsZUFBZSxRQUFRO0FBQUEsTUFDMUMsQ0FBQyxzQkFBc0IsbUJBQW1CLFFBQVE7QUFBQSxNQUNsRCxDQUFDLDZCQUE2QixvQkFBb0IsUUFBUTtBQUFBLE1BQzFELENBQUMsc0JBQXNCLGFBQWEsU0FBUztBQUFBLElBQy9DO0FBOEJPLElBQU0sdUJBQXVCO0FBQUEsTUFDbEM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFHTyxJQUFNLGVBQWU7QUFHckIsSUFBTSxhQUFhO0FBQUE7QUFBQTs7O0FDcEVuQixTQUFTLG9CQUFvQixLQUE2QjtBQUMvRCxNQUFJLEVBQUUsZUFBZSxtQkFBbUIsSUFBSSxXQUFXLElBQUssUUFBTztBQUNuRSxTQUFPLElBQUksUUFBUSxLQUFLLEtBQUs7QUFDL0I7QUE3RkEsSUFrSGEsbUJBMG9EUCxzQkFLQTtBQWp3RE47QUFBQTtBQUFBO0FBK0JBO0FBU0E7QUFDQTtBQUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFNQTtBQUNBO0FBQ0E7QUFTQTtBQU9BO0FBd0NPLElBQU0sb0JBQU4sY0FBZ0MsWUFBWTtBQUFBLE1Bc0hqRCxjQUFjO0FBQ1osY0FBTTtBQXRHUixhQUFRLE1BQXdCO0FBT2hDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHlCQUEwQztBQVMxQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsZ0NBQTRDO0FBUTVDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsMkJBQWlELENBQUM7QUFHbEQ7QUFBQTtBQUFBLHlDQUFxRTtBQVNyRTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsNkJBQXNEO0FBSXREO0FBQUE7QUFBQTtBQUFBLHVCQUE2RDtBQUk3RDtBQUFBO0FBQUE7QUFBQSxzQkFBd0I7QUFDeEIsYUFBUSxNQUEyQixZQUFZLE1BQVM7QUFDeEQsYUFBUSxZQUFZO0FBQ3BCLGFBQVEsWUFBc0IsQ0FBQztBQUMvQixhQUFRLFlBQTJCO0FBQ25DLGFBQVEsU0FBUztBQUdqQjtBQUFBLGFBQVEsV0FBVztBQUVuQjtBQUFBLGFBQVEsZUFBZTtBQUN2QixhQUFRLFFBQVE7QUFDaEIsYUFBUSxPQUFhO0FBQ3JCLGFBQVEsY0FBMkI7QUFHbkM7QUFBQTtBQUFBLGFBQVEscUJBQXFCO0FBQzdCLGFBQVEsUUFBUTtBQUNoQixhQUFRLG9CQUFvQjtBQUM1QixhQUFRLG1CQUFrQztBQUMxQyxhQUFRLFFBQTBCO0FBQ2xDLGFBQVEsMkJBQTJCO0FBQ25DLGFBQVEsb0JBQXlDO0FBR2pEO0FBQUEsYUFBUSxRQUE0QjtBQUNwQyxhQUFRLHNCQUFxQztBQUM3QyxhQUFRLGdCQUErQjtBQUN2QyxhQUFRLHFCQUFvQztBQUs1QztBQUFBO0FBQUE7QUFBQTtBQUFBLGFBQVEsbUJBQWlDO0FBQ3pDLGFBQVEsV0FBVztBQUNuQixhQUFRLFdBQStCO0FBQ3ZDLGFBQVEsYUFBYTtBQUVyQjtBQUFBLGFBQVEscUJBQTJDLENBQUM7QUFFcEQ7QUFBQSxhQUFRLDBCQUEwQjtBQWNsQyxhQUFRLFdBQStCO0FBQ3ZDLGFBQVEsT0FBb0IsQ0FBQztBQStCN0I7QUFBQSxhQUFpQixpQkFBaUIsQ0FBQyxVQUF1QjtBQUN4RCxnQkFBTSxTQUFTLGNBQWMsTUFBTSxNQUFNLEtBQUssYUFBYSxjQUFjLEdBQUksTUFBc0IsTUFBTTtBQUN6RyxjQUFJLENBQUMsT0FBUTtBQUNiLGNBQUksT0FBTyxTQUFTLHFCQUFxQjtBQUN2QyxpQkFBSyxLQUFLLHFCQUFxQixPQUFPLE9BQU8sRUFBRSxLQUFLLENBQUMsU0FBUztBQUM1RCxrQkFBSSxDQUFDLEtBQU0sTUFBSyxNQUFNLEVBQUUsTUFBTSxtQkFBbUIsT0FBTyxNQUFNLEtBQUssQ0FBQztBQUFBLFlBQ3RFLENBQUM7QUFDRDtBQUFBLFVBQ0Y7QUFDQSxjQUFJLE9BQU8sU0FBUyxpQkFBaUI7QUFDbkMsZ0JBQUksS0FBSyxNQUFPLE1BQUssTUFBTSxpQkFBaUI7QUFBQSxnQkFFdkMsTUFBSyxNQUFNLEVBQUUsTUFBTSxLQUFLLGdCQUFnQiwrQkFBK0IsbUJBQW1CLE9BQU8sTUFBTSxLQUFLLENBQUM7QUFDbEg7QUFBQSxVQUNGO0FBQ0EsY0FBSSxLQUFLLE9BQU87QUFDZCxnQkFBSSxLQUFLLE1BQU0sYUFBYSxPQUFPLE9BQU8sRUFBRyxNQUFLLGNBQWMsUUFBUSxPQUFPLE9BQU87QUFBQSxVQUN4RixXQUFXLEtBQUssaUJBQWlCLENBQUMsS0FBSyxVQUFVO0FBQy9DLGlCQUFLLEtBQUssU0FBUyxPQUFPLE9BQU87QUFBQSxVQUNuQyxPQUFPO0FBQ0wsaUJBQUssTUFBTSxFQUFFLE1BQU0sS0FBSyxXQUFXLGlCQUFpQixtQkFBbUIsT0FBTyxNQUFNLEtBQUssQ0FBQztBQUFBLFVBQzVGO0FBQUEsUUFDRjtBQUdBO0FBQUEsYUFBaUIsZ0JBQWdCLENBQUMsVUFBdUI7QUFDdkQsZ0JBQU0sU0FBVSxNQUFzQjtBQUN0QyxjQUFJLENBQUMsVUFBVSxPQUFPLFdBQVcsWUFBWSxPQUFPLGtCQUFtQjtBQUN2RSxpQkFBTyxvQkFBb0I7QUFDM0IsY0FBSSxDQUFDLEtBQUssYUFBYztBQUN4QixnQkFBTSxPQUFPLGFBQWEsT0FBTyxRQUFRLEtBQUssVUFBVSxLQUFLLFdBQVc7QUFDeEUsY0FBSSxTQUFTLFFBQVEsU0FBUyxLQUFLLFNBQVU7QUFDN0MsZUFBSyxXQUFXO0FBQ2hCLGVBQUssYUFBYTtBQUFBLFFBQ3BCO0FBOFhBLGFBQVEsYUFBdUM7QUFDL0MsYUFBUSxvQkFBOEM7QUF1QnRELGFBQVEsVUFBb0M7QUFDNUMsYUFBUSxZQUFzQztBQXBkNUMsYUFBSyxTQUFTLEtBQUssYUFBYSxFQUFFLE1BQU0sT0FBTyxDQUFDO0FBRWhELG1CQUFXLFFBQVEscUJBQXNCLE1BQUssaUJBQWlCLE1BQU0sS0FBSyxjQUFjO0FBRXhGLGFBQUssaUJBQWlCLGNBQWMsS0FBSyxhQUFhO0FBQUEsTUFDeEQ7QUFBQSxNQTVIQTtBQUFBLGFBQU8scUJBQXFCO0FBQUEsVUFDMUI7QUFBQSxVQUNBO0FBQUE7QUFBQSxVQUVBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUE7QUFBQSxNQWlIQSxvQkFBMEI7QUFDeEIsaUJBQVMsaUJBQWlCLGNBQWMsS0FBSyxhQUFhO0FBQzFELFlBQUksQ0FBQyxLQUFLLFFBQVE7QUFDaEIsZUFBSyxTQUFTO0FBQ2QsZUFBSyxLQUFLLFVBQVU7QUFBQSxRQUN0QjtBQUFBLE1BQ0Y7QUFBQSxNQUVBLHVCQUE2QjtBQUMzQixpQkFBUyxvQkFBb0IsY0FBYyxLQUFLLGFBQWE7QUFDN0QsYUFBSyxZQUFZO0FBQ2pCLGFBQUssS0FBSyxpQkFBaUIsTUFBTTtBQUFBLE1BQ25DO0FBQUEsTUFFUSxNQUFNLE9BQXNDO0FBQ2xELFlBQUksS0FBSyxRQUFTLE1BQUssUUFBUSxLQUFLO0FBQUEsWUFDL0IsU0FBUSxNQUFNLGlCQUFpQixLQUFLO0FBQUEsTUFDM0M7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUE0Q1EsYUFBYSxVQUFxQztBQUN4RCxjQUFNLFNBQTJCO0FBQUEsVUFDL0IsU0FBUyxLQUFLLGFBQWEsVUFBVSxLQUFLO0FBQUEsVUFDMUMsVUFBVSxLQUFLO0FBQUEsVUFDZixXQUFXLEtBQUssaUJBQWlCO0FBQUEsVUFDakMsa0JBQWtCLEtBQUssd0JBQXdCO0FBQUEsVUFDL0MsYUFBYSxLQUFLO0FBQUEsVUFDbEIsUUFBUSxLQUFLLFVBQVUsS0FBSyxhQUFhLFNBQVM7QUFBQSxVQUNsRDtBQUFBLFFBQ0Y7QUFDQSxhQUFLLGNBQWMsSUFBSSxZQUFZLFlBQVksRUFBRSxTQUFTLE1BQU0sVUFBVSxNQUFNLFFBQVEsRUFBRSxPQUFPLEVBQUUsQ0FBQyxDQUFDO0FBQ3JHLFlBQUksT0FBTyxlQUFlLE9BQU8sT0FBTyxnQkFBZ0IsU0FBVSxNQUFLLGNBQWMsT0FBTztBQUM1RixlQUFPO0FBQUEsTUFDVDtBQUFBLE1BRUEsMkJBQWlDO0FBQy9CLFlBQUksQ0FBQyxLQUFLLE9BQVE7QUFDbEIsYUFBSyxLQUFLLFVBQVU7QUFBQSxNQUN0QjtBQUFBO0FBQUE7QUFBQSxNQUtRLDBCQUFtRDtBQUN6RCxZQUFJLEtBQUssaUJBQWtCLFFBQU8sS0FBSztBQUN2QyxjQUFNLE9BQU8sS0FBSyxhQUFhLG1CQUFtQjtBQUNsRCxZQUFJLENBQUMsS0FBTSxRQUFPO0FBQ2xCLFlBQUk7QUFDRixnQkFBTSxTQUFrQixLQUFLLE1BQU0sSUFBSTtBQUN2QyxpQkFBTyxVQUFVLE9BQU8sV0FBVyxZQUFZLENBQUMsTUFBTSxRQUFRLE1BQU0sSUFDL0QsU0FDRDtBQUFBLFFBQ04sUUFBUTtBQUNOLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtRLG1CQUFpRDtBQUN2RCxjQUFNLFNBQVMsbUJBQW1CLENBQUMsU0FBUyxLQUFLLGFBQWEsSUFBSSxDQUFDO0FBQ25FLGNBQU0sV0FBVyxLQUFLLGtCQUFrQjtBQUN4QyxZQUFJLENBQUMsT0FBUSxRQUFPO0FBQ3BCLGVBQU8sRUFBRSxHQUFHLFFBQVEsR0FBSSxZQUFZLENBQUMsRUFBRztBQUFBLE1BQzFDO0FBQUEsTUFFUSxvQkFBa0Q7QUFDeEQsWUFBSSxLQUFLLFVBQVcsUUFBTyxLQUFLO0FBQ2hDLGNBQU0sT0FBTyxLQUFLLGFBQWEsV0FBVztBQUMxQyxZQUFJLENBQUMsS0FBTSxRQUFPO0FBQ2xCLFlBQUk7QUFDRixnQkFBTSxTQUFrQixLQUFLLE1BQU0sSUFBSTtBQUN2QyxpQkFBTyxVQUFVLE9BQU8sV0FBVyxZQUFZLENBQUMsTUFBTSxRQUFRLE1BQU0sSUFDL0QsU0FDRDtBQUFBLFFBQ04sUUFBUTtBQUNOLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFBQSxNQUVRLGdCQUF3QjtBQUM5QixjQUFNLE9BQU8sS0FBSyxhQUFhLFlBQVk7QUFDM0MsWUFBSSxLQUFNLFFBQU8sS0FBSyxRQUFRLE9BQU8sRUFBRTtBQUV2QyxZQUFJLHFCQUFzQixRQUFPO0FBQ2pDLFlBQUksY0FBZSxRQUFPO0FBQzFCLGVBQU8sT0FBTyxTQUFTO0FBQUEsTUFDekI7QUFBQSxNQUVBLE1BQWMsWUFBMkI7QUFDdkMsY0FBTSxXQUFXLEtBQUssYUFBYSxVQUFVLEtBQUs7QUFHbEQsY0FBTSxZQUFZLEtBQUssYUFBYSxZQUFZO0FBQ2hELGFBQUssTUFBTSxXQUNQLElBQUksVUFBVSxLQUFLLGNBQWMsR0FBRyxVQUFVLFNBQVMsSUFDdkQ7QUFFSixjQUFNLFNBQVMsS0FBSyxhQUFhLGFBQWE7QUFDOUMsWUFBSSxTQUFvQztBQUN4QyxZQUFJLFFBQVE7QUFDVixjQUFJO0FBQ0YscUJBQVMsS0FBSyxNQUFNLE1BQU07QUFBQSxVQUM1QixRQUFRO0FBQ04scUJBQVM7QUFBQSxVQUNYO0FBQUEsUUFDRjtBQUNBLFlBQUksQ0FBQyxVQUFVLEtBQUssS0FBSztBQUN2QixjQUFJO0FBQ0YscUJBQVMsTUFBTSxLQUFLLElBQUksWUFBWTtBQUFBLFVBQ3RDLFNBQVMsS0FBSztBQUdaLGdCQUFJLGVBQWUsa0JBQWtCLElBQUksV0FBVyxJQUFLO0FBQ3pEO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFDQSxZQUFJLENBQUMsT0FBUTtBQUdiLGNBQU0sVUFBVTtBQUFBLFVBQ2QsWUFBWSxPQUFPLE1BQXNDO0FBQUEsVUFDekQsQ0FBQyxTQUFTLEtBQUssYUFBYSxJQUFJO0FBQUEsVUFDaEMsQ0FBQyxVQUFVLEtBQUssTUFBTSxLQUFLO0FBQUEsUUFDN0I7QUFNQSxZQUFJLEtBQUssZ0JBQWdCLEtBQUssUUFBUTtBQUNwQyxnQkFBTSxhQUFhLENBQUMsTUFDbEIsS0FBSyxVQUFVLEVBQUUsR0FBRyxHQUFHLFFBQVEsTUFBTSxPQUFPLEtBQUssQ0FBQztBQUNwRCxnQkFBTSxlQUNKLEtBQUssVUFBVSxRQUFRLE1BQU0sTUFBTSxLQUFLLFVBQVUsS0FBSyxJQUFJLE1BQU07QUFDbkUsY0FDRSxXQUFXLE9BQU8sTUFBTSxXQUFXLEtBQUssR0FBRyxLQUMzQyxpQkFDQyxPQUFPLGNBQWMsZ0JBQWdCLEtBQUssYUFDM0MsS0FBSyxVQUFVLE9BQU8sYUFBYSxDQUFDLENBQUMsTUFBTSxLQUFLLFVBQVUsS0FBSyxTQUFTLEdBQ3hFO0FBQ0EsaUJBQUssTUFBTTtBQUNYLHVCQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLGFBQWEsT0FBTyxDQUFDLEdBQUc7QUFDakUsbUJBQUssT0FBTyxNQUFNLFlBQVksTUFBTSxLQUFLO0FBQUEsWUFDM0M7QUFDQTtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBRUEsYUFBSyxNQUFNO0FBQ1gsYUFBSyxZQUFZLE9BQU8sY0FBYztBQUN0QyxhQUFLLFlBQVksT0FBTyxhQUFhLENBQUM7QUFDdEMsYUFBSyxZQUNILE9BQU8sY0FBYyxLQUFLLE1BQ3RCLEtBQUssSUFBSSxXQUFXLE9BQU8sVUFBVSxJQUNyQyxPQUFPLGNBQWM7QUFFM0IsY0FBTSxZQUFZLEtBQUssYUFBYSxVQUFVO0FBQzlDLGFBQUssbUJBQ0gsYUFBYSxLQUFLLFVBQVUsU0FBUyxTQUFTLElBQUksWUFBWSxLQUFLLFVBQVUsQ0FBQyxLQUFLO0FBS3JGLFlBQUksQ0FBQyxLQUFLLGNBQWM7QUFDdEIsZUFBSyxXQUNILEtBQUssSUFBSSxzQkFBc0IscUJBQy9CLEtBQUssSUFBSSxzQkFBc0I7QUFDakMsZUFBSyxvQkFBb0IsS0FBSyxJQUFJO0FBQUEsUUFDcEMsV0FBVyxLQUFLLElBQUksc0JBQXNCLG1CQUFtQjtBQUMzRCxlQUFLLFdBQVc7QUFBQSxRQUNsQjtBQUNBLGFBQUssZUFBZTtBQUVwQixhQUFLLGVBQWU7QUFDcEIsYUFBSyxhQUFhO0FBQUEsTUFDcEI7QUFBQSxNQUVRLEtBQUssS0FBNEI7QUFDdkMsZUFBTyxZQUFZLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFBQSxNQUN2QztBQUFBLE1BRUEsSUFBWSxjQUF1QjtBQUNqQyxlQUFPLEtBQUssSUFBSSxlQUFlLEtBQUssSUFBSSxzQkFBc0I7QUFBQSxNQUNoRTtBQUFBLE1BRUEsSUFBWSxpQkFBMEI7QUFJcEMsZUFBTyxLQUFLLElBQUk7QUFBQSxNQUNsQjtBQUFBO0FBQUEsTUFJUSxpQkFBdUI7QUFDN0IsYUFBSyxZQUFZO0FBQ2pCLGFBQUssT0FBTyxjQUFjO0FBQzFCLGNBQU0sUUFBUSxTQUFTLGNBQWMsT0FBTztBQUM1QyxjQUFNLGNBQWM7QUFDcEIsYUFBSyxPQUFPLE9BQU8sS0FBSztBQUV4QixhQUFLLFNBQVMsU0FBUyxjQUFjLEtBQUs7QUFDMUMsYUFBSyxPQUFPLFlBQVk7QUFDeEIsY0FBTSxVQUFVLEtBQUssYUFBYSxTQUFTLE1BQU07QUFDakQsWUFBSSxTQUFTO0FBQ1gsZUFBSyxPQUFPLGFBQWEsZ0JBQWdCLEVBQUU7QUFDM0MsZUFBSyxPQUFPLFFBQVEsWUFBWTtBQUFBLFFBQ2xDLE9BQU87QUFDTCxlQUFLLE9BQU8sUUFBUSxZQUFZLEtBQUssSUFBSTtBQUFBLFFBQzNDO0FBQ0EsY0FBTSxPQUFPLGFBQWEsS0FBSyxHQUFHO0FBQ2xDLG1CQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLElBQUksR0FBRztBQUNoRCxlQUFLLE9BQU8sTUFBTSxZQUFZLE1BQU0sS0FBSztBQUFBLFFBQzNDO0FBQ0EsWUFBSSxLQUFLLElBQUksT0FBTyxTQUFTLE9BQU87QUFDbEMsZUFBSyxPQUFPLE1BQU0sWUFBWSxjQUFjLEtBQUssSUFBSSxPQUFPLE9BQU87QUFDbkUsZUFBSyxPQUFPLE1BQU0sWUFBWSxjQUFjLEtBQUssSUFBSSxPQUFPLE9BQU87QUFBQSxRQUNyRTtBQUdBLGFBQUssYUFBYSxTQUFTLGNBQWMsUUFBUTtBQUNqRCxhQUFLLFdBQVcsWUFBWTtBQUM1QixhQUFLLFdBQVcsUUFBUSxVQUFVLEtBQUssSUFBSTtBQUMzQyxhQUFLLFdBQVcsYUFBYSxjQUFjLEtBQUssS0FBSyxRQUFRLENBQUM7QUFFOUQsWUFBSSxLQUFLLElBQUksOEJBQThCLEtBQUssSUFBSSxZQUFZLFFBQVE7QUFDdEUsZUFBSyxXQUFXO0FBQUEsWUFDZCxLQUFLO0FBQUEsY0FDSCxLQUFLLElBQUksWUFBWSxTQUFTLEtBQUssS0FBSyxJQUFJLFlBQVksU0FBUyxLQUFLO0FBQUEsWUFDeEU7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUNBLGNBQU0sUUFBUSxTQUFTLGNBQWMsTUFBTTtBQUMzQyxjQUFNLFlBQVk7QUFDbEIsY0FBTSxjQUFjLEtBQUssS0FBSyxZQUFZO0FBQzFDLGFBQUssV0FBVyxPQUFPLEtBQUs7QUFDNUIsWUFBSSxLQUFLLElBQUksWUFBWSxRQUFRO0FBQy9CLGdCQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsZUFBSyxZQUFZLE1BQU07QUFDdkIsZUFBSyxNQUFNLFVBQVU7QUFDckIsZUFBSyxXQUFXLE9BQU8sSUFBSTtBQUFBLFFBQzdCO0FBQ0EsYUFBSyxXQUFXLGlCQUFpQixTQUFTLE1BQU07QUFDOUMsZUFBSyxXQUFXO0FBQ2hCLGVBQUssYUFBYTtBQUFBLFFBQ3BCLENBQUM7QUFHRCxhQUFLLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDM0MsYUFBSyxRQUFRLFlBQVk7QUFFekIsY0FBTSxTQUFTLFNBQVMsY0FBYyxLQUFLO0FBQzNDLGVBQU8sWUFBWTtBQUNuQixhQUFLLGlCQUFpQixLQUFLLFlBQVksRUFBRTtBQUN6QyxlQUFPLE9BQU8sS0FBSyxjQUFjO0FBQ2pDLGNBQU0sT0FBTyxTQUFTLGNBQWMsS0FBSztBQUN6QyxhQUFLLFlBQVk7QUFDakIsYUFBSyxlQUFlLFNBQVMsY0FBYyxLQUFLO0FBQ2hELGFBQUssYUFBYSxZQUFZO0FBQzlCLGFBQUssYUFBYSxjQUFjLEtBQUs7QUFDckMsYUFBSyxpQkFBaUIsU0FBUyxjQUFjLEtBQUs7QUFDbEQsYUFBSyxlQUFlLFlBQVk7QUFDaEMsYUFBSyxPQUFPLEtBQUssY0FBYyxLQUFLLGNBQWM7QUFDbEQsZUFBTyxPQUFPLElBQUk7QUFDbEIsZUFBTyxPQUFPLEtBQUssbUJBQW1CLENBQUM7QUFDdkMsYUFBSyxRQUFRLE9BQU8sTUFBTTtBQUUxQixjQUFNLFlBQVksU0FBUyxjQUFjLEtBQUs7QUFDOUMsa0JBQVUsWUFBWTtBQUV0QixhQUFLLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDM0MsYUFBSyxRQUFRLFlBQVk7QUFDekIsa0JBQVUsT0FBTyxLQUFLLE9BQU87QUFFN0IsYUFBSyxTQUFTLFNBQVMsY0FBYyxLQUFLO0FBQzFDLGFBQUssT0FBTyxZQUFZO0FBQ3hCLGtCQUFVLE9BQU8sS0FBSyxNQUFNO0FBRTVCLGFBQUssY0FBYyxTQUFTLGNBQWMsS0FBSztBQUMvQyxrQkFBVSxPQUFPLEtBQUssV0FBVztBQUVqQyxhQUFLLFFBQVEsT0FBTyxTQUFTO0FBRTdCLGFBQUssV0FBVyxTQUFTLGNBQWMsS0FBSztBQUM1QyxhQUFLLFNBQVMsWUFBWTtBQUMxQixhQUFLLFFBQVEsT0FBTyxLQUFLLFFBQVE7QUFFakMsYUFBSyxVQUFVLFNBQVMsY0FBYyxPQUFPO0FBQzdDLGFBQUssUUFBUSxXQUFXO0FBQ3hCLGFBQUssUUFBUSxNQUFNLFVBQVU7QUFDN0IsYUFBSyxRQUFRLE9BQU8sS0FBSyxPQUFPO0FBR2hDLGFBQUssb0JBQ0gsS0FBSyxJQUFJLHFDQUNULEtBQUssSUFBSSw2QkFDVCxLQUFLLFVBQVUsU0FBUyxJQUNwQixLQUFLLG9CQUFvQixJQUN6QjtBQUNOLFlBQUksS0FBSyxtQkFBbUI7QUFDMUIsZUFBSyxrQkFBa0IsVUFBVSxJQUFJLGlCQUFpQjtBQUN0RCxlQUFLLE9BQU8sT0FBTyxLQUFLLFNBQVMsS0FBSyxtQkFBbUIsS0FBSyxVQUFVO0FBQUEsUUFDMUUsT0FBTztBQUNMLGVBQUssT0FBTyxPQUFPLEtBQUssU0FBUyxLQUFLLFVBQVU7QUFBQSxRQUNsRDtBQUNBLGFBQUssT0FBTyxPQUFPLEtBQUssTUFBTTtBQUFBLE1BQ2hDO0FBQUEsTUFFUSxZQUFZLE9BQU8sSUFBaUI7QUFDMUMsY0FBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ3ZDLFdBQUcsWUFBWTtBQUNmLGNBQU0sT0FBTyxLQUFLLElBQUksT0FBTztBQUM3QixjQUFNLE1BQ0osU0FBUyxRQUNKLEtBQUssSUFBSSxPQUE0QixPQUFPLE9BQzdDLFNBQVMsVUFDUCxLQUFLLFlBQ0w7QUFDUixZQUFJLEtBQUs7QUFDUCxnQkFBTSxNQUFNLFNBQVMsY0FBYyxLQUFLO0FBQ3hDLGNBQUksTUFBTTtBQUNWLGNBQUksTUFBTTtBQUNWLGFBQUcsT0FBTyxHQUFHO0FBQ2IsaUJBQU87QUFBQSxRQUNUO0FBQ0EsWUFBSSxTQUFTLFNBQVMsU0FBUyxTQUFTO0FBSXRDLGdCQUFNLFFBQVEsU0FBUyxjQUFjLE1BQU07QUFDM0MsZ0JBQU0sWUFBWTtBQUNsQixnQkFBTSxZQUFZLFNBQVMsUUFBUSxNQUFNLE9BQU8sTUFBTTtBQUN0RCxhQUFHLE9BQU8sS0FBSztBQUNmLGlCQUFPO0FBQUEsUUFDVDtBQUdBLFdBQUcsTUFBTSxhQUFhO0FBQ3RCLGNBQU0sU0FBUyxLQUFLLElBQUk7QUFDeEIsY0FBTSxNQUFNLFVBQVUsTUFBTSxPQUFPLFNBQVMsT0FBTyxPQUFPO0FBQzFELGFBQUssS0FBSyxLQUFLLEdBQUc7QUFDbEIsV0FBRyxPQUFPLElBQUksRUFBRTtBQUNoQixlQUFPO0FBQUEsTUFDVDtBQUFBLE1BRVEsWUFBWSxPQUF1QjtBQUN6QyxtQkFBVyxPQUFPLEtBQUssS0FBTSxLQUFJLFNBQVMsS0FBSztBQUFBLE1BQ2pEO0FBQUEsTUFFUSxjQUFvQjtBQUMxQixtQkFBVyxPQUFPLEtBQUssS0FBTSxLQUFJLFFBQVE7QUFDekMsYUFBSyxPQUFPLENBQUM7QUFBQSxNQUNmO0FBQUEsTUFFUSxxQkFBa0M7QUFDeEMsY0FBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLGdCQUFRLFlBQVk7QUFFcEIsYUFBSyxhQUFhO0FBQ2xCLFlBQUksS0FBSyxJQUFJLDZCQUE2QixLQUFLLFVBQVUsU0FBUyxHQUFHO0FBQ25FLGdCQUFNLFNBQVMsS0FBSyxvQkFBb0I7QUFDeEMsa0JBQVEsT0FBTyxNQUFNO0FBQ3JCLGVBQUssYUFBYTtBQUFBLFFBQ3BCO0FBRUEsWUFBSSxLQUFLLGdCQUFnQjtBQUN2QixlQUFLLFVBQVUsS0FBSyxXQUFXLE1BQU0sVUFBVSxLQUFLLEtBQUssV0FBVyxHQUFHLE1BQU07QUFDM0UsaUJBQUssS0FBSyxXQUFXO0FBQUEsVUFDdkIsQ0FBQztBQUNELGtCQUFRLE9BQU8sS0FBSyxPQUFPO0FBQUEsUUFDN0I7QUFFQSxZQUFJLEtBQUssSUFBSSx1QkFBdUI7QUFDbEMsZUFBSyxZQUFZLEtBQUssV0FBVyxNQUFNLFFBQVEsS0FBSyxLQUFLLFFBQVEsR0FBRyxNQUFNO0FBQ3hFLGlCQUFLLFFBQVEsQ0FBQyxLQUFLO0FBQ25CLGdCQUFJLEtBQUssTUFBTyxNQUFLLFFBQVEsYUFBYSxjQUFjLEVBQUU7QUFBQSxnQkFDckQsTUFBSyxRQUFRLGdCQUFnQixZQUFZO0FBQzlDLGlCQUFLLFVBQVcsWUFBWSxLQUFLLFFBQVEsTUFBTSxTQUFTLE1BQU07QUFBQSxVQUNoRSxDQUFDO0FBQ0Qsa0JBQVEsT0FBTyxLQUFLLFNBQVM7QUFBQSxRQUMvQjtBQUVBLFlBQUksS0FBSyxhQUFhO0FBQ3BCLGtCQUFRO0FBQUEsWUFDTixLQUFLLFdBQVcsTUFBTSxhQUFhLEtBQUssS0FBSyxVQUFVLEdBQUcsTUFBTTtBQUM5RCxtQkFBSyxXQUFXO0FBQ2hCLG1CQUFLLGFBQWE7QUFBQSxZQUNwQixDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0Y7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBO0FBQUEsTUFNUSxzQkFBeUM7QUFDL0MsY0FBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLGVBQU8sWUFBWTtBQUNuQixlQUFPLFFBQVEsS0FBSyxLQUFLLGlCQUFpQjtBQUMxQyxlQUFPLGFBQWEsY0FBYyxLQUFLLEtBQUssaUJBQWlCLENBQUM7QUFDOUQsbUJBQVcsUUFBUSxLQUFLLFdBQVc7QUFDakMsZ0JBQU0sTUFBTSxTQUFTLGNBQWMsUUFBUTtBQUMzQyxjQUFJLFFBQVE7QUFDWixjQUFJLGNBQWM7QUFDbEIsaUJBQU8sT0FBTyxHQUFHO0FBQUEsUUFDbkI7QUFDQSxZQUFJLEtBQUssaUJBQWtCLFFBQU8sUUFBUSxLQUFLO0FBQy9DLGVBQU8saUJBQWlCLFVBQVUsTUFBTTtBQUN0QyxlQUFLLG1CQUFtQixPQUFPO0FBQy9CLHFCQUFXLFNBQVMsQ0FBQyxLQUFLLFlBQVksS0FBSyxpQkFBaUIsR0FBRztBQUM3RCxnQkFBSSxTQUFTLFVBQVUsT0FBUSxPQUFNLFFBQVEsT0FBTztBQUFBLFVBQ3REO0FBQUEsUUFDRixDQUFDO0FBQ0QsZUFBTztBQUFBLE1BQ1Q7QUFBQSxNQUlRLFdBQ04sTUFDQSxPQUNBLFNBQ21CO0FBQ25CLGNBQU0sTUFBTSxTQUFTLGNBQWMsUUFBUTtBQUMzQyxZQUFJLFlBQVk7QUFDaEIsWUFBSSxRQUFRO0FBQ1osWUFBSSxhQUFhLGNBQWMsS0FBSztBQUNwQyxZQUFJLFlBQVk7QUFDaEIsWUFBSSxpQkFBaUIsU0FBUyxPQUFPO0FBQ3JDLGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQSxNQUlRLGVBQXFCO0FBQzNCLGFBQUssV0FBVyxVQUFVLE9BQU8sYUFBYSxLQUFLLFFBQVE7QUFDM0QsYUFBSyxRQUFRLFVBQVUsT0FBTyxhQUFhLENBQUMsS0FBSyxRQUFRO0FBR3pELGFBQUssZUFBZSxjQUFjO0FBQ2xDLGNBQU0sTUFBTSxTQUFTLGNBQWMsTUFBTTtBQUN6QyxZQUFJLFlBQVk7QUFDaEIsY0FBTSxhQUFhLFNBQVMsY0FBYyxNQUFNO0FBQ2hELFlBQUksS0FBSyxTQUFTLFNBQVM7QUFDekIsY0FBSSxhQUFhLGFBQWEsRUFBRTtBQUNoQyxxQkFBVyxjQUNULEtBQUssZ0JBQWdCLGVBQ2pCLEtBQUssS0FBSyxtQkFBbUIsSUFDN0IsS0FBSyxnQkFBZ0IsV0FDbkIsS0FBSyxLQUFLLGVBQWUsSUFDekIsS0FBSyxnQkFBZ0IsYUFDbkIsS0FBSyxLQUFLLGlCQUFpQixJQUMzQixLQUFLLEtBQUssa0JBQWtCO0FBQUEsUUFDeEMsV0FBVyxLQUFLLFNBQVMsUUFBUTtBQUMvQixjQUFJLGFBQWEsYUFBYSxFQUFFO0FBQ2hDLHFCQUFXLGNBQWMsS0FBSyxLQUFLLGlCQUFpQjtBQUFBLFFBQ3RELE9BQU87QUFDTCxxQkFBVyxjQUFjLEtBQUs7QUFBQSxRQUNoQztBQUNBLGFBQUssZUFBZSxPQUFPLEtBQUssVUFBVTtBQUUxQyxhQUFLLGVBQWUsVUFBVSxPQUFPLGFBQWEsQ0FBQyxLQUFLLElBQUksaUJBQWlCO0FBQzdFLGFBQUssZUFBZTtBQUFBLFVBQ2xCO0FBQUEsVUFDQSxLQUFLLFNBQVMsV0FBVyxLQUFLLGdCQUFnQjtBQUFBLFFBQ2hEO0FBQ0EsYUFBSztBQUFBLFVBQ0gsS0FBSyxTQUFTLFVBQ1YsS0FBSyxnQkFBZ0IsV0FDbkIsZUFDQSxLQUFLLGNBQ1AsS0FBSyxTQUFTLFNBQ1osY0FDQTtBQUFBLFFBQ1I7QUFHQSxhQUFLLGFBQWEsZ0JBQWdCLEtBQUssSUFBSTtBQUMzQyxZQUFJLEtBQUssU0FBUyxTQUFTO0FBQ3pCLGVBQUssYUFBYSx3QkFBd0IsS0FBSyxXQUFXO0FBQUEsUUFDNUQsT0FBTztBQUNMLGVBQUssZ0JBQWdCLHNCQUFzQjtBQUFBLFFBQzdDO0FBR0EsY0FBTSxpQkFBaUIsS0FBSyxTQUFTLFVBQVUsS0FBSyxPQUFPLFdBQVcsU0FBUztBQUMvRSxhQUFLLFFBQVEsVUFBVSxPQUFPLGFBQWEsY0FBYztBQUN6RCxjQUFNLGFBQ0osS0FBSyxTQUFTLFdBQVcsQ0FBQyxLQUFLLG9CQUFvQixPQUFPLENBQUM7QUFDN0QsYUFBSyxPQUFPLFVBQVUsT0FBTyxhQUFhLFVBQVU7QUFDcEQsWUFBSSxDQUFDLGVBQWdCLE1BQUssWUFBWTtBQUV0QyxZQUFJLEtBQUssWUFBWTtBQUNuQixlQUFLLFdBQVcsV0FBVyxLQUFLLFNBQVM7QUFBQSxRQUMzQztBQUNBLFlBQUksS0FBSyxtQkFBbUI7QUFDMUIsZUFBSyxrQkFBa0IsVUFBVSxPQUFPLGFBQWEsS0FBSyxRQUFRO0FBQ2xFLGVBQUssa0JBQWtCLFdBQVcsS0FBSyxTQUFTO0FBQUEsUUFDbEQ7QUFDQSxZQUFJLEtBQUssU0FBUztBQUNoQixlQUFLLFFBQVEsUUFDWCxLQUFLLFNBQVMsVUFBVSxLQUFLLEtBQUssV0FBVyxJQUFJLEtBQUssS0FBSyxZQUFZO0FBQ3pFLGVBQUssUUFBUSxZQUFZLEtBQUssU0FBUyxVQUFVLE1BQU0sV0FBVyxNQUFNO0FBQ3hFLGVBQUssUUFBUSxVQUFVLE9BQU8sYUFBYSxLQUFLLFNBQVMsTUFBTTtBQUFBLFFBQ2pFO0FBRUEsYUFBSyxhQUFhO0FBQUEsTUFDcEI7QUFBQSxNQUVRLGNBQW9CO0FBQzFCLGFBQUssUUFBUSxjQUFjO0FBQzNCLGNBQU0sU0FBUyxLQUFLLFlBQVksRUFBRTtBQUNsQyxjQUFNLFFBQVEsU0FBUyxjQUFjLEtBQUs7QUFDMUMsY0FBTSxZQUFZO0FBQ2xCLGNBQU0sY0FBYyxLQUFLLEtBQUssWUFBWTtBQUMxQyxhQUFLLFFBQVEsT0FBTyxRQUFRLEtBQUs7QUFFakMsWUFBSSxLQUFLLElBQUksZUFBZTtBQUMxQixnQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGVBQUssWUFBWTtBQUNqQixlQUFLLFlBQVksR0FBRyxNQUFNLEtBQUs7QUFDL0IsVUFBQyxLQUFLLGlCQUFpQyxjQUFjLEtBQUssS0FBSyxZQUFZO0FBQzNFLGVBQUssaUJBQWlCLFNBQVMsTUFBTSxLQUFLLFdBQVcsTUFBTSxLQUFLLEtBQUssVUFBVSxDQUFDLENBQUM7QUFDakYsZUFBSyxRQUFRLE9BQU8sSUFBSTtBQUFBLFFBQzFCO0FBQ0EsWUFBSSxLQUFLLElBQUksY0FBYztBQUN6QixnQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGVBQUssWUFBWSxTQUFTLEtBQUssSUFBSSxnQkFBZ0Isc0JBQXNCLEVBQUU7QUFDM0UsZUFBSyxZQUFZLEdBQUcsTUFBTSxJQUFJO0FBQzlCLFVBQUMsS0FBSyxpQkFBaUMsY0FBYyxLQUFLLEtBQUssWUFBWTtBQUMzRSxlQUFLLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxXQUFXLE1BQU0sS0FBSyxLQUFLLFVBQVUsQ0FBQyxDQUFDO0FBQ2pGLGVBQUssUUFBUSxPQUFPLElBQUk7QUFBQSxRQUMxQjtBQUFBLE1BQ0Y7QUFBQSxNQUVRLGVBQXFCO0FBQzNCLGFBQUssU0FBUyxjQUFjO0FBRTVCLFlBQUksS0FBSyxTQUFTLFNBQVM7QUFDekIsZ0JBQU0sTUFBTSxTQUFTLGNBQWMsS0FBSztBQUN4QyxjQUFJLFlBQVk7QUFDaEIsY0FBSSxLQUFLLElBQUkscUJBQXFCO0FBQ2hDLGtCQUFNLE9BQU8sU0FBUyxjQUFjLFFBQVE7QUFDNUMsaUJBQUssWUFBWTtBQUNqQixpQkFBSyxRQUFRLEtBQUssS0FBSyxpQkFBaUI7QUFDeEMsaUJBQUssWUFBWSxLQUFLLFFBQVEsTUFBTSxTQUFTLE1BQU07QUFDbkQsaUJBQUssaUJBQWlCLFNBQVMsTUFBTTtBQUNuQyxtQkFBSyxRQUFRLENBQUMsS0FBSztBQUNuQixtQkFBSyxPQUFPLHFCQUFxQixDQUFDLEtBQUssS0FBSztBQUM1QyxtQkFBSyxhQUFhO0FBQUEsWUFDcEIsQ0FBQztBQUNELGdCQUFJLE9BQU8sSUFBSTtBQUFBLFVBQ2pCO0FBQ0EsY0FBSSxLQUFLLElBQUksb0JBQW9CO0FBQy9CLGtCQUFNLGFBQWEsU0FBUyxjQUFjLFFBQVE7QUFDbEQsdUJBQVcsWUFBWTtBQUN2Qix1QkFBVyxZQUFZLE1BQU07QUFDN0IsdUJBQVcsUUFBUTtBQUNuQixnQkFBSSxLQUFLLGtCQUFtQixZQUFXLGFBQWEsZUFBZSxFQUFFO0FBQ3JFLHVCQUFXLGlCQUFpQixTQUFTLE1BQU07QUFDekMsbUJBQUssb0JBQW9CLENBQUMsS0FBSztBQUMvQixtQkFBSyxhQUFhO0FBQUEsWUFDcEIsQ0FBQztBQUNELGdCQUFJLE9BQU8sVUFBVTtBQUFBLFVBQ3ZCO0FBQ0EsZ0JBQU0sTUFBTSxTQUFTLGNBQWMsUUFBUTtBQUMzQyxjQUFJLFlBQVk7QUFDaEIsY0FBSSxhQUFhLGVBQWUsRUFBRTtBQUNsQyxjQUFJLFlBQVksR0FBRyxNQUFNLFFBQVE7QUFDakMsVUFBQyxJQUFJLGlCQUFpQyxjQUFjLEtBQUssS0FBSyxVQUFVO0FBQ3hFLGNBQUksaUJBQWlCLFNBQVMsTUFBTSxLQUFLLEtBQUssUUFBUSxNQUFNLENBQUM7QUFDN0QsY0FBSSxPQUFPLEdBQUc7QUFDZCxlQUFLLFNBQVMsT0FBTyxHQUFHO0FBTXhCLGNBQUksS0FBSyxJQUFJLHlCQUF5QjtBQUNwQyxrQkFBTSxXQUFXLFNBQVMsY0FBYyxLQUFLO0FBQzdDLHFCQUFTLFlBQVk7QUFDckIsa0JBQU0sUUFBUSxTQUFTLGNBQWMsT0FBTztBQUM1QyxrQkFBTSxZQUFZO0FBQ2xCLGtCQUFNLGNBQWMsS0FBSyxLQUFLLG1CQUFtQjtBQUNqRCxrQkFBTSxhQUFhLGNBQWMsS0FBSyxLQUFLLGFBQWEsQ0FBQztBQUN6RCxrQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGlCQUFLLFlBQVk7QUFDakIsaUJBQUssUUFBUSxLQUFLLEtBQUssY0FBYztBQUNyQyxpQkFBSyxhQUFhLGNBQWMsS0FBSyxLQUFLLGNBQWMsQ0FBQztBQUN6RCxpQkFBSyxZQUFZLE1BQU07QUFHdkIsa0JBQU0sU0FBUyxLQUFLLGdCQUFnQjtBQUNwQyxrQkFBTSxXQUFXO0FBQ2pCLGlCQUFLLFdBQVc7QUFDaEIsa0JBQU0sU0FBUyxNQUFNO0FBQ25CLGtCQUFJLEtBQUssZ0JBQWdCLFNBQVU7QUFDbkMsb0JBQU0sUUFBUSxNQUFNLE1BQU0sS0FBSztBQUMvQixrQkFBSSxDQUFDLE1BQU87QUFDWixrQkFBSSxLQUFLLE9BQU8sYUFBYSxLQUFLLEdBQUc7QUFDbkMsc0JBQU0sUUFBUTtBQUNkLHFCQUFLLGNBQWMsUUFBUSxLQUFLO0FBQUEsY0FDbEM7QUFBQSxZQUNGO0FBQ0EsaUJBQUssaUJBQWlCLFNBQVMsTUFBTTtBQUNyQyxrQkFBTSxpQkFBaUIsV0FBVyxDQUFDLE1BQU07QUFDdkMsa0JBQUksRUFBRSxRQUFRLFdBQVcsQ0FBQyxFQUFFLFVBQVU7QUFDcEMsa0JBQUUsZUFBZTtBQUNqQix1QkFBTztBQUFBLGNBQ1Q7QUFBQSxZQUNGLENBQUM7QUFDRCxxQkFBUyxPQUFPLE9BQU8sSUFBSTtBQUMzQixpQkFBSyxTQUFTLE9BQU8sUUFBUTtBQUFBLFVBQy9CO0FBQ0E7QUFBQSxRQUNGO0FBRUEsWUFBSSxLQUFLLFNBQVMsUUFBUTtBQUV4QixjQUFJLEtBQUssbUJBQW1CLFNBQVMsR0FBRztBQUN0QyxrQkFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLGtCQUFNLFlBQVk7QUFDbEIsdUJBQVcsY0FBYyxLQUFLLG9CQUFvQjtBQUNoRCxvQkFBTSxPQUFPLFNBQVMsY0FBYyxNQUFNO0FBQzFDLG1CQUFLLFlBQVk7QUFDakIsb0JBQU0sT0FBTyxTQUFTLGNBQWMsTUFBTTtBQUMxQyxtQkFBSyxZQUFZO0FBQ2pCLG1CQUFLLGNBQWMsV0FBVztBQUM5QixvQkFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLHFCQUFPLFlBQVk7QUFDbkIscUJBQU8sUUFBUSxLQUFLLEtBQUssYUFBYTtBQUN0QyxxQkFBTyxhQUFhLGNBQWMsS0FBSyxLQUFLLGFBQWEsQ0FBQztBQUMxRCxxQkFBTyxZQUFZLE1BQU07QUFDekIscUJBQU8saUJBQWlCLFNBQVMsTUFBTTtBQUNyQyxxQkFBSyxxQkFBcUIsS0FBSyxtQkFBbUI7QUFBQSxrQkFDaEQsQ0FBQyxNQUFNLEVBQUUsa0JBQWtCLFdBQVc7QUFBQSxnQkFDeEM7QUFDQSxxQkFBSyxhQUFhO0FBQUEsY0FDcEIsQ0FBQztBQUNELG1CQUFLLE9BQU8sTUFBTSxNQUFNO0FBQ3hCLG9CQUFNLE9BQU8sSUFBSTtBQUFBLFlBQ25CO0FBQ0EsaUJBQUssU0FBUyxPQUFPLEtBQUs7QUFBQSxVQUM1QjtBQUVBLGdCQUFNLE1BQU0sU0FBUyxjQUFjLEtBQUs7QUFDeEMsY0FBSSxZQUFZO0FBR2hCLGdCQUFNLFNBQVMsU0FBUyxjQUFjLE9BQU87QUFDN0MsaUJBQU8sT0FBTztBQUNkLGlCQUFPLFNBQVMsMEJBQTBCO0FBQzFDLGlCQUFPLE1BQU0sVUFBVTtBQUN2QixpQkFBTyxpQkFBaUIsVUFBVSxNQUFNO0FBQ3RDLGtCQUFNLE9BQU8sT0FBTyxRQUFRLENBQUM7QUFDN0IsbUJBQU8sUUFBUTtBQUNmLGdCQUFJLEtBQU0sTUFBSyxLQUFLLFdBQVcsSUFBSTtBQUFBLFVBQ3JDLENBQUM7QUFDRCxnQkFBTSxTQUFTLFNBQVMsY0FBYyxRQUFRO0FBQzlDLGlCQUFPLFlBQVk7QUFDbkIsaUJBQU8sUUFBUSxLQUFLLEtBQUssYUFBYTtBQUN0QyxpQkFBTyxhQUFhLGNBQWMsS0FBSyxLQUFLLGFBQWEsQ0FBQztBQUMxRCxpQkFBTyxZQUFZLE1BQU07QUFDekIsaUJBQU8saUJBQWlCLFNBQVMsTUFBTSxPQUFPLE1BQU0sQ0FBQztBQUVyRCxnQkFBTSxRQUFRLFNBQVMsY0FBYyxPQUFPO0FBQzVDLGdCQUFNLFlBQVk7QUFDbEIsZ0JBQU0sY0FBYyxLQUFLLElBQUksZ0JBQ3pCLEtBQUssS0FBSyxtQkFBbUIsSUFDN0IsS0FBSyxLQUFLLDZCQUE2QjtBQUMzQyxnQkFBTSxhQUFhLGNBQWMsS0FBSyxLQUFLLGFBQWEsQ0FBQztBQUN6RCxnQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGVBQUssWUFBWTtBQUNqQixlQUFLLFFBQVEsS0FBSyxLQUFLLGNBQWM7QUFDckMsZUFBSyxhQUFhLGNBQWMsS0FBSyxLQUFLLGNBQWMsQ0FBQztBQUN6RCxlQUFLLFlBQVksTUFBTTtBQUN2QixnQkFBTSxTQUFTLE1BQU07QUFDbkIsa0JBQU0sUUFBUSxNQUFNLE1BQU0sS0FBSztBQUMvQixnQkFBSSxDQUFDLFNBQVMsS0FBSyxTQUFVO0FBQzdCLGtCQUFNLFFBQVE7QUFDZCxpQkFBSyxLQUFLLFNBQVMsS0FBSztBQUFBLFVBQzFCO0FBQ0EsZUFBSyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3JDLGdCQUFNLGlCQUFpQixXQUFXLENBQUMsTUFBTTtBQUN2QyxnQkFBSSxFQUFFLFFBQVEsV0FBVyxDQUFDLEVBQUUsVUFBVTtBQUNwQyxnQkFBRSxlQUFlO0FBQ2pCLHFCQUFPO0FBQUEsWUFDVDtBQUFBLFVBQ0YsQ0FBQztBQUNELGNBQUksT0FBTyxRQUFRLFFBQVEsT0FBTyxJQUFJO0FBQ3RDLGVBQUssU0FBUyxPQUFPLEdBQUc7QUFDeEI7QUFBQSxRQUNGO0FBRUEsWUFBSSxLQUFLLE9BQU87QUFFZCxjQUFJLEtBQUssSUFBSSx3QkFBd0IsS0FBSyxNQUFNLGdCQUFnQjtBQUM5RCxrQkFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLGtCQUFNLFlBQVk7QUFDbEIsa0JBQU0sUUFBUSxTQUFTLGNBQWMsTUFBTTtBQUMzQyxrQkFBTSxjQUFjLEdBQUcsS0FBSyxLQUFLLGlCQUFpQixDQUFDO0FBQ25ELGtCQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsaUJBQUssY0FBYyxLQUFLLE1BQU07QUFDOUIsa0JBQU0sT0FBTyxTQUFTLGNBQWMsUUFBUTtBQUM1QyxpQkFBSyxZQUFZO0FBQ2pCLGlCQUFLLE1BQU0sUUFBUTtBQUNuQixpQkFBSyxNQUFNLFNBQVM7QUFDcEIsaUJBQUssUUFBUSxLQUFLLEtBQUssU0FBUztBQUNoQyxpQkFBSyxhQUFhLGNBQWMsS0FBSyxLQUFLLFNBQVMsQ0FBQztBQUNwRCxpQkFBSyxZQUFZLE1BQU07QUFDdkIsaUJBQUssaUJBQWlCLFNBQVMsTUFBTTtBQUNuQyxtQkFBSyxVQUFVLFdBQVcsVUFBVSxLQUFLLE9BQU8sa0JBQWtCLEVBQUU7QUFDcEUsbUJBQUssWUFBWSxNQUFNO0FBQ3ZCLG1CQUFLLFFBQVEsS0FBSyxLQUFLLFFBQVE7QUFDL0IseUJBQVcsTUFBTTtBQUNmLHFCQUFLLFlBQVksTUFBTTtBQUN2QixxQkFBSyxRQUFRLEtBQUssS0FBSyxTQUFTO0FBQUEsY0FDbEMsR0FBRyxJQUFJO0FBQUEsWUFDVCxDQUFDO0FBQ0Qsa0JBQU0sT0FBTyxPQUFPLE1BQU0sSUFBSTtBQUM5QixpQkFBSyxTQUFTLE9BQU8sS0FBSztBQUFBLFVBQzVCO0FBQ0EsZ0JBQU0sTUFBTSxTQUFTLGNBQWMsS0FBSztBQUN4QyxjQUFJLFlBQVk7QUFDaEIsY0FBSSxLQUFLLElBQUksZUFBZTtBQUMxQixrQkFBTSxRQUFRLFNBQVMsY0FBYyxRQUFRO0FBQzdDLGtCQUFNLFlBQVk7QUFDbEIsa0JBQU0sYUFBYSxlQUFlLEVBQUU7QUFDcEMsa0JBQU0sWUFBWSxHQUFHLE1BQU0sS0FBSztBQUNoQyxZQUFDLE1BQU0saUJBQWlDLGNBQWMsS0FBSyxLQUFLLFVBQVU7QUFDMUUsa0JBQU0saUJBQWlCLFNBQVMsTUFBTSxLQUFLLFdBQVcsTUFBTSxLQUFLLEtBQUssVUFBVSxDQUFDLENBQUM7QUFDbEYsZ0JBQUksT0FBTyxLQUFLO0FBQUEsVUFDbEI7QUFDQSxjQUFJLEtBQUssSUFBSSxjQUFjO0FBQ3pCLGtCQUFNLE9BQU8sU0FBUyxjQUFjLFFBQVE7QUFDNUMsaUJBQUssWUFBWTtBQUNqQixpQkFBSyxZQUFZLEdBQUcsTUFBTSxJQUFJO0FBQzlCLFlBQUMsS0FBSyxpQkFBaUMsY0FBYyxLQUFLLEtBQUssWUFBWTtBQUMzRSxpQkFBSyxpQkFBaUIsU0FBUyxNQUFNLEtBQUssV0FBVyxNQUFNLEtBQUssS0FBSyxVQUFVLENBQUMsQ0FBQztBQUNqRixnQkFBSSxPQUFPLElBQUk7QUFBQSxVQUNqQjtBQUNBLGVBQUssU0FBUyxPQUFPLEdBQUc7QUFBQSxRQUMxQjtBQUFBLE1BQ0Y7QUFBQTtBQUFBLE1BSVEsY0FDTixNQUNBLEtBQ0EsU0FBdUIsS0FBSyxrQkFDdEI7QUFDTixZQUFJLE9BQU87QUFDWCxZQUFJLEtBQUssSUFBSSxtQkFBbUIsU0FBUyxZQUFZLFNBQVMsU0FBUztBQUNyRSxpQkFBTyxlQUFlLElBQUk7QUFDMUIsY0FBSSxDQUFDLEtBQUssS0FBSyxFQUFHO0FBQUEsUUFDcEI7QUFDQSxjQUFNLEtBQUssU0FBUyxjQUFjLEtBQUs7QUFDdkMsWUFBSSxTQUFTLFVBQVU7QUFDckIsYUFBRyxZQUFZO0FBQ2YsYUFBRyxjQUFjO0FBQUEsUUFDbkIsV0FBVyxTQUFTLFNBQVM7QUFDM0IsYUFBRyxZQUFZO0FBQ2YsYUFBRyxjQUFjO0FBQUEsUUFDbkIsT0FBTztBQUNMLGFBQUcsWUFBWSxpQkFBaUIsSUFBSTtBQUNwQyxnQkFBTSxTQUFTLFNBQVMsY0FBYyxLQUFLO0FBQzNDLGlCQUFPLFlBQVk7QUFDbkIsY0FBSSxTQUFTLFNBQVM7QUFDcEIsNEJBQWdCLFFBQVEsTUFBTSxRQUFRLENBQUMsTUFBTSxLQUFLLGFBQWEsQ0FBQyxDQUFDO0FBQUEsVUFDbkUsT0FBTztBQUNMLG1CQUFPLGNBQWM7QUFBQSxVQUN2QjtBQUNBLGFBQUcsT0FBTyxNQUFNO0FBQUEsUUFDbEI7QUFDQSxhQUFLLE9BQU8sT0FBTyxFQUFFO0FBQ3JCLGFBQUssZUFBZTtBQUFBLE1BQ3RCO0FBQUEsTUFFUSxzQkFBc0IsT0FBcUMsTUFBcUI7QUFDdEYsWUFBSSxDQUFDLEtBQUssSUFBSSx5QkFBMEI7QUFDeEMsY0FBTSxPQUFPLFNBQVMsY0FBYyxLQUFLO0FBQ3pDLGFBQUssWUFBWTtBQUNqQixhQUFLLFFBQVEsUUFBUTtBQUNyQixjQUFNLFFBQ0osVUFBVSxZQUNOLEtBQUssS0FBSyxlQUFlLElBQ3pCLFVBQVUsU0FDUixLQUFLLEtBQUssWUFBWSxJQUN0QixLQUFLLEtBQUssYUFBYTtBQUMvQixhQUFLLFlBQVksVUFBVSxZQUFZLE1BQU0sVUFBVSxVQUFVLFNBQVMsTUFBTSxRQUFRLE1BQU07QUFDOUYsY0FBTSxPQUFPLFNBQVMsY0FBYyxNQUFNO0FBQzFDLGFBQUssY0FBYyxPQUFPLEdBQUcsSUFBSSxXQUFNLEtBQUssS0FBSztBQUNqRCxhQUFLLE9BQU8sSUFBSTtBQUNoQixhQUFLLE9BQU8sT0FBTyxJQUFJO0FBQ3ZCLGFBQUssZUFBZTtBQUFBLE1BQ3RCO0FBQUEsTUFFUSxVQUFVLElBQW1CO0FBQ25DLFlBQUksTUFBTSxDQUFDLEtBQUssVUFBVTtBQUN4QixnQkFBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ3ZDLGFBQUcsWUFBWTtBQUNmLGdCQUFNLE9BQU8sU0FBUyxjQUFjLE1BQU07QUFDMUMsZUFBSyxZQUFZO0FBQ2pCLGVBQUs7QUFBQSxZQUNILFNBQVMsY0FBYyxNQUFNO0FBQUEsWUFDN0IsU0FBUyxjQUFjLE1BQU07QUFBQSxZQUM3QixTQUFTLGNBQWMsTUFBTTtBQUFBLFVBQy9CO0FBQ0EsZ0JBQU0sUUFBUSxTQUFTLGNBQWMsTUFBTTtBQUMzQyxnQkFBTSxjQUFjLEtBQUssS0FBSyxrQkFBa0I7QUFDaEQsYUFBRyxPQUFPLE1BQU0sS0FBSztBQUNyQixlQUFLLE9BQU8sT0FBTyxFQUFFO0FBQ3JCLGVBQUssV0FBVztBQUNoQixlQUFLLGVBQWU7QUFBQSxRQUN0QixXQUFXLENBQUMsTUFBTSxLQUFLLFVBQVU7QUFDL0IsZUFBSyxTQUFTLE9BQU87QUFDckIsZUFBSyxXQUFXO0FBQUEsUUFDbEI7QUFBQSxNQUNGO0FBQUEsTUFFUSxpQkFBdUI7QUFDN0IsYUFBSyxPQUFPLFlBQVksS0FBSyxPQUFPO0FBQUEsTUFDdEM7QUFBQTtBQUFBLE1BR1EsYUFBYSxNQUFvQjtBQUN2QyxlQUFPLGVBQWUsY0FBYyxNQUFNLEtBQUssSUFBSSxXQUFXLEdBQUc7QUFBQSxVQUMvRCxhQUFhLEtBQUssSUFBSTtBQUFBLFVBQ3RCLE1BQU07QUFBQSxZQUNKLE1BQU0sS0FBSyxLQUFLLE1BQU07QUFBQSxZQUN0QixRQUFRLEtBQUssS0FBSyxRQUFRO0FBQUEsWUFDMUIsVUFBVSxLQUFLLEtBQUssVUFBVTtBQUFBLFlBQzlCLE1BQU0sS0FBSyxLQUFLLE1BQU07QUFBQSxVQUN4QjtBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ0g7QUFBQTtBQUFBLE1BSVEsdUJBQWdDO0FBQ3RDLFlBQUksQ0FBQyxLQUFLLElBQUksTUFBTSxXQUFXLENBQUMsS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLEVBQUcsUUFBTztBQUN0RSxZQUFJLEtBQUsseUJBQTBCLFFBQU87QUFDMUMsY0FBTSxNQUFNLEtBQUssSUFBSSxNQUFNO0FBQzNCLFlBQUksS0FBSztBQUNQLGNBQUk7QUFDRixnQkFBSSxPQUFPLGFBQWEsUUFBUSxHQUFHLE1BQU0sV0FBWSxRQUFPO0FBQUEsVUFDOUQsUUFBUTtBQUFBLFVBRVI7QUFBQSxRQUNGO0FBQ0EsZUFBTztBQUFBLE1BQ1Q7QUFBQSxNQUVRLFdBQVcsU0FBMkI7QUFDNUMsWUFBSSxLQUFLLHFCQUFxQixHQUFHO0FBQy9CLGtCQUFRO0FBQ1I7QUFBQSxRQUNGO0FBQ0EsYUFBSyxvQkFBb0I7QUFDekIsYUFBSyxpQkFBaUI7QUFBQSxNQUN4QjtBQUFBLE1BRVEsbUJBQXlCO0FBQy9CLGNBQU0sVUFBVSxTQUFTLGNBQWMsS0FBSztBQUM1QyxnQkFBUSxZQUFZO0FBQ3BCLGNBQU0sT0FBTyxTQUFTLGNBQWMsS0FBSztBQUN6QyxhQUFLLFlBQVk7QUFDakIsY0FBTSxPQUFPLFNBQVMsY0FBYyxLQUFLO0FBQ3pDLGFBQUssWUFBWTtBQUNqQixhQUFLLE9BQU8sS0FBSyxhQUFhLEtBQUssSUFBSSxNQUFNLE9BQU8sQ0FBQztBQUNyRCxjQUFNLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDNUMsZ0JBQVEsWUFBWTtBQUNwQixjQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsZUFBTyxZQUFZO0FBQ25CLGVBQU8sY0FBYyxLQUFLLEtBQUssZUFBZTtBQUM5QyxlQUFPLGlCQUFpQixTQUFTLE1BQU07QUFDckMsZUFBSyxvQkFBb0I7QUFDekIsa0JBQVEsT0FBTztBQUFBLFFBQ2pCLENBQUM7QUFDRCxjQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsZUFBTyxZQUFZO0FBQ25CLGVBQU8sYUFBYSxlQUFlLEVBQUU7QUFDckMsZUFBTyxjQUFjLEtBQUssS0FBSyxjQUFjO0FBQzdDLGVBQU8saUJBQWlCLFNBQVMsTUFBTTtBQUNyQyxlQUFLLDJCQUEyQjtBQUNoQyxnQkFBTSxNQUFNLEtBQUssSUFBSSxNQUFNO0FBQzNCLGNBQUksS0FBSztBQUNQLGdCQUFJO0FBQ0YscUJBQU8sYUFBYSxRQUFRLEtBQUssVUFBVTtBQUFBLFlBQzdDLFFBQVE7QUFBQSxZQUVSO0FBQUEsVUFDRjtBQUNBLGtCQUFRLE9BQU87QUFDZixnQkFBTSxVQUFVLEtBQUs7QUFDckIsZUFBSyxvQkFBb0I7QUFDekIsb0JBQVU7QUFBQSxRQUNaLENBQUM7QUFDRCxnQkFBUSxPQUFPLFFBQVEsTUFBTTtBQUM3QixhQUFLLE9BQU8sTUFBTSxPQUFPO0FBQ3pCLGdCQUFRLE9BQU8sSUFBSTtBQUNuQixhQUFLLFlBQVksT0FBTyxPQUFPO0FBQUEsTUFDakM7QUFBQTtBQUFBLE1BSUEsTUFBYyxZQUEyQjtBQUN2QyxZQUFJLENBQUMsS0FBSyxPQUFPLEtBQUssU0FBUyxRQUFTO0FBQ3hDLGNBQU0sS0FBSyxpQkFBaUIsSUFBSTtBQUNoQyxhQUFLLFFBQVE7QUFDYixhQUFLLE9BQU87QUFDWixhQUFLLGNBQWM7QUFDbkIsYUFBSyxxQkFBcUI7QUFDMUIsYUFBSyxRQUFRO0FBQ2IsYUFBSyxhQUFhO0FBRWxCLFlBQUk7QUFDRixnQkFBTSxPQUFPLEtBQUssYUFBYSxLQUFLO0FBQ3BDLGdCQUFNLFVBQVUsTUFBTSxLQUFLLElBQUk7QUFBQSxZQUM3QixLQUFLO0FBQUEsWUFDTCxLQUFLO0FBQUEsWUFDTCxLQUFLO0FBQUEsVUFDUDtBQUNBLGVBQUssc0JBQXNCLFFBQVE7QUFJbkMsY0FBSSxRQUFRLE9BQU8sV0FBVyxXQUFXO0FBQ3ZDLGlCQUFLLGNBQWM7QUFDbkIsaUJBQUssYUFBYTtBQUFBLFVBQ3BCO0FBQ0EsZ0JBQU0sU0FBUyxJQUFJLFlBQVksU0FBUztBQUFBLFlBQ3RDLGVBQWUsQ0FBQyxVQUFVO0FBQ3hCLGtCQUFJLFVBQVUsYUFBYTtBQUN6QixvQkFBSSxLQUFLLGdCQUFnQixTQUFVLE1BQUssY0FBYztBQUN0RCxxQkFBSyxhQUFhO0FBQUEsY0FDcEIsV0FBVyxVQUFVLGtCQUFrQixVQUFVLFNBQVM7QUFDeEQsb0JBQUksS0FBSyxTQUFTLFFBQVMsTUFBSyxLQUFLLFFBQVEsT0FBTztBQUFBLGNBQ3REO0FBQUEsWUFDRjtBQUFBLFlBQ0EsZUFBZSxDQUFDLFdBQVc7QUFDekIsbUJBQUssUUFBUSxZQUFZO0FBQ3pCLG1CQUFLLEtBQUssUUFDUCxLQUFLLEVBQ0wsS0FBSyxNQUFNLE9BQU8scUJBQXFCLENBQUMsRUFDeEMsTUFBTSxNQUFNLE9BQU8scUJBQXFCLENBQUM7QUFBQSxZQUM5QztBQUFBLFlBQ0EsY0FBYyxDQUFDLFFBQVEsS0FBSyxjQUFjLEdBQUc7QUFBQSxZQUM3QyxTQUFTLE1BQU07QUFDYixrQkFBSSxLQUFLLFNBQVMsU0FBUztBQUN6QixxQkFBSyxjQUFjLFNBQVMsS0FBSyxLQUFLLGdCQUFnQixDQUFDO0FBQUEsY0FDekQ7QUFBQSxZQUNGO0FBQUEsVUFDRixDQUFDO0FBQ0QsZUFBSyxRQUFRO0FBQ2IsZ0JBQU0sT0FBTyxRQUFRO0FBQUEsUUFDdkIsU0FBUyxLQUFLO0FBQ1osZUFBSyxPQUFPO0FBQ1osZUFBSyxRQUFRO0FBQ2IsZ0JBQU0sT0FBTyxvQkFBb0IsR0FBRztBQUNwQyxjQUFJLE1BQU07QUFJUixpQkFBSyxjQUFjLFNBQVMsSUFBSTtBQUFBLFVBQ2xDLE9BQU87QUFDTCxpQkFBSyxVQUFVLGVBQWUsaUJBQWlCLEdBQUcsSUFBSSxNQUFNLElBQUksSUFBSSxPQUFPLEtBQUssR0FBRztBQUFBLFVBQ3JGO0FBQ0EsZUFBSyxhQUFhO0FBQUEsUUFDcEI7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVNBLE1BQU0scUJBQXFCLE1BQWMsTUFBaUQ7QUFDeEYsWUFBSSxLQUFLLE1BQU8sUUFBTyxLQUFLLE1BQU0scUJBQXFCLE1BQU0sTUFBTSxTQUFTO0FBQzVFLFlBQUksS0FBSyxPQUFPLEtBQUssZUFBZTtBQUNsQyxjQUFJO0FBQ0Ysa0JBQU0sS0FBSyxJQUFJLGdCQUFnQixLQUFLLGVBQWUsTUFBTSxNQUFNLFNBQVM7QUFDeEUsbUJBQU87QUFBQSxVQUNULFNBQVMsS0FBSztBQUNaLG9CQUFRLEtBQUssc0NBQXNDLEdBQUc7QUFDdEQsbUJBQU87QUFBQSxVQUNUO0FBQUEsUUFDRjtBQUNBLGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT0EsTUFBTSxlQUFlLFlBQW9CLFlBQXVDO0FBQzlFLFlBQUksS0FBSyxNQUFPLFFBQU8sS0FBSyxNQUFNLG9CQUFvQixZQUFZLFVBQVU7QUFDNUUsWUFBSSxLQUFLLE9BQU8sS0FBSyxlQUFlO0FBQ2xDLGNBQUk7QUFDRixrQkFBTSxLQUFLLElBQUkscUJBQXFCLEtBQUssZUFBZSxZQUFZLFVBQVU7QUFDOUUsbUJBQU87QUFBQSxVQUNULFNBQVMsS0FBSztBQUNaLG9CQUFRLEtBQUssaUNBQWlDLEdBQUc7QUFDakQsbUJBQU87QUFBQSxVQUNUO0FBQUEsUUFDRjtBQUNBLGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQSxNQUdRLGtCQUFrQixNQUF5QjtBQUNqRCxZQUFJLEtBQUssZUFBZTtBQUN0QixjQUFJO0FBQ0YsaUJBQUssY0FBYyxJQUFJO0FBQUEsVUFDekIsU0FBUyxLQUFLO0FBQ1osb0JBQVEsS0FBSyx3QkFBd0IsS0FBSyxRQUFRLEtBQUssR0FBRztBQUFBLFVBQzVEO0FBQ0E7QUFBQSxRQUNGO0FBQ0EsWUFBSSxLQUFLLFVBQVUsb0JBQXFCLE1BQUssS0FBSyxlQUFlLEtBQUssWUFBWSxLQUFLO0FBQUEsTUFDekY7QUFBQTtBQUFBO0FBQUEsTUFJQSxNQUFjLHFCQUNaLE1BQ0EsTUFDZTtBQUNmLGNBQU0sU0FBUyxNQUFNO0FBQUEsVUFDbkIsS0FBSztBQUFBLFVBQ0w7QUFBQSxVQUNBLEtBQUssNkJBQTZCO0FBQUEsUUFDcEM7QUFDQSxZQUFJLENBQUMsT0FBUTtBQUdiLFlBQUk7QUFDRixnQkFBTSxLQUFLLE9BQU8sUUFBUSxPQUFPLE9BQU87QUFBQSxRQUMxQyxTQUFTLEtBQUs7QUFDWixrQkFBUSxLQUFLLHNCQUFzQixLQUFLLFFBQVEsMEJBQTBCLEdBQUc7QUFBQSxRQUMvRTtBQUFBLE1BQ0Y7QUFBQSxNQUVRLGNBQWMsS0FBd0I7QUFDNUMsY0FBTSxVQUFVLHdCQUF3QixHQUFHO0FBQzNDLFlBQUksU0FBUztBQUNYLGdCQUFNLFVBQVUsc0JBQXNCLE9BQU87QUFDN0MsY0FBSSxRQUFTLE1BQUssa0JBQWtCLE9BQU87QUFDM0M7QUFBQSxRQUNGO0FBQ0EsY0FBTSxpQkFBaUIsdUJBQXVCLEdBQUc7QUFDakQsWUFBSSxnQkFBZ0I7QUFDbEIsZ0JBQU0sU0FBUyxLQUFLO0FBQ3BCLGVBQUssS0FBSztBQUFBLFlBQXFCO0FBQUEsWUFBZ0IsQ0FBQyxRQUFRLFlBQ3RELFNBQVMsT0FBTyxxQkFBcUIsZUFBZSxZQUFZLFFBQVEsT0FBTyxJQUFJO0FBQUEsVUFDckY7QUFDQTtBQUFBLFFBQ0Y7QUFDQSxjQUFNLGFBQWEsZ0JBQWdCLEdBQUc7QUFDdEMsWUFBSSxZQUFZO0FBQ2QsZUFBSyxrQkFBa0IsVUFBVTtBQUNqQztBQUFBLFFBQ0Y7QUFDQSxnQkFBUSxJQUFJLE1BQU07QUFBQSxVQUNoQixLQUFLO0FBQ0gsaUJBQUssY0FBYztBQUNuQixpQkFBSyxhQUFhO0FBQ2xCO0FBQUEsVUFDRixLQUFLO0FBRUgsZ0JBQUksS0FBSyxnQkFBZ0IsU0FBVSxNQUFLLGNBQWM7QUFDdEQsaUJBQUssYUFBYTtBQUNsQjtBQUFBLFVBQ0YsS0FBSztBQUNILGdCQUFJLEtBQUssZ0JBQWdCLGNBQWM7QUFDckMsbUJBQUssY0FBYztBQUNuQixtQkFBSyxhQUFhO0FBQUEsWUFDcEI7QUFDQTtBQUFBLFVBQ0Y7QUFDRTtBQUFBLFFBQ0o7QUFDQSxZQUFJLHVCQUF1QixHQUFHLEdBQUc7QUFDL0IsZ0JBQU0sT0FBTyxlQUFlLEdBQUc7QUFDL0IsZ0JBQU0sT0FBTyxJQUFJLE1BQU0sUUFBUTtBQUMvQixjQUFJLFFBQVEsT0FBTyxTQUFTLFlBQVksS0FBSyxLQUFLLEdBQUc7QUFHbkQsaUJBQUssY0FBYyxNQUFNLE1BQU0sVUFBVTtBQUFBLFVBQzNDO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BTVEsa0JBQWtCLFlBQXdEO0FBQ2hGLFlBQUksS0FBSyxTQUFTLFFBQVM7QUFDM0IsWUFBSSxlQUFlLFdBQVc7QUFDNUIsZUFBSyxjQUFjO0FBQ25CLGVBQUssYUFBYTtBQUNsQjtBQUFBLFFBQ0Y7QUFDQSxZQUFJLGVBQWUsWUFBWTtBQUM3QixlQUFLLGNBQWM7QUFDbkIsZUFBSyxhQUFhO0FBQ2xCO0FBQUEsUUFDRjtBQUNBLFlBQUksS0FBSyxtQkFBb0I7QUFDN0IsYUFBSyxxQkFBcUI7QUFDMUIsYUFBSyxjQUFjLFVBQVUsS0FBSyxLQUFLLGlCQUFpQixDQUFDO0FBQ3pELGFBQUssS0FBSyxRQUFRLE9BQU87QUFBQSxNQUMzQjtBQUFBLE1BRUEsTUFBYyxRQUFRLElBQXFDO0FBQ3pELGNBQU0sU0FBUyxLQUFLO0FBQ3BCLGFBQUssUUFBUTtBQUNiLGFBQUssT0FBTztBQUNaLGFBQUssUUFBUSxFQUFFLElBQUksZ0JBQWdCLEtBQUssb0JBQW9CO0FBQzVELFlBQUksT0FBUSxPQUFNLE9BQU8sV0FBVztBQUNwQyxhQUFLLFFBQVEsWUFBWTtBQUN6QixhQUFLO0FBQUEsVUFDSDtBQUFBLFVBQ0EsT0FBTyxTQUNILEtBQUssS0FBSyx5QkFBeUIsSUFDbkMsS0FBSyxLQUFLLDBCQUEwQjtBQUFBLFFBQzFDO0FBQ0EsYUFBSyxhQUFhO0FBQ2xCLFlBQUksS0FBSyxJQUFJLG9CQUFvQixLQUFLLHFCQUFxQjtBQUN6RCxlQUFLLG9CQUFvQixLQUFLLG1CQUFtQjtBQUFBLFFBQ25EO0FBQUEsTUFDRjtBQUFBO0FBQUEsTUFJQSxNQUFjLFlBQTJCO0FBQ3ZDLFlBQUksQ0FBQyxLQUFLLE9BQU8sS0FBSyxTQUFTLE9BQVE7QUFDdkMsY0FBTSxLQUFLLGlCQUFpQixJQUFJO0FBQ2hDLGFBQUssUUFBUTtBQUNiLGFBQUssT0FBTztBQUNaLGFBQUssV0FBVztBQUNoQixhQUFLLHFCQUFxQjtBQUMxQixhQUFLLG1CQUFtQjtBQUN4QixhQUFLLHFCQUFxQixDQUFDO0FBQzNCLGFBQUssMEJBQTBCO0FBQy9CLGFBQUssYUFBYTtBQUNsQixhQUFLLFVBQVUsSUFBSTtBQUNuQixZQUFJO0FBQ0YsZ0JBQU0sT0FBTyxLQUFLLGFBQWEsSUFBSTtBQUNuQyxnQkFBTSxLQUFLLGtCQUFrQixLQUFLLElBQUk7QUFBQSxZQUNsQyxLQUFLO0FBQUEsWUFDTCxLQUFLO0FBQUEsWUFDTCxLQUFLO0FBQUEsVUFDUCxDQUFDO0FBQUEsUUFDTCxTQUFTLEtBQUs7QUFDWixlQUFLLFVBQVUsS0FBSztBQUNwQixlQUFLLE9BQU87QUFDWixlQUFLLFVBQVUsZUFBZSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxHQUFHO0FBQUEsUUFDckYsVUFBRTtBQUNBLGVBQUssV0FBVztBQUNoQixlQUFLLGFBQWE7QUFBQSxRQUNwQjtBQUFBLE1BQ0Y7QUFBQTtBQUFBO0FBQUEsTUFJQSxNQUFjLFdBQVcsTUFBMkI7QUFDbEQsWUFBSSxDQUFDLEtBQUssT0FBTyxDQUFDLEtBQUssY0FBZTtBQUN0QyxjQUFNLFlBQVksbUJBQW1CLE1BQU0sS0FBSyx1QkFBdUI7QUFDdkUsWUFBSSxjQUFjLHlCQUF5QjtBQUN6QyxlQUFLO0FBQUEsWUFDSDtBQUFBLFlBQ0EsR0FBRyxLQUFLLEtBQUssdUJBQXVCLENBQUM7QUFBQSxVQUN2QztBQUNBO0FBQUEsUUFDRjtBQUNBLFlBQUksV0FBVztBQUNiLGVBQUssY0FBYyxTQUFTLEtBQUssS0FBSyxTQUFTLENBQUM7QUFDaEQ7QUFBQSxRQUNGO0FBQ0EsWUFBSTtBQUNGLGdCQUFNLFdBQVcsTUFBTSxLQUFLLElBQUksaUJBQWlCLEtBQUssZUFBZSxJQUFJO0FBQ3pFLGVBQUssMkJBQTJCO0FBQ2hDLGVBQUssbUJBQW1CLEtBQUssUUFBUTtBQUNyQyxlQUFLLGFBQWE7QUFBQSxRQUNwQixTQUFTLEtBQUs7QUFDWixlQUFLO0FBQUEsWUFDSCxlQUFlLGlCQUFpQixHQUFHLElBQUksTUFBTSxJQUFJLElBQUksT0FBTyxLQUFLO0FBQUEsWUFDakU7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxNQUVBLE1BQWMsU0FBUyxNQUE2QjtBQUNsRCxZQUFJLENBQUMsS0FBSyxPQUFPLENBQUMsS0FBSyxjQUFlO0FBQ3RDLGNBQU0sY0FBYyxLQUFLO0FBQ3pCLGFBQUsscUJBQXFCLENBQUM7QUFDM0IsWUFBSSxZQUFZLFNBQVMsRUFBRyxNQUFLLGFBQWE7QUFDOUMsY0FBTSxVQUNKLFlBQVksU0FBUyxJQUNqQixHQUFHLElBQUk7QUFBQSxFQUFLLFlBQVksSUFBSSxDQUFDLE1BQU0sSUFBSSxFQUFFLFFBQVEsR0FBRyxFQUFFLEtBQUssSUFBSSxDQUFDLEtBQ2hFO0FBQ04sYUFBSyxjQUFjLFFBQVEsT0FBTztBQUNsQyxhQUFLLFdBQVc7QUFDaEIsYUFBSyxVQUFVLElBQUk7QUFDbkIsWUFBSTtBQUNGLGdCQUFNLEtBQUs7QUFBQSxZQUNULEtBQUssSUFBSTtBQUFBLGNBQ1AsS0FBSztBQUFBLGNBQ0w7QUFBQSxjQUNBLFlBQVksSUFBSSxDQUFDLE1BQU0sRUFBRSxhQUFhO0FBQUEsWUFDeEM7QUFBQSxVQUNGO0FBQUEsUUFDRixTQUFTLEtBQUs7QUFDWixlQUFLLFVBQVUsS0FBSztBQUNwQixlQUFLLFVBQVUsZUFBZSxpQkFBaUIsR0FBRyxJQUFJLE1BQU0sSUFBSSxJQUFJLE9BQU8sS0FBSyxHQUFHO0FBQUEsUUFDckYsVUFBRTtBQUNBLGVBQUssV0FBVztBQUFBLFFBQ2xCO0FBQUEsTUFDRjtBQUFBLE1BRUEsTUFBYyxrQkFDWixRQUNlO0FBQ2YseUJBQWlCLFNBQVMsUUFBUTtBQUNoQyxrQkFBUSxNQUFNLE1BQU07QUFBQSxZQUNsQixLQUFLO0FBR0gsbUJBQUssbUJBQW1CLHNCQUFzQixNQUFNLGFBQWE7QUFDakUsbUJBQUssZ0JBQWdCLE1BQU0sY0FBYztBQUd6QyxtQkFBSyxxQkFBcUIsTUFBTSxtQkFBbUI7QUFDbkQ7QUFBQSxZQUNGLEtBQUssbUJBQW1CO0FBQ3RCLG1CQUFLLFVBQVUsS0FBSztBQUNwQixtQkFBSyxjQUFjLE1BQU0sU0FBUztBQUNsQyxrQkFBSSxDQUFDLEtBQUssVUFBVTtBQUNsQixzQkFBTSxLQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ3ZDLG1CQUFHLFlBQVk7QUFDZixzQkFBTSxTQUFTLFNBQVMsY0FBYyxLQUFLO0FBQzNDLHVCQUFPLFlBQVk7QUFDbkIsbUJBQUcsT0FBTyxNQUFNO0FBQ2hCLHFCQUFLLE9BQU8sT0FBTyxFQUFFO0FBQ3JCLHFCQUFLLFdBQVc7QUFBQSxjQUNsQjtBQUNBLG1CQUFLLFNBQVMsY0FBYyxLQUFLO0FBQ2pDLG1CQUFLLGVBQWU7QUFDcEI7QUFBQSxZQUNGO0FBQUEsWUFDQSxLQUFLLHFCQUFxQjtBQUN4QixtQkFBSyxtQkFBbUI7QUFDeEIsbUJBQUssVUFBVSxLQUFLO0FBQ3BCLGtCQUFJLE1BQU0sS0FBTSxNQUFLLGNBQWMsU0FBUyxNQUFNLElBQUk7QUFDdEQ7QUFBQSxZQUNGO0FBQUEsWUFDQSxLQUFLLG9CQUFvQjtBQUd2QixvQkFBTSxZQUFZLEtBQUs7QUFDdkIsb0JBQU0sTUFBTSxLQUFLO0FBQ2pCLGtCQUFJLE9BQU8sTUFBTSxpQkFBaUIsWUFBWSxPQUFPLE1BQU0sU0FBUyxVQUFVO0FBQzVFLHNCQUFNLE9BQXVCO0FBQUEsa0JBQzNCLFVBQVUsTUFBTTtBQUFBLGtCQUNoQixZQUFZLE1BQU07QUFBQSxrQkFDbEIsWUFBWSxNQUFNLFFBQVEsQ0FBQztBQUFBLGtCQUMzQixpQkFBaUIsTUFBTSxxQkFBcUI7QUFBQSxrQkFDNUMsR0FBSSxPQUFPLE1BQU0saUJBQWlCLFdBQzlCLEVBQUUscUJBQXFCLE1BQU0sYUFBYSxJQUMxQyxDQUFDO0FBQUEsZ0JBQ1A7QUFDQSxxQkFBSyxLQUFLLHFCQUFxQixNQUFNLE9BQU8sUUFBUSxZQUFZO0FBQzlELHNCQUFJLENBQUMsT0FBTyxDQUFDLFVBQVcsUUFBTztBQUMvQix3QkFBTSxJQUFJLG1CQUFtQixXQUFXLEtBQUssWUFBWSxRQUFRLE9BQU87QUFDeEUseUJBQU87QUFBQSxnQkFDVCxDQUFDO0FBQUEsY0FDSDtBQUNBLG1CQUFLLHNCQUFzQixXQUFXLE1BQU0sSUFBSTtBQUNoRDtBQUFBLFlBQ0Y7QUFBQSxZQUNBLEtBQUssaUJBQWlCO0FBR3BCLG9CQUFNLFVBQVUsc0JBQXNCLEtBQWdDO0FBQ3RFLGtCQUFJLFNBQVM7QUFDWCxxQkFBSyxrQkFBa0IsT0FBTztBQUM5QixvQkFBSSxRQUFRLFVBQVUscUJBQXFCO0FBQ3pDLHVCQUFLLHNCQUFzQixXQUFXLFFBQVEsUUFBUTtBQUFBLGdCQUN4RDtBQUFBLGNBQ0Y7QUFDQTtBQUFBLFlBQ0Y7QUFBQSxZQUNBLEtBQUs7QUFPSCxtQkFBSyxzQkFBc0IsUUFBUSxNQUFNLElBQUk7QUFDN0M7QUFBQSxZQUNGLEtBQUs7QUFDSCxtQkFBSyxtQkFBbUI7QUFDeEIsbUJBQUssVUFBVSxLQUFLO0FBQ3BCO0FBQUEsWUFDRixLQUFLLFNBQVM7QUFDWixtQkFBSyxtQkFBbUI7QUFDeEIsbUJBQUssVUFBVSxLQUFLO0FBQ3BCLG1CQUFLLE9BQU87QUFDWixvQkFBTSxpQkFBaUIsS0FBSztBQUM1QixtQkFBSyxRQUFRLEVBQUUsSUFBSSxTQUFTLGVBQWU7QUFDM0Msb0JBQU0sWUFBWSxLQUFLO0FBQ3ZCLG1CQUFLLGdCQUFnQjtBQUNyQixrQkFBSSxhQUFhLEtBQUssSUFBSyxNQUFLLEtBQUssSUFBSSxVQUFVLFNBQVM7QUFDNUQsbUJBQUssY0FBYyxVQUFVLEtBQUssS0FBSywwQkFBMEIsQ0FBQztBQUNsRSxtQkFBSyxhQUFhO0FBRWxCLGtCQUFJLEtBQUssSUFBSSxvQkFBb0IsZ0JBQWdCO0FBQy9DLHFCQUFLLG9CQUFvQixjQUFjO0FBQUEsY0FDekM7QUFDQTtBQUFBLFlBQ0Y7QUFBQSxZQUNBLEtBQUs7QUFHSCxtQkFBSyxtQkFBbUI7QUFDeEIsbUJBQUssVUFBVSxLQUFLO0FBQ3BCLG1CQUFLLDZCQUE2QixNQUFNLFNBQVMsTUFBTSxJQUFJO0FBQzNEO0FBQUEsWUFDRjtBQUNFO0FBQUEsVUFDSjtBQUFBLFFBQ0Y7QUFFQSxhQUFLLG1CQUFtQjtBQUN4QixhQUFLLFVBQVUsS0FBSztBQUFBLE1BQ3RCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1RLFVBQVUsUUFBaUIsTUFBcUIsa0JBQXdCO0FBQzlFLFlBQUksV0FBVyxVQUFhLFdBQVcsUUFBUSxXQUFXLElBQUk7QUFDNUQsa0JBQVEsTUFBTSx1QkFBdUIsTUFBTTtBQUFBLFFBQzdDO0FBQ0EsYUFBSyxjQUFjLFNBQVMsS0FBSyxLQUFLLEdBQUcsQ0FBQztBQUFBLE1BQzVDO0FBQUEsTUFFUSw2QkFBNkIsU0FBa0IsTUFBcUI7QUFDMUUsYUFBSyxVQUFVLE9BQU8sR0FBRyxJQUFJLEtBQUssV0FBVyxFQUFFLEtBQUssT0FBTztBQUFBLE1BQzdEO0FBQUE7QUFBQTtBQUFBLE1BSVEscUJBQTJCO0FBQ2pDLFlBQUksQ0FBQyxLQUFLLFNBQVU7QUFDcEIsY0FBTSxPQUFPLEtBQUs7QUFDbEIsY0FBTSxTQUFTLEtBQUs7QUFDcEIsYUFBSyxXQUFXO0FBQ2hCLGFBQUssYUFBYTtBQUNsQixlQUFPLGNBQWM7QUFDckIsWUFBSSxVQUFVO0FBQ2QsWUFBSSxLQUFLLElBQUksZ0JBQWlCLFdBQVUsZUFBZSxPQUFPO0FBQzlELHdCQUFnQixRQUFRLFNBQVMsS0FBSyxrQkFBa0IsQ0FBQyxNQUFNLEtBQUssYUFBYSxDQUFDLENBQUM7QUFDbkYsYUFBSyxlQUFlO0FBQUEsTUFDdEI7QUFBQTtBQUFBLE1BSUEsTUFBYyxhQUE0QjtBQUN4QyxZQUFJLEtBQUssU0FBUyxTQUFTO0FBQ3pCLGdCQUFNLEtBQUssUUFBUSxNQUFNO0FBQ3pCLGVBQUssY0FBYyxVQUFVLEtBQUssS0FBSyx1QkFBdUIsQ0FBQztBQUMvRCxnQkFBTSxLQUFLLFVBQVU7QUFBQSxRQUN2QixXQUFXLEtBQUssU0FBUyxRQUFRO0FBQy9CLGdCQUFNLFlBQVksS0FBSztBQUN2QixlQUFLLGdCQUFnQjtBQUNyQixjQUFJLGFBQWEsS0FBSyxJQUFLLE1BQUssS0FBSyxJQUFJLFVBQVUsU0FBUztBQUM1RCxlQUFLLE9BQU87QUFDWixlQUFLLGNBQWMsVUFBVSxLQUFLLEtBQUssd0JBQXdCLENBQUM7QUFDaEUsZ0JBQU0sS0FBSyxVQUFVO0FBQUEsUUFDdkI7QUFBQSxNQUNGO0FBQUEsTUFFQSxNQUFjLGlCQUFpQixTQUF1QztBQUNwRSxZQUFJLEtBQUssT0FBTztBQUNkLGdCQUFNLFNBQVMsS0FBSztBQUNwQixlQUFLLFFBQVE7QUFDYixnQkFBTSxPQUFPLFdBQVc7QUFBQSxRQUMxQjtBQUNBLFlBQUksS0FBSyxpQkFBaUIsS0FBSyxLQUFLO0FBQ2xDLGVBQUssS0FBSyxJQUFJLFVBQVUsS0FBSyxhQUFhO0FBQzFDLGVBQUssZ0JBQWdCO0FBQUEsUUFDdkI7QUFDQSxZQUFJLFdBQVcsS0FBSyxTQUFTLFFBQVE7QUFDbkMsZUFBSyxPQUFPO0FBQUEsUUFDZDtBQUFBLE1BQ0Y7QUFBQTtBQUFBLE1BSVEsb0JBQW9CLGdCQUE4QjtBQUN4RCxjQUFNLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDNUMsZ0JBQVEsWUFBWTtBQUNwQixjQUFNLE9BQU8sU0FBUyxjQUFjLEtBQUs7QUFDekMsYUFBSyxZQUFZO0FBQ2pCLGdCQUFRLE9BQU8sSUFBSTtBQUNuQixhQUFLLFlBQVksT0FBTyxPQUFPO0FBRS9CLFlBQUksU0FBUztBQUViLGNBQU0sYUFBYSxNQUFNO0FBQ3ZCLGVBQUssY0FBYztBQUNuQixnQkFBTSxRQUFRLFNBQVMsY0FBYyxLQUFLO0FBQzFDLGdCQUFNLFlBQVk7QUFDbEIsZ0JBQU0sY0FBYyxLQUFLLEtBQUssbUJBQW1CO0FBQ2pELGdCQUFNLFFBQVEsU0FBUyxjQUFjLEtBQUs7QUFDMUMsZ0JBQU0sWUFBWTtBQUNsQixtQkFBUyxJQUFJLEdBQUcsS0FBSyxHQUFHLEtBQUssR0FBRztBQUM5QixrQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGlCQUFLLFlBQVk7QUFDakIsaUJBQUssWUFBWSxNQUFNO0FBQ3ZCLGlCQUFLLGFBQWEsY0FBYyxHQUFHLENBQUMsRUFBRTtBQUN0QyxnQkFBSSxLQUFLLE9BQVEsTUFBSyxhQUFhLFdBQVcsRUFBRTtBQUNoRCxpQkFBSyxpQkFBaUIsU0FBUyxNQUFNO0FBQ25DLHVCQUFTO0FBQ1QsbUJBQUssS0FBSyxLQUFLLGVBQWUsZ0JBQWdCLFFBQVEsSUFBSSxFQUFFLE1BQU0sTUFBTSxNQUFTO0FBQ2pGLDRCQUFjO0FBQUEsWUFDaEIsQ0FBQztBQUNELGtCQUFNLE9BQU8sSUFBSTtBQUFBLFVBQ25CO0FBQ0EsZ0JBQU0sVUFBVSxTQUFTLGNBQWMsS0FBSztBQUM1QyxrQkFBUSxZQUFZO0FBQ3BCLGdCQUFNLE9BQU8sU0FBUyxjQUFjLFFBQVE7QUFDNUMsZUFBSyxZQUFZO0FBQ2pCLGVBQUssY0FBYyxLQUFLLEtBQUssZUFBZTtBQUM1QyxlQUFLLGlCQUFpQixTQUFTLE1BQU0sUUFBUSxPQUFPLENBQUM7QUFDckQsa0JBQVEsT0FBTyxJQUFJO0FBQ25CLGVBQUssT0FBTyxPQUFPLE9BQU8sT0FBTztBQUFBLFFBQ25DO0FBRUEsY0FBTSxnQkFBZ0IsTUFBTTtBQUMxQixlQUFLLGNBQWM7QUFDbkIsZ0JBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxnQkFBTSxZQUFZO0FBQ2xCLGdCQUFNLGNBQWMsS0FBSyxLQUFLLDRCQUE0QjtBQUMxRCxnQkFBTSxXQUFXLFNBQVMsY0FBYyxVQUFVO0FBQ2xELG1CQUFTLFlBQVk7QUFDckIsbUJBQVMsY0FBYyxLQUFLLEtBQUssZ0NBQWdDO0FBQ2pFLGdCQUFNLFVBQVUsU0FBUyxjQUFjLEtBQUs7QUFDNUMsa0JBQVEsWUFBWTtBQUNwQixnQkFBTSxPQUFPLFNBQVMsY0FBYyxRQUFRO0FBQzVDLGVBQUssWUFBWTtBQUNqQixlQUFLLGNBQWMsS0FBSyxLQUFLLFNBQVM7QUFDdEMsZUFBSyxpQkFBaUIsU0FBUyxVQUFVO0FBQ3pDLGdCQUFNLFNBQVMsU0FBUyxjQUFjLFFBQVE7QUFDOUMsaUJBQU8sWUFBWTtBQUNuQixpQkFBTyxhQUFhLGVBQWUsRUFBRTtBQUNyQyxpQkFBTyxjQUFjLEtBQUssS0FBSyxRQUFRO0FBQ3ZDLGlCQUFPLGlCQUFpQixTQUFTLE1BQU07QUFDckMsaUJBQUssS0FBSyxLQUNOLGVBQWUsZ0JBQWdCLFFBQVEsU0FBUyxNQUFNLEtBQUssS0FBSyxJQUFJLEVBQ3JFLE1BQU0sTUFBTSxNQUFTO0FBQ3hCLHlCQUFhO0FBQUEsVUFDZixDQUFDO0FBQ0Qsa0JBQVEsT0FBTyxNQUFNLE1BQU07QUFDM0IsZUFBSyxPQUFPLE9BQU8sVUFBVSxPQUFPO0FBQUEsUUFDdEM7QUFFQSxjQUFNLGVBQWUsTUFBTTtBQUN6QixlQUFLLGNBQWM7QUFDbkIsZ0JBQU0sUUFBUSxTQUFTLGNBQWMsS0FBSztBQUMxQyxnQkFBTSxZQUFZO0FBQ2xCLGdCQUFNLGNBQWMsS0FBSyxLQUFLLHFCQUFxQjtBQUNuRCxnQkFBTSxPQUFPLFNBQVMsY0FBYyxLQUFLO0FBQ3pDLGVBQUssWUFBWTtBQUNqQixlQUFLLGNBQWMsS0FBSyxLQUFLLDZCQUE2QjtBQUMxRCxnQkFBTSxVQUFVLFNBQVMsY0FBYyxLQUFLO0FBQzVDLGtCQUFRLFlBQVk7QUFDcEIsZ0JBQU0sUUFBUSxTQUFTLGNBQWMsUUFBUTtBQUM3QyxnQkFBTSxZQUFZO0FBQ2xCLGdCQUFNLGFBQWEsZUFBZSxFQUFFO0FBQ3BDLGdCQUFNLGNBQWMsS0FBSyxLQUFLLFNBQVM7QUFDdkMsZ0JBQU0saUJBQWlCLFNBQVMsTUFBTSxRQUFRLE9BQU8sQ0FBQztBQUN0RCxrQkFBUSxPQUFPLEtBQUs7QUFDcEIsZUFBSyxPQUFPLE9BQU8sTUFBTSxPQUFPO0FBQUEsUUFDbEM7QUFFQSxtQkFBVztBQUFBLE1BQ2I7QUFBQSxJQUNGO0FBS0EsSUFBTSx1QkFDSixPQUFPLG1DQUFtQyxXQUFXLGlDQUFpQztBQUl4RixJQUFNLGlCQUFnQyxNQUFNO0FBQzFDLFVBQUk7QUFDRixjQUFNLE1BQU8sU0FBUyxlQUE0QztBQUNsRSxlQUFPLE1BQU0sSUFBSSxJQUFJLEdBQUcsRUFBRSxTQUFTO0FBQUEsTUFDckMsUUFBUTtBQUNOLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRixHQUFHO0FBQUE7QUFBQTs7O0FDeHdESDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUEyQk8sU0FBUyxlQUFlLFVBQWtCLGVBQXFCO0FBQ3BFLE1BQUksT0FBTyxXQUFXLGVBQWUsRUFBRSxvQkFBb0IsUUFBUztBQUNwRSxNQUFJLGVBQWUsSUFBSSxPQUFPLEVBQUc7QUFDakMsaUJBQWU7QUFBQSxJQUNiO0FBQUEsSUFDQSxZQUFZLGdCQUFnQixvQkFBb0IsY0FBYyxrQkFBa0I7QUFBQSxJQUFDO0FBQUEsRUFDbkY7QUFDRjtBQWxDQSxJQW1CYTtBQW5CYjtBQUFBO0FBQUE7QUFhQTtBQU1PLElBQU0sY0FBYyxDQUFDLGVBQWUsZ0JBQWdCO0FBaUIzRCxlQUFXLE9BQU8sWUFBYSxnQkFBZSxHQUFHO0FBQUE7QUFBQTs7O0FDcENqRCxPQUFPLFVBQVU7QUFDakIsT0FBTyxZQUFZO0FBT25CLElBQU0sVUFBVSxvQkFBSSxJQUFzQztBQUcxRCxJQUFNLGNBQU4sTUFBa0I7QUFBQSxFQUFsQjtBQUNFLFNBQVMsUUFBUSxvQkFBSSxJQUFvQjtBQUN6QyxTQUFTLFlBQVksb0JBQUksSUFBNkM7QUFBQTtBQUFBLEVBQ3RFLGVBQWU7QUFDYixXQUFPLENBQUM7QUFBQSxFQUNWO0FBQUEsRUFDQSxhQUFhLE1BQWM7QUFDekIsV0FBTyxLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUs7QUFBQSxFQUNqQztBQUFBLEVBQ0EsYUFBYSxNQUFjLE9BQWU7QUFDeEMsU0FBSyxNQUFNLElBQUksTUFBTSxLQUFLO0FBQUEsRUFDNUI7QUFBQSxFQUNBLGlCQUFpQixNQUFjLElBQThCO0FBQzNELFNBQUssVUFBVSxJQUFJLE1BQU0sQ0FBQyxHQUFJLEtBQUssVUFBVSxJQUFJLElBQUksS0FBSyxDQUFDLEdBQUksRUFBRSxDQUFDO0FBQUEsRUFDcEU7QUFBQSxFQUNBLGNBQWMsT0FBeUI7QUFDckMsZUFBVyxNQUFNLEtBQUssVUFBVSxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsRUFBRyxJQUFHLEtBQUs7QUFDL0QsV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVBLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQUNwQixZQUNXLE1BQ0EsTUFDVDtBQUZTO0FBQ0E7QUFBQSxFQUNSO0FBQUEsRUFDSCxJQUFJLFNBQVM7QUFDWCxXQUFPLEtBQUssS0FBSztBQUFBLEVBQ25CO0FBQ0Y7QUFFQSxPQUFPLE9BQU8sWUFBWTtBQUFBLEVBQ3hCLGFBQWE7QUFBQSxFQUNiLGFBQWE7QUFBQSxFQUNiLFFBQVE7QUFBQSxFQUNSLGdCQUFnQjtBQUFBLElBQ2QsS0FBSyxDQUFDLFNBQWlCLFFBQVEsSUFBSSxJQUFJO0FBQUEsSUFDdkMsUUFBUSxDQUFDLE1BQWMsU0FBbUM7QUFDeEQsVUFBSSxRQUFRLElBQUksSUFBSSxFQUFHLE9BQU0sSUFBSSxNQUFNLEdBQUcsSUFBSSxrQkFBa0I7QUFDaEUsY0FBUSxJQUFJLE1BQU0sSUFBSTtBQUFBLElBQ3hCO0FBQUEsRUFDRjtBQUNGLENBQUM7QUFFRCxLQUFLLHFFQUFxRSxZQUFZO0FBQ3BGLFFBQU0sTUFBTSxNQUFNO0FBQ2xCLFNBQU8sVUFBVSxDQUFDLEdBQUcsUUFBUSxLQUFLLENBQUMsR0FBRyxDQUFDLGVBQWUsZ0JBQWdCLENBQUM7QUFDdkUsU0FBTyxNQUFNLFFBQVEsSUFBSSxhQUFhLEdBQUcsSUFBSSxpQkFBaUI7QUFDOUQsUUFBTSxRQUFRLFFBQVEsSUFBSSxnQkFBZ0I7QUFDMUMsU0FBTyxNQUFNLE9BQU8sZUFBZSxLQUFLLEdBQUcsSUFBSSxtQkFBbUIsK0JBQStCO0FBQ2pHLFNBQU8sVUFBVSxPQUFPLG9CQUFvQixNQUFNLFNBQVMsR0FBRyxDQUFDLGFBQWEsR0FBRyw2QkFBNkI7QUFDNUcsU0FBTztBQUFBLElBQ0osTUFBc0Q7QUFBQSxJQUN2RCxJQUFJLGtCQUFrQjtBQUFBLEVBQ3hCO0FBQ0YsQ0FBQztBQUVELEtBQUssc0VBQXNFLFlBQVk7QUFDckYsUUFBTSxFQUFFLGdCQUFBQyxpQkFBZ0IsbUJBQUFDLG1CQUFrQixJQUFJLE1BQU07QUFDcEQsRUFBQUQsZ0JBQWUsWUFBWTtBQUMzQixFQUFBQSxnQkFBZSxZQUFZO0FBQzNCLEVBQUFBLGdCQUFlLGFBQWE7QUFDNUIsU0FBTyxNQUFNLE9BQU8sZUFBZSxRQUFRLElBQUksWUFBWSxDQUFFLEdBQUdDLGtCQUFpQjtBQUNqRixTQUFPLE1BQU0sUUFBUSxNQUFNLENBQUM7QUFDOUIsQ0FBQztBQUVELEtBQUssMEZBQTBGLFlBQVk7QUFDekcsUUFBTSxFQUFFLG1CQUFBQSxtQkFBa0IsSUFBSSxNQUFNO0FBQ3BDLGFBQVcsUUFBUTtBQUFBLElBQ2pCO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGLEdBQUc7QUFDRCxXQUFPLEdBQUdBLG1CQUFrQixtQkFBbUIsU0FBUyxJQUFJLEdBQUcsSUFBSTtBQUFBLEVBQ3JFO0FBQ0YsQ0FBQztBQUVELEtBQUssd0dBQXdHLFlBQVk7QUFDdkgsUUFBTSxFQUFFLG1CQUFBQSxtQkFBa0IsSUFBSSxNQUFNO0FBQ3BDLFFBQU0sS0FBSyxJQUFJQSxtQkFBa0I7QUFVakMsS0FBRyxhQUFhLFlBQVksVUFBVTtBQUN0QyxLQUFHLGFBQWEsMEJBQTBCLHVCQUF1QjtBQUNqRSxLQUFHLGFBQWEsYUFBYSxLQUFLLFVBQVUsRUFBRSxlQUFlLG9CQUFvQixDQUFDLENBQUM7QUFDbkYsS0FBRyxhQUFhLFdBQVcsUUFBUTtBQUNuQyxRQUFNLE9BQTBCLENBQUM7QUFDakMsUUFBTSxTQUFTLE1BQU07QUFDckIsS0FBRyxpQkFBaUIsb0JBQW9CLENBQUMsVUFBVTtBQUNqRCxVQUFNLElBQUk7QUFDVixTQUFLLEtBQUssQ0FBQztBQUNYLElBQUMsRUFBRSxPQUFnRSxPQUFPLGNBQWMsRUFBRSxPQUFPO0FBQUEsRUFDbkcsQ0FBQztBQUNELFFBQU0sU0FBUyxHQUFHLGFBQWEsS0FBSztBQUNwQyxTQUFPLE1BQU0sS0FBSyxRQUFRLENBQUM7QUFDM0IsU0FBTyxVQUFVLENBQUMsS0FBSyxDQUFDLEVBQUcsS0FBSyxTQUFTLEtBQUssQ0FBQyxFQUFHLEtBQUssUUFBUSxHQUFHLENBQUMsTUFBTSxJQUFJLENBQUM7QUFDOUUsU0FBTyxNQUFNLE9BQU8sU0FBUyxVQUFVO0FBQ3ZDLFNBQU8sTUFBTSxPQUFPLFVBQVUsS0FBSztBQUNuQyxTQUFPLE1BQU0sT0FBTyxRQUFRLFFBQVE7QUFDcEMsU0FBTyxVQUFVLE9BQU8sV0FBVyxFQUFFLGVBQWUsb0JBQW9CLEdBQUcsb0NBQW9DO0FBQy9HLFNBQU8sVUFBVSxHQUFHLGFBQWEsRUFBRSxPQUFPLEdBQUcsNkNBQTZDO0FBQzVGLENBQUM7QUFFRCxLQUFLLHdFQUEwRSxZQUFZO0FBQ3pGLFFBQU0sRUFBRSxtQkFBQUEsbUJBQWtCLElBQUksTUFBTTtBQUNwQyxRQUFNLEtBQUssSUFBSUEsbUJBQWtCO0FBQ2pDLFFBQU0sUUFBd0MsQ0FBQztBQUMvQyxLQUFHLFVBQVUsQ0FBQyxNQUFNLE1BQU0sS0FBSyxDQUFDO0FBQ2hDLEtBQUcsY0FBYyxJQUFJLGdCQUFnQiw0QkFBNEIsRUFBRSxRQUFRLEVBQUUsU0FBUyxLQUFLLEVBQUUsQ0FBQyxDQUFVO0FBQ3hHLFNBQU8sVUFBVSxPQUFPLENBQUMsR0FBRyx3Q0FBd0M7QUFDcEUsS0FBRyxhQUFhLGdCQUFnQixNQUFNO0FBQ3RDLEtBQUcsY0FBYyxJQUFJLGdCQUFnQiw0QkFBNEIsRUFBRSxRQUFRLEVBQUUsU0FBUyxLQUFLLEVBQUUsQ0FBQyxDQUFVO0FBQ3hHLFNBQU8sVUFBVSxPQUFPLENBQUMsRUFBRSxNQUFNLG1CQUFtQixPQUFPLDJCQUEyQixDQUFDLEdBQUcsOEJBQThCO0FBQzFILENBQUM7IiwKICAibmFtZXMiOiBbIm92ZXJyaWRlcyIsICJvdmVycmlkZXMiLCAic3RyZWFtIiwgInJlZ2lzdGVyV2lkZ2V0IiwgIlZvc29XaWRnZXRFbGVtZW50Il0KfQo=

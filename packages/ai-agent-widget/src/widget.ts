// <voso-widget> — the embeddable voice/chat widget custom element.
//
// Attributes:
//   agent-id     (required) public widget id, `wgt_<32 hex>`
//   server-url   (optional) API origin override; default = the origin the
//                embed script was loaded from (widget.js on vosopulse-api)
//   config-json  (optional) full PublicWidgetConfig JSON — used by the
//                dashboard's settings live preview to render UNSAVED
//                settings without a fetch
//   preview      (optional) "true" → position absolutely inside the parent
//                container, forced bottom-right (the settings page's note:
//                the preview is always bottom-right)
//   auth-token   (optional) dashboard access token, set ONLY by the
//                settings page's live preview so a DISABLED widget still
//                previews for authenticated tenant members. Customer
//                embeds must never set it.
//
// The vendor's attributes (E4 §4.8, all additive — see attributes.ts):
//   show-agent-status / show-resize-button / show-language-selector-on-trigger
//   / show-avatar-when-collapsed ("true" | "false", Q9), variant, placement,
//   language, terms-key, text-contents (JSON, Q25), override-* (per key),
//   user-id, allow-events ("true" → the voso-widget:user-message /
//   user-activity / contextual-update events are forwarded, Q22),
//   signed-url (accepted, not used until the WebSocket transport — E4-b).
// Events: `voso-widget:call {detail.config}` before every start (listeners
// may mutate it); `voso-widget:expand {detail.action}` is heard ungated on the
// element and on document (Q30).
//
// All UI is inside a closed shadow root; styling flows through --vw-*
// custom properties (see config.ts / styles.ts).

import {
  WidgetApi,
  WidgetApiError,
  type ChatEvent,
  type ConversationOverrides,
  DynamicVariables,
  type PublicWidgetConfig,
  type UploadedAttachment,
} from "./api";
import { attachmentAcceptAttribute, validateAttachment } from "./attachments";
import {
  buildCssVars,
  mergeConfig,
  type WidgetRuntimeConfig,
} from "./config";
import { ICONS } from "./icons";
import { createOrb, type OrbHandle, type OrbState } from "./orb";
import { parseMarkdown, stripAudioTags } from "./markdown";
import { renderMarkdown } from "./md-dom";
import {
  DEFAULT_OUTPUT_FORMAT,
  outputFormatFromFrame,
  renderAgentText,
  type OutputFormat,
} from "./output-format";
import { WIDGET_CSS } from "./styles";
import { resolveText, type WidgetTextKey } from "./text-defaults";
import {
  clientToolCallFromRtvi,
  isRenderableTranscript,
  mcpToolCallDataFromRtvi,
  transcriptRole,
  VoiceClient,
  queueTransition,
  type RtviMessage,
} from "./voice";
import {
  mcpToolCallFromRecord,
  runClientTool,
  type ClientToolCall,
  type ClientToolHandler,
  type McpToolCall,
} from "./client-tools";
import {
  attributeOverrides,
  CALL_EVENT,
  EXPAND_EVENT,
  expandAction,
  GATED_INBOUND_EVENTS,
  inboundAction,
  overlayAttributes,
} from "./attributes";

/**
 * VOSO-825 owner ruling: the ONE server text the widget shows the visitor —
 * the billing-hold sentence of a 402 voice-mint refusal, already rendered
 * server-side in the session language. Every other error body stays on the
 * console (VOSO-754 D21).
 */
export function billingHoldSentence(err: unknown): string | null {
  if (!(err instanceof WidgetApiError) || err.status !== 402) return null;
  return err.message.trim() || null;
}

type Mode = "idle" | "voice" | "chat";
type VoiceStatus = "connecting" | "queued" | "listening" | "speaking";

interface EndedInfo {
  by: "user" | "agent";
  conversationId: string | null;
}

/** `voso-widget:call` `detail.config` — what the next session starts with. */
export interface WidgetCallConfig {
  agentId: string;
  language: string | null;
  overrides: ConversationOverrides | null;
  dynamicVariables: DynamicVariables | null;
  clientTools: Record<string, ClientToolHandler>;
  userId: string | null;
  textOnly: boolean;
}

export class VosoWidgetElement extends HTMLElement {
  static observedAttributes = [
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
    "text-contents",
  ];

  private shadow: ShadowRoot;
  private api: WidgetApi | null = null;
  /**
   * Per-call conversation overrides sent on every session/chat start. Set
   * via the `overrides` attribute (a JSON object string) or the `overrides`
   * JS property (`el.overrides = { first_message: "…" }`); the property
   * wins. Gated server-side by the agent's Guardrails override toggles.
   */
  overrides: ConversationOverrides | null = null;
  /**
   * Per-session `{{name}}` values sent on every session/chat start (the
   * vendor JS SDK's `dynamicVariables`, E3 §4.3). Set via the
   * `dynamic-variables` attribute (a JSON object string) or the
   * `dynamicVariables` JS property (`el.dynamicVariables = { customer_name:
   * "Dana" }`); the property wins. Gated server-side by the agent's
   * Security → Overrides "Dynamic variables" toggle.
   */
  dynamicVariables: DynamicVariables | null = null;
  /**
   * The page's implementations of the agent's **client** tools, keyed by
   * tool name (E3 §4.1.8): `el.clientTools = { lookup_policy: async (p) =>
   * crm.lookup(p.policy_number) }`. Served on voice (RTVI) and chat (SSE +
   * HTTP) alike. An unregistered tool is answered at once with an error
   * unless `onUnhandledClientToolCall` is set.
   */
  clientTools: Record<string, ClientToolHandler> = {};
  /** Take over calls for tools not in `clientTools` (nothing is sent; the
   *  agent's Response timeout applies). */
  onUnhandledClientToolCall: ((call: ClientToolCall) => void) | null = null;
  /**
   * Every state of an MCP tool call the agent makes through an **Ask**
   * server or tool (E3 §4.6): `awaiting_approval` first — answer it with
   * `el.approveMcpTool(call.toolCallId, true | false)` within
   * `call.approvalTimeoutSecs` (30 s) — then `loading` and `success` /
   * `failure`. Without a handler the page **denies** every ask at once
   * (fail closed: a stranger's embed never runs an approval-gated tool).
   */
  onMcpToolCall: ((call: McpToolCall) => void) | null = null;
  /** Diagnostics the element reports instead of failing (an unmapped
   *  `text-contents` key, an event with no live session, …). Default: the
   *  console's debug level. */
  onDebug: ((event: Record<string, unknown>) => void) | null = null;
  /** The vendor's `userId` (also the `user-id` attribute; the property wins).
   *  Carried on `voso-widget:call` `detail.config`; the widget mint does not
   *  take a user id yet, so it is not sent. */
  userId: string | null = null;
  private cfg: WidgetRuntimeConfig = mergeConfig(undefined);
  private agentName = "";
  private languages: string[] = [];
  private avatarUrl: string | null = null;
  private loaded = false;

  // UI state
  private expanded = false;
  /** First-render latch — UI state follows config only before this is set. */
  private everRendered = false;
  private large = false;
  private mode: Mode = "idle";
  private voiceStatus: VoiceStatus = "connecting";
  /** The queue-timeout line is shown once per call (the `queue_status` and
   *  the `session-ended` announcements both name it). */
  private queueTimedOutShown = false;
  private muted = false;
  private transcriptVisible = true;
  private selectedLanguage: string | null = null;
  private ended: EndedInfo | null = null;
  private termsAcceptedThisSession = false;
  private pendingAfterTerms: (() => void) | null = null;

  // Sessions
  private voice: VoiceClient | null = null;
  private voiceConversationId: string | null = null;
  private chatSessionId: string | null = null;
  private chatConversationId: string | null = null;
  /** Agent-bubble rendering for the CURRENT chat session — the leading
   *  `session` frame's `output_format` (agent behavior panel, Widget row).
   *  Markdown until the frame arrives (today's behaviour). Voice transcripts
   *  never read it: they pass `"markdown"` explicitly. */
  private chatOutputFormat: OutputFormat = DEFAULT_OUTPUT_FORMAT;
  private chatBusy = false;
  private streamEl: HTMLElement | null = null;
  private streamText = "";
  /** Uploads staged for the NEXT chat message (chips in the composer). */
  private pendingAttachments: UploadedAttachment[] = [];
  /** Every upload made this conversation — mirrors the backend cap. */
  private uploadsThisConversation = 0;

  // DOM refs
  private rootEl!: HTMLElement;
  private launcherEl!: HTMLElement;
  private sheetEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private introEl!: HTMLElement;
  private headerStatusEl!: HTMLElement;
  private headerNameEl!: HTMLElement;
  private headerAvatarEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private overlayHost!: HTMLElement;
  private audioEl!: HTMLAudioElement;
  private typingEl: HTMLElement | null = null;
  private orbs: OrbHandle[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: "open" });
    // Q22: the gated inbound events, heard on the element itself.
    for (const type of GATED_INBOUND_EVENTS) this.addEventListener(type, this.onInboundEvent);
    // Q30: the ungated expand event, on the element (and on document below).
    this.addEventListener(EXPAND_EVENT, this.onExpandEvent);
  }

  connectedCallback(): void {
    document.addEventListener(EXPAND_EVENT, this.onExpandEvent);
    if (!this.loaded) {
      this.loaded = true;
      void this.bootstrap();
    }
  }

  disconnectedCallback(): void {
    document.removeEventListener(EXPAND_EVENT, this.onExpandEvent);
    this.destroyOrbs();
    void this.teardownSessions("user");
  }

  private debug(event: Record<string, unknown>): void {
    if (this.onDebug) this.onDebug(event);
    else console.debug("[voso-widget]", event);
  }

  /** Q22: `allow-events="true"` forwards a page's message / activity / context into the live session. */
  private readonly onInboundEvent = (event: Event): void => {
    const action = inboundAction(event.type, this.getAttribute("allow-events"), (event as CustomEvent).detail);
    if (!action) return;
    if (action.kind === "contextual-update") {
      void this.sendContextualUpdate(action.message).then((sent) => {
        if (!sent) this.debug({ type: "no_live_session", event: event.type });
      });
      return;
    }
    if (action.kind === "user-activity") {
      if (this.voice) this.voice.sendUserActivity();
      // Text sessions have no dead-air clock to reset (voice/chat timing rule E-1).
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
  private readonly onExpandEvent = (event: Event): void => {
    const detail = (event as CustomEvent).detail as { action?: unknown; _vosoEventHandled?: boolean } | null;
    if (!detail || typeof detail !== "object" || detail._vosoEventHandled) return;
    detail._vosoEventHandled = true;
    if (!this.everRendered) return;
    const next = expandAction(detail.action, this.expanded, this.collapsible);
    if (next === null || next === this.expanded) return;
    this.expanded = next;
    this.updateChrome();
  };

  /**
   * The vendor's call hook: dispatch `voso-widget:call` (bubbling, composed)
   * with the config the session is about to start with; listeners may mutate
   * `detail.config` in place (e.g. `clientTools`), and the start uses it.
   */
  private dispatchCall(textOnly: boolean): WidgetCallConfig {
    const config: WidgetCallConfig = {
      agentId: this.getAttribute("agent-id") ?? "",
      language: this.selectedLanguage,
      overrides: this.resolveOverrides(),
      dynamicVariables: this.resolveDynamicVariables(),
      clientTools: this.clientTools,
      userId: this.userId ?? this.getAttribute("user-id"),
      textOnly,
    };
    this.dispatchEvent(new CustomEvent(CALL_EVENT, { bubbles: true, composed: true, detail: { config } }));
    if (config.clientTools && typeof config.clientTools === "object") this.clientTools = config.clientTools;
    return config;
  }

  attributeChangedCallback(): void {
    if (!this.loaded) return;
    void this.bootstrap();
  }

  // ── bootstrap ────────────────────────────────────────────────

  /** The dynamic variables to send: the JS property, else the parsed attribute. */
  private resolveDynamicVariables(): DynamicVariables | null {
    if (this.dynamicVariables) return this.dynamicVariables;
    const attr = this.getAttribute("dynamic-variables");
    if (!attr) return null;
    try {
      const parsed: unknown = JSON.parse(attr);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as DynamicVariables)
        : null;
    } catch {
      return null;
    }
  }

  /** The overrides to send: the JS property, else the parsed attribute —
   *  laid over the per-key `override-*` attributes (E4 §4.8; the explicit
   *  object wins on a conflict). */
  private resolveOverrides(): ConversationOverrides | null {
    const perKey = attributeOverrides((name) => this.getAttribute(name)) as ConversationOverrides | null;
    const explicit = this.explicitOverrides();
    if (!perKey) return explicit;
    return { ...perKey, ...(explicit ?? {}) };
  }

  private explicitOverrides(): ConversationOverrides | null {
    if (this.overrides) return this.overrides;
    const attr = this.getAttribute("overrides");
    if (!attr) return null;
    try {
      const parsed: unknown = JSON.parse(attr);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as ConversationOverrides)
        : null;
    } catch {
      return null;
    }
  }

  private resolveOrigin(): string {
    const attr = this.getAttribute("server-url");
    if (attr) return attr.replace(/\/$/, "");
    // The npm / CDN bundle (E4 Q8): the script's origin is the CDN, not our API.
    if (BUILD_DEFAULT_ORIGIN) return BUILD_DEFAULT_ORIGIN;
    if (SCRIPT_ORIGIN) return SCRIPT_ORIGIN;
    return window.location.origin;
  }

  private async bootstrap(): Promise<void> {
    const publicId = this.getAttribute("agent-id") ?? "";
    // `auth-token` is the settings preview's credential for previewing a
    // DISABLED widget — customer embeds never set it.
    const authToken = this.getAttribute("auth-token");
    this.api = publicId
      ? new WidgetApi(this.resolveOrigin(), publicId, authToken)
      : null;

    const inline = this.getAttribute("config-json");
    let server: PublicWidgetConfig | null = null;
    if (inline) {
      try {
        server = JSON.parse(inline) as PublicWidgetConfig;
      } catch {
        server = null;
      }
    }
    if (!server && this.api) {
      try {
        server = await this.api.fetchConfig();
      } catch (err) {
        // Disabled/unknown widget: render nothing (an embed on a page
        // must never break the host site).
        if (err instanceof WidgetApiError && err.status === 404) return;
        return;
      }
    }
    if (!server) return;

    // E4 §4.8: the element's attributes overlay the fetched config.
    const nextCfg = overlayAttributes(
      mergeConfig(server.config as Partial<WidgetRuntimeConfig>),
      (name) => this.getAttribute(name),
      (event) => this.debug(event),
    );
    // FAST PATH: when only colors/radii changed (the settings page's
    // continuous inputs — color pickers, px steppers), update the CSS
    // custom properties in place instead of tearing down and re-rendering
    // the whole widget. This is what makes the live preview track those
    // controls instantly, with no flicker and no state loss.
    if (this.everRendered && this.rootEl) {
      const structural = (c: WidgetRuntimeConfig) =>
        JSON.stringify({ ...c, colors: null, radii: null });
      const orbUnchanged =
        JSON.stringify(nextCfg.avatar) === JSON.stringify(this.cfg.avatar);
      if (
        structural(nextCfg) === structural(this.cfg) &&
        orbUnchanged &&
        (server.agent_name || "AI Agent") === this.agentName &&
        JSON.stringify(server.languages ?? []) === JSON.stringify(this.languages)
      ) {
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
    this.avatarUrl =
      server.avatar_url && this.api
        ? this.api.resolveUrl(server.avatar_url)
        : server.avatar_url ?? null;
    // The `language` attribute picks the start language when the agent has it.
    const preferred = this.getAttribute("language");
    this.selectedLanguage =
      preferred && this.languages.includes(preferred) ? preferred : this.languages[0] ?? null;
    // UI state follows the config only on the FIRST render. Re-bootstraps
    // (the settings preview pushing a new config-json on every edit) must
    // preserve what the user is looking at — collapsing the sheet on each
    // color tweak made the live preview feel dead.
    if (!this.everRendered) {
      this.expanded =
        this.cfg.expanded_behavior === "starts_expanded" ||
        this.cfg.expanded_behavior === "always_expanded";
      this.transcriptVisible = this.cfg.transcript_enabled;
    } else if (this.cfg.expanded_behavior === "always_expanded") {
      this.expanded = true;
    }
    this.everRendered = true;

    this.renderSkeleton();
    this.updateChrome();
  }

  private text(key: WidgetTextKey): string {
    return resolveText(this.cfg.text, key);
  }

  private get collapsible(): boolean {
    return this.cfg.collapsible && this.cfg.expanded_behavior !== "always_expanded";
  }

  private get canSwitchModes(): boolean {
    // Chat is always available (single "Chat (text-only) mode" toggle:
    // text-only OFF = voice AND chat, ON = chat only), so switching
    // exists exactly when voice does.
    return this.cfg.voice_enabled;
  }

  // ── skeleton ─────────────────────────────────────────────────

  private renderSkeleton(): void {
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
      this.rootEl.dataset.placement = "bottom-right"; // preview is always bottom-right
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

    // Launcher
    this.launcherEl = document.createElement("button");
    this.launcherEl.className = "vw-launcher";
    this.launcherEl.dataset.variant = this.cfg.variant;
    this.launcherEl.setAttribute("aria-label", this.text("expand"));
    // Q9 `show-avatar-when-collapsed="false"` drops it (the tiny launcher IS its avatar).
    if (this.cfg.show_avatar_when_collapsed || this.cfg.variant === "tiny") {
      this.launcherEl.append(
        this.buildAvatar(
          this.cfg.variant === "full" ? 40 : this.cfg.variant === "tiny" ? 44 : 26,
        ),
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

    // Sheet
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

    // Q9 `show-language-selector-on-trigger`: pick the language while collapsed.
    this.triggerLangSelect =
      this.cfg.show_language_selector_on_trigger &&
      this.cfg.language_dropdown_enabled &&
      this.languages.length > 1
        ? this.buildLanguageSelect()
        : null;
    if (this.triggerLangSelect) {
      this.triggerLangSelect.classList.add("vw-lang-trigger");
      this.rootEl.append(this.sheetEl, this.triggerLangSelect, this.launcherEl);
    } else {
      this.rootEl.append(this.sheetEl, this.launcherEl);
    }
    this.shadow.append(this.rootEl);
  }

  private buildAvatar(size = 34): HTMLElement {
    const el = document.createElement("div");
    el.className = "vw-avatar";
    const kind = this.cfg.avatar.kind;
    const src =
      kind === "url"
        ? (this.cfg.avatar as { url?: string }).url || null
        : kind === "image"
          ? this.avatarUrl
          : null;
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      el.append(img);
      return el;
    }
    if (kind === "url" || kind === "image") {
      // Link/image selected but no source yet — show the mode's glyph on
      // the neutral gradient instead of silently falling back to the orb,
      // so the settings preview visibly tracks the avatar type.
      const glyph = document.createElement("span");
      glyph.className = "vw-avatar-glyph";
      glyph.innerHTML = kind === "url" ? ICONS.link : ICONS.image;
      el.append(glyph);
      return el;
    }
    // Orb: the same wireframe orb the dashboard preview renders (see
    // orb.ts), colored by the configured gradient pair.
    el.style.background = "none";
    const colors = this.cfg.avatar as { color_1: string; color_2: string };
    const orb = createOrb(size, colors.color_1, colors.color_2);
    this.orbs.push(orb);
    el.append(orb.el);
    return el;
  }

  private setOrbState(state: OrbState): void {
    for (const orb of this.orbs) orb.setState(state);
  }

  private destroyOrbs(): void {
    for (const orb of this.orbs) orb.destroy();
    this.orbs = [];
  }

  private buildHeaderActions(): HTMLElement {
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
        this.resizeBtn!.innerHTML = this.large ? ICONS.shrink : ICONS.expand;
      });
      actions.append(this.resizeBtn);
    }

    if (this.collapsible) {
      actions.append(
        this.iconButton(ICONS.chevronDown, this.text("collapse"), () => {
          this.expanded = false;
          this.updateChrome();
        }),
      );
    }
    return actions;
  }

  private langSelect: HTMLSelectElement | null = null;
  private triggerLangSelect: HTMLSelectElement | null = null;

  /** The language dropdown (header and, with Q9, the collapsed trigger) — both stay in sync. */
  private buildLanguageSelect(): HTMLSelectElement {
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
  private modeBtn: HTMLButtonElement | null = null;
  private resizeBtn: HTMLButtonElement | null = null;

  private iconButton(
    icon: string,
    title: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "vw-iconbtn";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = icon; // static trusted markup
    btn.addEventListener("click", onClick);
    return btn;
  }

  // ── chrome updates ───────────────────────────────────────────

  private updateChrome(): void {
    this.launcherEl.classList.toggle("vw-hidden", this.expanded);
    this.sheetEl.classList.toggle("vw-hidden", !this.expanded);

    // Status line
    this.headerStatusEl.textContent = "";
    const dot = document.createElement("span");
    dot.className = "vw-status-dot";
    const statusText = document.createElement("span");
    if (this.mode === "voice") {
      dot.setAttribute("data-live", "");
      statusText.textContent =
        this.voiceStatus === "connecting"
          ? this.text("connecting_status")
          : this.voiceStatus === "queued"
            ? this.text("queued_status")
            : this.voiceStatus === "speaking"
              ? this.text("speaking_status")
              : this.text("listening_status");
    } else if (this.mode === "chat") {
      dot.setAttribute("data-live", "");
      statusText.textContent = this.text("chatting_status");
    } else {
      statusText.textContent = this.agentName;
    }
    this.headerStatusEl.append(dot, statusText);
    // Q9 `show-agent-status="false"` hides the status line.
    this.headerStatusEl.classList.toggle("vw-hidden", !this.cfg.show_agent_status);
    this.headerAvatarEl.toggleAttribute(
      "data-speaking",
      this.mode === "voice" && this.voiceStatus === "speaking",
    );
    this.setOrbState(
      this.mode === "voice"
        ? this.voiceStatus === "queued"
          ? "connecting"
          : this.voiceStatus
        : this.mode === "chat"
          ? "listening"
          : "idle",
    );
    // Host-element mirror of the live state for embedding pages and the
    // Playwright spec (`docs/qa/agent-integration-e7-qa.md` §2).
    this.setAttribute("data-vw-mode", this.mode);
    if (this.mode === "voice") {
      this.setAttribute("data-vw-voice-status", this.voiceStatus);
    } else {
      this.removeAttribute("data-vw-voice-status");
    }

    // Intro vs conversation body
    const inConversation = this.mode !== "idle" || this.bodyEl.childNodes.length > 0;
    this.introEl.classList.toggle("vw-hidden", inConversation);
    const bodyHidden =
      this.mode === "voice" && !this.transcriptVisible ? true : !inConversation;
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
      this.modeBtn.title =
        this.mode === "voice" ? this.text("text_mode") : this.text("voice_mode");
      this.modeBtn.innerHTML = this.mode === "voice" ? ICONS.keyboard : ICONS.phone;
      this.modeBtn.classList.toggle("vw-hidden", this.mode === "idle");
    }

    this.renderFooter();
  }

  private renderIntro(): void {
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
      (call.lastElementChild as HTMLElement).textContent = this.text("start_call");
      call.addEventListener("click", () => this.guardTerms(() => void this.startCall()));
      this.introEl.append(call);
    }
    if (this.cfg.text_enabled) {
      const chat = document.createElement("button");
      chat.className = `vw-cta${this.cfg.voice_enabled ? " vw-cta-secondary" : ""}`;
      chat.innerHTML = `${ICONS.chat}<span></span>`;
      (chat.lastElementChild as HTMLElement).textContent = this.text("start_chat");
      chat.addEventListener("click", () => this.guardTerms(() => void this.startChat()));
      this.introEl.append(chat);
    }
  }

  private renderFooter(): void {
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
      (end.lastElementChild as HTMLElement).textContent = this.text("end_call");
      end.addEventListener("click", () => void this.endCall("user"));
      row.append(end);
      this.footerEl.append(row);
      // Typed text during the live call: the composer stays active when
      // the toggle is on — submissions become real user turns via the
      // RTVI send-text envelope (the pipeline interrupts the bot when it
      // is mid-utterance, appends the text as a user message, and runs a
      // completion).
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
        // Waiting in the queue (E7 §4.3): nothing typed reaches the agent
        // (the worker drops it — vendor parity), so the composer is off.
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
      // Staged-attachment chips (uploads riding the next message).
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
              (a) => a.attachment_id !== attachment.attachment_id,
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

      // Attach button + hidden picker.
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
      input.placeholder = this.cfg.voice_enabled
        ? this.text("input_placeholder")
        : this.text("input_placeholder_text_only");
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
      // Conversation id + new call/chat CTAs.
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
        (again.lastElementChild as HTMLElement).textContent = this.text("new_call");
        again.addEventListener("click", () => this.guardTerms(() => void this.startCall()));
        row.append(again);
      }
      if (this.cfg.text_enabled) {
        const chat = document.createElement("button");
        chat.className = "vw-callbtn";
        chat.innerHTML = `${ICONS.chat}<span></span>`;
        (chat.lastElementChild as HTMLElement).textContent = this.text("start_chat");
        chat.addEventListener("click", () => this.guardTerms(() => void this.startChat()));
        row.append(chat);
      }
      this.footerEl.append(row);
    }
  }

  // ── messages ─────────────────────────────────────────────────

  private appendMessage(
    kind: "agent" | "user" | "system" | "error",
    raw: string,
    format: OutputFormat = this.chatOutputFormat,
  ): void {
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

  private appendActionIndicator(state: "working" | "done" | "error", name?: string): void {
    if (!this.cfg.action_indicator_enabled) return;
    const chip = document.createElement("div");
    chip.className = "vw-action";
    chip.dataset.state = state;
    const label =
      state === "working"
        ? this.text("agent_working")
        : state === "done"
          ? this.text("agent_done")
          : this.text("agent_error");
    chip.innerHTML = state === "working" ? ICONS.spinner : state === "done" ? ICONS.check : ICONS.x;
    const span = document.createElement("span");
    span.textContent = name ? `${name} — ${label}` : label;
    chip.append(span);
    this.bodyEl.append(chip);
    this.scrollToBottom();
  }

  private setTyping(on: boolean): void {
    if (on && !this.typingEl) {
      const el = document.createElement("div");
      el.className = "vw-typing";
      const dots = document.createElement("span");
      dots.className = "vw-typing-dots";
      dots.append(
        document.createElement("span"),
        document.createElement("span"),
        document.createElement("span"),
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

  private scrollToBottom(): void {
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  /** The ONE markdown → DOM render (agent bubbles, terms overlay). */
  private markdownNode(text: string): Node {
    return renderMarkdown(parseMarkdown(text, this.cfg.link_policy), {
      syntaxTheme: this.cfg.syntax_theme,
      text: {
        copy: this.text("copy"),
        copied: this.text("copied"),
        download: this.text("download"),
        wrap: this.text("wrap"),
      },
    });
  }

  // ── terms gate ───────────────────────────────────────────────

  private termsAlreadyAccepted(): boolean {
    if (!this.cfg.terms.enabled || !this.cfg.terms.content.trim()) return true;
    if (this.termsAcceptedThisSession) return true;
    const key = this.cfg.terms.local_storage_key;
    if (key) {
      try {
        if (window.localStorage.getItem(key) === "accepted") return true;
      } catch {
        // storage unavailable → session memory only
      }
    }
    return false;
  }

  private guardTerms(proceed: () => void): void {
    if (this.termsAlreadyAccepted()) {
      proceed();
      return;
    }
    this.pendingAfterTerms = proceed;
    this.showTermsOverlay();
  }

  private showTermsOverlay(): void {
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
          // ignore
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

  private async startCall(): Promise<void> {
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
        call.dynamicVariables,
      );
      this.voiceConversationId = session.conversation_id;
      // The door already knows (E7 §4.2): a queued session shows the
      // waiting line before the peer even connects; the RTVI
      // `queue_status` twin drives every later transition.
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
          void this.audioEl
            .play()
            .then(() => client.notifyAudioRendering())
            .catch(() => client.notifyAudioRendering());
        },
        onAppMessage: (msg) => this.onRtviMessage(msg),
        onError: () => {
          if (this.mode === "voice") {
            this.appendMessage("error", this.text("error_occurred"));
          }
        },
      });
      this.voice = client;
      await client.connect();
    } catch (err) {
      this.mode = "idle";
      this.voice = null;
      const hold = billingHoldSentence(err);
      if (hold) {
        // VOSO-825 billing hold: the refusal is a sentence for the visitor
        // ("…billing issue on this account…"), shown as the agent's bubble
        // rather than an HTTP error line.
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
  async sendContextualUpdate(text: string, opts?: { contextId?: string }): Promise<boolean> {
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
  async approveMcpTool(toolCallId: string, isApproved: boolean): Promise<boolean> {
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
  private handleMcpToolCall(call: McpToolCall): void {
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
  private async handleClientToolCall(
    call: ClientToolCall,
    send: (result: string, isError: boolean) => Promise<boolean> | boolean,
  ): Promise<void> {
    const answer = await runClientTool(
      this.clientTools,
      call,
      this.onUnhandledClientToolCall ?? undefined,
    );
    if (!answer) return;
    // The server ignores an answer to a fire-and-forget tool; sending it
    // costs nothing and keeps the page's code identical for both kinds.
    try {
      await send(answer.result, answer.isError);
    } catch (err) {
      console.warn(`Widget client tool ${call.toolName}: answer not delivered`, err);
    }
  }

  private onRtviMessage(msg: RtviMessage): void {
    const mcpData = mcpToolCallDataFromRtvi(msg);
    if (mcpData) {
      const mcpCall = mcpToolCallFromRecord(mcpData);
      if (mcpCall) this.handleMcpToolCall(mcpCall);
      return;
    }
    const clientToolCall = clientToolCallFromRtvi(msg);
    if (clientToolCall) {
      const client = this.voice;
      void this.handleClientToolCall(clientToolCall, (result, isError) =>
        client ? client.sendClientToolResult(clientToolCall.toolCallId, result, isError) : false,
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
        // A queued caller hears hold audio, not the agent: stay waiting.
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
        // Voice transcripts render markdown regardless of the chat session's
        // Output format — the flag rides the chat frame only (plan §7.6).
        this.appendMessage(role, text, "markdown");
      }
    }
  }

  /** E7 §4.3: `waiting` → the queued state (input off, hold audio plays);
   *  `admitted` → listening (the greeting follows); `timed_out` → the
   *  session is over — the configured per-language line is shown and the
   *  peer close that follows is an ordinary end, not an error. */
  private onQueueTransition(transition: "waiting" | "admitted" | "timed_out"): void {
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

  private async endCall(by: "user" | "agent"): Promise<void> {
    const client = this.voice;
    this.voice = null;
    this.mode = "idle";
    this.ended = { by, conversationId: this.voiceConversationId };
    if (client) await client.disconnect();
    this.audioEl.srcObject = null;
    this.appendMessage(
      "system",
      by === "user"
        ? this.text("user_ended_conversation")
        : this.text("agent_ended_conversation"),
    );
    this.updateChrome();
    if (this.cfg.feedback_enabled && this.voiceConversationId) {
      this.showFeedbackOverlay(this.voiceConversationId);
    }
  }

  // ── chat ─────────────────────────────────────────────────────

  private async startChat(): Promise<void> {
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
          call.dynamicVariables,
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
  private async attachFile(file: File): Promise<void> {
    if (!this.api || !this.chatSessionId) return;
    const rejection = validateAttachment(file, this.uploadsThisConversation);
    if (rejection === "file_type_unsupported") {
      this.appendMessage(
        "error",
        `${this.text("file_type_unsupported")} png, jpeg, webp, gif, pdf, txt, csv, md`,
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
        "file_upload_error",
      );
    }
  }

  private async sendChat(text: string): Promise<void> {
    if (!this.api || !this.chatSessionId) return;
    const attachments = this.pendingAttachments;
    this.pendingAttachments = [];
    if (attachments.length > 0) this.renderFooter();
    const display =
      attachments.length > 0
        ? `${text}\n${attachments.map((a) => `[${a.filename}]`).join("\n")}`
        : text;
    this.appendMessage("user", display);
    this.chatBusy = true;
    this.setTyping(true);
    try {
      await this.consumeChatStream(
        this.api.sendChatMessage(
          this.chatSessionId,
          text,
          attachments.map((a) => a.attachment_id),
        ),
      );
    } catch (err) {
      this.setTyping(false);
      this.showError(err instanceof WidgetApiError ? `${err.status} ${err.message}` : err);
    } finally {
      this.chatBusy = false;
    }
  }

  private async consumeChatStream(
    stream: AsyncGenerator<ChatEvent, void, undefined>,
  ): Promise<void> {
    for await (const event of stream) {
      switch (event.type) {
        case "session":
          // How this session's agent replies render (Widget row → Output
          // format). Missing ⇒ markdown, today's behaviour.
          this.chatOutputFormat = outputFormatFromFrame(event.output_format);
          this.chatSessionId = event.session_id ?? null;
          // Durable conversation id (calls.call_id) — same identity voice
          // carries, so show-conversation-ID + feedback work on chat too.
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
          // E3 §4.1.7: the agent asked the page; run the handler and post
          // the answer while the turn stream stays open.
          const sessionId = this.chatSessionId;
          const api = this.api;
          if (typeof event.tool_call_id === "string" && typeof event.name === "string") {
            const call: ClientToolCall = {
              toolName: event.name,
              toolCallId: event.tool_call_id,
              parameters: event.args ?? {},
              expectsResponse: event.expects_response !== false,
              ...(typeof event.timeout_secs === "number"
                ? { responseTimeoutSecs: event.timeout_secs }
                : {}),
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
          // E3 §4.6: an Ask server / tool — the page approves or denies
          // (`approveMcpTool`), the turn stream stays open meanwhile.
          const mcpCall = mcpToolCallFromRecord(event as Record<string, unknown>);
          if (mcpCall) {
            this.handleMcpToolCall(mcpCall);
            if (mcpCall.state === "awaiting_approval") {
              this.appendActionIndicator("working", mcpCall.toolName);
            }
          }
          break;
        }
        case "tool_called":
          // Do NOT close the streaming bubble: providers interleave tool
          // calls with text inside one turn, and closing here split the
          // tail of a sentence into its own bubble. The dashboard chat
          // glues trailing text for the same reason — bubbles end only at
          // turn boundaries (turn_complete / ended / error) or when a
          // scripted assistant_message starts a deliberate new bubble.
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
          // Same end-of-conversation feedback flow as voice.
          if (this.cfg.feedback_enabled && conversationId) {
            this.showFeedbackOverlay(conversationId);
          }
          break;
        }
        case "error":
          // The frame's `message` is developer text (status line +
          // provider code); the visitor gets the localized line.
          this.finishStreamBubble();
          this.setTyping(false);
          this.appendActionIndicatorOnError(event.message, event.code);
          break;
        default:
          break;
      }
    }
    // Turn finished streaming; re-render the streamed text in the session's format.
    this.finishStreamBubble();
    this.setTyping(false);
  }

  /** Text sent to a person (VOSO-754 D21): every failure the visitor sees is
   *  the configured, per-language `error_occurred` line (or the given text
   *  key) — never a server body, an SSE `error.message` or an exception
   *  text. The raw detail goes to the console for the embedding developer. */
  private showError(detail: unknown, key: WidgetTextKey = "error_occurred"): void {
    if (detail !== undefined && detail !== null && detail !== "") {
      console.debug("[voso-widget] error", detail);
    }
    this.appendMessage("error", this.text(key));
  }

  private appendActionIndicatorOnError(message?: string, code?: string): void {
    this.showError(code ? `${code}: ${message ?? ""}` : message);
  }

  /** Replace the raw streamed text with the session-format render
   *  (markdown, or literal text on a plain_text session). */
  private finishStreamBubble(): void {
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

  private async toggleMode(): Promise<void> {
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

  private async teardownSessions(endedBy: "user" | null): Promise<void> {
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

  private showFeedbackOverlay(conversationId: string): void {
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
          void this.api?.submitFeedback(conversationId, rating, null).catch(() => undefined);
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
        void this.api
          ?.submitFeedback(conversationId, rating, textarea.value.trim() || null)
          .catch(() => undefined);
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
}

declare const __VOSO_WIDGET_DEFAULT_ORIGIN__: string | undefined;

/** The npm / CDN bundle's build-time API origin; `null` in the same-host bundle. */
const BUILD_DEFAULT_ORIGIN: string | null =
  typeof __VOSO_WIDGET_DEFAULT_ORIGIN__ === "string" ? __VOSO_WIDGET_DEFAULT_ORIGIN__ : null;

/** Origin the embed script was loaded from, captured at module-eval time
 *  (document.currentScript is null later). */
const SCRIPT_ORIGIN: string | null = (() => {
  try {
    const src = (document.currentScript as HTMLScriptElement | null)?.src;
    return src ? new URL(src).origin : null;
  } catch {
    return null;
  }
})();

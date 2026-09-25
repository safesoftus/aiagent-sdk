// The provider's state machine, framework-free (the React bindings in
// index.tsx are thin `useSyncExternalStore` wrappers over it, so every rule
// below is unit-tested without a renderer). Semantics follow the vendor's
// React package (E4 plan §1.2) with the owner-ruled deviations (§4.7, Q28):
//   · options merge provider → hook → startSession; same-name callbacks are
//     COMPOSED (every listener fires, in that order); `origin` passes through;
//   · `onMCPToolApprovalRequest` is accepted on the provider and the hooks
//     (the vendor's React layer cannot carry it) — the most specific wins;
//   · a runtime `onError` never flips `status` while connected (the vendor's
//     does); a rejected `startSession` → `status: "error"` + `message`;
//   · a `startSession` while one is pending or live is ignored; `endSession`
//     during connect ends the session once it is up; late callbacks of a
//     finished session are dropped.
import {
  Conversation,
  TextConversation,
  VoiceConversation,
  type Callbacks,
  type ClientToolsConfig,
  type McpToolCall,
  type Mode,
  type SessionConfig,
} from "@convoso/ai-agent";

export type ConversationStatus = "disconnected" | "connecting" | "connected" | "error";

type ClientTool = ClientToolsConfig["clientTools"][string];

export type HookCallbacks = Callbacks & {
  onConversationCreated?: (conversation: VoiceConversation | TextConversation) => void;
  /** Approve (`true`) or deny an MCP tool call (Q28 — accepted on the provider and every hook). */
  onMCPToolApprovalRequest?: (call: McpToolCall, ctx: { signal: AbortSignal }) => Promise<boolean> | boolean;
};

type SessionBase = Omit<SessionConfig, "agentId" | "conversationToken" | "signedUrl" | keyof HookCallbacks>;

export type HookOptions = Partial<SessionBase> &
  HookCallbacks & {
    agentId?: string;
    conversationToken?: string;
    signedUrl?: string;
    /** Accepted for source compatibility; we run one host per environment (use `origin`). */
    serverLocation?: string;
  };

export type AnyConversation = VoiceConversation | TextConversation;

export interface Snapshot {
  status: ConversationStatus;
  message: string | undefined;
  mode: Mode;
  canSendFeedback: boolean;
  isMuted: boolean;
  conversation: AnyConversation | null;
}

/** Every callback the provider composes (the vendor's list + `onConversationCreated`). */
export const CALLBACK_NAMES = [
  "onConnect",
  "onDisconnect",
  "onError",
  "onMessage",
  "onAudio",
  "onModeChange",
  "onStatusChange",
  "onCanSendFeedbackChange",
  "onUnhandledClientToolCall",
  "onVadScore",
  "onMCPToolCall",
  "onMCPConnectionStatus",
  "onConversationMetadata",
  "onInterruption",
  "onAgentResponseCorrection",
  "onAgentChatResponsePart",
  "onAudioAlignment",
  "onDebug",
  "onIncomingEvent",
  "onOutgoingEvent",
  "onConversationCreated",
] as const satisfies ReadonlyArray<keyof HookCallbacks>;

type CallbackName = (typeof CALLBACK_NAMES)[number];
const CALLBACK_SET: ReadonlySet<string> = new Set<string>([...CALLBACK_NAMES, "onMCPToolApprovalRequest"]);

export interface ProviderProps {
  options: HookOptions;
  /** Controlled mute (the provider's `isMuted` prop); `undefined` = uncontrolled. */
  isMuted?: boolean;
  onMutedChange?: (muted: boolean) => void;
}

type Fn = (...args: unknown[]) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** The vendor's `mergeOptions` for data: plain objects merge key-wise, anything else replaces; `undefined` never overwrites. */
export function deepMerge(base: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value) : value;
  }
  return out;
}

/** Options without callbacks, client tools or `serverLocation` (those are handled apart). */
function dataOf(options: HookOptions | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    if (CALLBACK_SET.has(key) || key === "clientTools" || key === "serverLocation") continue;
    out[key] = value;
  }
  return out;
}

/** Volume / mute apply to voice only (a text session's throw, as the vendor's do). */
export function isVoice(conversation: AnyConversation | null): conversation is VoiceConversation {
  return conversation instanceof VoiceConversation && !(conversation instanceof TextConversation);
}

export class ConversationStore {
  private snapshot: Snapshot = {
    status: "disconnected",
    message: undefined,
    mode: "listening",
    canSendFeedback: false,
    isMuted: false,
    conversation: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly registrations = new Set<{ current: HookOptions }>();
  private readonly registeredTools = new Map<string, { current: ClientTool }>();
  /** The live session's client-tool object (the core reads it at call time). */
  private liveTools: Record<string, ClientTool> | null = null;
  private pending = false;
  private cancelPending = false;
  /** Bumped per session: late callbacks of an older one are dropped. */
  private token = 0;
  private volume: number | undefined;

  constructor(private provider: ProviderProps = { options: {} }) {}

  // ── external store ──────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private update(patch: Partial<Snapshot>): void {
    const next = { ...this.snapshot, ...patch };
    if ((Object.keys(patch) as Array<keyof Snapshot>).every((key) => next[key] === this.snapshot[key])) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Latest provider props (called on every provider render; never notifies —
   *  a controlled `isMuted` is applied from an effect through `applyMuted`). */
  setProvider(props: ProviderProps): void {
    this.provider = props;
  }

  // ── registrations (hooks) ───────────────────────────────────────────

  /** A hook's callbacks, read at call time through the ref (ref-stable). */
  registerCallbacks(ref: { current: HookOptions }): () => void {
    this.registrations.add(ref);
    return () => {
      this.registrations.delete(ref);
    };
  }

  /** `useConversationClientTool`: a name already registered or given as an option tool throws. */
  registerClientTool(name: string, handler: { current: ClientTool }): () => void {
    if (this.registeredTools.has(name)) throw new Error(`Client tool "${name}" is already registered`);
    if (this.liveTools && Object.prototype.hasOwnProperty.call(this.liveTools, name)) {
      throw new Error(`Client tool "${name}" is already defined in clientTools`);
    }
    this.registeredTools.set(name, handler);
    if (this.liveTools) this.liveTools[name] = (params: unknown) => handler.current(params);
    return () => {
      this.registeredTools.delete(name);
      if (this.liveTools) delete this.liveTools[name];
    };
  }

  // ── session ─────────────────────────────────────────────────────────

  /**
   * Start a session: provider options, then `hookOptions` (the calling
   * `useConversation`'s own — data only, its callbacks are registered), then
   * `sessionOptions`. Ignored while one is pending or live.
   */
  async startSession(hookOptions: HookOptions = {}, sessionOptions: HookOptions = {}): Promise<void> {
    if (this.pending || this.snapshot.conversation) return;
    this.pending = true;
    this.cancelPending = false;
    const token = ++this.token;
    this.update({ status: "connecting", message: undefined });
    try {
      const layers = [this.provider.options, hookOptions, sessionOptions];
      const data = layers.reduce<Record<string, unknown>>((acc, layer) => deepMerge(acc, dataOf(layer)), {});
      const tools = this.buildTools(layers);
      const config: Record<string, unknown> = {
        ...data,
        ...this.composedCallbacks(token, sessionOptions),
        clientTools: tools,
      };
      if (this.approvalHandler(sessionOptions, hookOptions)) {
        // Resolved per request: a hook registered later still answers.
        config.onMCPToolApprovalRequest = (call: McpToolCall, ctx: { signal: AbortSignal }) =>
          this.approvalHandler(sessionOptions, hookOptions)?.(call, ctx) ?? false;
      }
      if (layers.some((layer) => layer?.serverLocation !== undefined)) {
        this.fire(token, "onDebug", [{ type: "ignored_options", ignored: ["serverLocation"] }], sessionOptions);
      }
      this.liveTools = tools;
      const conversation = await Conversation.startSession(config as unknown as SessionConfig);
      if (token !== this.token) return;
      this.update({ conversation });
      this.applyMuted(this.snapshot.isMuted);
      if (this.volume !== undefined && isVoice(conversation)) conversation.setVolume({ volume: this.volume });
      if (this.cancelPending) await conversation.endSession();
    } catch (err) {
      if (token !== this.token) return;
      this.liveTools = null;
      const message = err instanceof Error ? err.message : String(err);
      this.update({ status: "error", message, conversation: null });
      this.fire(token, "onError", [message, err], sessionOptions);
    } finally {
      if (token === this.token) this.pending = false;
    }
  }

  async endSession(): Promise<void> {
    if (this.pending && !this.snapshot.conversation) {
      this.cancelPending = true;
      return;
    }
    await this.snapshot.conversation?.endSession();
  }

  private buildTools(layers: HookOptions[]): Record<string, ClientTool> {
    const tools: Record<string, ClientTool> = {};
    for (const layer of layers) Object.assign(tools, layer?.clientTools ?? {});
    for (const [name, handler] of this.registeredTools) {
      if (Object.prototype.hasOwnProperty.call(tools, name)) {
        throw new Error(`Client tool "${name}" is registered by useConversationClientTool and defined in clientTools`);
      }
      tools[name] = (params: unknown) => handler.current(params);
    }
    return tools;
  }

  /** Most specific first: startSession → the hook's own → any registered hook → provider. */
  private approvalHandler(session: HookOptions, hook: HookOptions): HookOptions["onMCPToolApprovalRequest"] {
    if (session.onMCPToolApprovalRequest) return session.onMCPToolApprovalRequest;
    if (hook.onMCPToolApprovalRequest) return hook.onMCPToolApprovalRequest;
    for (const ref of [...this.registrations].reverse()) {
      if (ref.current.onMCPToolApprovalRequest) return ref.current.onMCPToolApprovalRequest;
    }
    return this.provider.options.onMCPToolApprovalRequest;
  }

  private composedCallbacks(token: number, session: HookOptions): Record<CallbackName, Fn> {
    const out = {} as Record<CallbackName, Fn>;
    for (const name of CALLBACK_NAMES) out[name] = (...args: unknown[]) => this.fire(token, name, args, session);
    return out;
  }

  /** Internal bookkeeping, then provider → registered hooks → startSession listeners. */
  private fire(token: number, name: CallbackName, args: unknown[], session: HookOptions): void {
    if (token !== this.token) return;
    this.track(name, args);
    const call = (fn: unknown) => {
      if (typeof fn === "function") (fn as Fn)(...args);
    };
    call(this.provider.options[name]);
    for (const ref of [...this.registrations]) call(ref.current[name]);
    call(session[name]);
  }

  private track(name: CallbackName, args: unknown[]): void {
    const payload = args[0] as Record<string, unknown> | undefined;
    switch (name) {
      case "onStatusChange": {
        const status = payload?.status;
        // The vendor's provider never reports "disconnecting" (connected → disconnected).
        if (status === "connecting" || status === "connected") this.update({ status });
        if (status === "disconnected") {
          this.liveTools = null;
          this.update({
            status: this.snapshot.status === "error" ? "error" : "disconnected",
            conversation: null,
            mode: "listening",
            canSendFeedback: false,
          });
        }
        return;
      }
      case "onModeChange":
        if (payload?.mode === "speaking" || payload?.mode === "listening") this.update({ mode: payload.mode });
        return;
      case "onCanSendFeedbackChange":
        this.update({ canSendFeedback: payload?.canSendFeedback === true });
        return;
      default:
        // onError: status untouched (Q28 — the session is still connected).
        return;
    }
  }

  // ── controls ────────────────────────────────────────────────────────

  get conversation(): AnyConversation | null {
    return this.snapshot.conversation;
  }

  /** `setMuted`: controlled → `onMutedChange` only; uncontrolled → applied now. */
  setMuted(muted: boolean): void {
    if (this.provider.isMuted !== undefined) {
      this.provider.onMutedChange?.(muted);
      return;
    }
    this.applyMuted(muted);
    this.provider.onMutedChange?.(muted);
  }

  /** Apply a mute state to the snapshot and a live voice session. */
  applyMuted(muted: boolean): void {
    this.update({ isMuted: muted });
    const conversation = this.snapshot.conversation;
    if (isVoice(conversation)) conversation.setMicMuted(muted);
  }

  /** 0–1 on a voice session; remembered for the next one. Text sessions ignore it. */
  setVolume(volume: number): void {
    this.volume = volume;
    const conversation = this.snapshot.conversation;
    if (isVoice(conversation)) conversation.setVolume({ volume });
  }
}

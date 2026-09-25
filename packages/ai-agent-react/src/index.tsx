// @convoso/ai-agent-react — the vendor's React names over @convoso/ai-agent
// (E4 plan §1.2 / §4.7): ConversationProvider + useConversation,
// useConversationControls, useConversationStatus, useConversationInput,
// useConversationMode, useConversationFeedback, useRawConversation,
// useConversationClientTool. Every hook except useRawConversation throws
// outside a ConversationProvider (as the vendor's ≥ 1.0 does).
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { setSourceInfo, type ClientToolsConfig, type Mode } from "@convoso/ai-agent";
import {
  ConversationStore,
  type AnyConversation,
  type ConversationStatus,
  type HookOptions,
  type Snapshot,
} from "./store";

export * from "@convoso/ai-agent";
export type { AnyConversation, ConversationStatus, HookCallbacks, HookOptions } from "./store";

setSourceInfo({ source: "react_sdk" });

const StoreContext = createContext<ConversationStore | null>(null);

export type ConversationProviderProps = PropsWithChildren<
  HookOptions & { isMuted?: boolean; onMutedChange?: (muted: boolean) => void }
>;

export type UseConversationOptions = HookOptions & { micMuted?: boolean; volume?: number };

export interface ConversationStatusValue {
  status: ConversationStatus;
  message?: string;
}

export interface ConversationModeValue {
  mode: Mode;
  isSpeaking: boolean;
  isListening: boolean;
}

export interface ConversationInputValue {
  isMuted: boolean;
  setMuted: (isMuted: boolean) => void;
}

export interface ConversationFeedbackValue {
  canSendFeedback: boolean;
  sendFeedback: (like: boolean | null, eventId?: number) => void;
}

export interface ConversationControlsValue {
  startSession: (options?: HookOptions) => void;
  endSession: () => void;
  sendUserMessage: (text: string) => void;
  sendContextualUpdate: (text: string, options?: { contextId?: string }) => void;
  sendUserActivity: () => void;
  sendMCPToolApprovalResult: (toolCallId: string, isApproved: boolean) => void;
  setVolume: (options: { volume: number }) => void;
  /** Not in v1 (device switching is a stated gap): rejects. */
  changeInputDevice: (config: { inputDeviceId?: string }) => Promise<void>;
  /** Not in v1 (device switching is a stated gap): rejects. */
  changeOutputDevice: (config: { outputDeviceId?: string }) => Promise<void>;
  getInputByteFrequencyData: () => Uint8Array;
  getOutputByteFrequencyData: () => Uint8Array;
  getInputVolume: () => number;
  getOutputVolume: () => number;
  getId: () => string;
}

/** Holds the live conversation and the defaults every hook's `startSession` merges over. */
export function ConversationProvider({
  children,
  isMuted,
  onMutedChange,
  ...options
}: ConversationProviderProps): ReactElement {
  const ref = useRef<ConversationStore | null>(null);
  if (!ref.current) ref.current = new ConversationStore();
  const store = ref.current;
  store.setProvider({ options, isMuted, onMutedChange });
  useEffect(() => {
    if (isMuted !== undefined) store.applyMuted(isMuted);
  }, [store, isMuted]);
  // Unmount ends the session (StrictMode's probe unmount has none to end).
  useEffect(() => () => void store.endSession(), [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

function useStore(hook: string): ConversationStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error(`${hook} must be used within a ConversationProvider`);
  return store;
}

function useField<K extends keyof Snapshot>(store: ConversationStore, key: K): Snapshot[K] {
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot()[key],
    () => store.getSnapshot()[key],
  );
}

function controlsOf(store: ConversationStore, hookOptions: { current: HookOptions } | null): ConversationControlsValue {
  const conversation = (): AnyConversation | null => store.conversation;
  const unsupported = (name: string) => () =>
    Promise.reject(new Error(`${name} is not supported by @convoso/ai-agent yet`));
  return {
    startSession: (options) => void store.startSession(hookOptions?.current ?? {}, options ?? {}),
    endSession: () => void store.endSession(),
    sendUserMessage: (text) => conversation()?.sendUserMessage(text),
    sendContextualUpdate: (text, options) => conversation()?.sendContextualUpdate(text, options),
    sendUserActivity: () => conversation()?.sendUserActivity(),
    sendMCPToolApprovalResult: (id, ok) => conversation()?.sendMCPToolApprovalResult(id, ok),
    setVolume: ({ volume }) => store.setVolume(volume),
    changeInputDevice: unsupported("changeInputDevice"),
    changeOutputDevice: unsupported("changeOutputDevice"),
    getInputByteFrequencyData: () => conversation()?.getInputByteFrequencyData() ?? new Uint8Array(0),
    getOutputByteFrequencyData: () => conversation()?.getOutputByteFrequencyData() ?? new Uint8Array(0),
    getInputVolume: () => conversation()?.getInputVolume() ?? 0,
    getOutputVolume: () => conversation()?.getOutputVolume() ?? 0,
    getId: () => conversation()?.getId() ?? "",
  };
}

/** Session controls. Its `startSession` sees the provider's options + what you pass it. */
export function useConversationControls(): ConversationControlsValue {
  const store = useStore("useConversationControls");
  return useMemo(() => controlsOf(store, null), [store]);
}

/** `status` adds `"error"` (a rejected start). A runtime onError leaves it `connected` (Q28). */
export function useConversationStatus(): ConversationStatusValue {
  const store = useStore("useConversationStatus");
  const status = useField(store, "status");
  const message = useField(store, "message");
  return useMemo(() => (message === undefined ? { status } : { status, message }), [status, message]);
}

export function useConversationMode(): ConversationModeValue {
  const store = useStore("useConversationMode");
  const mode = useField(store, "mode");
  return useMemo(() => ({ mode, isSpeaking: mode === "speaking", isListening: mode === "listening" }), [mode]);
}

export function useConversationInput(): ConversationInputValue {
  const store = useStore("useConversationInput");
  const isMuted = useField(store, "isMuted");
  return useMemo(() => ({ isMuted, setMuted: (muted: boolean) => store.setMuted(muted) }), [store, isMuted]);
}

/** `canSendFeedback` follows `status === "connected"`; `sendFeedback` thumbs one agent response (Q16). */
export function useConversationFeedback(): ConversationFeedbackValue {
  const store = useStore("useConversationFeedback");
  const canSendFeedback = useField(store, "canSendFeedback");
  return useMemo(
    () => ({
      canSendFeedback,
      sendFeedback: (like: boolean | null, eventId?: number) => store.conversation?.sendFeedback(like, eventId),
    }),
    [store, canSendFeedback],
  );
}

/** The live conversation object, or `null` (also outside a provider — the vendor's rule). */
export function useRawConversation(): AnyConversation | null {
  const store = useContext(StoreContext);
  const conversation = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.getSnapshot().conversation ?? null,
    () => store?.getSnapshot().conversation ?? null,
  );
  return store ? conversation : null;
}

const noopSubscribe = () => () => {};

/**
 * Serve one client tool from a component. A name also given in
 * `clientTools` (provider / hook / startSession) throws, as the vendor's does.
 */
export function useConversationClientTool(
  name: string,
  handler: ClientToolsConfig["clientTools"][string],
): void {
  const store = useStore("useConversationClientTool");
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => store.registerClientTool(name, ref), [store, name]);
}

/**
 * Everything at once. The callbacks you pass are ref-stable and COMPOSED with
 * the provider's (both fire). The NON-callback options you pass (agentId,
 * clientTools, overrides, …) reach the session ONLY through the
 * `startSession` this hook returns — `useConversationControls().startSession()`
 * never sees them (the vendor's behaviour, kept; README "the controls trap").
 */
export function useConversation(options: UseConversationOptions = {}) {
  const store = useStore("useConversation");
  const ref = useRef<HookOptions>(options);
  ref.current = options;
  useEffect(() => store.registerCallbacks(ref), [store]);
  const conversation = useField(store, "conversation");
  const { micMuted, volume } = options;
  useEffect(() => {
    if (micMuted !== undefined) store.applyMuted(micMuted);
  }, [store, micMuted, conversation]);
  useEffect(() => {
    if (volume !== undefined) store.setVolume(volume);
  }, [store, volume, conversation]);
  const controls = useMemo(() => controlsOf(store, ref), [store]);
  const status = useField(store, "status");
  const message = useField(store, "message");
  const mode = useField(store, "mode");
  const isMuted = useField(store, "isMuted");
  const canSendFeedback = useField(store, "canSendFeedback");
  return {
    ...controls,
    status,
    message,
    mode,
    isSpeaking: mode === "speaking",
    isListening: mode === "listening",
    isMuted: micMuted ?? isMuted,
    setMuted: (muted: boolean) => store.setMuted(muted),
    canSendFeedback,
    sendFeedback: (like: boolean | null, eventId?: number) => store.conversation?.sendFeedback(like, eventId),
  };
}

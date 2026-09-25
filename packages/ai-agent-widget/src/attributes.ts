// The vendor's element attributes, mapped onto ours (E4 plan §4.8, owner
// rulings Q9 / Q25). Pure functions over an attribute reader so every rule is
// unit-tested without a DOM. Everything here is ADDITIVE: an element without
// these attributes renders exactly as before (the defaults ARE today's
// rendering), and an explicit `overrides` attribute / property wins over the
// per-key `override-*` attributes.
import type { WidgetPlacement, WidgetRuntimeConfig, WidgetVariant } from "./config";
import { WIDGET_TEXT_KEYS, type WidgetTextKey } from "./text-defaults";

export type AttributeReader = (name: string) => string | null;
export type DebugSink = (event: Record<string, unknown>) => void;

/** `"true"` / `"false"` → boolean; anything else (absent included) → undefined. */
export function parseBool(value: string | null): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/**
 * Q9 — the four display attributes → the runtime config key each overlays
 * after `mergeConfig()`. Defaults keep today's rendering: the status line and
 * the collapsed avatar are shown, the resize button follows the server config,
 * no language selector on the collapsed trigger.
 */
export const DISPLAY_ATTRIBUTES = [
  ["show-agent-status", "show_agent_status"],
  ["show-resize-button", "resize_button_enabled"],
  ["show-language-selector-on-trigger", "show_language_selector_on_trigger"],
  ["show-avatar-when-collapsed", "show_avatar_when_collapsed"],
] as const satisfies ReadonlyArray<readonly [string, keyof WidgetRuntimeConfig]>;

const VARIANTS: readonly WidgetVariant[] = ["tiny", "compact", "full"];
const PLACEMENTS: readonly WidgetPlacement[] = [
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

/**
 * Q25 — the vendor's `text-contents` keys that differ from ours. Every key of
 * ours that the vendor shares (WIDGET_TEXT_KEYS were copied from the vendor's
 * map, text-defaults.ts) maps to itself; these are the renames. Keys in
 * neither set (the vendor's file-input / rich-content / short queue copy) are
 * reported through the debug sink and ignored.
 */
export const VENDOR_TEXT_RENAMES: Readonly<Record<string, WidgetTextKey>> = {
  queue_waiting_status: "queued_status",
};

const OUR_TEXT_KEYS: ReadonlySet<string> = new Set(WIDGET_TEXT_KEYS);

/** A `text-contents` JSON object (vendor or our key names) → our text overrides. */
export function mapTextContents(raw: string | null, debug: DebugSink): Partial<Record<WidgetTextKey, string>> {
  if (!raw) return {};
  let parsed: unknown;
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
  const out: Partial<Record<WidgetTextKey, string>> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const target = OUR_TEXT_KEYS.has(key) ? (key as WidgetTextKey) : VENDOR_TEXT_RENAMES[key];
    if (target) out[target] = value;
    else debug({ type: "unmapped_text_contents_key", key });
  }
  return out;
}

/**
 * The fetched (merged) config with the element's attributes laid over it:
 * the four display attributes (Q9), `variant`, `placement`, `terms-key` and
 * `text-contents` (Q25). An invalid value is ignored (the config stays).
 */
export function overlayAttributes(
  cfg: WidgetRuntimeConfig,
  attr: AttributeReader,
  debug: DebugSink,
): WidgetRuntimeConfig {
  const out: WidgetRuntimeConfig = { ...cfg };
  for (const [name, key] of DISPLAY_ATTRIBUTES) {
    const value = parseBool(attr(name));
    if (value !== undefined) out[key] = value;
  }
  const variant = attr("variant");
  if (variant && (VARIANTS as readonly string[]).includes(variant)) out.variant = variant as WidgetVariant;
  const placement = attr("placement");
  if (placement && (PLACEMENTS as readonly string[]).includes(placement)) {
    out.placement = placement as WidgetPlacement;
  }
  const termsKey = attr("terms-key");
  if (termsKey) out.terms = { ...out.terms, local_storage_key: termsKey };
  const text = mapTextContents(attr("text-contents"), debug);
  if (Object.keys(text).length > 0) out.text = { ...out.text, ...text };
  return out;
}

/** The vendor's `override-*` attributes → our flat override keys (the §4.4 table). */
export const OVERRIDE_ATTRIBUTES = [
  ["override-prompt", "system_prompt", "string"],
  ["override-llm", "llm", "string"],
  ["override-first-message", "first_message", "string"],
  ["override-language", "language", "string"],
  ["override-voice-id", "voice", "string"],
  ["override-speed", "voice_speed", "number"],
  ["override-stability", "voice_stability", "number"],
  ["override-similarity-boost", "voice_similarity", "number"],
  ["override-text-only", "text_only", "boolean"],
] as const;

/** The per-key override attributes as one overrides object, or `null` when none is set. */
export function attributeOverrides(attr: AttributeReader): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [name, key, kind] of OVERRIDE_ATTRIBUTES) {
    const raw = attr(name);
    if (raw === null || raw === "") continue;
    if (kind === "number") {
      const value = Number(raw);
      if (Number.isFinite(value)) out[key] = value;
    } else if (kind === "boolean") {
      const value = parseBool(raw);
      if (value !== undefined) out[key] = value;
    } else {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Q30 — `voso-widget:expand {detail.action}` → the next expanded state (`null` = ignore). */
export function expandAction(action: unknown, expanded: boolean, collapsible: boolean): boolean | null {
  if (action === "expand") return true;
  if (action === "collapse") return collapsible ? false : null;
  if (action === "toggle") return expanded ? (collapsible ? false : null) : true;
  return null;
}

/** Q22 — the inbound events the element forwards only under `allow-events="true"`. */
export const GATED_INBOUND_EVENTS = [
  "voso-widget:user-message",
  "voso-widget:user-activity",
  "voso-widget:contextual-update",
] as const;

/** The ungated UI event (Q30), heard on the element AND on `document`. */
export const EXPAND_EVENT = "voso-widget:expand";

/** Dispatched (bubbling, composed) before every session start; listeners mutate `detail.config`. */
export const CALL_EVENT = "voso-widget:call";

export type InboundAction =
  | { kind: "user-message"; message: string }
  | { kind: "user-activity" }
  | { kind: "contextual-update"; message: string };

/**
 * Q22 — what one inbound event asks for, or `null`: nothing is forwarded
 * unless the element carries `allow-events="true"` (the vendor's default keeps
 * third-party scripts from steering a conversation); a message event needs a
 * non-blank `detail.message`.
 */
export function inboundAction(type: string, allowEvents: string | null, detail: unknown): InboundAction | null {
  if (allowEvents !== "true") return null;
  const raw = (detail as { message?: unknown } | null | undefined)?.message;
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

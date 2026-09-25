// Widget runtime config — the shape served by the PUBLIC config endpoint
// (`GET {origin}/api/widget/{public_id}/config`, runtime-safe fields only)
// plus defaults and the CSS custom-property projection.
//
// Backend validation is authoritative (vosopulse-api widget routes); the
// defaults here only fill gaps so a partial config still renders.

import type { LinkPolicy } from "./link-policy";
import { DEFAULT_LINK_POLICY } from "./link-policy";
import type { WidgetTextKey } from "./text-defaults";

export type WidgetVariant = "tiny" | "compact" | "full";
export type WidgetPlacement =
  | "top-left"
  | "top"
  | "top-right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";
export type ExpandedBehavior =
  | "starts_collapsed"
  | "starts_expanded"
  | "always_expanded";
export type SyntaxTheme = "auto" | "light" | "dark";

export type WidgetAvatar =
  | { kind: "orb"; color_1: string; color_2: string }
  | { kind: "url"; url: string }
  | { kind: "image"; url: string };

export interface WidgetColors {
  base: string;
  base_hover: string;
  base_active: string;
  base_border: string;
  base_subtle: string;
  base_primary: string;
  base_error: string;
  accent: string;
  accent_hover: string;
  accent_active: string;
  accent_border: string;
  accent_subtle: string;
  accent_primary: string;
}

export interface WidgetRadii {
  overlay_padding: number;
  button_radius: number;
  input_radius: number;
  bubble_radius: number;
  sheet_radius: number;
  compact_sheet_radius: number;
  dropdown_sheet_radius: number;
}

export interface WidgetTerms {
  enabled: boolean;
  /** Markdown body shown in the gate. */
  content: string;
  /** When non-empty, accepting stores this localStorage key and future
   *  visits skip the prompt. */
  local_storage_key: string;
}

export interface WidgetFeatureToggles {
  /** Storage form of the single "Chat (text-only) mode" toggle:
   *  `voice_enabled = !text_only`. Text-only OFF (default) = voice AND
   *  chat both available; ON = chat only. */
  voice_enabled: boolean;
  /** LEGACY — accepted from stored configs but forced `true` by
   *  `mergeConfig`: chat is always available (no chat-off mode in the
   *  single-toggle model). */
  text_enabled: boolean;
  /** Show the composer during a live call; typed text becomes a real
   *  user turn (RTVI send-text). */
  send_text_while_on_call: boolean;
  transcript_enabled: boolean;
  language_dropdown_enabled: boolean;
  mute_button_enabled: boolean;
  show_conversation_id: boolean;
  hide_audio_tags: boolean;
  action_indicator_enabled: boolean;
  resize_button_enabled: boolean;
  feedback_enabled: boolean;
  /** Element-only display flags (E4 Q9) — set by the `show-*` attributes,
   *  never by the server config; the defaults are today's rendering. */
  show_agent_status: boolean;
  show_language_selector_on_trigger: boolean;
  show_avatar_when_collapsed: boolean;
}

export interface WidgetRuntimeConfig extends WidgetFeatureToggles {
  agent_name: string;
  variant: WidgetVariant;
  placement: WidgetPlacement;
  expanded_behavior: ExpandedBehavior;
  collapsible: boolean;
  syntax_theme: SyntaxTheme;
  avatar: WidgetAvatar;
  colors: WidgetColors;
  radii: WidgetRadii;
  terms: WidgetTerms;
  link_policy: LinkPolicy;
  /** BCP-47-ish language codes the agent supports; first entry is default. */
  languages: string[];
  text: Partial<Record<WidgetTextKey, string>>;
}

export const DEFAULT_COLORS: WidgetColors = {
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
  accent_primary: "#ffffff",
};

export const DEFAULT_RADII: WidgetRadii = {
  overlay_padding: 32,
  button_radius: 18,
  input_radius: 18,
  bubble_radius: 15,
  sheet_radius: 24,
  compact_sheet_radius: 30,
  dropdown_sheet_radius: 24,
};

export const DEFAULT_CONFIG: WidgetRuntimeConfig = {
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
  show_avatar_when_collapsed: true,
};

/** Deep-merge a server config over the defaults (arrays/objects replaced,
 *  nested known objects merged key-wise). Tolerates missing fields.
 *
 *  Single-toggle semantics: chat is ALWAYS available (`text_enabled` is
 *  forced `true`, whatever a stored config carries), and voice
 *  availability is exactly `voice_enabled` (= !text-only). A legacy
 *  config that explicitly disabled voice therefore behaves as
 *  text-only ON. */
export function mergeConfig(
  partial: Partial<WidgetRuntimeConfig> | undefined,
): WidgetRuntimeConfig {
  if (!partial) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    text_enabled: true,
    avatar: partial.avatar ?? DEFAULT_CONFIG.avatar,
    colors: { ...DEFAULT_COLORS, ...(partial.colors ?? {}) },
    radii: { ...DEFAULT_RADII, ...(partial.radii ?? {}) },
    terms: { ...DEFAULT_CONFIG.terms, ...(partial.terms ?? {}) },
    link_policy: { ...DEFAULT_LINK_POLICY, ...(partial.link_policy ?? {}) },
    languages: partial.languages ?? [],
    text: partial.text ?? {},
  };
}

/**
 * Project config onto the shadow-root CSS custom properties.
 * Every visual knob the widget uses flows through these variables.
 */
export function buildCssVars(cfg: WidgetRuntimeConfig): Record<string, string> {
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
    "--vw-dropdown-sheet-radius": `${r.dropdown_sheet_radius}px`,
  };
}

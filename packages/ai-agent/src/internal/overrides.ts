// The vendor's nested `overrides` object ↔ our flat conversation-override
// keys (E4 plan §4.4 — one table, unit-tested both ways). Server-side gating
// (`security_config.overrides`: 400 unknown / 403 disabled) stays the
// authority; the SDK adds no validation of its own.

export interface ConversationOverrides {
  agent?: { prompt?: { prompt?: string; llm?: string }; firstMessage?: string; language?: string };
  tts?: { voiceId?: string; speed?: number; stability?: number; similarityBoost?: number };
  asr?: { keywords?: string[] };
  conversation?: { textOnly?: boolean };
}

/** `[vendor path, our key]` — the whole mapping. `asr.keywords` rides verbatim (E2 D-22). */
export const OVERRIDE_TABLE: ReadonlyArray<readonly [string, string]> = [
  ["agent.prompt.prompt", "system_prompt"],
  ["agent.prompt.llm", "llm"],
  ["agent.firstMessage", "first_message"],
  ["agent.language", "language"],
  ["tts.voiceId", "voice"],
  ["tts.speed", "voice_speed"],
  ["tts.stability", "voice_stability"],
  ["tts.similarityBoost", "voice_similarity"],
  ["conversation.textOnly", "text_only"],
];

function read(root: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), root);
}

function write(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let node = root;
  for (const key of keys.slice(0, -1)) {
    node[key] = (node[key] as Record<string, unknown> | undefined) ?? {};
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]!] = value;
}

/**
 * Vendor overrides → our flat keys. `text_only` is the transport selector
 * and is NOT forwarded unless `forwardTextOnly` (the plan's edge case: it is
 * a gated key and would 403 on agents that have not enabled it).
 */
export function toOurOverrides(
  overrides: ConversationOverrides | undefined,
  { forwardTextOnly = false }: { forwardTextOnly?: boolean } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, key] of OVERRIDE_TABLE) {
    if (key === "text_only" && !forwardTextOnly) continue;
    const value = read(overrides, path);
    if (value !== undefined) out[key] = value;
  }
  const keywords = overrides?.asr?.keywords;
  if (keywords !== undefined) out.asr = { keywords };
  return out;
}

/** Our flat keys → the vendor's nested object (the reverse of the table). */
export function fromOurOverrides(flat: Record<string, unknown>): ConversationOverrides {
  const out: Record<string, unknown> = {};
  for (const [path, key] of OVERRIDE_TABLE) {
    if (flat[key] !== undefined) write(out, path, flat[key]);
  }
  const asr = flat.asr as { keywords?: string[] } | undefined;
  if (asr?.keywords !== undefined) write(out, "asr.keywords", asr.keywords);
  return out as ConversationOverrides;
}

// Conversation.startSession — the vendor's entry point (E4 plan §4.4).
import type { SessionConfig } from "../types";
import { TextConversation } from "./text";
import { VoiceConversation } from "./voice";

/**
 * `textOnly` wins over `overrides.conversation.textOnly` (conflict → a
 * console warning, the vendor's rule); root-level `textOnly` is honoured
 * (Q26). The resolved value is written back into the overrides.
 */
export function resolveTextOnly(config: SessionConfig): boolean {
  const root = config.textOnly;
  const nested = config.overrides?.conversation?.textOnly;
  if (root !== undefined && nested !== undefined && root !== nested) {
    console.warn("textOnly and overrides.conversation.textOnly disagree; textOnly wins");
  }
  const textOnly = root ?? nested ?? false;
  if (config.overrides) {
    config.overrides.conversation = { ...(config.overrides.conversation ?? {}), textOnly };
  }
  return textOnly;
}

async function startSession(config: SessionConfig & { textOnly: true }): Promise<TextConversation>;
async function startSession(config: SessionConfig & { textOnly: false }): Promise<VoiceConversation>;
async function startSession(config: SessionConfig): Promise<VoiceConversation | TextConversation>;
async function startSession(config: SessionConfig): Promise<VoiceConversation | TextConversation> {
  const conversation = resolveTextOnly(config) ? new TextConversation(config) : new VoiceConversation(config);
  await conversation.start();
  return conversation;
}

/** The vendor's `Conversation` namespace. */
export const Conversation = { startSession } as const;
export type Conversation = VoiceConversation | TextConversation;

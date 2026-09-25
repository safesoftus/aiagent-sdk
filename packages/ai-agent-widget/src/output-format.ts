// Agent-bubble output-format gate (agent behavior panel — Widget row,
// plan §7.6). The leading chat `session` frame carries `output_format`;
// the widget renders agent text as markdown or as literal text from it.
// The flag rides the CHAT frame only: voice transcripts always render
// markdown (today's behaviour), so a Plain-text Widget row never touches
// a voice conversation.

/** Wire values of `channel_catalog::text::TextOutputFormat`. */
export type OutputFormat = "plain_text" | "markdown";

/** Today's rendering — used until the `session` frame arrives and for every
 *  voice transcript. */
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = "markdown";

/** The frame's `output_format`. Missing or unknown ⇒ the default, so an
 *  older API (or a malformed frame) never strips formatting from a live
 *  widget. */
export function outputFormatFromFrame(value: unknown): OutputFormat {
  return value === "plain_text" ? "plain_text" : DEFAULT_OUTPUT_FORMAT;
}

/** Minimal bubble surface — a DOM element in the widget, a stub in tests. */
export interface AgentBubble {
  textContent: string | null;
  append(node: Node): void;
}

/** The ONE agent-bubble text render. `plain_text` ⇒ literal text (the same
 *  path user bubbles take: asterisks stay asterisks, no links, no code
 *  blocks); `markdown` ⇒ the renderer's node. */
export function renderAgentText(
  bubble: AgentBubble,
  text: string,
  format: OutputFormat,
  markdown: (text: string) => Node,
): void {
  if (format === "plain_text") {
    bubble.textContent = text;
    return;
  }
  bubble.append(markdown(text));
}

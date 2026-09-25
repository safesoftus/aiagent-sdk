// Minimal markdown parser for widget chat bubbles.
//
// Deliberately small (no dependency): paragraphs, ATX headings, fenced code
// blocks, ordered/unordered lists, bold/italic/strikethrough, inline code,
// and links gated by the LinkPolicy. The parser produces a pure tree — the
// DOM is built separately in the browser (never via innerHTML), so parsing is
// unit-testable under node and injection-safe by construction.

import { isLinkAllowed, type LinkPolicy } from "./link-policy";

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "del"; children: MdInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MdInline[]; allowed: boolean };

export type MdBlock =
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "heading"; level: number; children: MdInline[] }
  | { kind: "code_block"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; items: MdInline[][] };

/** Parse markdown into a render tree. Links carry an `allowed` verdict. */
export function parseMarkdown(src: string, policy: LinkPolicy): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```([A-Za-z0-9+#._-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] ?? "").toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // consume closing fence (or EOF)
      blocks.push({ kind: "code_block", lang, text: body.join("\n") });
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        children: parseInline(heading[2] ?? "", policy),
      });
      i += 1;
      continue;
    }

    // List (unordered or ordered) — consecutive item lines.
    const listItem = matchListItem(line);
    if (listItem) {
      const ordered = listItem.ordered;
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const m = matchListItem(lines[i] ?? "");
        if (!m || m.ordered !== ordered) break;
        items.push(parseInline(m.text, policy));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: gather until blank line or a structural line.
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        next.trim() === "" ||
        /^```/.test(next) ||
        /^#{1,4}\s/.test(next) ||
        matchListItem(next)
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(para.join("\n"), policy) });
  }

  return blocks;
}

function matchListItem(
  line: string,
): { ordered: boolean; text: string } | null {
  const ul = line.match(/^\s{0,3}[-*+]\s+(.*)$/);
  if (ul) return { ordered: false, text: ul[1] ?? "" };
  const ol = line.match(/^\s{0,3}\d{1,9}[.)]\s+(.*)$/);
  if (ol) return { ordered: true, text: ol[1] ?? "" };
  return null;
}

/** Parse inline markdown. Exported for tests. */
export function parseInline(src: string, policy: LinkPolicy): MdInline[] {
  const out: MdInline[] = [];
  let rest = src;

  const pushText = (t: string) => {
    if (t === "") return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };

  while (rest.length > 0) {
    // Inline code — earliest special first; code wins over emphasis inside it.
    const patterns: Array<{ index: number; run: () => void; len: number }> = [];

    const code = rest.match(/`([^`\n]+)`/);
    if (code && code.index !== undefined) {
      patterns.push({
        index: code.index,
        len: code[0].length,
        run: () => out.push({ kind: "code", text: code[1] ?? "" }),
      });
    }

    const link = rest.match(/\[([^\]\n]*)\]\(([^)\s]+)\)/);
    if (link && link.index !== undefined) {
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
            allowed,
          });
        },
      });
    }

    const strong = rest.match(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/);
    if (strong && strong.index !== undefined) {
      const inner = strong[1] ?? strong[2] ?? "";
      patterns.push({
        index: strong.index,
        len: strong[0].length,
        run: () =>
          out.push({ kind: "strong", children: parseInline(inner, policy) }),
      });
    }

    const em = rest.match(/(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/);
    if (em && em.index !== undefined) {
      const inner = em[1] ?? em[2] ?? "";
      patterns.push({
        index: em.index,
        len: em[0].length,
        run: () => out.push({ kind: "em", children: parseInline(inner, policy) }),
      });
    }

    const del = rest.match(/~~([^~\n]+)~~/);
    if (del && del.index !== undefined) {
      patterns.push({
        index: del.index,
        len: del[0].length,
        run: () =>
          out.push({ kind: "del", children: parseInline(del[1] ?? "", policy) }),
      });
    }

    if (patterns.length === 0) {
      pushText(rest);
      break;
    }
    patterns.sort((a, b) => a.index - b.index);
    const first = patterns[0]!;
    pushText(rest.slice(0, first.index));
    first.run();
    rest = rest.slice(first.index + first.len);
  }

  return out;
}

/**
 * Strip vendor-style audio tags — bracketed cues like `[laughs]` or
 * `[whispering]` — from transcript text when `hide_audio_tags` is enabled.
 * Markdown links (`[text](url)`) are preserved: only `[...]` NOT followed by
 * `(` is treated as an audio tag.
 */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[^\][\n]{1,60}\](?!\()/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/^ +| +$/gm, "");
}

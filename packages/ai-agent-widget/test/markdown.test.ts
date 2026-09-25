import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, parseInline, stripAudioTags } from "../src/markdown";
import { DEFAULT_LINK_POLICY, type LinkPolicy } from "../src/link-policy";

const allowAll: LinkPolicy = { ...DEFAULT_LINK_POLICY, allow_all: true };

test("plain paragraph", () => {
  const blocks = parseMarkdown("Hello world", allowAll);
  assert.deepEqual(blocks, [
    { kind: "paragraph", children: [{ kind: "text", text: "Hello world" }] },
  ]);
});

test("bold, italic, strikethrough, inline code", () => {
  const inl = parseInline("a **b** *c* ~~d~~ `e`", allowAll);
  assert.deepEqual(inl, [
    { kind: "text", text: "a " },
    { kind: "strong", children: [{ kind: "text", text: "b" }] },
    { kind: "text", text: " " },
    { kind: "em", children: [{ kind: "text", text: "c" }] },
    { kind: "text", text: " " },
    { kind: "del", children: [{ kind: "text", text: "d" }] },
    { kind: "text", text: " " },
    { kind: "code", text: "e" },
  ]);
});

test("allowed link carries allowed=true", () => {
  const inl = parseInline("see [docs](https://example.com/d)", allowAll);
  assert.deepEqual(inl[1], {
    kind: "link",
    href: "https://example.com/d",
    children: [{ kind: "text", text: "docs" }],
    allowed: true,
  });
});

test("disallowed link carries allowed=false (renderer degrades to text)", () => {
  const inl = parseInline("[x](javascript:alert(1))", allowAll);
  const link = inl[0];
  assert.equal(link?.kind, "link");
  if (link?.kind === "link") assert.equal(link.allowed, false);
});

test("fenced code block with language", () => {
  const blocks = parseMarkdown("```ts\nconst a = 1;\n```", allowAll);
  assert.deepEqual(blocks, [
    { kind: "code_block", lang: "ts", text: "const a = 1;" },
  ]);
});

test("unterminated fence consumes to EOF without hanging", () => {
  const blocks = parseMarkdown("```\nabc", allowAll);
  assert.deepEqual(blocks, [{ kind: "code_block", lang: "", text: "abc" }]);
});

test("headings h1-h4", () => {
  const blocks = parseMarkdown("# One\n#### Four", allowAll);
  assert.equal(blocks[0]?.kind, "heading");
  assert.equal((blocks[0] as { level: number }).level, 1);
  assert.equal((blocks[1] as { level: number }).level, 4);
});

test("unordered and ordered lists", () => {
  const blocks = parseMarkdown("- a\n- b\n\n1. x\n2. y", allowAll);
  assert.deepEqual(blocks, [
    {
      kind: "list",
      ordered: false,
      items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]],
    },
    {
      kind: "list",
      ordered: true,
      items: [[{ kind: "text", text: "x" }], [{ kind: "text", text: "y" }]],
    },
  ]);
});

test("multi-line paragraph joins; blank line splits", () => {
  const blocks = parseMarkdown("line one\nline two\n\npara two", allowAll);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]?.kind, "paragraph");
});

test("html in text stays text (no innerHTML surface)", () => {
  const blocks = parseMarkdown("<script>alert(1)</script>", allowAll);
  assert.deepEqual(blocks, [
    {
      kind: "paragraph",
      children: [{ kind: "text", text: "<script>alert(1)</script>" }],
    },
  ]);
});

test("stripAudioTags removes bracketed cues, keeps markdown links", () => {
  assert.equal(stripAudioTags("hi [laughs] there"), "hi there");
  assert.equal(
    stripAudioTags("see [docs](https://e.co)"),
    "see [docs](https://e.co)",
  );
  assert.equal(stripAudioTags("[whispering] ok"), "ok");
});

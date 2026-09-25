// test/markdown.test.ts
import test from "node:test";
import assert from "node:assert/strict";

// src/link-policy.ts
var DEFAULT_LINK_POLICY = {
  allow_all: false,
  allowed_hosts: [],
  include_www_variants: true,
  allow_http: false
};
function splitHostPort(entry) {
  const idx = entry.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(entry.slice(idx + 1))) {
    return { host: entry.slice(0, idx).toLowerCase(), port: entry.slice(idx + 1) };
  }
  return { host: entry.toLowerCase(), port: null };
}
function hostMatches(urlHost, entryHost, includeWww) {
  if (urlHost === entryHost) return true;
  if (!includeWww) return false;
  const strip = (h) => h.startsWith("www.") ? h.slice(4) : h;
  return strip(urlHost) === strip(entryHost);
}
function isLinkAllowed(href, policy) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const scheme = url.protocol;
  if (scheme === "javascript:") return false;
  if (scheme !== "https:" && scheme !== "http:") return false;
  if (scheme === "http:" && !policy.allow_http) return false;
  if (policy.allow_all) return true;
  const urlHost = url.hostname.toLowerCase();
  const urlPort = url.port;
  for (const raw of policy.allowed_hosts) {
    const entry = raw.trim();
    if (!entry) continue;
    const { host, port } = splitHostPort(entry);
    if (!hostMatches(urlHost, host, policy.include_www_variants)) continue;
    if (port === null) return true;
    const effectivePort = urlPort || (scheme === "https:" ? "443" : "80");
    if (effectivePort === port) return true;
  }
  return false;
}

// src/markdown.ts
function parseMarkdown(src, policy) {
  const blocks = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const fence = line.match(/^```([A-Za-z0-9+#._-]*)\s*$/);
    if (fence) {
      const lang = (fence[1] ?? "").toLowerCase();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code_block", lang, text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length,
        children: parseInline(heading[2] ?? "", policy)
      });
      i += 1;
      continue;
    }
    const listItem = matchListItem(line);
    if (listItem) {
      const ordered = listItem.ordered;
      const items = [];
      while (i < lines.length) {
        const m = matchListItem(lines[i] ?? "");
        if (!m || m.ordered !== ordered) break;
        items.push(parseInline(m.text, policy));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const para = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (next.trim() === "" || /^```/.test(next) || /^#{1,4}\s/.test(next) || matchListItem(next)) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(para.join("\n"), policy) });
  }
  return blocks;
}
function matchListItem(line) {
  const ul = line.match(/^\s{0,3}[-*+]\s+(.*)$/);
  if (ul) return { ordered: false, text: ul[1] ?? "" };
  const ol = line.match(/^\s{0,3}\d{1,9}[.)]\s+(.*)$/);
  if (ol) return { ordered: true, text: ol[1] ?? "" };
  return null;
}
function parseInline(src, policy) {
  const out = [];
  let rest = src;
  const pushText = (t) => {
    if (t === "") return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  while (rest.length > 0) {
    const patterns = [];
    const code = rest.match(/`([^`\n]+)`/);
    if (code && code.index !== void 0) {
      patterns.push({
        index: code.index,
        len: code[0].length,
        run: () => out.push({ kind: "code", text: code[1] ?? "" })
      });
    }
    const link = rest.match(/\[([^\]\n]*)\]\(([^)\s]+)\)/);
    if (link && link.index !== void 0) {
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
            allowed
          });
        }
      });
    }
    const strong = rest.match(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/);
    if (strong && strong.index !== void 0) {
      const inner = strong[1] ?? strong[2] ?? "";
      patterns.push({
        index: strong.index,
        len: strong[0].length,
        run: () => out.push({ kind: "strong", children: parseInline(inner, policy) })
      });
    }
    const em = rest.match(/(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/);
    if (em && em.index !== void 0) {
      const inner = em[1] ?? em[2] ?? "";
      patterns.push({
        index: em.index,
        len: em[0].length,
        run: () => out.push({ kind: "em", children: parseInline(inner, policy) })
      });
    }
    const del = rest.match(/~~([^~\n]+)~~/);
    if (del && del.index !== void 0) {
      patterns.push({
        index: del.index,
        len: del[0].length,
        run: () => out.push({ kind: "del", children: parseInline(del[1] ?? "", policy) })
      });
    }
    if (patterns.length === 0) {
      pushText(rest);
      break;
    }
    patterns.sort((a, b) => a.index - b.index);
    const first = patterns[0];
    pushText(rest.slice(0, first.index));
    first.run();
    rest = rest.slice(first.index + first.len);
  }
  return out;
}
function stripAudioTags(text) {
  return text.replace(/\[[^\][\n]{1,60}\](?!\()/g, "").replace(/ {2,}/g, " ").replace(/^ +| +$/gm, "");
}

// test/markdown.test.ts
var allowAll = { ...DEFAULT_LINK_POLICY, allow_all: true };
test("plain paragraph", () => {
  const blocks = parseMarkdown("Hello world", allowAll);
  assert.deepEqual(blocks, [
    { kind: "paragraph", children: [{ kind: "text", text: "Hello world" }] }
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
    { kind: "code", text: "e" }
  ]);
});
test("allowed link carries allowed=true", () => {
  const inl = parseInline("see [docs](https://example.com/d)", allowAll);
  assert.deepEqual(inl[1], {
    kind: "link",
    href: "https://example.com/d",
    children: [{ kind: "text", text: "docs" }],
    allowed: true
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
    { kind: "code_block", lang: "ts", text: "const a = 1;" }
  ]);
});
test("unterminated fence consumes to EOF without hanging", () => {
  const blocks = parseMarkdown("```\nabc", allowAll);
  assert.deepEqual(blocks, [{ kind: "code_block", lang: "", text: "abc" }]);
});
test("headings h1-h4", () => {
  const blocks = parseMarkdown("# One\n#### Four", allowAll);
  assert.equal(blocks[0]?.kind, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].level, 4);
});
test("unordered and ordered lists", () => {
  const blocks = parseMarkdown("- a\n- b\n\n1. x\n2. y", allowAll);
  assert.deepEqual(blocks, [
    {
      kind: "list",
      ordered: false,
      items: [[{ kind: "text", text: "a" }], [{ kind: "text", text: "b" }]]
    },
    {
      kind: "list",
      ordered: true,
      items: [[{ kind: "text", text: "x" }], [{ kind: "text", text: "y" }]]
    }
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
      children: [{ kind: "text", text: "<script>alert(1)</script>" }]
    }
  ]);
});
test("stripAudioTags removes bracketed cues, keeps markdown links", () => {
  assert.equal(stripAudioTags("hi [laughs] there"), "hi there");
  assert.equal(
    stripAudioTags("see [docs](https://e.co)"),
    "see [docs](https://e.co)"
  );
  assert.equal(stripAudioTags("[whispering] ok"), "ok");
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vdGVzdC9tYXJrZG93bi50ZXN0LnRzIiwgIi4uL3NyYy9saW5rLXBvbGljeS50cyIsICIuLi9zcmMvbWFya2Rvd24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB0ZXN0IGZyb20gXCJub2RlOnRlc3RcIjtcbmltcG9ydCBhc3NlcnQgZnJvbSBcIm5vZGU6YXNzZXJ0L3N0cmljdFwiO1xuaW1wb3J0IHsgcGFyc2VNYXJrZG93biwgcGFyc2VJbmxpbmUsIHN0cmlwQXVkaW9UYWdzIH0gZnJvbSBcIi4uL3NyYy9tYXJrZG93blwiO1xuaW1wb3J0IHsgREVGQVVMVF9MSU5LX1BPTElDWSwgdHlwZSBMaW5rUG9saWN5IH0gZnJvbSBcIi4uL3NyYy9saW5rLXBvbGljeVwiO1xuXG5jb25zdCBhbGxvd0FsbDogTGlua1BvbGljeSA9IHsgLi4uREVGQVVMVF9MSU5LX1BPTElDWSwgYWxsb3dfYWxsOiB0cnVlIH07XG5cbnRlc3QoXCJwbGFpbiBwYXJhZ3JhcGhcIiwgKCkgPT4ge1xuICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duKFwiSGVsbG8gd29ybGRcIiwgYWxsb3dBbGwpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGJsb2NrcywgW1xuICAgIHsga2luZDogXCJwYXJhZ3JhcGhcIiwgY2hpbGRyZW46IFt7IGtpbmQ6IFwidGV4dFwiLCB0ZXh0OiBcIkhlbGxvIHdvcmxkXCIgfV0gfSxcbiAgXSk7XG59KTtcblxudGVzdChcImJvbGQsIGl0YWxpYywgc3RyaWtldGhyb3VnaCwgaW5saW5lIGNvZGVcIiwgKCkgPT4ge1xuICBjb25zdCBpbmwgPSBwYXJzZUlubGluZShcImEgKipiKiogKmMqIH5+ZH5+IGBlYFwiLCBhbGxvd0FsbCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoaW5sLCBbXG4gICAgeyBraW5kOiBcInRleHRcIiwgdGV4dDogXCJhIFwiIH0sXG4gICAgeyBraW5kOiBcInN0cm9uZ1wiLCBjaGlsZHJlbjogW3sga2luZDogXCJ0ZXh0XCIsIHRleHQ6IFwiYlwiIH1dIH0sXG4gICAgeyBraW5kOiBcInRleHRcIiwgdGV4dDogXCIgXCIgfSxcbiAgICB7IGtpbmQ6IFwiZW1cIiwgY2hpbGRyZW46IFt7IGtpbmQ6IFwidGV4dFwiLCB0ZXh0OiBcImNcIiB9XSB9LFxuICAgIHsga2luZDogXCJ0ZXh0XCIsIHRleHQ6IFwiIFwiIH0sXG4gICAgeyBraW5kOiBcImRlbFwiLCBjaGlsZHJlbjogW3sga2luZDogXCJ0ZXh0XCIsIHRleHQ6IFwiZFwiIH1dIH0sXG4gICAgeyBraW5kOiBcInRleHRcIiwgdGV4dDogXCIgXCIgfSxcbiAgICB7IGtpbmQ6IFwiY29kZVwiLCB0ZXh0OiBcImVcIiB9LFxuICBdKTtcbn0pO1xuXG50ZXN0KFwiYWxsb3dlZCBsaW5rIGNhcnJpZXMgYWxsb3dlZD10cnVlXCIsICgpID0+IHtcbiAgY29uc3QgaW5sID0gcGFyc2VJbmxpbmUoXCJzZWUgW2RvY3NdKGh0dHBzOi8vZXhhbXBsZS5jb20vZClcIiwgYWxsb3dBbGwpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGlubFsxXSwge1xuICAgIGtpbmQ6IFwibGlua1wiLFxuICAgIGhyZWY6IFwiaHR0cHM6Ly9leGFtcGxlLmNvbS9kXCIsXG4gICAgY2hpbGRyZW46IFt7IGtpbmQ6IFwidGV4dFwiLCB0ZXh0OiBcImRvY3NcIiB9XSxcbiAgICBhbGxvd2VkOiB0cnVlLFxuICB9KTtcbn0pO1xuXG50ZXN0KFwiZGlzYWxsb3dlZCBsaW5rIGNhcnJpZXMgYWxsb3dlZD1mYWxzZSAocmVuZGVyZXIgZGVncmFkZXMgdG8gdGV4dClcIiwgKCkgPT4ge1xuICBjb25zdCBpbmwgPSBwYXJzZUlubGluZShcIlt4XShqYXZhc2NyaXB0OmFsZXJ0KDEpKVwiLCBhbGxvd0FsbCk7XG4gIGNvbnN0IGxpbmsgPSBpbmxbMF07XG4gIGFzc2VydC5lcXVhbChsaW5rPy5raW5kLCBcImxpbmtcIik7XG4gIGlmIChsaW5rPy5raW5kID09PSBcImxpbmtcIikgYXNzZXJ0LmVxdWFsKGxpbmsuYWxsb3dlZCwgZmFsc2UpO1xufSk7XG5cbnRlc3QoXCJmZW5jZWQgY29kZSBibG9jayB3aXRoIGxhbmd1YWdlXCIsICgpID0+IHtcbiAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bihcImBgYHRzXFxuY29uc3QgYSA9IDE7XFxuYGBgXCIsIGFsbG93QWxsKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChibG9ja3MsIFtcbiAgICB7IGtpbmQ6IFwiY29kZV9ibG9ja1wiLCBsYW5nOiBcInRzXCIsIHRleHQ6IFwiY29uc3QgYSA9IDE7XCIgfSxcbiAgXSk7XG59KTtcblxudGVzdChcInVudGVybWluYXRlZCBmZW5jZSBjb25zdW1lcyB0byBFT0Ygd2l0aG91dCBoYW5naW5nXCIsICgpID0+IHtcbiAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bihcImBgYFxcbmFiY1wiLCBhbGxvd0FsbCk7XG4gIGFzc2VydC5kZWVwRXF1YWwoYmxvY2tzLCBbeyBraW5kOiBcImNvZGVfYmxvY2tcIiwgbGFuZzogXCJcIiwgdGV4dDogXCJhYmNcIiB9XSk7XG59KTtcblxudGVzdChcImhlYWRpbmdzIGgxLWg0XCIsICgpID0+IHtcbiAgY29uc3QgYmxvY2tzID0gcGFyc2VNYXJrZG93bihcIiMgT25lXFxuIyMjIyBGb3VyXCIsIGFsbG93QWxsKTtcbiAgYXNzZXJ0LmVxdWFsKGJsb2Nrc1swXT8ua2luZCwgXCJoZWFkaW5nXCIpO1xuICBhc3NlcnQuZXF1YWwoKGJsb2Nrc1swXSBhcyB7IGxldmVsOiBudW1iZXIgfSkubGV2ZWwsIDEpO1xuICBhc3NlcnQuZXF1YWwoKGJsb2Nrc1sxXSBhcyB7IGxldmVsOiBudW1iZXIgfSkubGV2ZWwsIDQpO1xufSk7XG5cbnRlc3QoXCJ1bm9yZGVyZWQgYW5kIG9yZGVyZWQgbGlzdHNcIiwgKCkgPT4ge1xuICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duKFwiLSBhXFxuLSBiXFxuXFxuMS4geFxcbjIuIHlcIiwgYWxsb3dBbGwpO1xuICBhc3NlcnQuZGVlcEVxdWFsKGJsb2NrcywgW1xuICAgIHtcbiAgICAgIGtpbmQ6IFwibGlzdFwiLFxuICAgICAgb3JkZXJlZDogZmFsc2UsXG4gICAgICBpdGVtczogW1t7IGtpbmQ6IFwidGV4dFwiLCB0ZXh0OiBcImFcIiB9XSwgW3sga2luZDogXCJ0ZXh0XCIsIHRleHQ6IFwiYlwiIH1dXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGtpbmQ6IFwibGlzdFwiLFxuICAgICAgb3JkZXJlZDogdHJ1ZSxcbiAgICAgIGl0ZW1zOiBbW3sga2luZDogXCJ0ZXh0XCIsIHRleHQ6IFwieFwiIH1dLCBbeyBraW5kOiBcInRleHRcIiwgdGV4dDogXCJ5XCIgfV1dLFxuICAgIH0sXG4gIF0pO1xufSk7XG5cbnRlc3QoXCJtdWx0aS1saW5lIHBhcmFncmFwaCBqb2luczsgYmxhbmsgbGluZSBzcGxpdHNcIiwgKCkgPT4ge1xuICBjb25zdCBibG9ja3MgPSBwYXJzZU1hcmtkb3duKFwibGluZSBvbmVcXG5saW5lIHR3b1xcblxcbnBhcmEgdHdvXCIsIGFsbG93QWxsKTtcbiAgYXNzZXJ0LmVxdWFsKGJsb2Nrcy5sZW5ndGgsIDIpO1xuICBhc3NlcnQuZXF1YWwoYmxvY2tzWzBdPy5raW5kLCBcInBhcmFncmFwaFwiKTtcbn0pO1xuXG50ZXN0KFwiaHRtbCBpbiB0ZXh0IHN0YXlzIHRleHQgKG5vIGlubmVySFRNTCBzdXJmYWNlKVwiLCAoKSA9PiB7XG4gIGNvbnN0IGJsb2NrcyA9IHBhcnNlTWFya2Rvd24oXCI8c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+XCIsIGFsbG93QWxsKTtcbiAgYXNzZXJ0LmRlZXBFcXVhbChibG9ja3MsIFtcbiAgICB7XG4gICAgICBraW5kOiBcInBhcmFncmFwaFwiLFxuICAgICAgY2hpbGRyZW46IFt7IGtpbmQ6IFwidGV4dFwiLCB0ZXh0OiBcIjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD5cIiB9XSxcbiAgICB9LFxuICBdKTtcbn0pO1xuXG50ZXN0KFwic3RyaXBBdWRpb1RhZ3MgcmVtb3ZlcyBicmFja2V0ZWQgY3Vlcywga2VlcHMgbWFya2Rvd24gbGlua3NcIiwgKCkgPT4ge1xuICBhc3NlcnQuZXF1YWwoc3RyaXBBdWRpb1RhZ3MoXCJoaSBbbGF1Z2hzXSB0aGVyZVwiKSwgXCJoaSB0aGVyZVwiKTtcbiAgYXNzZXJ0LmVxdWFsKFxuICAgIHN0cmlwQXVkaW9UYWdzKFwic2VlIFtkb2NzXShodHRwczovL2UuY28pXCIpLFxuICAgIFwic2VlIFtkb2NzXShodHRwczovL2UuY28pXCIsXG4gICk7XG4gIGFzc2VydC5lcXVhbChzdHJpcEF1ZGlvVGFncyhcIlt3aGlzcGVyaW5nXSBva1wiKSwgXCJva1wiKTtcbn0pO1xuIiwgIi8vIE1hcmtkb3duIGxpbmsgcG9saWN5IFx1MjAxNCBtaXJyb3JzIHRoZSBiYWNrZW5kLXZhbGlkYXRlZCB3aWRnZXQgY29uZmlnIHJ1bGVzLlxuLy9cbi8vIENvbnRyYWN0IChiYWNrZW5kLWF1dGhvcml0YXRpdmUsIGVuZm9yY2VkIGFnYWluIGhlcmUgYXQgcmVuZGVyIHRpbWUpOlxuLy8gICAqIGBqYXZhc2NyaXB0OmAgKGFuZCBldmVyeSBub24taHR0cChzKSBzY2hlbWUpIGlzIEFMV0FZUyBibG9ja2VkLlxuLy8gICAqIGBodHRwOmAgaXMgYWxsb3dlZCBvbmx5IHdoZW4gYGFsbG93X2h0dHBgIGlzIG9uIChkZWZhdWx0IGh0dHBzLW9ubHkpLlxuLy8gICAqIGBhbGxvd19hbGxgIHBlcm1pdHMgYW55IGhvc3QgKHNjaGVtZSBydWxlcyBzdGlsbCBhcHBseSkuXG4vLyAgICogT3RoZXJ3aXNlIHRoZSBVUkwncyBob3N0bmFtZSBtdXN0IG1hdGNoIGFuIGFsbG93bGlzdCBlbnRyeS4gRW50cmllcyBhcmVcbi8vICAgICBob3N0bmFtZXMgd2l0aCBhbiBvcHRpb25hbCBgOnBvcnRgLiBBbiBlbnRyeSB3aXRob3V0IGEgcG9ydCBtYXRjaGVzIGFueVxuLy8gICAgIHBvcnQ7IGFuIGVudHJ5IHdpdGggYSBwb3J0IHJlcXVpcmVzIHRoYXQgZXhhY3QgcG9ydC5cbi8vICAgKiBgaW5jbHVkZV93d3dfdmFyaWFudHNgIG1ha2VzIGBleGFtcGxlLmNvbWAgXHUyMUM0IGB3d3cuZXhhbXBsZS5jb21gXG4vLyAgICAgaW50ZXJjaGFuZ2VhYmxlIGluIGJvdGggZGlyZWN0aW9ucy5cblxuZXhwb3J0IGludGVyZmFjZSBMaW5rUG9saWN5IHtcbiAgYWxsb3dfYWxsOiBib29sZWFuO1xuICBhbGxvd2VkX2hvc3RzOiBzdHJpbmdbXTtcbiAgaW5jbHVkZV93d3dfdmFyaWFudHM6IGJvb2xlYW47XG4gIGFsbG93X2h0dHA6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX0xJTktfUE9MSUNZOiBMaW5rUG9saWN5ID0ge1xuICBhbGxvd19hbGw6IGZhbHNlLFxuICBhbGxvd2VkX2hvc3RzOiBbXSxcbiAgaW5jbHVkZV93d3dfdmFyaWFudHM6IHRydWUsXG4gIGFsbG93X2h0dHA6IGZhbHNlLFxufTtcblxuZnVuY3Rpb24gc3BsaXRIb3N0UG9ydChlbnRyeTogc3RyaW5nKTogeyBob3N0OiBzdHJpbmc7IHBvcnQ6IHN0cmluZyB8IG51bGwgfSB7XG4gIGNvbnN0IGlkeCA9IGVudHJ5Lmxhc3RJbmRleE9mKFwiOlwiKTtcbiAgLy8gQSBsb25lIGNvbG9uIG9yIElQdjYtc3R5bGUgZW50cmllcyBhcmUgbm90IHN1cHBvcnRlZCBieSB0aGUgYmFja2VuZFxuICAvLyBob3N0bmFtZSBydWxlLCBzbyBhIHNpbXBsZSBzcGxpdCBpcyBzdWZmaWNpZW50IGhlcmUuXG4gIGlmIChpZHggPiAwICYmIC9eXFxkKyQvLnRlc3QoZW50cnkuc2xpY2UoaWR4ICsgMSkpKSB7XG4gICAgcmV0dXJuIHsgaG9zdDogZW50cnkuc2xpY2UoMCwgaWR4KS50b0xvd2VyQ2FzZSgpLCBwb3J0OiBlbnRyeS5zbGljZShpZHggKyAxKSB9O1xuICB9XG4gIHJldHVybiB7IGhvc3Q6IGVudHJ5LnRvTG93ZXJDYXNlKCksIHBvcnQ6IG51bGwgfTtcbn1cblxuZnVuY3Rpb24gaG9zdE1hdGNoZXMoXG4gIHVybEhvc3Q6IHN0cmluZyxcbiAgZW50cnlIb3N0OiBzdHJpbmcsXG4gIGluY2x1ZGVXd3c6IGJvb2xlYW4sXG4pOiBib29sZWFuIHtcbiAgaWYgKHVybEhvc3QgPT09IGVudHJ5SG9zdCkgcmV0dXJuIHRydWU7XG4gIGlmICghaW5jbHVkZVd3dykgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBzdHJpcCA9IChoOiBzdHJpbmcpID0+IChoLnN0YXJ0c1dpdGgoXCJ3d3cuXCIpID8gaC5zbGljZSg0KSA6IGgpO1xuICByZXR1cm4gc3RyaXAodXJsSG9zdCkgPT09IHN0cmlwKGVudHJ5SG9zdCk7XG59XG5cbi8qKlxuICogRGVjaWRlIHdoZXRoZXIgYSBtYXJrZG93biBsaW5rIG1heSByZW5kZXIgYXMgYSBjbGlja2FibGUgYW5jaG9yLlxuICogRGlzYWxsb3dlZCBsaW5rcyBhcmUgcmVuZGVyZWQgYXMgcGxhaW4gdGV4dCBieSB0aGUgbWFya2Rvd24gcmVuZGVyZXIuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpbmtBbGxvd2VkKGhyZWY6IHN0cmluZywgcG9saWN5OiBMaW5rUG9saWN5KTogYm9vbGVhbiB7XG4gIGxldCB1cmw6IFVSTDtcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKGhyZWYpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7IC8vIHJlbGF0aXZlL21hbGZvcm1lZCBVUkxzIG5ldmVyIHJlbmRlciBhcyBsaW5rc1xuICB9XG4gIGNvbnN0IHNjaGVtZSA9IHVybC5wcm90b2NvbDtcbiAgaWYgKHNjaGVtZSA9PT0gXCJqYXZhc2NyaXB0OlwiKSByZXR1cm4gZmFsc2U7IC8vIGV4cGxpY2l0LCBiZWx0IGFuZCBicmFjZXNcbiAgaWYgKHNjaGVtZSAhPT0gXCJodHRwczpcIiAmJiBzY2hlbWUgIT09IFwiaHR0cDpcIikgcmV0dXJuIGZhbHNlO1xuICBpZiAoc2NoZW1lID09PSBcImh0dHA6XCIgJiYgIXBvbGljeS5hbGxvd19odHRwKSByZXR1cm4gZmFsc2U7XG4gIGlmIChwb2xpY3kuYWxsb3dfYWxsKSByZXR1cm4gdHJ1ZTtcblxuICBjb25zdCB1cmxIb3N0ID0gdXJsLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHVybFBvcnQgPSB1cmwucG9ydDsgLy8gXCJcIiB3aGVuIGRlZmF1bHQgZm9yIHRoZSBzY2hlbWVcbiAgZm9yIChjb25zdCByYXcgb2YgcG9saWN5LmFsbG93ZWRfaG9zdHMpIHtcbiAgICBjb25zdCBlbnRyeSA9IHJhdy50cmltKCk7XG4gICAgaWYgKCFlbnRyeSkgY29udGludWU7XG4gICAgY29uc3QgeyBob3N0LCBwb3J0IH0gPSBzcGxpdEhvc3RQb3J0KGVudHJ5KTtcbiAgICBpZiAoIWhvc3RNYXRjaGVzKHVybEhvc3QsIGhvc3QsIHBvbGljeS5pbmNsdWRlX3d3d192YXJpYW50cykpIGNvbnRpbnVlO1xuICAgIGlmIChwb3J0ID09PSBudWxsKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBlZmZlY3RpdmVQb3J0ID0gdXJsUG9ydCB8fCAoc2NoZW1lID09PSBcImh0dHBzOlwiID8gXCI0NDNcIiA6IFwiODBcIik7XG4gICAgaWYgKGVmZmVjdGl2ZVBvcnQgPT09IHBvcnQpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cbiIsICIvLyBNaW5pbWFsIG1hcmtkb3duIHBhcnNlciBmb3Igd2lkZ2V0IGNoYXQgYnViYmxlcy5cbi8vXG4vLyBEZWxpYmVyYXRlbHkgc21hbGwgKG5vIGRlcGVuZGVuY3kpOiBwYXJhZ3JhcGhzLCBBVFggaGVhZGluZ3MsIGZlbmNlZCBjb2RlXG4vLyBibG9ja3MsIG9yZGVyZWQvdW5vcmRlcmVkIGxpc3RzLCBib2xkL2l0YWxpYy9zdHJpa2V0aHJvdWdoLCBpbmxpbmUgY29kZSxcbi8vIGFuZCBsaW5rcyBnYXRlZCBieSB0aGUgTGlua1BvbGljeS4gVGhlIHBhcnNlciBwcm9kdWNlcyBhIHB1cmUgdHJlZSBcdTIwMTQgdGhlXG4vLyBET00gaXMgYnVpbHQgc2VwYXJhdGVseSBpbiB0aGUgYnJvd3NlciAobmV2ZXIgdmlhIGlubmVySFRNTCksIHNvIHBhcnNpbmcgaXNcbi8vIHVuaXQtdGVzdGFibGUgdW5kZXIgbm9kZSBhbmQgaW5qZWN0aW9uLXNhZmUgYnkgY29uc3RydWN0aW9uLlxuXG5pbXBvcnQgeyBpc0xpbmtBbGxvd2VkLCB0eXBlIExpbmtQb2xpY3kgfSBmcm9tIFwiLi9saW5rLXBvbGljeVwiO1xuXG5leHBvcnQgdHlwZSBNZElubGluZSA9XG4gIHwgeyBraW5kOiBcInRleHRcIjsgdGV4dDogc3RyaW5nIH1cbiAgfCB7IGtpbmQ6IFwic3Ryb25nXCI7IGNoaWxkcmVuOiBNZElubGluZVtdIH1cbiAgfCB7IGtpbmQ6IFwiZW1cIjsgY2hpbGRyZW46IE1kSW5saW5lW10gfVxuICB8IHsga2luZDogXCJkZWxcIjsgY2hpbGRyZW46IE1kSW5saW5lW10gfVxuICB8IHsga2luZDogXCJjb2RlXCI7IHRleHQ6IHN0cmluZyB9XG4gIHwgeyBraW5kOiBcImxpbmtcIjsgaHJlZjogc3RyaW5nOyBjaGlsZHJlbjogTWRJbmxpbmVbXTsgYWxsb3dlZDogYm9vbGVhbiB9O1xuXG5leHBvcnQgdHlwZSBNZEJsb2NrID1cbiAgfCB7IGtpbmQ6IFwicGFyYWdyYXBoXCI7IGNoaWxkcmVuOiBNZElubGluZVtdIH1cbiAgfCB7IGtpbmQ6IFwiaGVhZGluZ1wiOyBsZXZlbDogbnVtYmVyOyBjaGlsZHJlbjogTWRJbmxpbmVbXSB9XG4gIHwgeyBraW5kOiBcImNvZGVfYmxvY2tcIjsgbGFuZzogc3RyaW5nOyB0ZXh0OiBzdHJpbmcgfVxuICB8IHsga2luZDogXCJsaXN0XCI7IG9yZGVyZWQ6IGJvb2xlYW47IGl0ZW1zOiBNZElubGluZVtdW10gfTtcblxuLyoqIFBhcnNlIG1hcmtkb3duIGludG8gYSByZW5kZXIgdHJlZS4gTGlua3MgY2FycnkgYW4gYGFsbG93ZWRgIHZlcmRpY3QuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VNYXJrZG93bihzcmM6IHN0cmluZywgcG9saWN5OiBMaW5rUG9saWN5KTogTWRCbG9ja1tdIHtcbiAgY29uc3QgYmxvY2tzOiBNZEJsb2NrW10gPSBbXTtcbiAgY29uc3QgbGluZXMgPSBzcmMucmVwbGFjZSgvXFxyXFxuPy9nLCBcIlxcblwiKS5zcGxpdChcIlxcblwiKTtcbiAgbGV0IGkgPSAwO1xuXG4gIHdoaWxlIChpIDwgbGluZXMubGVuZ3RoKSB7XG4gICAgY29uc3QgbGluZSA9IGxpbmVzW2ldID8/IFwiXCI7XG5cbiAgICBpZiAobGluZS50cmltKCkgPT09IFwiXCIpIHtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIEZlbmNlZCBjb2RlIGJsb2NrLlxuICAgIGNvbnN0IGZlbmNlID0gbGluZS5tYXRjaCgvXmBgYChbQS1aYS16MC05KyMuXy1dKilcXHMqJC8pO1xuICAgIGlmIChmZW5jZSkge1xuICAgICAgY29uc3QgbGFuZyA9IChmZW5jZVsxXSA/PyBcIlwiKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgYm9keTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIHdoaWxlIChpIDwgbGluZXMubGVuZ3RoICYmICEvXmBgYFxccyokLy50ZXN0KGxpbmVzW2ldID8/IFwiXCIpKSB7XG4gICAgICAgIGJvZHkucHVzaChsaW5lc1tpXSA/PyBcIlwiKTtcbiAgICAgICAgaSArPSAxO1xuICAgICAgfVxuICAgICAgaSArPSAxOyAvLyBjb25zdW1lIGNsb3NpbmcgZmVuY2UgKG9yIEVPRilcbiAgICAgIGJsb2Nrcy5wdXNoKHsga2luZDogXCJjb2RlX2Jsb2NrXCIsIGxhbmcsIHRleHQ6IGJvZHkuam9pbihcIlxcblwiKSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIEFUWCBoZWFkaW5nLlxuICAgIGNvbnN0IGhlYWRpbmcgPSBsaW5lLm1hdGNoKC9eKCN7MSw0fSlcXHMrKC4qKSQvKTtcbiAgICBpZiAoaGVhZGluZykge1xuICAgICAgYmxvY2tzLnB1c2goe1xuICAgICAgICBraW5kOiBcImhlYWRpbmdcIixcbiAgICAgICAgbGV2ZWw6IChoZWFkaW5nWzFdID8/IFwiI1wiKS5sZW5ndGgsXG4gICAgICAgIGNoaWxkcmVuOiBwYXJzZUlubGluZShoZWFkaW5nWzJdID8/IFwiXCIsIHBvbGljeSksXG4gICAgICB9KTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIExpc3QgKHVub3JkZXJlZCBvciBvcmRlcmVkKSBcdTIwMTQgY29uc2VjdXRpdmUgaXRlbSBsaW5lcy5cbiAgICBjb25zdCBsaXN0SXRlbSA9IG1hdGNoTGlzdEl0ZW0obGluZSk7XG4gICAgaWYgKGxpc3RJdGVtKSB7XG4gICAgICBjb25zdCBvcmRlcmVkID0gbGlzdEl0ZW0ub3JkZXJlZDtcbiAgICAgIGNvbnN0IGl0ZW1zOiBNZElubGluZVtdW10gPSBbXTtcbiAgICAgIHdoaWxlIChpIDwgbGluZXMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IG0gPSBtYXRjaExpc3RJdGVtKGxpbmVzW2ldID8/IFwiXCIpO1xuICAgICAgICBpZiAoIW0gfHwgbS5vcmRlcmVkICE9PSBvcmRlcmVkKSBicmVhaztcbiAgICAgICAgaXRlbXMucHVzaChwYXJzZUlubGluZShtLnRleHQsIHBvbGljeSkpO1xuICAgICAgICBpICs9IDE7XG4gICAgICB9XG4gICAgICBibG9ja3MucHVzaCh7IGtpbmQ6IFwibGlzdFwiLCBvcmRlcmVkLCBpdGVtcyB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIFBhcmFncmFwaDogZ2F0aGVyIHVudGlsIGJsYW5rIGxpbmUgb3IgYSBzdHJ1Y3R1cmFsIGxpbmUuXG4gICAgY29uc3QgcGFyYTogc3RyaW5nW10gPSBbbGluZV07XG4gICAgaSArPSAxO1xuICAgIHdoaWxlIChpIDwgbGluZXMubGVuZ3RoKSB7XG4gICAgICBjb25zdCBuZXh0ID0gbGluZXNbaV0gPz8gXCJcIjtcbiAgICAgIGlmIChcbiAgICAgICAgbmV4dC50cmltKCkgPT09IFwiXCIgfHxcbiAgICAgICAgL15gYGAvLnRlc3QobmV4dCkgfHxcbiAgICAgICAgL14jezEsNH1cXHMvLnRlc3QobmV4dCkgfHxcbiAgICAgICAgbWF0Y2hMaXN0SXRlbShuZXh0KVxuICAgICAgKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgcGFyYS5wdXNoKG5leHQpO1xuICAgICAgaSArPSAxO1xuICAgIH1cbiAgICBibG9ja3MucHVzaCh7IGtpbmQ6IFwicGFyYWdyYXBoXCIsIGNoaWxkcmVuOiBwYXJzZUlubGluZShwYXJhLmpvaW4oXCJcXG5cIiksIHBvbGljeSkgfSk7XG4gIH1cblxuICByZXR1cm4gYmxvY2tzO1xufVxuXG5mdW5jdGlvbiBtYXRjaExpc3RJdGVtKFxuICBsaW5lOiBzdHJpbmcsXG4pOiB7IG9yZGVyZWQ6IGJvb2xlYW47IHRleHQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gIGNvbnN0IHVsID0gbGluZS5tYXRjaCgvXlxcc3swLDN9Wy0qK11cXHMrKC4qKSQvKTtcbiAgaWYgKHVsKSByZXR1cm4geyBvcmRlcmVkOiBmYWxzZSwgdGV4dDogdWxbMV0gPz8gXCJcIiB9O1xuICBjb25zdCBvbCA9IGxpbmUubWF0Y2goL15cXHN7MCwzfVxcZHsxLDl9Wy4pXVxccysoLiopJC8pO1xuICBpZiAob2wpIHJldHVybiB7IG9yZGVyZWQ6IHRydWUsIHRleHQ6IG9sWzFdID8/IFwiXCIgfTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiBQYXJzZSBpbmxpbmUgbWFya2Rvd24uIEV4cG9ydGVkIGZvciB0ZXN0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUlubGluZShzcmM6IHN0cmluZywgcG9saWN5OiBMaW5rUG9saWN5KTogTWRJbmxpbmVbXSB7XG4gIGNvbnN0IG91dDogTWRJbmxpbmVbXSA9IFtdO1xuICBsZXQgcmVzdCA9IHNyYztcblxuICBjb25zdCBwdXNoVGV4dCA9ICh0OiBzdHJpbmcpID0+IHtcbiAgICBpZiAodCA9PT0gXCJcIikgcmV0dXJuO1xuICAgIGNvbnN0IGxhc3QgPSBvdXRbb3V0Lmxlbmd0aCAtIDFdO1xuICAgIGlmIChsYXN0ICYmIGxhc3Qua2luZCA9PT0gXCJ0ZXh0XCIpIGxhc3QudGV4dCArPSB0O1xuICAgIGVsc2Ugb3V0LnB1c2goeyBraW5kOiBcInRleHRcIiwgdGV4dDogdCB9KTtcbiAgfTtcblxuICB3aGlsZSAocmVzdC5sZW5ndGggPiAwKSB7XG4gICAgLy8gSW5saW5lIGNvZGUgXHUyMDE0IGVhcmxpZXN0IHNwZWNpYWwgZmlyc3Q7IGNvZGUgd2lucyBvdmVyIGVtcGhhc2lzIGluc2lkZSBpdC5cbiAgICBjb25zdCBwYXR0ZXJuczogQXJyYXk8eyBpbmRleDogbnVtYmVyOyBydW46ICgpID0+IHZvaWQ7IGxlbjogbnVtYmVyIH0+ID0gW107XG5cbiAgICBjb25zdCBjb2RlID0gcmVzdC5tYXRjaCgvYChbXmBcXG5dKylgLyk7XG4gICAgaWYgKGNvZGUgJiYgY29kZS5pbmRleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKHtcbiAgICAgICAgaW5kZXg6IGNvZGUuaW5kZXgsXG4gICAgICAgIGxlbjogY29kZVswXS5sZW5ndGgsXG4gICAgICAgIHJ1bjogKCkgPT4gb3V0LnB1c2goeyBraW5kOiBcImNvZGVcIiwgdGV4dDogY29kZVsxXSA/PyBcIlwiIH0pLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgbGluayA9IHJlc3QubWF0Y2goL1xcWyhbXlxcXVxcbl0qKVxcXVxcKChbXilcXHNdKylcXCkvKTtcbiAgICBpZiAobGluayAmJiBsaW5rLmluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGhyZWYgPSBsaW5rWzJdID8/IFwiXCI7XG4gICAgICBjb25zdCBsYWJlbCA9IGxpbmtbMV0gPz8gXCJcIjtcbiAgICAgIHBhdHRlcm5zLnB1c2goe1xuICAgICAgICBpbmRleDogbGluay5pbmRleCxcbiAgICAgICAgbGVuOiBsaW5rWzBdLmxlbmd0aCxcbiAgICAgICAgcnVuOiAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgYWxsb3dlZCA9IGlzTGlua0FsbG93ZWQoaHJlZiwgcG9saWN5KTtcbiAgICAgICAgICBvdXQucHVzaCh7XG4gICAgICAgICAgICBraW5kOiBcImxpbmtcIixcbiAgICAgICAgICAgIGhyZWYsXG4gICAgICAgICAgICBjaGlsZHJlbjogcGFyc2VJbmxpbmUobGFiZWwsIHBvbGljeSksXG4gICAgICAgICAgICBhbGxvd2VkLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3Qgc3Ryb25nID0gcmVzdC5tYXRjaCgvXFwqXFwqKFteKlxcbl0rKVxcKlxcKnxfXyhbXl9cXG5dKylfXy8pO1xuICAgIGlmIChzdHJvbmcgJiYgc3Ryb25nLmluZGV4ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGlubmVyID0gc3Ryb25nWzFdID8/IHN0cm9uZ1syXSA/PyBcIlwiO1xuICAgICAgcGF0dGVybnMucHVzaCh7XG4gICAgICAgIGluZGV4OiBzdHJvbmcuaW5kZXgsXG4gICAgICAgIGxlbjogc3Ryb25nWzBdLmxlbmd0aCxcbiAgICAgICAgcnVuOiAoKSA9PlxuICAgICAgICAgIG91dC5wdXNoKHsga2luZDogXCJzdHJvbmdcIiwgY2hpbGRyZW46IHBhcnNlSW5saW5lKGlubmVyLCBwb2xpY3kpIH0pLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZW0gPSByZXN0Lm1hdGNoKC8oPzwhWypcXHddKVxcKihbXipcXG5dKylcXCooPyFcXCopfCg/PCFbX1xcd10pXyhbXl9cXG5dKylfKD8hXykvKTtcbiAgICBpZiAoZW0gJiYgZW0uaW5kZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgaW5uZXIgPSBlbVsxXSA/PyBlbVsyXSA/PyBcIlwiO1xuICAgICAgcGF0dGVybnMucHVzaCh7XG4gICAgICAgIGluZGV4OiBlbS5pbmRleCxcbiAgICAgICAgbGVuOiBlbVswXS5sZW5ndGgsXG4gICAgICAgIHJ1bjogKCkgPT4gb3V0LnB1c2goeyBraW5kOiBcImVtXCIsIGNoaWxkcmVuOiBwYXJzZUlubGluZShpbm5lciwgcG9saWN5KSB9KSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGRlbCA9IHJlc3QubWF0Y2goL35+KFteflxcbl0rKX5+Lyk7XG4gICAgaWYgKGRlbCAmJiBkZWwuaW5kZXggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0dGVybnMucHVzaCh7XG4gICAgICAgIGluZGV4OiBkZWwuaW5kZXgsXG4gICAgICAgIGxlbjogZGVsWzBdLmxlbmd0aCxcbiAgICAgICAgcnVuOiAoKSA9PlxuICAgICAgICAgIG91dC5wdXNoKHsga2luZDogXCJkZWxcIiwgY2hpbGRyZW46IHBhcnNlSW5saW5lKGRlbFsxXSA/PyBcIlwiLCBwb2xpY3kpIH0pLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHBhdHRlcm5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcHVzaFRleHQocmVzdCk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgcGF0dGVybnMuc29ydCgoYSwgYikgPT4gYS5pbmRleCAtIGIuaW5kZXgpO1xuICAgIGNvbnN0IGZpcnN0ID0gcGF0dGVybnNbMF0hO1xuICAgIHB1c2hUZXh0KHJlc3Quc2xpY2UoMCwgZmlyc3QuaW5kZXgpKTtcbiAgICBmaXJzdC5ydW4oKTtcbiAgICByZXN0ID0gcmVzdC5zbGljZShmaXJzdC5pbmRleCArIGZpcnN0Lmxlbik7XG4gIH1cblxuICByZXR1cm4gb3V0O1xufVxuXG4vKipcbiAqIFN0cmlwIHZlbmRvci1zdHlsZSBhdWRpbyB0YWdzIFx1MjAxNCBicmFja2V0ZWQgY3VlcyBsaWtlIGBbbGF1Z2hzXWAgb3JcbiAqIGBbd2hpc3BlcmluZ11gIFx1MjAxNCBmcm9tIHRyYW5zY3JpcHQgdGV4dCB3aGVuIGBoaWRlX2F1ZGlvX3RhZ3NgIGlzIGVuYWJsZWQuXG4gKiBNYXJrZG93biBsaW5rcyAoYFt0ZXh0XSh1cmwpYCkgYXJlIHByZXNlcnZlZDogb25seSBgWy4uLl1gIE5PVCBmb2xsb3dlZCBieVxuICogYChgIGlzIHRyZWF0ZWQgYXMgYW4gYXVkaW8gdGFnLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBBdWRpb1RhZ3ModGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHRcbiAgICAucmVwbGFjZSgvXFxbW15cXF1bXFxuXXsxLDYwfVxcXSg/IVxcKCkvZywgXCJcIilcbiAgICAucmVwbGFjZSgvIHsyLH0vZywgXCIgXCIpXG4gICAgLnJlcGxhY2UoL14gK3wgKyQvZ20sIFwiXCIpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLE9BQU8sVUFBVTtBQUNqQixPQUFPLFlBQVk7OztBQ2tCWixJQUFNLHNCQUFrQztBQUFBLEVBQzdDLFdBQVc7QUFBQSxFQUNYLGVBQWUsQ0FBQztBQUFBLEVBQ2hCLHNCQUFzQjtBQUFBLEVBQ3RCLFlBQVk7QUFDZDtBQUVBLFNBQVMsY0FBYyxPQUFzRDtBQUMzRSxRQUFNLE1BQU0sTUFBTSxZQUFZLEdBQUc7QUFHakMsTUFBSSxNQUFNLEtBQUssUUFBUSxLQUFLLE1BQU0sTUFBTSxNQUFNLENBQUMsQ0FBQyxHQUFHO0FBQ2pELFdBQU8sRUFBRSxNQUFNLE1BQU0sTUFBTSxHQUFHLEdBQUcsRUFBRSxZQUFZLEdBQUcsTUFBTSxNQUFNLE1BQU0sTUFBTSxDQUFDLEVBQUU7QUFBQSxFQUMvRTtBQUNBLFNBQU8sRUFBRSxNQUFNLE1BQU0sWUFBWSxHQUFHLE1BQU0sS0FBSztBQUNqRDtBQUVBLFNBQVMsWUFDUCxTQUNBLFdBQ0EsWUFDUztBQUNULE1BQUksWUFBWSxVQUFXLFFBQU87QUFDbEMsTUFBSSxDQUFDLFdBQVksUUFBTztBQUN4QixRQUFNLFFBQVEsQ0FBQyxNQUFlLEVBQUUsV0FBVyxNQUFNLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtBQUNsRSxTQUFPLE1BQU0sT0FBTyxNQUFNLE1BQU0sU0FBUztBQUMzQztBQU1PLFNBQVMsY0FBYyxNQUFjLFFBQTZCO0FBQ3ZFLE1BQUk7QUFDSixNQUFJO0FBQ0Ys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

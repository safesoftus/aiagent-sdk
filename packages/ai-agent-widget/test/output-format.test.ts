import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_OUTPUT_FORMAT,
  outputFormatFromFrame,
  renderAgentText,
  type AgentBubble,
} from "../src/output-format";

// Agent behavior panel §7.6: the Widget row's Output format reaches the
// embedded widget through the leading chat `session` frame. Plain text must
// render the agent's reply literally; markdown keeps today's renderer; the
// voice transcript never follows the chat setting.

const RAW = "**bold** and a list:\n- one\n- two";

function stubBubble(): AgentBubble & { appended: Node[] } {
  const appended: Node[] = [];
  return {
    textContent: null,
    appended,
    append(node: Node) {
      appended.push(node);
    },
  };
}

/** A renderer stub — records the text it was asked to render. */
function stubMarkdown(): { render: (text: string) => Node; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    render(text) {
      calls.push(text);
      return { rendered: text } as unknown as Node;
    },
  };
}

test("the session frame's output_format is read; missing or unknown keeps today's markdown", () => {
  assert.equal(outputFormatFromFrame("plain_text"), "plain_text");
  assert.equal(outputFormatFromFrame("markdown"), "markdown");
  assert.equal(outputFormatFromFrame(undefined), "markdown");
  assert.equal(outputFormatFromFrame(null), "markdown");
  assert.equal(outputFormatFromFrame("html"), "markdown");
  assert.equal(outputFormatFromFrame(42), "markdown");
  assert.equal(DEFAULT_OUTPUT_FORMAT, "markdown");
});

test("a markdown session renders the agent bubble through the markdown renderer", () => {
  const bubble = stubBubble();
  const md = stubMarkdown();
  renderAgentText(bubble, RAW, "markdown", md.render);
  assert.deepEqual(md.calls, [RAW]);
  assert.equal(bubble.appended.length, 1);
  assert.equal(bubble.textContent, null);
});

test("a plain_text session renders the agent bubble literally — the renderer is never called", () => {
  const bubble = stubBubble();
  const md = stubMarkdown();
  renderAgentText(bubble, RAW, "plain_text", md.render);
  assert.deepEqual(md.calls, []);
  assert.equal(bubble.appended.length, 0);
  // Asterisks and dashes stay exactly as the model wrote them.
  assert.equal(bubble.textContent, RAW);
});

test("the same reply switches rendering with the session's format, nothing else", () => {
  const plain = stubBubble();
  const rich = stubBubble();
  const md = stubMarkdown();
  renderAgentText(plain, RAW, outputFormatFromFrame("plain_text"), md.render);
  renderAgentText(rich, RAW, outputFormatFromFrame("markdown"), md.render);
  assert.equal(plain.textContent, RAW);
  assert.equal(rich.appended.length, 1);
  assert.deepEqual(md.calls, [RAW]);
});

// Drift guard over the widget source: every agent bubble renders through
// renderAgentText, the markdown renderer is reached only via the shared
// markdownNode helper, and the voice transcript pins "markdown" so a
// plain_text CHAT session cannot change how a voice transcript renders.
test("every widget agent-bubble render goes through renderAgentText and the voice transcript pins markdown", () => {
  const src = readFileSync(new URL("../src/widget.ts", import.meta.url), "utf8");
  const count = (needle: string) => src.split(needle).length - 1;

  // Two bubble sites: appendMessage's agent branch + finishStreamBubble.
  assert.equal(count("renderAgentText("), 2, "agent-bubble render sites must call renderAgentText");
  // renderMarkdown is called from markdownNode only (the import line is not a call).
  assert.equal(count("renderMarkdown(parseMarkdown("), 1, "renderMarkdown must be reached only through markdownNode");
  assert.match(src, /private markdownNode\(text: string\): Node \{\n\s*return renderMarkdown\(parseMarkdown\(/);
  // The streamed turn re-renders with the session's format.
  assert.match(src, /renderAgentText\(bubble, display, this\.chatOutputFormat,/);
  // Voice transcripts: explicit markdown, never the chat session's format.
  assert.match(src, /this\.appendMessage\(role, text, "markdown"\)/);
  // The chat session frame is the ONLY writer of the format (plus the new-session reset).
  assert.match(src, /case "session":[\s\S]{0,400}this\.chatOutputFormat = outputFormatFromFrame\(event\.output_format\)/);
  assert.equal(count("this.chatOutputFormat = "), 2, "format writers: the session frame + the startChat reset");
  assert.match(src, /this\.chatOutputFormat = DEFAULT_OUTPUT_FORMAT;/);
});

test("a voice transcript after a plain_text chat session still renders markdown", () => {
  // The widget passes "markdown" explicitly on the voice path (guarded above);
  // this pins the rendering that call produces even when the chat format is plain.
  const chatFormat = outputFormatFromFrame("plain_text");
  assert.equal(chatFormat, "plain_text");
  const voiceBubble = stubBubble();
  const md = stubMarkdown();
  renderAgentText(voiceBubble, RAW, "markdown", md.render);
  assert.deepEqual(md.calls, [RAW]);
  assert.equal(voiceBubble.textContent, null);
});

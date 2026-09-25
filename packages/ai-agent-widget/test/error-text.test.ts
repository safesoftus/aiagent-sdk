import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// VOSO-754 D21 — "text sent to a person": the widget never renders a
// server body, an SSE `error.message` or an exception text to the visitor.
// Source-level drift test over widget.ts: every error bubble is a
// configured (per-language) text.

const widgetSource = readFileSync(new URL("../src/widget.ts", import.meta.url), "utf8");

test("every error bubble renders a configured text, never a raw message", () => {
  const renders = [...widgetSource.matchAll(/appendMessage\(\s*"error",\s*([\s\S]*?)\)\s*;/g)];
  assert.ok(renders.length >= 4, `expected the error render sites, found ${renders.length}`);
  for (const [, argument] of renders) {
    const text = (argument ?? "").trim();
    const localized = text.startsWith("this.text(") || text.startsWith("`${this.text(");
    assert.ok(localized, `error bubble renders a non-configured text: ${text}`);
  }
});

test("no HTTP error body or SSE error message reaches appendMessage", () => {
  assert.doesNotMatch(widgetSource, /appendMessage\([^)]*err\.message/);
  assert.doesNotMatch(widgetSource, /appendMessage\([^)]*event\.message/);
  assert.doesNotMatch(widgetSource, /appendActionIndicatorOnError\([^)]*\)\s*\{\s*this\.appendMessage\("error",\s*message/);
});

test("the raw detail is kept for the embedding developer on the console", () => {
  assert.match(widgetSource, /console\.debug\("\[voso-widget\] error", detail\)/);
  // The five WidgetApiError sites and the SSE frame all funnel through showError.
  const funnelled = widgetSource.match(/this\.showError\(/g) ?? [];
  assert.ok(funnelled.length >= 5, `showError call sites: ${funnelled.length}`);
});

test("the billing-hold 402 sentence is the only server text shown, and only as the agent bubble", () => {
  const helper = widgetSource.match(/export function billingHoldSentence\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(helper, /err\.status !== 402\) return null/);
  const uses = widgetSource.match(/billingHoldSentence\(/g) ?? [];
  assert.equal(uses.length, 2, "one definition + one call site (the voice mint)");
  assert.match(widgetSource, /const hold = billingHoldSentence\(err\);\s*if \(hold\) \{[\s\S]*?this\.appendMessage\("agent", hold\);/);
});

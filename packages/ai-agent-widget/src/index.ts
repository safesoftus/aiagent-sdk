// Entry point: register the widget element under both names exactly once.
//
// Embed snippet (HOST = your vosopulse-api origin):
//
//   <voso-widget agent-id="AGENT_PUBLIC_ID"></voso-widget>
//   <script src="https://HOST/widget.js" async type="text/javascript"></script>
//
// `<convoso-widget>` is the same element under the new name (E4 Q7). The
// same-host bundle (dist/widget.js) derives its API origin from the script's
// own src; the npm / CDN bundle (dist/index.js, E4 Q8) defaults to the
// production API. The dashboard's settings live preview imports this module
// directly and overrides the origin via the element's `server-url` attribute.

import { VosoWidgetElement } from "./widget";

export { VosoWidgetElement };
export type { WidgetCallConfig } from "./widget";

/** The tags the bundle registers on load (E4 Q7). */
export const WIDGET_TAGS = ["voso-widget", "convoso-widget"] as const;

/**
 * Register the element under `tagName` (the vendor's `registerWidget`). A
 * custom-element constructor backs exactly one tag, so every tag after
 * `voso-widget` gets an EMPTY subclass — the same element, drift-tested.
 * Already-registered tags are left alone.
 */
export function registerWidget(tagName: string = "voso-widget"): void {
  if (typeof window === "undefined" || !("customElements" in window)) return;
  if (customElements.get(tagName)) return;
  customElements.define(
    tagName,
    tagName === "voso-widget" ? VosoWidgetElement : class extends VosoWidgetElement {},
  );
}

for (const tag of WIDGET_TAGS) registerWidget(tag);

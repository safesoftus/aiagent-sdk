# Embed widget — `<voso-widget>` / `@convoso/ai-agent-widget`

A voice + chat button for any website: one custom element and one script tag. The element renders
inside its own shadow root, so the page's CSS does not leak in.

## 1. Install

**Standard (default).** Agent → **Deploy** → **Channels** → **Widget** → **Setup** shows the snippet
with your widget id filled in:

```html
<voso-widget agent-id="wgt_<32 hex>"></voso-widget>
<script src="https://aiagent-api.convoso.com/widget.js" async type="text/javascript"></script>
```

The script is served by our api and takes its api origin from its own `src`. Every existing embed keeps
working unchanged.

**npm / CDN (after the first publish, Q8).** Once `@convoso/ai-agent-widget` is published the Setup
section gains an **npm / CDN** tab:

```html
<voso-widget agent-id="wgt_<32 hex>" server-url="https://aiagent-api.convoso.com"></voso-widget>
<script src="https://unpkg.com/@convoso/ai-agent-widget" async type="text/javascript"></script>
```

A CDN copy cannot derive the api origin from its `src`, so the snippet names it in `server-url`.
From npm: `npm install @convoso/ai-agent-widget`, then `import { registerWidget } from
"@convoso/ai-agent-widget"; registerWidget();`.

The element is registered under both `<voso-widget>` and `<convoso-widget>` (Q7) — same element;
`registerWidget("my-tag")` registers a name of your choice.

## 2. Quickstart

1. Turn the widget on (Widget tab → **Widget enabled**) and add your site's hostname to the allowlist.
2. Paste the snippet before `</body>`.
3. Open the page, click the button, **Start a call**, allow the microphone.

## 3. API — attributes

| Attribute | Value |
|---|---|
| `agent-id` | **Required.** The widget public id `wgt_<32 hex>` (Q15: the element keeps the public id; the SDK packages take the agent uuid). |
| `server-url` | API origin override. Default: the origin the script was loaded from. |
| `overrides` | JSON of per-conversation overrides (only the keys the agent's **Security** settings allow). |
| `dynamic-variables` | JSON object of dynamic variables for the conversation. |
| `show-agent-status` | `"true"` shows the agent's speaking / listening status (Q9). |
| `show-resize-button` | `"true"` shows the expand / shrink button (Q9). |
| `show-language-selector-on-trigger` | `"true"` shows the language picker on the collapsed button (Q9). |
| `show-avatar-when-collapsed` | `"true"` shows the avatar on the collapsed button (Q9). |
| `text-contents` | JSON of UI text overrides. Vendor key names are mapped to ours; unknown keys are ignored (Q25). |
| `allow-events` | `"true"` lets page scripts steer the conversation (§4). Off by default. |

Everything else (colours, avatar, feedback, languages, terms) comes from the Widget tab.

## 4. Callbacks — events

**Before every call** the element dispatches `voso-widget:call` (bubbles, crosses the shadow boundary)
with `detail.config`; change it in place to add client tools (§5) or overrides:

```js
document.addEventListener("voso-widget:call", (event) => {
  event.detail.config.clientTools = { showProduct: ({ sku }) => openProductPanel(sku) };
});
```

**Inbound events** (only with `allow-events="true"`, Q22), dispatched on the element:

| Event | `detail` | Does |
|---|---|---|
| `voso-widget:user-message` | `{ message }` | Sends a typed user turn. |
| `voso-widget:user-activity` | — | Tells the agent the user is active. |
| `voso-widget:contextual-update` | `{ message }` | Background note for the agent's next reply. |

`voso-widget:expand` with `detail.action` = `"expand"`, `"collapse"` or `"toggle"` opens or closes the
widget from the page (on `document` or the element; UI only, always allowed — Q30).

## 5. Client tools

Add them in the `voso-widget:call` listener (above). The agent calls the tool by name during the call
and hears the return value; a throw answers with an error.

## 6. Differences from the vendor widget (stated)

- **Voice transport:** WebRTC always (the vendor defaults to WebSocket).
- **Microphone processing (Q21):** echo cancellation ON; noise suppression and automatic gain control
  OFF.
- **Network loss (Q24):** no reconnect yet — the call ends with an error line when the connection fails.
- **Id (Q15):** the element takes the widget public id (`wgt_…`); the SDK packages take the agent uuid.
- **Visitor id (Q10):** one random id kept in `localStorage`; no browser fingerprinting.

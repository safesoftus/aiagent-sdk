# @convoso/ai-agent-widget

The embeddable Convoso AI agent widget: a voice + chat button for any website, one custom element and
one script tag. No framework, shadow-DOM isolated, zero runtime dependencies. MIT licensed.

> Not published yet: publishing waits for the `@convoso` npm org (E4 publish gate). Today the same
> bundle is served by the api at `/widget.js` — copy the snippet from the dashboard's Widget tab.

```html
<voso-widget agent-id="wgt_<32 hex>"></voso-widget>
<script src="https://aiagent-api.convoso.com/widget.js" async type="text/javascript"></script>
```

After the first publish, from the CDN (the api origin is named because a CDN copy cannot derive it):

```html
<voso-widget agent-id="wgt_<32 hex>" server-url="https://aiagent-api.convoso.com"></voso-widget>
<script src="https://unpkg.com/@convoso/ai-agent-widget" async type="text/javascript"></script>
```

## Differences from the vendor widget (stated)

- **Microphone processing (Q21):** echo cancellation ON; browser noise suppression and automatic gain
  control OFF.
- **Network loss (Q24):** no reconnect yet — the call ends with an error line when the connection fails.
- **Tool approvals / error status on hooks (Q28):** applies to the React packages; the element has no
  status API.
- **Id (Q15):** the element takes the widget public id (`wgt_…`) exactly as before; the SDK packages
  (`@convoso/ai-agent`, `-react`, `-react-native`) take the agent uuid. **Migration:** apps built on the
  interim mobile guide with a `wgt_…` id switch to the agent uuid when they move to the SDK.

Full guide (attributes, events, client tools):
[`docs/guides/sdk-widget.md`](https://github.com/safesoftus/aiagent-sdk/blob/main/docs/sdk-widget.md).

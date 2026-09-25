# JavaScript SDK — `@convoso/ai-agent`

Start a voice or text conversation with a Convoso AI agent from a browser app. The package is the
client half of the same WebRTC path the dashboard's **Test your agent** and the embedded widget use.

> **Published on npm.** Source, issues and releases live in the public repo
> [safesoftus/aiagent-sdk](https://github.com/safesoftus/aiagent-sdk).

Plan and owner rulings: `docs/plans/agent-integration/E4-sdks.plan.md` §8a. React: [`sdk-react.md`](sdk-react.md).
React Native: [`sdk-react-native.md`](sdk-react-native.md). Embed widget: [`sdk-widget.md`](sdk-widget.md).

## 1. Install

```bash
npm install @convoso/ai-agent
```

Zero runtime dependencies. ESM build (`dist/index.js`) plus a browser global build (`dist/lib.iife.js`,
the package's `unpkg` file). MIT licensed.

## 2. Quickstart

```ts
import { Conversation } from "@convoso/ai-agent";

// Ask for the microphone first so the browser prompt shows before the call starts.
await navigator.mediaDevices.getUserMedia({ audio: true });

const conversation = await Conversation.startSession({
  agentId: "<agent uuid>",
  onConnect: ({ conversationId }) => console.log("Connected", conversationId),
  onMessage: ({ role, message }) => console.log(role, message),
  onDisconnect: (details) => console.log("Ended", details.reason),
  onError: (message) => console.error(message),
});

// …later
await conversation.endSession();
```

### Public agent or private agent

| Agent | How the browser starts | What you pass |
|---|---|---|
| Public (Agent → **Settings** → **Security** → public access on) | the SDK asks our api for a one-time conversation token itself | `agentId` |
| Private | **your server** asks for the token with your API key, then hands it to the browser | `conversationToken` |

Your server's call for a private agent:

```bash
curl -s "https://aiagent-api.convoso.com/v1/convai/conversation/token?agent_id=<agent uuid>" \
  -H "Authorization: Bearer <your API key>"
# → {"token":"cvsig_…","conversation_id":"conv_…","signaling_url":"…/api/offer","ice_servers":[…]}
```

Hand the browser the whole response and pass all three values — the offer goes to `signaling_url`, and
`ice_servers` carries the relay (TURN) servers that callers behind strict networks need:

```ts
const { token, signaling_url, ice_servers } = await fetch("/my-server/voso-token").then((r) => r.json());
const conversation = await Conversation.startSession({
  conversationToken: token,
  signalingUrl: signaling_url,
  iceServers: ice_servers,
});
```

A token re-joins the **same** conversation for 15 minutes after its first use while that conversation
is live (owner ruling Q29). The re-join is a fresh session: the agent greets again, and the earlier
part's transcript is not merged into the new part.

### Text only

```ts
const chat = await Conversation.startSession({ agentId: "<agent uuid>", textOnly: true });
chat.sendUserMessage("Hello!");
```

`textOnly: true` runs over the same WebRTC data channel with no microphone (Q19). The root-level
`textOnly` wins over `overrides.conversation.textOnly` (Q26); a disagreement logs a console warning.

> Until VOSO-807 lands, the server still runs the voice pipeline behind a text-only WebRTC session (speech is synthesised and discarded by the client). The E4-b WebSocket transport is the text-native path.

## 3. API

`Conversation.startSession(config)` resolves once the agent is ready and returns a
`VoiceConversation` (default) or a `TextConversation` (`textOnly: true`).

### Session config

| Option | Type | Notes |
|---|---|---|
| `agentId` | `string` | The **agent uuid** (dashed or not) — see "Agent id" below. One of `agentId` / `conversationToken`. |
| `conversationToken` | `string` | Minted by your server (above). |
| `signedUrl` | `string` | WebSocket transport — arrives with E4-b; today it throws `SessionConnectionError`. |
| `origin` | `string` | API origin. Default `https://aiagent-api.convoso.com`; staging `https://aiagent-api-stage.convoso.com`. |
| `authorization` | `string` | Sent as `Authorization: Bearer …` on the token request. |
| `signalingUrl` | `string` | Where the offer is sent. With `conversationToken`, pass the token response's `signaling_url`. |
| `iceServers` | `{urls, username?, credential?}[]` | With `conversationToken`, pass the token response's `ice_servers`. |
| `textOnly` | `boolean` | Text session over the data channel. |
| `clientTools` | `Record<string, (params) => …>` | See §5. |
| `overrides`, `dynamicVariables`, `userId` | | Typed now; not forwarded on the WebRTC token path yet — reported once through `onDebug({type:"ignored_options"})`, never thrown. |
| `connectionType` | `"webrtc" \| "websocket"` | `"websocket"` arrives with E4-b. |

### Methods (both conversation kinds)

| Method | Does |
|---|---|
| `endSession()` | Ends the call (no-op unless connecting or connected). |
| `getId()` | The conversation id (`conv_…`). |
| `isOpen()` | `true` while connected. |
| `sendUserMessage(text)` | A typed user turn (the agent answers; interrupts it if speaking). |
| `sendContextualUpdate(text, { contextId? })` | Background note for the agent's next reply; no turn. |
| `sendUserActivity()` | Tells the agent the user is active (holds back a "are you there?" prompt). |
| `sendFeedback(like, eventId?)` | Thumbs up (`true`) / down (`false`) for an agent reply. |
| `sendMCPToolApprovalResult(toolCallId, isApproved)` | Answer an MCP tool approval request. |

Voice only (`VoiceConversation`): `setMicMuted(muted)`, `setVolume({ volume })` (0–1),
`getInputVolume()`, `getOutputVolume()`, `getInputByteFrequencyData()`, `getOutputByteFrequencyData()`.
A `TextConversation` throws on the two setters and returns 0 / an empty array from the getters.

### End-of-conversation feedback

```ts
import { postOverallFeedback } from "@convoso/ai-agent";

await postOverallFeedback(conversationId, true);                             // thumbs up
await postOverallFeedback(conversationId, { rating: 4, comment: "Quick" });  // 1–5 rating + comment
```

Both shapes are stored natively — a thumb is never turned into a rating or back (Q16).

### Errors

`SessionConnectionError` (`error.code`, `error.status`) is thrown by `startSession` when a session cannot
start: `widget_public_id` (a `wgt_…` id), `invalid_agent_id`, `authorization_required` (401 — a
private agent needs a `conversationToken`), `token_request_failed`, `websocket_unavailable`, `session_ended` (the server ended the session before it was ready, e.g. while queued).

## 4. Callbacks

| Callback | Fires |
|---|---|
| `onConnect({ conversationId })` | The agent is ready. |
| `onDisconnect(details)` | Once per session. `details.reason` is `"user"` (you ended it), `"agent"` (the agent ended the call — `context.type:"end_call"`) or `"error"` (see "Network loss"). |
| `onStatusChange({ status })` | `connecting` → `connected` → `disconnecting` → `disconnected`. |
| `onModeChange({ mode })` | `speaking` / `listening`. |
| `onMessage({ role, message, event_id })` | A final user transcript line or a spoken agent sentence. |
| `onAgentChatResponsePart({ type, text })` | Streaming agent text (`start` / `delta` / `stop`). |
| `onInterruption({ event_id })` | The user interrupted the agent. |
| `onCanSendFeedbackChange({ canSendFeedback })` | Follows the connection status. |
| `onAudioAlignment(alignment)` | **Approximate** character timing (Q18) — characters spread evenly across each spoken word. |
| `onMCPToolCall`, `onMCPConnectionStatus`, `onMCPToolApprovalRequest` | MCP tools (approval: return `true` / `false`; a throw or non-boolean denies). |
| `onUnhandledClientToolCall(call)` | The agent called a client tool you did not register. |
| `onConversationMetadata`, `onError(message, context)`, `onDebug`, `onIncomingEvent`, `onOutgoingEvent` | Diagnostics. |

## 5. Client tools

Register a function under the tool's name; the agent calls it during the conversation and hears your
return value.

```ts
const conversation = await Conversation.startSession({
  agentId: "<agent uuid>",
  clientTools: {
    showProduct: async ({ sku }) => {
      openProductPanel(sku);
      return "The product panel is open.";
    },
  },
  onUnhandledClientToolCall: (call) => console.warn("No handler for", call.tool_name),
});
```

A throw answers the agent with an error result. The agent waits up to the tool's response timeout
(default 20 s).

## 6. Differences from the vendor SDK (stated)

- **Microphone processing (Q21):** echo cancellation ON; browser noise suppression and automatic gain
  control OFF — the agent's own speech pipeline handles both. Every call, every platform.
- **Network loss (Q24):** no reconnect yet. When the connection fails the session ends with
  `onDisconnect({ reason: "error", context: { type: "connection_state_changed", reason: "failed" } })`.
  The vendor rides out a short outage silently; reconnect is tracked in `docs/plans/DEFERRED.md`.
- **Errors keep the call up (Q28):** a non-fatal `onError` does not change `status`; the session stays
  `connected`. Only a fatal error ends it (through `onDisconnect`).
- **Agent id (Q15):** `agentId` is the agent uuid only. **Migration:** if you used the widget public id
  (`wgt_…`) with the interim mobile guide, switch to the agent uuid (Agent → **Settings**, the id in the
  page URL). The `<voso-widget agent-id="wgt_…">` element is unchanged.
- **Audio alignment (Q18):** approximate (above); true character timestamps are a later epic.
- **Token re-join (Q29):** a re-join is a fresh session (new greeting); transcripts are not merged.

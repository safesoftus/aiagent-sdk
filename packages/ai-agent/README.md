# @convoso/ai-agent

Client SDK for Convoso AI agents — start a voice or text conversation with an agent from a browser
(React Native through `@convoso/ai-agent-react-native`). Zero runtime dependencies; WebRTC transport.

> Published on npm. Source, issues and releases live in the public repo
> [safesoftus/aiagent-sdk](https://github.com/safesoftus/aiagent-sdk).

```ts
import { Conversation } from "@convoso/ai-agent";

const conversation = await Conversation.startSession({
  agentId: "<agent uuid>",
  onConnect: ({ conversationId }) => console.log("connected", conversationId),
  onMessage: ({ role, message }) => console.log(role, message),
});
// …
await conversation.endSession();
```

## Differences from the vendor SDK (stated)

- **Microphone processing (Q21):** noise suppression and automatic gain control are OFF; echo
  cancellation is ON. The agent's own speech pipeline does the rest.
- **Network loss (Q24):** there is no ICE restart. When the connection fails the session ends with
  `onDisconnect({ reason: "error", context: { type: "connection_state_changed", reason: "failed" } })`.
- **Errors keep the call up (Q28):** a non-fatal `onError` does not change `status`; the session stays
  `connected`. Only a fatal error ends it, through `onDisconnect`.
- **Agent id (Q15):** `agentId` is the agent uuid only. The widget public id (`wgt_…`) belongs to
  `<voso-widget>`; passing it here throws `SessionConnectionError` with a migration hint.
  **Migration:** apps built on the interim mobile guide replace the `wgt_…` id with the agent uuid.
- **Audio alignment (Q18):** `onAudioAlignment` is **approximate** — characters are spread evenly
  across each word's timing from the agent's spoken output.
- **Conversation token re-join (Q29):** a `conversationToken` re-joins the same conversation for
  15 minutes after its first use while the conversation is live. A re-join starts a fresh session
  (new greeting); the earlier segment's transcript is not merged.

## Feedback (both shapes, Q16)

- Per response: `conversation.sendFeedback(true | false | null, eventId?)` — a thumb on one agent
  message (`eventId` = the `event_id` of its `onMessage`; default the last one); `null` clears it.
  Only while connected (otherwise a console warning, nothing sent).
- Whole conversation: `postOverallFeedback(conversationId, like)` or
  `postOverallFeedback(conversationId, { rating: 1–5, comment? })`. The route authenticates with your
  API key (`history: write`) — call it from your server:
  `postOverallFeedback(id, { rating: 5 }, "https://aiagent-api.convoso.com", process.env.CONVOSO_API_KEY)`.

Full guide: [`docs/sdk-javascript.md`](https://github.com/safesoftus/aiagent-sdk/blob/main/docs/sdk-javascript.md).
React: `@convoso/ai-agent-react`; React Native: `@convoso/ai-agent-react-native`; embed widget:
`@convoso/ai-agent-widget`. License: MIT.

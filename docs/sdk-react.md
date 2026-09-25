# React SDK — `@convoso/ai-agent-react`

React provider and hooks over [`@convoso/ai-agent`](sdk-javascript.md). Same session options, callbacks
and client tools; this page covers only what the React layer adds.

> **Not published yet.** Publishes with the first SDK release (E4 publish gate, VOSO-757). Until then
> build from this repo and depend on it with `"@convoso/ai-agent-react": "file:<path>/packages/ai-agent-react"`.
> The sample app `packages/examples/react-vite` shows the full wiring.

## 1. Install

```bash
npm install @convoso/ai-agent-react
```

Peer dependency: React 18 or newer. MIT licensed.

## 2. Quickstart

Every hook must sit inside a `ConversationProvider` (hooks outside it throw; `useRawConversation`
returns `null`).

```tsx
import { ConversationProvider, useConversation } from "@convoso/ai-agent-react";

export function App() {
  return (
    <ConversationProvider onError={(message) => console.error(message)}>
      <CallButton />
    </ConversationProvider>
  );
}

function CallButton() {
  const { status, isSpeaking, startSession, endSession } = useConversation({
    agentId: "<agent uuid>",
    onMessage: ({ role, message }) => console.log(role, message),
  });

  if (status === "connected") {
    return <button onClick={endSession}>End call ({isSpeaking ? "agent speaking" : "listening"})</button>;
  }
  return <button onClick={() => startSession()}>Start call</button>;
}
```

## 3. API

| Export | Returns / does |
|---|---|
| `ConversationProvider` | Holds the live conversation. Accepts every session option and callback, plus `isMuted` / `onMutedChange` for a mute state you own. |
| `useConversation(options?)` | Everything below in one object: `status`, `message`, `isMuted`, `setMuted`, `mode`, `isSpeaking`, `isListening`, `canSendFeedback`, `sendFeedback` and the controls. |
| `useConversationControls()` | `startSession(options?)`, `endSession()`, `sendUserMessage`, `sendContextualUpdate`, `sendUserActivity`, `sendMCPToolApprovalResult`, `setVolume`, volume / frequency getters, `getId()`. |
| `useConversationStatus()` | `{ status: "disconnected" \| "connecting" \| "connected" \| "error", message? }`. |
| `useConversationInput()` | `{ isMuted, setMuted }`. |
| `useConversationMode()` | `{ mode, isSpeaking, isListening }`. |
| `useConversationFeedback()` | `{ canSendFeedback, sendFeedback(like, eventId?) }`. |
| `useRawConversation()` | The underlying conversation object, or `null`. |
| `useConversationClientTool(name, handler)` | Registers a client tool for as long as the component is mounted. |

**Options only reach the session through the hook that started it.** Non-callback options given to
`useConversation({ … })` (`agentId`, `clientTools`, `overrides`, …) apply only to the `startSession`
returned by that same hook call. `useConversationControls().startSession()` does not see them — pass
them to that `startSession(options)` or to the provider instead.

Callback order when the same callback is given in several places: provider → hook → `startSession`;
every one fires. A second `startSession` while one is starting or live is ignored. `endSession()` during
connect cancels the connect.

## 4. Callbacks

The [JavaScript SDK callbacks](sdk-javascript.md#4-callbacks), passed to the provider, a hook, or
`startSession`. `onMCPToolApprovalRequest` is accepted on the provider and on every hook (Q28 — the
vendor's React layer does not accept it there).

## 5. Client tools

```tsx
function ProductPanel() {
  useConversationClientTool("showProduct", async ({ sku }) => {
    openProductPanel(sku);
    return "The product panel is open.";
  });
  return null;
}
```

A name registered by a hook that is also in the `clientTools` option throws.

## 6. Differences from the vendor SDK (stated)

- **Errors keep the call up (Q28):** a runtime `onError` does **not** flip `status` to `"error"` while the
  call is connected (the vendor's React layer does). `status` becomes `"error"` only when `startSession`
  itself fails.
- **Tool approvals on hooks (Q28):** `onMCPToolApprovalRequest` works on the provider and the hooks.
- **`origin` passes through:** we have one api host per environment, so a provider `origin` is used as
  given. `serverLocation` is accepted and ignored (reported through `onDebug`).
- **Microphone processing (Q21), network loss (Q24), agent uuid only (Q15, with the `wgt_…` migration
  line), approximate alignment (Q18):** as in the [JavaScript SDK](sdk-javascript.md#6-differences-from-the-vendor-sdk-stated).

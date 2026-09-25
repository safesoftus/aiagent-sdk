# @convoso/ai-agent-react

React provider and hooks for Convoso AI agents, with the vendor's React names — swap the import
and the agent id. Re-exports everything from `@convoso/ai-agent`.

> Not published yet: publishing waits for the `@convoso` npm org (E4 publish gate).

```tsx
import { ConversationProvider, useConversation } from "@convoso/ai-agent-react";

function Call() {
  const conversation = useConversation({ onMessage: ({ role, message }) => console.log(role, message) });
  return (
    <>
      <p>{conversation.status}{conversation.isSpeaking ? " · agent speaking" : ""}</p>
      <button onClick={() => conversation.startSession()}>Start</button>
      <button onClick={() => conversation.endSession()}>End</button>
    </>
  );
}

export function App() {
  return (
    <ConversationProvider agentId="<agent uuid>">
      <Call />
    </ConversationProvider>
  );
}
```

Hooks: `useConversation`, `useConversationControls`, `useConversationStatus`,
`useConversationInput`, `useConversationMode`, `useConversationFeedback`, `useRawConversation`,
`useConversationClientTool`. Every hook except `useRawConversation` must be used inside a
`ConversationProvider` (it throws otherwise); `useRawConversation` returns `null` there.

Sample app (voice call + text-only chat): `packages/examples/react-vite`.

## Behaviour you should know

- **Options merge** provider → hook → `startSession(options)`; objects merge key by key, and
  callbacks with the same name are **composed** — every one fires, in that order.
- **The controls trap:** the non-callback options you give `useConversation({...})` (agentId,
  clientTools, overrides, …) reach the session only through the `startSession` **that hook
  returns**. `useConversationControls().startSession()` sees the provider's options and what you
  pass it — nothing from another hook. (The vendor's package behaves the same way.)
- A `startSession` while one is starting or live is ignored; `endSession` while connecting ends
  the session as soon as it is up.
- `status` is `"disconnected" | "connecting" | "connected" | "error"`; `"error"` means the start was
  refused (`message` says why, and `onError(message, error)` fires).

## Differences from the vendor SDK (stated)

- **Tool approvals (Q28):** `onMCPToolApprovalRequest` is accepted on the provider and on every
  hook (the vendor's React layer cannot carry it). The most specific one answers:
  `startSession` option → the hook's own → any other hook → the provider.
- **Errors keep the call (Q28):** a runtime `onError` (a tool failure, a server error) does **not**
  change `status` while the call is connected — it stays `"connected"`. The vendor flips it to
  `"error"`.
- **`origin` passes through** the provider (the vendor overwrites it); `serverLocation` is accepted
  and reported once through `onDebug` (one API host per environment).
- **Device switching** (`changeInputDevice` / `changeOutputDevice`) is not available yet — both
  reject.
- Everything listed in `@convoso/ai-agent`'s README applies (microphone processing Q21, network
  loss Q24, agent uuid only Q15, approximate alignment Q18).

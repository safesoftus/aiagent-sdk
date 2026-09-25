# React Native SDK — `@convoso/ai-agent-react-native`

Voice and text conversations with a Convoso AI agent from an iOS / Android app. It is the
[React SDK](sdk-react.md) (same provider and hooks) running on `react-native-webrtc`. It replaces the
interim hand-written mobile guide (`agent-mobile-integration.md`, owner ruling Q23).

> **Published on npm.** Source, issues and releases live in the public repo
> [safesoftus/aiagent-sdk](https://github.com/safesoftus/aiagent-sdk). The sample app
> `packages/examples/expo` is a working Expo development build.

## 1. Install

```bash
npx expo install @convoso/ai-agent-react-native react-native-webrtc @config-plugins/react-native-webrtc
# optional — routes the agent's voice to the loudspeaker
npx expo install react-native-incall-manager
```

| Requirement (Q5) | Minimum |
|---|---|
| React Native | 0.79 (older versions are not supported) |
| Expo | SDK 53, **development build** (`eas build --profile development` or `expo prebuild`) — Expo Go cannot load the native WebRTC module |
| `react-native-webrtc` | ^124 |
| React | 18 |

Add the config plugin and the microphone permission to `app.json`:

```json
{
  "expo": {
    "plugins": ["@config-plugins/react-native-webrtc"],
    "ios": { "infoPlist": { "NSMicrophoneUsageDescription": "Talk to our assistant" } },
    "android": { "permissions": ["android.permission.RECORD_AUDIO"] }
  }
}
```

Enable the iOS `audio` background mode only if a call must survive the app going to the background.
Test voice on a device; the iOS simulator has no real microphone path.

## 2. Quickstart

```tsx
import { ConversationProvider, useConversation } from "@convoso/ai-agent-react-native";
import { Button, Text, View } from "react-native";

export default function App() {
  return (
    <ConversationProvider>
      <Call />
    </ConversationProvider>
  );
}

function Call() {
  const { status, mode, startSession, endSession } = useConversation({
    agentId: "<agent uuid>",
    onMessage: ({ role, message }) => console.log(role, message),
  });
  return (
    <View>
      <Text>{status} · {mode}</Text>
      {status === "connected"
        ? <Button title="End call" onPress={endSession} />
        : <Button title="Start call" onPress={() => startSession()} />}
    </View>
  );
}
```

A private agent: your server mints a `conversationToken` (see
[JavaScript SDK §2](sdk-javascript.md#public-agent-or-private-agent)) and the app passes
`startSession({ conversationToken, signalingUrl, iceServers })` with the token response's `token`,
`signaling_url` and `ice_servers`.

## 3. API

The React SDK's provider and hooks, unchanged — see [`sdk-react.md` §3](sdk-react.md#3-api). React
Native specifics:

- Importing the package wires `react-native-webrtc` into the core; there is nothing to call.
- `connectionType: "websocket"` and `signedUrl` are refused (WebRTC only on React Native).
- When `react-native-incall-manager` is installed the call's audio goes to the loudspeaker
  (started before connecting, stopped when the call ends **or fails to connect**). Without it the OS
  default route is used.
- The greeting is released as soon as the peer connects (there is no `<audio>` element to wait for).

## 4. Callbacks

As the [JavaScript SDK](sdk-javascript.md#4-callbacks) and the React hooks.

## 5. Client tools

`clientTools` on the provider / `startSession`, as in [the JavaScript SDK](sdk-javascript.md#5-client-tools).

## 6. Differences from the vendor SDK (stated)

- **Volume and frequency data (Q20):** `getInputVolume()`, `getOutputVolume()` return `0` and the
  frequency getters return an empty array on React Native in this release (a `VolumeProvider` seam lets
  a native meter plug in later). Build your "speaking" indicator on `mode` / `isSpeaking` instead.
- **Microphone processing (Q21):** echo cancellation ON; noise suppression and automatic gain control
  OFF.
- **Network loss (Q24):** no reconnect yet — the session ends with
  `onDisconnect({ reason: "error", context: { type: "connection_state_changed", reason: "failed" } })`.
- **Errors keep the call up (Q28):** a non-fatal `onError` leaves `status` at `connected`;
  `onMCPToolApprovalRequest` is accepted on the provider and hooks.
- **Agent id (Q15):** the agent uuid only. **Migration for apps built on the interim guide:** replace the
  widget public id (`wgt_…`) and the `/api/widget/{public_id}/…` calls with this package and the agent
  uuid (Agent → **Settings**, the id in the page URL). The widget's own public id keeps working for the
  `<voso-widget>` embed.
- **Audio alignment (Q18):** approximate.

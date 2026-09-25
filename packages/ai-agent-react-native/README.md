# @convoso/ai-agent-react-native

Talk to a Convoso AI agent from a React Native app: the `@convoso/ai-agent-react` provider and hooks
over native WebRTC (`react-native-webrtc`). Replaces the interim hand-copied client of
`docs/agent-mobile-integration.md`.

> Published on npm. Source, issues and releases live in the public repo
> [safesoftus/aiagent-sdk](https://github.com/safesoftus/aiagent-sdk).

## Requirements (Q5)

| | Minimum |
|---|---|
| React Native | **0.79** (package `exports`; older versions are not supported) |
| React | 18 |
| react-native-webrtc | ^124 |
| Expo | SDK 53 **development build** — Expo Go cannot load native WebRTC |

## Install

```bash
npx expo install @convoso/ai-agent-react-native react-native-webrtc @config-plugins/react-native-webrtc expo-dev-client
npx expo install react-native-incall-manager   # optional: routes the agent to the loudspeaker
```

`app.json`:

```json
{
  "expo": {
    "ios": { "infoPlist": { "NSMicrophoneUsageDescription": "Talk to our assistant." } },
    "android": { "permissions": ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"] },
    "plugins": ["expo-dev-client", ["@config-plugins/react-native-webrtc", { "microphonePermission": "Talk to our assistant." }]]
  }
}
```

Then a development build: `npx eas build --profile development` (see `packages/examples/expo`).
Bare React Native: install `react-native-webrtc` per its guide and add the two permissions.

## Use

```tsx
import { ConversationProvider, useConversation } from "@convoso/ai-agent-react-native";

function Call() {
  const conversation = useConversation();
  return <Button title="Start" onPress={() => conversation.startSession()} />;
}

export default function App() {
  return (
    <ConversationProvider agentId="<agent uuid>" origin="https://aiagent-api.convoso.com">
      <Call />
    </ConversationProvider>
  );
}
```

The hooks are `@convoso/ai-agent-react`'s — see its README (option merging, the controls trap,
`status`).

## What the package does on import

- Plugs `react-native-webrtc` into the core (peer connection + microphone).
- With `react-native-incall-manager` installed: speaker output + communication mode **before**
  connecting, released on every end **and on a failed connect**.
- Marks the client as `react_native_sdk`.

## Differences from the vendor SDK (stated)

| | Vendor | Here |
|---|---|---|
| Transport | LiveKit | react-native-webrtc, no LiveKit dependency |
| `getInputVolume` / `getOutputVolume` / `get*ByteFrequencyData` | native RMS / FFT | **always 0 / empty (Q20)** — react-native-webrtc has no audio analyser; the `VolumeProvider` seam takes a real one later |
| `signedUrl` / `connectionType: "websocket"` | refused | refused with the same sentence (WebRTC only) |
| Audio session on a failed connect | left running | released |
| Network loss | LiveKit reconnects | the session ends with `onDisconnect({reason: "error", context: {type: "connection_state_changed"}})` (Q24) |
| Microphone processing | EC / NS / AGC on | echo cancellation on, noise suppression + auto gain **off** (Q21) |

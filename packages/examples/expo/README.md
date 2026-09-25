# Expo sample — @convoso/ai-agent-react-native

One screen: start / end a voice call with an agent, mute, transcript. Used by
the E4 QA plan (`docs/qa/agent-integration-e4-qa.md`, section P2).

**Requirements:** Expo SDK 53 or newer as a **development build** (Expo Go
cannot load native WebRTC), React Native 0.79+, react-native-webrtc ^124.
iOS 15+ device or simulator; Android 8+ device or emulator with a microphone.

```bash
# 1. build the packages once (repo root)
npm install
npm run build -w packages/ai-agent -w packages/ai-agent-react -w packages/ai-agent-react-native

# 2. install this sample on its own (it is not a root workspace)
cd packages/examples/expo
npm install
npx expo install --fix            # aligns expo / react-native / plugin versions

# 3. set the agent: app.json → expo.extra.agentId (the agent uuid, Public access on)
#    and expo.extra.apiOrigin (e.g. https://aiagent-api-stage.convoso.com)

# 4. development build
npx eas build --profile development --platform ios        # or android; or
npx expo run:ios                                          # local build (Xcode)

# 5. run
npm start                          # open the dev build, scan / pick the server
```

The microphone permission text and the WebRTC native setup come from
`@config-plugins/react-native-webrtc` (see `app.json`). Speaker routing uses
`react-native-incall-manager` when installed (it is, here).

// @convoso/ai-agent-react-native — the React provider + hooks on React Native
// (E4 plan §1.3 / §4.7, owner rulings Q5 / Q20). Importing it:
//   · plugs react-native-webrtc into the ONE core (`setPlatform`): peer
//     connection, microphone, `client-ready.about.platform = "react-native"`;
//   · volume / frequency reads return 0 (Q20: react-native-webrtc has no Web
//     Audio analyser — the VolumeProvider seam ships a no-op provider);
//   · routes the agent to the loudspeaker through react-native-incall-manager
//     when the app has it (optional peer): started before connecting, stopped
//     on every end AND on a failed connect;
//   · marks the SDK source `react_native_sdk`;
//   · refuses `signedUrl` / `connectionType: "websocket"` with the vendor's
//     sentence (WebRTC only on React Native).
// Requires react-native >= 0.79 (package `exports`), react >= 18,
// react-native-webrtc ^124, an Expo SDK >= 53 development build (Expo Go
// cannot load native WebRTC).
import { mediaDevices, RTCPeerConnection, RTCSessionDescription } from "react-native-webrtc";
import { NO_VOLUME, setSourceInfo } from "@convoso/ai-agent";
import { setPlatform } from "@convoso/ai-agent/internal";

export * from "@convoso/ai-agent-react";

interface InCallManagerLike {
  start(options: { media: "audio" | "video" }): void;
  setForceSpeakerphoneOn(on: boolean): void;
  stop(): void;
}

/** react-native-incall-manager when installed, else `null` (routing left to the OS). */
function inCallManager(): InCallManagerLike | null {
  try {
    // Optional peer: Metro resolves a require inside try/catch as optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-incall-manager") as { default?: InCallManagerLike } & Partial<InCallManagerLike>;
    return mod.default ?? (mod.start ? (mod as InCallManagerLike) : null);
  } catch {
    return null;
  }
}

const manager = inCallManager();

setPlatform({
  name: "react-native",
  RTCPeerConnection: RTCPeerConnection as unknown as typeof globalThis.RTCPeerConnection,
  RTCSessionDescription: RTCSessionDescription as unknown as typeof globalThis.RTCSessionDescription,
  mediaDevices: () => mediaDevices as unknown as MediaDevices,
  volumeProvider: () => NO_VOLUME,
  ...(manager
    ? {
        audioSession: {
          start: () => {
            manager.start({ media: "audio" });
            manager.setForceSpeakerphoneOn(true);
          },
          stop: () => manager.stop(),
        },
      }
    : {}),
});
setSourceInfo({ source: "react_native_sdk" });

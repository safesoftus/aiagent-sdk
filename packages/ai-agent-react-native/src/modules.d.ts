// Minimal typings for the native peers, so the package typechecks without
// installing React Native (CI). The app's real packages carry full types.
declare module "react-native-webrtc" {
  export const RTCPeerConnection: unknown;
  export const RTCSessionDescription: unknown;
  export const mediaDevices: unknown;
}

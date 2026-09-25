// Test stand-in for react-native-webrtc: the core harness's fake peer, and a
// mediaDevices that delegates to the harness's recording getUserMedia.
export { FakePeerConnection as RTCPeerConnection } from "../../../ai-agent/test/harness";
export class RTCSessionDescription {}
export const mediaDevices = {
  getUserMedia: (constraints: MediaStreamConstraints) =>
    (globalThis as unknown as { navigator: { mediaDevices: MediaDevices } }).navigator.mediaDevices.getUserMedia(constraints),
};

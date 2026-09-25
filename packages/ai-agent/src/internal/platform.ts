// Pluggable platform globals (E4 plan §4.3). The browser defaults ARE the
// globals, read at call time (never captured at import), so the browser
// build is behaviour-identical to the widget's original voice.ts; the React
// Native package calls `setPlatform` with react-native-webrtc's classes.
import type { VolumeProvider } from "./volume-provider";

export interface Platform {
  RTCPeerConnection: typeof RTCPeerConnection;
  RTCSessionDescription?: typeof RTCSessionDescription;
  mediaDevices: () => MediaDevices | undefined;
  fetch: typeof fetch;
  setTimeout: (handler: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  /** `client-ready.about.platform` (E4 plan §4.6). Default `"web"`. */
  name?: "web" | "react-native" | "node";
  /** Volume / frequency reads for a stream (Q20). Default: an AnalyserNode
   *  where Web Audio exists; React Native plugs a no-op provider. */
  volumeProvider?: (stream: MediaStream) => VolumeProvider;
  /** Native audio session around a voice session (React Native: speaker
   *  routing). `start` before connecting; `stop` on every end AND on a
   *  failed connect. Default: none. */
  audioSession?: { start(): void; stop(): void };
}

const browserDefaults = (): Platform => ({
  RTCPeerConnection: globalThis.RTCPeerConnection,
  RTCSessionDescription: globalThis.RTCSessionDescription,
  mediaDevices: () => globalThis.navigator?.mediaDevices,
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
});

let overrides: Partial<Platform> = {};

/** Replace some platform globals (React Native: react-native-webrtc). */
export function setPlatform(next: Partial<Platform>): void {
  overrides = { ...overrides, ...next };
}

/** The effective platform: browser globals (read now) + any overrides. */
export function platform(): Platform {
  return { ...browserDefaults(), ...overrides };
}

/**
 * Microphone capture profile (Q21, stated in every README): echo
 * cancellation ON (stops agent TTS echoing into the mic); browser noise
 * suppression and automatic gain control OFF — the same profile as the
 * dashboard preview.
 */
export const MIC_CONSTRAINTS = {
  audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  video: false,
} as const;

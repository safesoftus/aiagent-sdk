// Volume / frequency reads behind one seam (E4 Q20): the browser measures a
// MediaStream through an AnalyserNode; platforms without Web Audio (React
// Native) plug NO_VOLUME, whose reads are 0 / empty — documented.
import { platform } from "./platform";

export interface VolumeProvider {
  /** 0–1. */
  getVolume(): number;
  getByteFrequencyData(): Uint8Array;
  /** Release what the provider holds (the browser's AudioContext); called
   *  when the stream is replaced or the session ends. Optional. */
  close?(): void;
}

export const NO_VOLUME: VolumeProvider = {
  getVolume: () => 0,
  getByteFrequencyData: () => new Uint8Array(0),
};

/** The platform's provider (React Native: NO_VOLUME), else an AnalyserNode
 *  over `stream`, else NO_VOLUME where Web Audio is absent. */
export function analyserVolume(stream: MediaStream): VolumeProvider {
  const custom = platform().volumeProvider;
  if (custom) return custom(stream);
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) return NO_VOLUME;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  return {
    getVolume() {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const value of data) sum += value;
      return data.length ? sum / data.length / 255 : 0;
    },
    getByteFrequencyData() {
      analyser.getByteFrequencyData(data);
      return data;
    },
    close() {
      source.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}

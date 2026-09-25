// The agent's audio sink: an autoplaying <audio> element (browser) whose
// play() — resolved OR rejected, as in the widget — releases the server-held
// greeting through the client-ready latch; volume + analyser reads. Without a
// DOM (React Native / node) rendering is reported as soon as the track lands.
import { analyserVolume, NO_VOLUME, type VolumeProvider } from "./volume-provider";

export class OutputController {
  private audio: HTMLAudioElement | null = null;
  private volume = 1;
  volumeProvider: VolumeProvider = NO_VOLUME;

  attach(stream: MediaStream, onRendering: () => void): void {
    this.volumeProvider.close?.();
    this.volumeProvider = analyserVolume(stream);
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) {
      onRendering();
      return;
    }
    const audio = doc.createElement("audio");
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.volume = this.volume;
    this.audio = audio;
    void audio.play().then(onRendering, onRendering);
  }

  /** 0–1; a non-finite value means 1 (the vendor's clamp). */
  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    if (this.audio) this.audio.volume = this.volume;
  }

  detach(): void {
    if (this.audio) this.audio.srcObject = null;
    this.audio = null;
    this.volumeProvider.close?.();
    this.volumeProvider = NO_VOLUME;
  }
}

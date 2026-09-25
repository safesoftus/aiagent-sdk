// VoiceConversation — a WebRTC voice session (the vendor's VoiceConversation).
import { OutputController } from "../internal/output-controller";
import { analyserVolume, NO_VOLUME, type VolumeProvider } from "../internal/volume-provider";
import type { SessionConfig } from "../types";
import { BaseConversation } from "./base";

export class VoiceConversation extends BaseConversation {
  private readonly output = new OutputController();
  private input: VolumeProvider = NO_VOLUME;

  /** @internal — use `Conversation.startSession`. */
  constructor(config: SessionConfig) {
    super(config, false);
  }

  /** 0–1 (clamped; non-finite → 1). */
  setVolume({ volume }: { volume: number }): void {
    this.output.setVolume(volume);
  }

  setMicMuted(isMuted: boolean): void {
    this.client?.setMicrophoneEnabled(!isMuted);
  }

  getInputVolume(): number {
    return this.input.getVolume();
  }

  getOutputVolume(): number {
    return this.output.volumeProvider.getVolume();
  }

  getInputByteFrequencyData(): Uint8Array {
    return this.input.getByteFrequencyData();
  }

  getOutputByteFrequencyData(): Uint8Array {
    return this.output.volumeProvider.getByteFrequencyData();
  }

  protected override onRemoteAudio(stream: MediaStream, rendered: () => void): void {
    this.output.attach(stream, rendered);
  }

  protected override onLocalAudio(stream: MediaStream | null): void {
    this.input.close?.();
    this.input = stream ? analyserVolume(stream) : NO_VOLUME;
  }

  protected override teardownMedia(): void {
    this.output.detach();
    this.input.close?.();
    this.input = NO_VOLUME;
  }
}

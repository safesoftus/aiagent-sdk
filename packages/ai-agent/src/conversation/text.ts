// TextConversation — a text-only session over the WebRTC data channel (E4
// Q19): no microphone, `send-text` in, `bot-output` out. Volume and mute do
// not exist here (the vendor throws too); reads are 0 / empty.
import type { SessionConfig } from "../types";
import { BaseConversation } from "./base";

export class TextConversation extends BaseConversation {
  /** @internal — use `Conversation.startSession`. */
  constructor(config: SessionConfig) {
    super(config, true);
  }

  setVolume(_options: { volume: number }): never {
    throw new Error("setVolume is not supported in text conversations");
  }

  setMicMuted(_isMuted: boolean): never {
    throw new Error("setMicMuted is not supported in text conversations");
  }

  getInputVolume(): number {
    return 0;
  }

  getOutputVolume(): number {
    return 0;
  }

  getInputByteFrequencyData(): Uint8Array {
    return new Uint8Array(0);
  }

  getOutputByteFrequencyData(): Uint8Array {
    return new Uint8Array(0);
  }
}

// The façade's transport: the widget's VoiceClient with the SDK's two
// differences — `client-ready.about` (the SDK's source_info) and the
// text-only path (Q19: no microphone; a receive-only audio transceiver so the
// server's answer still negotiates; client-ready on data-channel open).
import { VoiceClient } from "../internal/voice-client";

export class SdkClient extends VoiceClient {
  textOnly = false;
  about: Record<string, unknown> | undefined;
  onMic: ((stream: MediaStream | null) => void) | undefined;

  protected override clientReadyData(): Record<string, unknown> | undefined {
    return this.about ? { about: this.about } : undefined;
  }

  protected override async localMedia(): Promise<MediaStream | null> {
    if (this.textOnly) return null;
    const stream = await super.localMedia();
    this.onMic?.(stream);
    return stream;
  }

  protected override configureTransceivers(pc: RTCPeerConnection, stream: MediaStream | null): void {
    if (this.textOnly) {
      pc.addTransceiver("audio", { direction: "recvonly" }); // text-only: no mic (Q19)
      return;
    }
    super.configureTransceivers(pc, stream);
  }

  /** The conversation the (redeemed) session carries. */
  conversationId(): string {
    return this.session.conversation_id;
  }
}

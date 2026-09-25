// onAudioAlignment (E4 Q18) — APPROXIMATE character timing derived from the
// agent's word-level spoken output (`bot-output {aggregated_by:"word",
// tts_offset_ms}`): each word's characters are spread evenly across the time
// until the next word (or a fixed per-character estimate for the last word).
// True provider-level character timestamps are deferred (§8b-2).

export interface AudioAlignment {
  chars: string[];
  char_start_times_ms: number[];
  char_durations_ms: number[];
}

/** Per-character estimate for a word with no following word. */
export const FALLBACK_CHAR_MS = 60;

export class AlignmentTracker {
  private pending: { text: string; offset: number } | null = null;

  constructor(private readonly emit: (alignment: AudioAlignment) => void) {}

  /** One spoken word at `offsetMs` from the start of its TTS context. */
  word(text: string, offsetMs: number): void {
    if (this.pending) this.flush(offsetMs - this.pending.offset);
    this.pending = { text, offset: offsetMs };
  }

  /** The utterance ended (stopped speaking, interrupted, new context). */
  end(): void {
    if (this.pending) this.flush([...this.pending.text].length * FALLBACK_CHAR_MS);
  }

  private flush(durationMs: number): void {
    const { text, offset } = this.pending!;
    this.pending = null;
    const chars = [...text];
    if (chars.length === 0) return;
    const per = Math.max(durationMs, 0) / chars.length;
    this.emit({
      chars,
      char_start_times_ms: chars.map((_, i) => Math.round(offset + i * per)),
      char_durations_ms: chars.map(() => Math.round(per)),
    });
  }
}

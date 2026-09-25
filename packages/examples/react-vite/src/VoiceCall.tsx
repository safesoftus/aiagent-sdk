import { useState } from "react";
import { useConversation, type MessagePayload } from "@convoso/ai-agent-react";
import { Transcript } from "./Transcript";

export function VoiceCall() {
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [muted, setMuted] = useState(false);
  const conversation = useConversation({
    micMuted: muted,
    onMessage: (m) => setMessages((all) => [...all, m]),
    onError: (message) => console.warn("agent error:", message),
  });
  const live = conversation.status === "connected";
  return (
    <section>
      <p>
        Status: <strong data-testid="status">{conversation.status}</strong>
        {live && (
          <>
            {" "}
            · <span data-testid="mode">{conversation.isSpeaking ? "agent speaking" : "listening"}</span> · conversation{" "}
            <code data-testid="conversation-id">{conversation.getId()}</code>
          </>
        )}
        {conversation.message && <span data-testid="error"> — {conversation.message}</span>}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button data-testid="start" disabled={conversation.status === "connecting" || live} onClick={() => conversation.startSession()}>
          Start call
        </button>
        <button data-testid="end" disabled={!live} onClick={() => conversation.endSession()}>
          End call
        </button>
        <button data-testid="mute" disabled={!live} onClick={() => setMuted((m) => !m)}>
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
      <Transcript messages={messages} />
    </section>
  );
}

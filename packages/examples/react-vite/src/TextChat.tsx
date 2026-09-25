// Text-only session over the same WebRTC data channel (E4 Q19): no
// microphone prompt, typed turns in, the agent's replies as messages.
import { useState } from "react";
import { useConversation, type MessagePayload } from "@convoso/ai-agent-react";
import { Transcript } from "./Transcript";

export function TextChat() {
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [draft, setDraft] = useState("");
  const conversation = useConversation({
    textOnly: true,
    onMessage: (m) => setMessages((all) => [...all, m]),
  });
  const live = conversation.status === "connected";
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((all) => [...all, { message: text, role: "user", source: "user" }]);
    conversation.sendUserMessage(text);
    setDraft("");
  };
  return (
    <section>
      <p>
        Status: <strong data-testid="status">{conversation.status}</strong>
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button data-testid="start" disabled={conversation.status === "connecting" || live} onClick={() => conversation.startSession()}>
          Start chat
        </button>
        <button data-testid="end" disabled={!live} onClick={() => conversation.endSession()}>
          End chat
        </button>
      </div>
      <Transcript messages={messages} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          data-testid="message"
          value={draft}
          disabled={!live}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          style={{ flex: 1 }}
        />
        <button data-testid="send" disabled={!live}>
          Send
        </button>
      </form>
    </section>
  );
}

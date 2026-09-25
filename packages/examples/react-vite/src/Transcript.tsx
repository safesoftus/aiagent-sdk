// The running transcript, with a thumbs up / down on every agent line
// (per-response feedback, E4 Q16 → stored on the conversation).
import { useConversationFeedback, type MessagePayload } from "@convoso/ai-agent-react";

export function Transcript({ messages }: { messages: MessagePayload[] }) {
  const { canSendFeedback, sendFeedback } = useConversationFeedback();
  return (
    <ol data-testid="transcript" style={{ listStyle: "none", padding: 0 }}>
      {messages.map((m, i) => (
        <li key={i} data-role={m.role} style={{ margin: "6px 0" }}>
          <strong>{m.role === "agent" ? "Agent" : "You"}:</strong> {m.message}
          {m.role === "agent" && m.event_id !== undefined && (
            <span style={{ marginLeft: 8 }}>
              <button
                aria-label="Good answer"
                data-testid={`like-${m.event_id}`}
                disabled={!canSendFeedback}
                onClick={() => sendFeedback(true, m.event_id)}
              >
                Like
              </button>
              <button
                aria-label="Bad answer"
                data-testid={`dislike-${m.event_id}`}
                disabled={!canSendFeedback}
                onClick={() => sendFeedback(false, m.event_id)}
              >
                Dislike
              </button>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

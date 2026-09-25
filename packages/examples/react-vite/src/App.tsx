// The sample: one ConversationProvider, a voice call and a text-only chat
// (E4 Q19 — no microphone) against the same agent.
import { useState } from "react";
import { ConversationProvider } from "@convoso/ai-agent-react";
import { VoiceCall } from "./VoiceCall";
import { TextChat } from "./TextChat";

const agentId = import.meta.env.VITE_AGENT_ID as string;
const origin = import.meta.env.VITE_API_ORIGIN as string;

export function App() {
  const [tab, setTab] = useState<"voice" | "text">("voice");
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "32px auto", padding: "0 16px" }}>
      <h1>Convoso AI agent — React sample</h1>
      <p>
        Agent <code data-testid="agent-id">{agentId}</code> on <code>{origin}</code>
      </p>
      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button data-testid="tab-voice" onClick={() => setTab("voice")} disabled={tab === "voice"}>
          Voice call
        </button>
        <button data-testid="tab-text" onClick={() => setTab("text")} disabled={tab === "text"}>
          Text chat (no microphone)
        </button>
      </nav>
      {/* A key per tab: switching tabs unmounts the provider, which ends any session. */}
      <ConversationProvider key={tab} agentId={agentId} origin={origin}>
        {tab === "voice" ? <VoiceCall /> : <TextChat />}
      </ConversationProvider>
    </main>
  );
}

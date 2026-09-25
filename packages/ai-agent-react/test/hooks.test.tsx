import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  ConversationProvider,
  useConversation,
  useConversationControls,
  useConversationFeedback,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
  useRawConversation,
  Conversation,
  postOverallFeedback,
} from "../src/index";
import { sourceInfo } from "../../ai-agent/src/internal/source-info";

// Hook contract (E4 plan §1.2): every hook but useRawConversation throws
// outside the provider; inside, the initial state is disconnected / listening.

const THROWING = [
  ["useConversation", useConversation],
  ["useConversationControls", useConversationControls],
  ["useConversationStatus", useConversationStatus],
  ["useConversationInput", useConversationInput],
  ["useConversationMode", useConversationMode],
  ["useConversationFeedback", useConversationFeedback],
] as const;

for (const [name, hook] of THROWING) {
  test(`react hooks: ${name} throws outside a ConversationProvider`, () => {
    function Probe() {
      hook();
      return null;
    }
    assert.throws(() => renderToString(<Probe />), new RegExp(`${name} must be used within a ConversationProvider`));
  });
}

test("react hooks: useRawConversation is null outside a provider (no throw)", () => {
  let seen: unknown = "unset";
  function Probe() {
    seen = useRawConversation();
    return null;
  }
  renderToString(<Probe />);
  assert.equal(seen, null);
});

test("react hooks: initial state inside a provider", () => {
  let state: ReturnType<typeof useConversation> | null = null;
  function Probe() {
    state = useConversation({ micMuted: true });
    return null;
  }
  renderToString(
    <ConversationProvider agentId="0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6">
      <Probe />
    </ConversationProvider>,
  );
  const s = state as unknown as ReturnType<typeof useConversation>;
  assert.equal(s.status, "disconnected");
  assert.equal(s.mode, "listening");
  assert.equal(s.isListening, true);
  assert.equal(s.canSendFeedback, false);
  assert.equal(s.isMuted, true, "micMuted ?? isMuted (controlled by the hook)");
  assert.equal(s.getId(), "");
});

test("react: the package re-exports the core and marks its source", () => {
  assert.equal(typeof Conversation.startSession, "function");
  assert.equal(typeof postOverallFeedback, "function");
  assert.equal(sourceInfo().source, "react_sdk");
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, server, tick } from "../../ai-agent/test/harness";
import { ConversationStore, deepMerge, type HookOptions } from "../src/store";

// The provider's rules (E4 plan §1.2 / §4.7, Q28), against the real core over
// the core's fake WebRTC harness.

const AGENT = "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6";
const base: HookOptions = { agentId: AGENT, origin: "https://api.test" };

beforeEach(() => server.reset());

test("react: start → connecting → connected; mode and canSendFeedback follow the session", async () => {
  const store = new ConversationStore({ options: base });
  const seen: string[] = [];
  store.subscribe(() => seen.push(store.getSnapshot().status));
  await store.startSession();
  assert.equal(store.getSnapshot().status, "connected");
  assert.equal(store.getSnapshot().canSendFeedback, true);
  assert.deepEqual([...new Set(seen)], ["connecting", "connected"]);
  peer().dc.deliver({ type: "bot-started-speaking" });
  assert.equal(store.getSnapshot().mode, "speaking");
  await store.endSession();
  assert.equal(store.getSnapshot().status, "disconnected");
  assert.equal(store.getSnapshot().conversation, null);
});

test("react (Q28): a runtime onError leaves status connected; the listener still fires", async () => {
  const errors: unknown[] = [];
  const store = new ConversationStore({ options: { ...base, onError: (m) => errors.push(m) } });
  await store.startSession();
  peer().dc.deliver({ type: "error", data: { error: "tool failed", fatal: false } });
  assert.equal(store.getSnapshot().status, "connected");
  assert.deepEqual(errors, ["Server error: tool failed"]);
  await store.endSession();
});

test("react: a rejected startSession → status error + message + onError(message, error)", async () => {
  server.tokenStatus = 404;
  const errors: unknown[][] = [];
  const store = new ConversationStore({ options: { ...base, onError: (...args) => errors.push(args) } });
  await store.startSession();
  assert.equal(store.getSnapshot().status, "error");
  assert.match(store.getSnapshot().message ?? "", /Failed to fetch conversation token/);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]![1] instanceof Error);
});

test("react: callbacks compose provider → registered hook → startSession, every listener fires", async () => {
  const order: string[] = [];
  const store = new ConversationStore({ options: { ...base, onConnect: () => order.push("provider") } });
  store.registerCallbacks({ current: { onConnect: () => order.push("hook") } });
  await store.startSession({}, { onConnect: () => order.push("session") });
  assert.deepEqual(order, ["provider", "hook", "session"]);
  await store.endSession();
});

test("react: data options merge deeply, most specific wins; origin passes through", () => {
  assert.deepEqual(
    deepMerge(
      { origin: "https://a.test", overrides: { agent: { firstMessage: "Hi", language: "en" } } },
      { overrides: { agent: { firstMessage: "Hello" } }, textOnly: undefined },
    ),
    { origin: "https://a.test", overrides: { agent: { firstMessage: "Hello", language: "en" } } },
  );
});

test("react: a second startSession while one is pending is ignored (one token request)", async () => {
  const store = new ConversationStore({ options: base });
  const first = store.startSession();
  const second = store.startSession();
  await Promise.all([first, second]);
  assert.equal(server.calls.filter((c) => c.url.includes("/conversation/token")).length, 1);
  await store.endSession();
});

test("react: endSession during connect ends the session once it is up (reason user)", async () => {
  const reasons: unknown[] = [];
  const store = new ConversationStore({ options: { ...base, onDisconnect: (d) => reasons.push(d) } });
  const started = store.startSession();
  await store.endSession();
  await started;
  assert.deepEqual(reasons, [{ reason: "user" }]);
  assert.equal(store.getSnapshot().status, "disconnected");
});

test("react: useConversationClientTool names colliding with option tools throw; registered tools dispatch", async () => {
  const store = new ConversationStore({ options: { ...base, clientTools: { lookup: () => "from options" } } });
  store.registerClientTool("lookup", { current: () => "from hook" });
  await store.startSession();
  assert.equal(store.getSnapshot().status, "error", "collision refuses the start");
  const clean = new ConversationStore({ options: base });
  const unregister = clean.registerClientTool("crm", { current: (p: { id: string }) => `found ${p.id}` });
  await clean.startSession();
  peer().dc.deliver({ type: "llm-function-call", data: { function_name: "crm", tool_call_id: "t1", args: { id: "7" } } });
  await tick(5);
  const result = peer().dc.sent.find((f) => f.type === "llm-function-call-result");
  assert.deepEqual((result?.data as { result: string }).result, "found 7");
  unregister();
  await clean.endSession();
});

test("react (Q28): onMCPToolApprovalRequest on a hook answers the agent's approval", async () => {
  const store = new ConversationStore({ options: base });
  store.registerCallbacks({ current: { onMCPToolApprovalRequest: () => true } });
  await store.startSession();
  peer().dc.deliver({
    type: "mcp-tool-call",
    data: { service_id: "s", tool_call_id: "m1", tool_name: "refund", parameters: {}, state: "awaiting_approval" },
  });
  await tick(5);
  const approval = peer().dc.sent.find((f) => f.type === "mcp-tool-approval-result");
  assert.deepEqual(approval?.data, { tool_call_id: "m1", is_approved: true });
  await store.endSession();
});

test("react: controlled mute calls onMutedChange only; uncontrolled applies at once", async () => {
  const changes: boolean[] = [];
  const controlled = new ConversationStore({ options: base, isMuted: false, onMutedChange: (m) => changes.push(m) });
  controlled.setMuted(true);
  assert.deepEqual(changes, [true]);
  assert.equal(controlled.getSnapshot().isMuted, false, "the parent owns the value");
  const free = new ConversationStore({ options: base });
  free.setMuted(true);
  assert.equal(free.getSnapshot().isMuted, true);
});

test("react: serverLocation is accepted and reported once through onDebug", async () => {
  const debug: unknown[] = [];
  const store = new ConversationStore({ options: { ...base, serverLocation: "us", onDebug: (e) => debug.push(e) } });
  await store.startSession();
  assert.deepEqual(debug[0], { type: "ignored_options", ignored: ["serverLocation"] });
  await store.endSession();
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, recorder, server, tick } from "./harness";
import { Conversation, SessionConnectionError } from "../src/index";

beforeEach(() => server.reset());

async function connected() {
  const rec = recorder();
  const conversation = await Conversation.startSession({
    agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
    origin: "https://api.test",
    ...rec.callbacks,
  });
  await tick(2);
  return { conversation, ...rec, pc: peer() };
}

const disconnectPosts = () => server.calls.filter((c) => c.url.endsWith("/api/disconnect"));

test("Q24: ICE failure without an announcement ends the session with connection_state_changed", async () => {
  const { conversation, pc, log } = await connected();
  pc.moveTo("failed");
  const disconnects = log.filter(([name]) => name === "onDisconnect").map(([, d]) => d);
  assert.deepEqual(disconnects, [
    {
      reason: "error",
      message: "WebRTC connection failed",
      context: { type: "connection_state_changed", reason: "failed" },
    },
  ]);
  assert.equal(conversation.isOpen(), false);
  assert.ok(!log.some(([name]) => name === "onError"), "a transport loss is not an onError");
});

test("the agent ends the call: end_call shape, and no disconnect POST after the announcement", async () => {
  const { pc, log } = await connected();
  pc.dc.deliver({ type: "server-message", data: { type: "session-ended", reason: "end_call" } });
  await tick(2);
  pc.moveTo("failed"); // the DTLS close that follows an announced end
  const disconnects = log.filter(([name]) => name === "onDisconnect").map(([, d]) => d);
  assert.deepEqual(disconnects, [{ reason: "agent", context: { type: "end_call", reason: "end_call" } }]);
  assert.equal(disconnectPosts().length, 0);
  const statuses = log.filter(([name]) => name === "onStatusChange").map(([, s]) => (s as { status: string }).status);
  assert.deepEqual(statuses.slice(-2), ["disconnecting", "disconnected"]);
});

test("the user ends the call: reason user, one ownership-proof disconnect POST", async () => {
  const { conversation, log } = await connected();
  await conversation.endSession();
  await conversation.endSession(); // a second end is a no-op
  assert.deepEqual(
    log.filter(([name]) => name === "onDisconnect").map(([, d]) => d),
    [{ reason: "user" }],
  );
  assert.deepEqual(disconnectPosts().map((c) => c.body), [
    { session_id: "sess_redeemed", session_token: "st_redeemed" },
  ]);
});

test("a fatal server error ends the session with reason error", async () => {
  const { pc, log } = await connected();
  pc.dc.deliver({ type: "error", data: { error: "Pipeline stopped", fatal: true } });
  assert.deepEqual(
    log.filter(([name]) => name === "onDisconnect").map(([, d]) => d),
    [{ reason: "error", message: "Pipeline stopped", context: { type: "error" } }],
  );
});

test("endSession while connecting rejects startSession and nothing stays live (Copilot #16)", async () => {
  const rec = recorder();
  let created = null as Conversation | null;
  await assert.rejects(
    Conversation.startSession({
      agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6",
      origin: "https://api.test",
      ...rec.callbacks,
      // The only public moment a caller holds the instance before startSession resolves.
      onConversationCreated: (c) => {
        created = c as Conversation;
        void created.endSession();
      },
    }),
    (err: unknown) => err instanceof SessionConnectionError && err.code === "ended_while_connecting",
  );
  await tick(2);
  assert.ok(created, "onConversationCreated fired");
  assert.equal(created!.isOpen(), false);
  const statuses = rec.log.filter(([n]) => n === "onStatusChange").map(([, s]) => (s as { status: string }).status);
  assert.deepEqual(statuses, ["connecting", "disconnecting", "disconnected"]);
  assert.ok(!rec.log.some(([n]) => n === "onConnect"), "no onConnect after an end while connecting");
  assert.deepEqual(
    rec.log.filter(([n]) => n === "onDisconnect").map(([, d]) => d),
    [{ reason: "user" }],
  );
  assert.equal(disconnectPosts().length, 1, "the server session is released");
  assert.equal(peer().connectionState, "closed", "the peer is closed");
  // A second start on a fresh instance still works (nothing global was left behind).
  server.calls = [];
  const again = await Conversation.startSession({ agentId: "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6", origin: "https://api.test" });
  assert.equal(again.isOpen(), true);
  await again.endSession();
});

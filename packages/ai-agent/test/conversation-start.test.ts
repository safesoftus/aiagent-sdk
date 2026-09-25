import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { peer, recorder, server, tick } from "./harness";
import { Conversation, SessionConnectionError, VoiceConversation } from "../src/index";
import { LIBRARY_VERSION } from "../src/version";
import pkg from "../package.json";

beforeEach(() => server.reset());

const AGENT = "0191f3c4-5b6a-7c8d-9e0f-a1b2c3d4e5f6";

test("start: an agent uuid mints a token, redeems it on the offer, and connects", async () => {
  const { callbacks, names } = recorder();
  const conversation = await Conversation.startSession({
    agentId: AGENT,
    origin: "https://api.test/",
    authorization: "customer-bearer",
    ...callbacks,
  });
  assert.ok(conversation instanceof VoiceConversation);
  const [tokenCall, offerCall] = server.calls;
  assert.equal(
    tokenCall!.url,
    `https://api.test/v1/convai/conversation/token?agent_id=agent_0191f3c45b6a7c8d9e0fa1b2c3d4e5f6&source=js_sdk&version=${LIBRARY_VERSION}`,
  );
  assert.equal(tokenCall!.headers["Authorization"], "Bearer customer-bearer");
  assert.equal(offerCall!.url, "https://preview.test/api/offer", "the token response's signaling_url");
  assert.deepEqual(Object.keys(offerCall!.body!), ["conversation_token", "sdp", "type"]);
  assert.equal(offerCall!.body!.conversation_token, server.token.token);
  assert.equal(conversation.getId(), server.token.conversation_id);
  assert.equal(conversation.isOpen(), true);
  assert.deepEqual(names(), [
    "onStatusChange", // connecting
    "onCanSendFeedbackChange", // false
    "onConversationCreated",
    "onStatusChange", // connected
    "onCanSendFeedbackChange", // true
    "onConnect",
  ]);
  await conversation.endSession();
});

test("start: client-ready carries the SDK's about (source_info slot)", async () => {
  const conversation = await Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  const ready = peer().dc.sent.find((frame) => frame.type === "client-ready");
  assert.deepEqual(ready?.data, {
    about: { library: "@convoso/ai-agent", library_version: pkg.version, platform: "web" },
  });
  await conversation.endSession();
});

test("start: a widget public id is refused with the migration hint (Q15), before any request", async () => {
  await assert.rejects(
    Conversation.startSession({ agentId: "wgt_00000000000000000000000000000001" }),
    (err: unknown) =>
      err instanceof SessionConnectionError && err.code === "widget_public_id" && /migration/.test(err.message),
  );
  assert.equal(server.calls.length, 0);
});

test("start: anything that is not an agent uuid is refused", async () => {
  await assert.rejects(
    Conversation.startSession({ agentId: "not-an-id" }),
    (err: unknown) => err instanceof SessionConnectionError && err.code === "invalid_agent_id",
  );
});

test("start: a signed URL needs the WebSocket transport (E4-b)", async () => {
  await assert.rejects(
    Conversation.startSession({ signedUrl: "wss://preview.test/v1/convai/conversation?x" }),
    (err: unknown) => err instanceof SessionConnectionError && err.code === "websocket_unavailable",
  );
});

test("start: a refused token request is a SessionConnectionError with the vendor's 401 text", async () => {
  server.tokenStatus = 401;
  await assert.rejects(
    Conversation.startSession({ agentId: AGENT, origin: "https://api.test" }),
    (err: unknown) =>
      err instanceof SessionConnectionError &&
      err.status === 401 &&
      err.message.startsWith("Your agent has authentication enabled"),
  );
});

test("start: a conversation token is redeemed on the offer and the answer's descriptor is adopted (Q6)", async () => {
  const conversation = await Conversation.startSession({
    conversationToken: "cvsig_ffffffffffffffffffffffffffffffff",
    signalingUrl: "https://preview.test/api/offer",
  });
  assert.equal(server.calls.filter((c) => c.url.includes("/token")).length, 0, "no token request");
  const offer = server.calls[0]!;
  assert.deepEqual(offer.body, {
    conversation_token: "cvsig_ffffffffffffffffffffffffffffffff",
    sdp: offer.body!.sdp,
    type: "offer",
  });
  assert.equal(conversation.getId(), "conv_22222222222222222222222222222222");
  await conversation.endSession();
  const teardown = server.calls.at(-1)!;
  assert.equal(teardown.url, "https://preview.test/api/disconnect");
  assert.deepEqual(teardown.body, { session_id: "sess_redeemed", session_token: "st_redeemed" });
});

test("start: a conversation token session uses the ICE servers handed over with the token", async () => {
  const turn = { urls: ["turn:turn.test:3478"], username: "u", credential: "c" };
  const conversation = await Conversation.startSession({
    conversationToken: "cvsig_ffffffffffffffffffffffffffffffff",
    signalingUrl: "https://preview.test/api/offer",
    iceServers: [turn],
  });
  assert.deepEqual(peer().config?.iceServers, [turn]);
  await conversation.endSession();
});

test("start: a session the server ends before bot-ready rejects startSession (never hangs)", async () => {
  server.autoReady = false;
  const disconnects: unknown[] = [];
  const starting = Conversation.startSession({
    agentId: AGENT,
    origin: "https://api.test",
    onDisconnect: (d) => disconnects.push(d),
  });
  await tick(10);
  peer().dc.deliver({ type: "server-message", data: { type: "session-ended", reason: "queue_timeout" } });
  await assert.rejects(
    starting,
    (err: unknown) => err instanceof SessionConnectionError && err.code === "session_ended",
  );
  assert.equal(disconnects.length, 1);
});

test("start: a peer that fails before bot-ready tears the session down before startSession rejects", async () => {
  server.autoReady = false;
  const starting = Conversation.startSession({ agentId: AGENT, origin: "https://api.test" });
  await tick(10);
  peer().moveTo("failed");
  await assert.rejects(starting, (err: unknown) => err instanceof SessionConnectionError);
  await tick(5);
  assert.equal(peer().connectionState, "closed", "the peer connection is closed");
  const teardown = server.calls.at(-1)!;
  assert.equal(teardown.url, "https://preview.test/api/disconnect");
});

test("start: options this transport cannot forward yet are reported once through onDebug", async () => {
  const debug: unknown[] = [];
  const conversation = await Conversation.startSession({
    agentId: AGENT,
    origin: "https://api.test",
    dynamicVariables: { name: "Dana" },
    overrides: { agent: { firstMessage: "Hi" } },
    onDebug: (d) => debug.push(d),
  });
  assert.deepEqual(
    debug.filter((d) => (d as { type?: string }).type === "ignored_options"),
    [{ type: "ignored_options", ignored: ["overrides", "dynamicVariables"] }],
  );
  await tick(2);
  await conversation.endSession();
});

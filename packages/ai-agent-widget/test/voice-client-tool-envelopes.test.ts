import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAppendToContextEnvelope,
  buildFunctionCallResultEnvelope,
  buildMcpToolApprovalEnvelope,
  clientToolCallFromRtvi,
  mcpToolCallDataFromRtvi,
} from "../src/voice";
import { mcpToolCallFromRecord } from "../src/client-tools";

test("llm-function-call-result envelope carries the vendor's three fields", () => {
  const envelope = buildFunctionCallResultEnvelope("call-1", '{"status":"active"}', false);
  assert.equal(envelope.label, "rtvi-ai");
  assert.equal(envelope.type, "llm-function-call-result");
  assert.ok(String(envelope.id).startsWith("tool-result-"));
  assert.deepEqual(envelope.data, {
    tool_call_id: "call-1",
    result: '{"status":"active"}',
    is_error: false,
  });
});

test("append-to-context envelope matches the E2 name and omits an unset context_id", () => {
  const plain = buildAppendToContextEnvelope("Gold tier now");
  assert.equal(plain.type, "append-to-context");
  assert.deepEqual(plain.data, { text: "Gold tier now" });
  const keyed = buildAppendToContextEnvelope("Cart: whitening kit", "cart");
  assert.deepEqual(keyed.data, { text: "Cart: whitening kit", context_id: "cart" });
});

test("llm-function-call is decoded into a client tool call; other messages are not", () => {
  const call = clientToolCallFromRtvi({
    label: "rtvi-ai",
    type: "llm-function-call",
    data: {
      function_name: "lookup_policy",
      tool_call_id: "call-1",
      args: { policy_number: "POL-88213" },
      expects_response: true,
      response_timeout_secs: 20,
    },
  });
  assert.deepEqual(call, {
    toolName: "lookup_policy",
    toolCallId: "call-1",
    parameters: { policy_number: "POL-88213" },
    expectsResponse: true,
    responseTimeoutSecs: 20,
  });
  // A pre-E3 emitter (no expects_response) is treated as waiting.
  const legacy = clientToolCallFromRtvi({
    type: "llm-function-call",
    data: { function_name: "f", tool_call_id: "c", args: {} },
  });
  assert.equal(legacy?.expectsResponse, true);
  assert.equal(clientToolCallFromRtvi({ type: "bot-output", data: { text: "hi" } }), null);
  assert.equal(clientToolCallFromRtvi({ type: "llm-function-call", data: { tool_call_id: "c" } }), null);
});

test("mcp-tool-approval-result envelope carries the vendor's two fields (E3 §4.6)", () => {
  const yes = buildMcpToolApprovalEnvelope("call-7", true);
  assert.equal(yes.label, "rtvi-ai");
  assert.equal(yes.type, "mcp-tool-approval-result");
  assert.ok(String(yes.id).startsWith("mcp-approval-"));
  assert.deepEqual(yes.data, { tool_call_id: "call-7", is_approved: true });
  assert.deepEqual(buildMcpToolApprovalEnvelope("call-8", false).data, {
    tool_call_id: "call-8",
    is_approved: false,
  });
});

test("mcp-tool-call is decoded into an MCP call on voice and chat shapes alike", () => {
  const data = mcpToolCallDataFromRtvi({
    label: "rtvi-ai",
    type: "mcp-tool-call",
    data: {
      service_id: "srv-1",
      tool_call_id: "call-7",
      tool_name: "search",
      parameters: { q: "x" },
      state: "awaiting_approval",
      approval_timeout_secs: 30,
    },
  });
  assert.ok(data);
  assert.deepEqual(mcpToolCallFromRecord(data ?? undefined), {
    serviceId: "srv-1",
    toolCallId: "call-7",
    toolName: "search",
    parameters: { q: "x" },
    state: "awaiting_approval",
    approvalTimeoutSecs: 30,
  });
  // The SSE frame is the same record with a `type` tag.
  const failed = mcpToolCallFromRecord({
    type: "mcp_tool_call",
    service_id: "srv-1",
    tool_call_id: "call-7",
    tool_name: "search",
    parameters: {},
    state: "failure",
    error_message: "approval_denied",
  });
  assert.equal(failed?.state, "failure");
  assert.equal(failed?.errorMessage, "approval_denied");
  assert.equal(mcpToolCallDataFromRtvi({ type: "bot-output", data: { text: "hi" } }), null);
  assert.equal(mcpToolCallFromRecord({ tool_call_id: "c" }), null);
});

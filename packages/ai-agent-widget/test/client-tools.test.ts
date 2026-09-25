import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_TOOL_SUCCESS_LITERAL,
  runClientTool,
  stringifyClientToolResult,
  undefinedClientToolLiteral,
  type ClientToolCall,
} from "../src/client-tools";

const call = (name: string, parameters: Record<string, unknown> = {}): ClientToolCall => ({
  toolName: name,
  toolCallId: "call-1",
  parameters,
  expectsResponse: true,
});

test("an unregistered tool is answered at once with the vendor SDK literal", async () => {
  const answer = await runClientTool({}, call("lookup_policy"));
  assert.deepEqual(answer, {
    result: undefinedClientToolLiteral("lookup_policy"),
    isError: true,
  });
  assert.equal(answer?.result, "Client tool with name lookup_policy is not defined on client");
});

test("onUnhandledClientToolCall takes the call and nothing is sent", async () => {
  const seen: string[] = [];
  const answer = await runClientTool({}, call("lookup_policy"), (c) => seen.push(c.toolName));
  assert.equal(answer, null);
  assert.deepEqual(seen, ["lookup_policy"]);
});

test("handler results follow the SDK: undefined literal, strings verbatim, objects stringified", async () => {
  assert.equal(stringifyClientToolResult(undefined), CLIENT_TOOL_SUCCESS_LITERAL);
  assert.equal(stringifyClientToolResult("plain"), "plain");
  assert.equal(stringifyClientToolResult({ status: "active", premium: 412.5 }), '{"status":"active","premium":412.5}');
  const answer = await runClientTool(
    { lookup_policy: (p) => ({ policy: p.policy_number, status: "active" }) },
    call("lookup_policy", { policy_number: "POL-88213" }),
  );
  assert.deepEqual(answer, { result: '{"policy":"POL-88213","status":"active"}', isError: false });
  const fire = await runClientTool({ open_form: () => undefined }, call("open_form"));
  assert.deepEqual(fire, { result: CLIENT_TOOL_SUCCESS_LITERAL, isError: false });
});

test("a thrown error becomes is_error with the SDK's message shape", async () => {
  const answer = await runClientTool(
    {
      lookup_policy: () => {
        throw new Error("CRM down");
      },
    },
    call("lookup_policy"),
  );
  assert.deepEqual(answer, { result: "Client tool execution failed: CRM down", isError: true });
  const rejected = await runClientTool({ lookup_policy: async () => Promise.reject("nope") }, call("lookup_policy"));
  assert.deepEqual(rejected, { result: "Client tool execution failed: nope", isError: true });
});

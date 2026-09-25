// Client tools — the embedding page's handlers for the agent's `client`
// tools (E3 §4.1.8, VOSO-756). The agent calls `lookup_policy`, the page
// runs its handler and the answer is sent back; the same registry serves a
// voice call (RTVI `llm-function-call` over the data channel) and a chat
// session (SSE `client_tool_call` + `POST …/tool-result`).
//
// Literals follow the vendor's JS SDK so a page ported from it behaves the
// same: an unregistered tool answers at once with an error (unless the
// page set `onUnhandledClientToolCall`, in which case nothing is sent and
// the agent's own timeout applies), a handler returning `undefined` sends
// "Client tool execution successful.", objects are JSON-stringified, and a
// thrown error becomes `is_error: true` with the message.

/** A page-side tool implementation: parameters in, result out. */
export type ClientToolHandler = (
  parameters: Record<string, unknown>,
) => unknown | Promise<unknown>;

/** The call the agent made, as the page sees it. */
export interface ClientToolCall {
  toolName: string;
  toolCallId: string;
  parameters: Record<string, unknown>;
  expectsResponse: boolean;
  responseTimeoutSecs?: number;
}

/** An MCP tool call that needs the page's approval (E3 §4.6; the vendor's
 *  `mcp_tool_call` with `state: "awaiting_approval"`). The page answers with
 *  `approveMcpTool(toolCallId, isApproved)` within `approvalTimeoutSecs`
 *  (30 s) or the agent is told the approval timed out. */
export interface McpToolCall {
  serviceId: string;
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  state: string;
  approvalTimeoutSecs?: number;
  result?: string;
  errorMessage?: string;
}

/** Parse one `mcp_tool_call`-shaped record (SSE frame or RTVI `data`). */
export function mcpToolCallFromRecord(data: Record<string, unknown> | undefined): McpToolCall | null {
  const toolCallId = data?.tool_call_id;
  const toolName = data?.tool_name;
  const state = data?.state;
  if (typeof toolCallId !== "string" || typeof toolName !== "string" || typeof state !== "string") {
    return null;
  }
  const params = data?.parameters;
  const parameters =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  return {
    serviceId: typeof data?.service_id === "string" ? data.service_id : "",
    toolCallId,
    toolName,
    parameters,
    state,
    ...(typeof data?.approval_timeout_secs === "number"
      ? { approvalTimeoutSecs: data.approval_timeout_secs }
      : {}),
    ...(typeof data?.result === "string" ? { result: data.result } : {}),
    ...(typeof data?.error_message === "string" ? { errorMessage: data.error_message } : {}),
  };
}

/** The answer sent back over either channel. */
export interface ClientToolAnswer {
  result: string;
  isError: boolean;
}

export const CLIENT_TOOL_SUCCESS_LITERAL = "Client tool execution successful.";

/** The vendor SDK's text for a tool the page did not register. */
export function undefinedClientToolLiteral(name: string): string {
  return `Client tool with name ${name} is not defined on client`;
}

/** Stringify a handler's return value the way the vendor SDK does. */
export function stringifyClientToolResult(value: unknown): string {
  if (value === undefined) return CLIENT_TOOL_SUCCESS_LITERAL;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Run one client tool call against the page's registry. Resolves to the
 * answer to send, or `null` when the tool is unregistered AND the page
 * installed `onUnhandled` (then the hook owns the call and nothing is sent).
 */
export async function runClientTool(
  handlers: Record<string, ClientToolHandler>,
  call: ClientToolCall,
  onUnhandled?: (call: ClientToolCall) => void,
): Promise<ClientToolAnswer | null> {
  const handler = handlers[call.toolName];
  if (typeof handler !== "function") {
    if (onUnhandled) {
      try {
        onUnhandled(call);
      } catch {
        /* the hook's failure is the page's business */
      }
      return null;
    }
    return { result: undefinedClientToolLiteral(call.toolName), isError: true };
  }
  try {
    const value = await handler(call.parameters);
    return { result: stringifyClientToolResult(value), isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: `Client tool execution failed: ${message}`, isError: true };
  }
}

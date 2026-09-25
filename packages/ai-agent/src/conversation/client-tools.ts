// Client tool semantics, verbatim from the vendor's client (E4 plan §1.1).
import type { ClientToolsConfig } from "../types";

export interface ClientToolOutcome {
  result: string;
  isError: boolean;
  /** Set when the call must also be reported through `onError`. */
  error?: { message: string; context?: unknown };
}

/** Run `toolName` from `tools`; `null` when it is not defined there. */
export async function runClientTool(
  tools: ClientToolsConfig["clientTools"] | undefined,
  toolName: string,
  parameters: unknown,
): Promise<ClientToolOutcome | null> {
  if (!tools || !Object.prototype.hasOwnProperty.call(tools, toolName)) return null;
  try {
    const value = await tools[toolName]!(parameters);
    if (value === undefined) return { result: "Client tool execution successful.", isError: false };
    return {
      result: typeof value === "object" ? JSON.stringify(value) : String(value),
      isError: false,
    };
  } catch (err) {
    const message = `Client tool execution failed with following error: ${err instanceof Error ? err.message : String(err)}`;
    return { result: message, isError: true, error: { message, context: { clientToolName: toolName } } };
  }
}

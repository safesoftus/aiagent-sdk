/**
 * A session could not start (bad `agentId`, a refused token, an unsupported
 * option combination). `code` is a stable machine-readable reason.
 */
export class SessionConnectionError extends Error {
  override readonly name = "SessionConnectionError";
  constructor(
    message: string,
    readonly code: string,
    /** HTTP status of a refused token request, when there was one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

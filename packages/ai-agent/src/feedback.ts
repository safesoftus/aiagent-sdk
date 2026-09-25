// postOverallFeedback — the vendor's end-of-conversation feedback, BOTH shapes
// natively (E4 Q16, no lossy mapping): `like` → the thumbs column,
// `{rating 1–5, comment?}` → rating + comment. One route stores both in the
// ONE feedback store (E5 D8 / E2 D-10, the whole-conversation row):
// `POST {origin}/v1/convai/conversations/{id}/feedback` with the vendor's
// body `{feedback: "like" | "dislike"}` or `{rating, comment?}`. Validation
// (rating range, conflicts) is the server's; the SDK adds none.
import { platform } from "./internal/platform";
import { DEFAULT_ORIGIN } from "./internal/session-resolver";

export type OverallFeedback = boolean | { rating: number; comment?: string };

/** The request body for one vote — exported for tests (the wire contract). */
export function overallFeedbackBody(feedback: OverallFeedback): Record<string, unknown> {
  if (typeof feedback === "boolean") return { feedback: feedback ? "like" : "dislike" };
  const body: Record<string, unknown> = { rating: feedback.rating };
  if (feedback.comment !== undefined) body.comment = feedback.comment;
  return body;
}

/**
 * Store the whole-conversation vote. `conversationId` is `getId()` of the
 * session (`conv_…`). `authorization` (our addition, optional): the route
 * authenticates with your API key (`history: write`), so call it from your
 * server with the key; a keyless browser call is refused (401). Rejects with
 * the status on any non-2xx answer.
 */
export async function postOverallFeedback(
  conversationId: string,
  feedback: OverallFeedback,
  origin: string = DEFAULT_ORIGIN,
  authorization?: string,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers["Authorization"] = `Bearer ${authorization}`;
  const res = await platform().fetch(
    `${origin.replace(/\/+$/, "")}/v1/convai/conversations/${encodeURIComponent(conversationId)}/feedback`,
    { method: "POST", headers, body: JSON.stringify(overallFeedbackBody(feedback)) },
  );
  if (!res.ok) throw new Error(`Feedback was not stored (${res.status})`);
}

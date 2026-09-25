// E4 Q10: a random per-browser user id persisted in localStorage — never a
// fingerprint. Storage may be missing or throw (private mode): then the id
// lives for this page only.
const KEY = "convoso_ai_agent_user_id";

export function persistentUserId(): string {
  const fresh = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return fresh();
    const existing = storage.getItem(KEY);
    if (existing) return existing;
    const id = fresh();
    storage.setItem(KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

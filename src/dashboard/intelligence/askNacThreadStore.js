/**
 * Browser-local Ask NAC conversations. This is not server sync.
 * Scope to authenticated user and branch; expire old transcripts and bound storage.
 */
const PREFIX = "nac:ask-nac:threads:v2";
const MAX_THREADS = 20;
const MAX_MESSAGES = 60;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function conversationStorageKey(userId, branch) {
  if (!userId) return null;
  return `${PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(branch || "all")}`;
}

export function loadAskNacThreads(storage, key, now = Date.now()) {
  if (!storage || !key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((thread) =>
      thread && typeof thread.id === "string" &&
      typeof thread.updatedAt === "number" &&
      thread.updatedAt <= now &&
      now - thread.updatedAt < MAX_AGE_MS &&
      Array.isArray(thread.messages)
    ).slice(0, MAX_THREADS).map((thread) => ({
      ...thread,
      messages: thread.messages.slice(-MAX_MESSAGES),
    }));
  } catch {
    return [];
  }
}

export function saveAskNacThreads(storage, key, threads) {
  if (!storage || !key) return false;
  try {
    const bounded = threads.slice(0, MAX_THREADS).map((thread) => ({
      id: thread.id,
      title: String(thread.title || "New conversation").slice(0, 90),
      updatedAt: thread.updatedAt,
      messages: (thread.messages || []).slice(-MAX_MESSAGES),
      context: thread.context || null,
    }));
    storage.setItem(key, JSON.stringify(bounded));
    return true;
  } catch {
    return false;
  }
}

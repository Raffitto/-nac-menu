import { conversationStorageKey, loadAskNacThreads, saveAskNacThreads } from "./askNacThreadStore";

const makeStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
};

describe("Ask NAC conversation history", () => {
  test("isolates users and branches", () => {
    expect(conversationStorageKey("user-a", "khobar")).not.toBe(conversationStorageKey("user-a", "riyadh"));
    expect(conversationStorageKey("user-a", "khobar")).not.toBe(conversationStorageKey("user-b", "khobar"));
    expect(conversationStorageKey(null, "khobar")).toBeNull();
  });
  test("saves and restores a bounded conversation", () => {
    const storage = makeStorage();
    const key = conversationStorageKey("user", "khobar");
    const now = Date.now();
    const threads = [{ id: "one", title: "Guest complaints", updatedAt: now, messages: [{ role: "user", content: "Complaints?" }], context: { lastQuestion: "Complaints?" } }];
    expect(saveAskNacThreads(storage, key, threads)).toBe(true);
    expect(loadAskNacThreads(storage, key, now)).toEqual(threads);
  });
  test("drops expired conversations and handles corrupted storage", () => {
    const storage = makeStorage();
    const key = conversationStorageKey("user", "khobar");
    const now = Date.now();
    saveAskNacThreads(storage, key, [{ id: "expired", title: "Old", updatedAt: now - 9 * 86400000, messages: [] }]);
    expect(loadAskNacThreads(storage, key, now)).toEqual([]);
    storage.setItem(key, "bad json");
    expect(loadAskNacThreads(storage, key, now)).toEqual([]);
  });
});

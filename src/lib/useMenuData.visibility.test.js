import { renderHook, act, waitFor } from "@testing-library/react";
import { useMenuData } from "./useMenuData";
import { getFullMenu } from "./menuApi";
jest.mock("./menuApi", () => ({ getFullMenu: jest.fn(), invalidateMenuCache: jest.fn(), MENU_CACHE_KEY: "test-menu" }));
jest.mock("./supabase", () => ({ isSupabaseConfigured: () => true, supabase: {
  channel: () => { const chain = { on: () => chain, subscribe: () => chain }; return chain; }, removeChannel: jest.fn(),
} }));
afterEach(() => jest.useRealTimers());
test("filtered hidden rows still schedule a refetch and automatically return in an open guest tab", async () => {
  jest.useFakeTimers();
  const expiry = Date.now() + 60000;
  getFullMenu.mockResolvedValueOnce({ data: { categories: [{ id: "daytime" }], menuData: { daytime: [] }, visibilityExpiryMs: expiry } })
    .mockResolvedValue({ data: { categories: [{ id: "daytime" }], menuData: { daytime: [{ items: [{ id: "restored", active: true }] }] }, visibilityExpiryMs: null } });
  const { result, unmount } = renderHook(() => useMenuData({}));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.menuData.daytime).toEqual([]);
  await act(async () => { jest.advanceTimersByTime(61000); });
  await waitFor(() => expect(result.current.menuData.daytime[0].items[0].id).toBe("restored"));
  expect(getFullMenu).toHaveBeenCalledTimes(2);
  unmount();
});

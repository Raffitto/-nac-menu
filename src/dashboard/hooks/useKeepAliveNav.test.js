import { act, renderHook } from "@testing-library/react";
import useKeepAliveNav from "./useKeepAliveNav";

describe("useKeepAliveNav", () => {
  test("starts with overview mounted and active", () => {
    const { result } = renderHook(() => useKeepAliveNav("overview"));
    expect(result.current.activeView).toBe("overview");
    expect(result.current.isMounted("overview")).toBe(true);
    expect(result.current.isMounted("menu")).toBe(false);
  });

  test("keeps previous views mounted after navigation", () => {
    const { result } = renderHook(() => useKeepAliveNav("overview"));
    act(() => {
      result.current.setActiveView("menu");
    });
    expect(result.current.activeView).toBe("menu");
    expect(result.current.isMounted("overview")).toBe(true);
    expect(result.current.isMounted("menu")).toBe(true);
    act(() => {
      result.current.setActiveView("settings");
    });
    expect(result.current.isMounted("menu")).toBe(true);
    expect(result.current.isMounted("settings")).toBe(true);
  });

  test("schedules delayed prefetch importer", () => {
    jest.useFakeTimers();
    const importer = jest.fn(() => Promise.resolve({ default: {} }));
    const { result } = renderHook(() => useKeepAliveNav("overview"));
    act(() => {
      result.current.schedulePrefetch("reviews", importer, 120);
    });
    expect(importer).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(120);
    });
    expect(importer).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

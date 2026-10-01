import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import NacActionPresenter from "./NacActionPresenter";
import { beginGuardedAction, endGuardedAction, resetGuardedActions } from "../../lib/nacActionGuard";

describe("NAC action presenter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => { resetGuardedActions(); });
  });

  afterEach(() => {
    act(() => { resetGuardedActions(); });
    jest.useRealTimers();
  });

  test("locks immediately and waits before showing the animation", () => {
    render(<NacActionPresenter />);
    act(() => {
      beginGuardedAction({ id: "post", scope: "global", label: "Posting receipt…" });
    });
    expect(screen.getByTestId("nac-action-shield")).toBeInTheDocument();
    expect(screen.queryByTestId("nac-action-overlay")).not.toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(300); });
    expect(screen.getByTestId("nac-action-overlay")).toHaveTextContent("Posting receipt…");
    act(() => { jest.advanceTimersByTime(8000); });
    expect(screen.getByTestId("nac-action-overlay")).toHaveTextContent(/Still working/);
  });

  test("a fast action does not flash the card", () => {
    render(<NacActionPresenter />);
    act(() => {
      beginGuardedAction({ id: "save", scope: "global", label: "Saving…" });
      endGuardedAction("save");
    });
    act(() => { jest.advanceTimersByTime(400); });
    expect(screen.queryByTestId("nac-action-shield")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nac-action-overlay")).not.toBeInTheDocument();
  });

  test("a local action does not cover the page", () => {
    render(
      <>
        <button type="button">Refresh report</button>
        <NacActionPresenter />
      </>
    );
    act(() => {
      beginGuardedAction({ id: "report", scope: "local", label: "Refreshing intelligence…" });
    });
    expect(screen.queryByTestId("nac-action-shield")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh report" })).toBeEnabled();
  });

  test("keyboard activation is blocked while a global action is locked", () => {
    render(<button type="button">Publish changes</button>);
    render(<NacActionPresenter />);
    act(() => {
      beginGuardedAction({ id: "publish", scope: "global", label: "Publishing menu…" });
    });
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByTestId("nac-action-shield"));
    expect(screen.getByTestId("nac-action-shield")).toBeInTheDocument();
  });

  test("unmount clears timers and leaves the lock for the mutation to finish", () => {
    const view = render(<NacActionPresenter />);
    act(() => {
      beginGuardedAction({ id: "post", scope: "global", label: "Posting receipt…" });
    });
    view.unmount();
    expect(() => {
      act(() => { jest.advanceTimersByTime(8000); });
    }).not.toThrow();
    endGuardedAction("post");
  });
});

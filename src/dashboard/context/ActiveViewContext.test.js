import { ActiveViewProvider, useIsViewActive, useActiveView } from "./ActiveViewContext";
import { render, screen } from "@testing-library/react";

function Probe({ viewId }) {
  const active = useIsViewActive(viewId);
  const { activeView } = useActiveView();
  return (
    <div>
      <span data-testid="active-view">{activeView}</span>
      <span data-testid="is-active">{String(active)}</span>
    </div>
  );
}

describe("ActiveViewContext", () => {
  test("reports active view and gates isActive", () => {
    const { rerender } = render(
      <ActiveViewProvider activeView="overview">
        <Probe viewId="overview" />
      </ActiveViewProvider>,
    );
    expect(screen.getByTestId("active-view").textContent).toBe("overview");
    expect(screen.getByTestId("is-active").textContent).toBe("true");

    rerender(
      <ActiveViewProvider activeView="menu">
        <Probe viewId="overview" />
      </ActiveViewProvider>,
    );
    expect(screen.getByTestId("active-view").textContent).toBe("menu");
    expect(screen.getByTestId("is-active").textContent).toBe("false");
  });
});

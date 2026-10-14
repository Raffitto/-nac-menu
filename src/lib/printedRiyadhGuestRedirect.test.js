import fs from "fs";
import path from "path";
import vm from "vm";
import {
  detectReviewQrMode,
  shouldRedirectPrintedRiyadhGuestToMenu,
} from "./reviewPortalParams";

const PRINTED = "https://nacmenu.netlify.app/?store=riyadh&role=guest&app=review";
const HOME = "https://nacmenu.netlify.app/";

function route(url) {
  const parsed = new URL(url);
  const location = {
    href: parsed.href,
    hostname: parsed.hostname,
    search: parsed.search,
    pathname: parsed.pathname,
    replaced: null,
    replace(next) {
      this.replaced = next;
      this.href = next;
    },
  };
  const window = { location };
  vm.runInNewContext(
    fs.readFileSync(path.join(process.cwd(), "public/review-routing.js"), "utf8"),
    { window, console, URLSearchParams, URL },
  );
  return {
    href: location.href,
    replaced: location.replaced,
    review: window.__NAC_REVIEW_MODE__,
  };
}

describe("printed Riyadh guest review QR", () => {
  test("the exact printed URL opens the menu homepage", () => {
    const result = route(PRINTED);
    expect(result.replaced).toBe(HOME);
    expect(result.href).toBe(HOME);
    expect(shouldRedirectPrintedRiyadhGuestToMenu(
      "?store=riyadh&role=guest&app=review",
      "nacmenu.netlify.app",
    )).toBe(true);
    expect(detectReviewQrMode(
      "?store=riyadh&role=guest&app=review",
      "nacmenu.netlify.app",
    )).toBe(false);
  });

  test("parameter order does not matter", () => {
    const result = route("https://nacmenu.netlify.app/?app=review&role=guest&store=riyadh");
    expect(result.replaced).toBe(HOME);
  });

  test("the normal homepage is not redirected", () => {
    const result = route(HOME);
    expect(result.replaced).toBeNull();
    expect(result.href).toBe(HOME);
    expect(result.review).toBe(false);
  });

  test("other review QR codes stay on the review flow", () => {
    const staff = route(
      "https://nacmenu.netlify.app/?store=riyadh&s=masud-ali&role=waiter&app=review",
    );
    expect(staff.replaced).toBeNull();
    expect(staff.review).toBe(true);

    const khobar = route(
      "https://nacmenu.netlify.app/?store=khobar&role=guest&app=review",
    );
    expect(khobar.replaced).toBeNull();
    expect(khobar.review).toBe(true);

    const extra = route(
      "https://nacmenu.netlify.app/?store=riyadh&role=guest&app=review&s=guest",
    );
    expect(extra.replaced).toBeNull();
    expect(extra.review).toBe(true);
  });

  test("the same query on another host is not sent to the nacmenu homepage", () => {
    const result = route("https://nacriyadh.netlify.app/?store=riyadh&role=guest&app=review");
    expect(result.replaced).not.toBe(HOME);
    expect(result.href).toBe(PRINTED);
  });
});

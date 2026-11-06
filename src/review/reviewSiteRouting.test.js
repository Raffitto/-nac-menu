import fs from "fs";
import path from "path";
import vm from "vm";
import cards from "./all15ReleaseCards.json";
import { detectReviewQrMode, parseReviewPortalParams } from "../lib/reviewPortalParams";

const routingScript = fs.readFileSync(
  path.join(process.cwd(), "public", "review-routing.js"),
  "utf8",
);

function runPreReactRouting(urlString) {
  const url = new URL(urlString);
  const redirects = [];
  const window = {
    location: {
      href: url.href,
      hostname: url.hostname,
      search: url.search,
      replace: (next) => redirects.push(next),
    },
  };
  vm.runInNewContext(routingScript, {
    window,
    URL,
    URLSearchParams,
    console: { log() {}, error() {} },
  });
  return { window, redirects };
}

test.each(cards)("$name QR keeps its printed host and review identity", (card) => {
  const source = new URL(card.url);
  const { window, redirects } = runPreReactRouting(card.url);
  const expectedHost = card.branch_id === "hettin"
    ? "nacmenu.netlify.app"
    : "nacriyadh.netlify.app";
  expect(source.hostname).toBe(expectedHost);
  expect(detectReviewQrMode(source.search, source.hostname)).toBe(true);

  if (card.branch_id === "hettin") {
    expect(redirects).toEqual([]);
    expect(window.__NAC_REVIEW_MODE__).toBe(true);
  } else {
    expect(redirects).toHaveLength(1);
    const destination = new URL(redirects[0]);
    expect(destination.origin).toBe("https://nacmenu.netlify.app");
    expect(destination.searchParams.get("app")).toBe("review");
    for (const key of ["store", "s", "role"]) {
      expect(destination.searchParams.get(key)).toBe(source.searchParams.get(key));
    }
    expect(parseReviewPortalParams(destination.search).normalizedBranch).toBe("riyadh");
  }
});

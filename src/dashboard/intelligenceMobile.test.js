import {
  MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS,
  MOBILE_INTELLIGENCE_MORE_SECTIONS,
  MOBILE_INTELLIGENCE_NAV,
} from "./navigation";
import { resolveAskNacSuggestions } from "./intelligence/askNacChatUtils";
import { MOBILE_INTELLIGENCE_BREAKPOINT_PX } from "./hooks/useMobileIntelligenceLayout";

describe("mobile intelligence navigation", () => {
  test("MOBILE_INTELLIGENCE_NAV defines ask plus more sections", () => {
    expect(MOBILE_INTELLIGENCE_NAV.map((item) => item.id)).toEqual([
      "ask",
      "dashboards",
      "vault",
      "settings",
    ]);
  });

  test("MOBILE_INTELLIGENCE_MORE_SECTIONS excludes ask", () => {
    expect(MOBILE_INTELLIGENCE_MORE_SECTIONS.map((item) => item.id)).toEqual([
      "dashboards",
      "vault",
      "settings",
    ]);
  });

  test("MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS excludes ask and uses new taxonomy", () => {
    expect(MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS).not.toContain("ask");
    expect(MOBILE_INTELLIGENCE_DASHBOARD_TAB_IDS).toEqual([
      "operations",
      "commercial",
      "market",
    ]);
  });
});

describe("resolveAskNacSuggestions mobile-first", () => {
  const allPrompts = Array.from({ length: 12 }, (_, index) => ({ text: `Prompt ${index + 1}` }));
  const mobilePrompts = allPrompts.slice(0, 4);

  test("mobile shows up to maxSuggestions before first message", () => {
    const result = resolveAskNacSuggestions({
      mobileFirst: true,
      maxSuggestions: 3,
      messageCount: 0,
      allPrompts,
      mobilePrompts,
    });
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("Prompt 1");
  });

  test("mobile collapses suggestions after first message", () => {
    expect(
      resolveAskNacSuggestions({
        mobileFirst: true,
        maxSuggestions: 3,
        messageCount: 1,
        allPrompts,
        mobilePrompts,
      }),
    ).toEqual([]);
  });

  test("desktop keeps post-chat suggestion chips", () => {
    const result = resolveAskNacSuggestions({
      mobileFirst: false,
      maxSuggestions: 8,
      messageCount: 2,
      allPrompts,
      mobilePrompts,
    });
    expect(result).toHaveLength(8);
  });
});

describe("mobile intelligence breakpoint", () => {
  test("uses 768px phone/tablet threshold", () => {
    expect(MOBILE_INTELLIGENCE_BREAKPOINT_PX).toBe(768);
  });
});

import { useEffect, useState } from "react";

/** Phone / narrow tablet — Intelligence uses AI-first mobile shell. */
export const MOBILE_INTELLIGENCE_BREAKPOINT_PX = 768;

function getMobileMatchQuery() {
  if (typeof window === "undefined") return null;
  return window.matchMedia(`(max-width: ${MOBILE_INTELLIGENCE_BREAKPOINT_PX}px)`);
}

export function isMobileIntelligenceViewport() {
  const mq = getMobileMatchQuery();
  return mq ? mq.matches : false;
}

/** Responsive hook — desktop Intelligence layout unchanged above breakpoint. */
export function useMobileIntelligenceLayout() {
  const [isMobile, setIsMobile] = useState(() => isMobileIntelligenceViewport());

  useEffect(() => {
    const mq = getMobileMatchQuery();
    if (!mq) return undefined;

    const onChange = (event) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

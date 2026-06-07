import { useMemo } from "react";
import { isAskNacServerConfigured } from "../../intelligence/askNac";

/** Connection / narration badge for Ask NAC header (UI only). */
export function useAskNacConnectionStatus({ messages = [], session = null }) {
  const lastResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.response) return msg.response;
    }
    return null;
  }, [messages]);

  const serverConfigured = isAskNacServerConfigured();
  const serverConnected = lastResponse?.serverConnected === true;
  const localFallback = lastResponse?.localFallback === true;
  const aiConnected = lastResponse?.aiConnected === true;
  const aiExplained = lastResponse?.isAiGenerated === true;

  return useMemo(() => {
    if (aiExplained) {
      return { label: "AI explained", shortLabel: "AI explained", tone: "ai" };
    }
    if (lastResponse && aiConnected) {
      return { label: "AI connected", shortLabel: "AI Connected", tone: "connected" };
    }
    if (lastResponse && serverConnected && !localFallback) {
      return { label: "Verified deterministic", shortLabel: "Verified", tone: "connected" };
    }
    if (lastResponse && localFallback) {
      return { label: "Local fallback", shortLabel: "Local", tone: "local" };
    }
    if (serverConfigured && session?.access_token) {
      return { label: "AI connected", shortLabel: "AI Connected", tone: "connected" };
    }
    if (serverConfigured) {
      return { label: "Local fallback", shortLabel: "Local", tone: "local" };
    }
    return { label: "Local fallback", shortLabel: "Local", tone: "local" };
  }, [aiExplained, aiConnected, lastResponse, serverConnected, localFallback, serverConfigured, session]);
}

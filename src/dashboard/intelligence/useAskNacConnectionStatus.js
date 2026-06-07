import { useMemo } from "react";
import { isAskNacServerConfigured } from "../../intelligence/askNac";
import { getMobileConnectionBadge } from "./askNacTrustLabels";

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

  return useMemo(
    () =>
      getMobileConnectionBadge({
        lastResponse,
        session,
        serverConfigured,
      }),
    [lastResponse, session, serverConfigured],
  );
}

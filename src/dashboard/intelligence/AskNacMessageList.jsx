import React, { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import AskNacAnswerCard from "./AskNacAnswerCard";

/**
 * Session chat transcript — user bubbles + assistant answer cards.
 */
export default function AskNacMessageList({
  messages = [],
  loading = false,
  filters = {},
  scrollAnchorRef = null,
  compact = false,
}) {
  const localAnchorRef = useRef(null);
  const anchorRef = scrollAnchorRef || localAnchorRef;
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const node = anchorRef.current;
    const scroller = node?.closest?.(".nac-ask-nac-chat--page, .nac-ask-nac-mobile__body");
    if (!scroller) return undefined;
    const onScroll = () => {
      const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      stickToBottomRef.current = distance < 120;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [anchorRef, messages.length]);

  useEffect(() => {
    if (!messages.length && !loading) return;
    const node = anchorRef.current;
    if (!node) return;
    const scroller = node.closest?.(".nac-ask-nac-chat--page, .nac-ask-nac-mobile__body");
    if (!stickToBottomRef.current) return;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, loading, anchorRef]);

  if (!messages.length && !loading) return null;

  return (
    <div className="nac-ask-nac-chat__messages" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <div key={message.id} className="nac-ask-nac-message nac-ask-nac-message--user">
              <div className="nac-ask-nac-user-bubble">{message.content}</div>
            </div>
          );
        }

        if (message.role === "assistant") {
          return (
            <div key={message.id} className="nac-ask-nac-message nac-ask-nac-message--assistant">
              {message.error ? (
                <div className="nac-ask-nac-error nac-glass-panel" role="alert">
                  {message.error}
                </div>
              ) : message.response ? (
                <AskNacAnswerCard
                  response={message.response}
                  question={message.question}
                  filters={filters}
                  variant={compact ? "mobile" : "desktop"}
                />
              ) : null}
            </div>
          );
        }

        return null;
      })}

      {loading ? (
        <div className="nac-ask-nac-message nac-ask-nac-message--assistant">
          {compact ? (
            <div className="nac-ask-nac-loading nac-ask-nac-loading--compact" aria-live="polite">
              <Loader2 size={18} className="nac-bi-spin" />
              <span>Querying verified metrics…</span>
            </div>
          ) : (
            <section className="nac-glass-panel nac-ask-nac-loading" aria-live="polite">
              <Loader2 size={22} className="nac-bi-spin" />
              <p>Querying verified metrics…</p>
            </section>
          )}
        </div>
      ) : null}

      <div ref={anchorRef} className="nac-ask-nac-chat__anchor" aria-hidden />
    </div>
  );
}

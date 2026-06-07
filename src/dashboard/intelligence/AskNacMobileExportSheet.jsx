import React, { useEffect, useState } from "react";
import { Share2, X } from "lucide-react";
import { ASK_NAC_EXPORT_ACTIONS, useAskNacExport } from "../../intelligence/askNac/export/useAskNacExport";

export default function AskNacMobileExportSheet({
  question,
  response,
  filters = {},
  onStatus,
}) {
  const [open, setOpen] = useState(false);
  const { busy, canExport, runExport, isDisabled } = useAskNacExport({
    question,
    response,
    filters,
    onStatus,
  });

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!canExport) return null;

  return (
    <>
      <button
        type="button"
        className="nac-ask-nac-mobile-export-trigger"
        aria-label="Export answer"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Share2 size={16} aria-hidden />
        <span>Export</span>
      </button>

      {open ? (
        <div className="nac-ask-nac-mobile-export" role="presentation">
          <button
            type="button"
            className="nac-ask-nac-mobile-export__backdrop"
            aria-label="Close export menu"
            onClick={() => setOpen(false)}
          />
          <div
            className="nac-ask-nac-mobile-export__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Export answer"
          >
            <div className="nac-ask-nac-mobile-export__head">
              <span>Export</span>
              <button
                type="button"
                className="nac-ask-nac-mobile-export__close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="nac-ask-nac-mobile-export__items">
              {ASK_NAC_EXPORT_ACTIONS.map(({ id, label, title }) => (
                <button
                  key={id}
                  type="button"
                  className="nac-ask-nac-mobile-export__item"
                  title={title}
                  disabled={isDisabled(id)}
                  aria-busy={busy === id}
                  onClick={() => {
                    runExport(id);
                    setOpen(false);
                  }}
                >
                  <span>{busy === id ? "…" : label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { summarizeDiffForPublish } from "../../lib/menuPublishDiff";

export default function MenuPublishDiffSheet({
  open,
  diff,
  liveVersion = null,
  publishing = false,
  readOnly = false,
  onClose,
  onConfirmPublish,
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeDiffForPublish(diff), [diff]);

  if (!open) return null;

  const risky = summary.risk?.largeBatch || summary.risk?.manyPrices || summary.risk?.manyHidden;

  return (
    <div className="mm-sheet-backdrop" onClick={onClose} data-testid="publish-diff-sheet">
      <div
        className="mm-sheet mm-publish-diff-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Publish changes summary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mm-sheet-header">
          <div>
            <h3>{summary.headline}</h3>
            {liveVersion != null ? (
              <p className="mm-publish-diff-meta">Compared to live version {liveVersion}</p>
            ) : (
              <p className="mm-publish-diff-meta">First verified publication for this branch</p>
            )}
          </div>
          <button type="button" className="mm-btn mm-btn-secondary" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {summary.bullets.length ? (
          <ul className="mm-publish-diff-bullets">
            {summary.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : (
          <p className="mm-publish-diff-empty">Nothing guest-facing differs from the last published version.</p>
        )}

        {risky ? (
          <div className="mm-publish-diff-risk" role="status">
            <AlertTriangle size={14} aria-hidden="true" />
            Large or sensitive batch — review details before publishing.
          </div>
        ) : null}

        <button
          type="button"
          className="mm-publish-diff-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {expanded ? "Hide details" : "Show details"}
        </button>

        {expanded ? (
          <ul className="mm-publish-diff-details">
            {(diff?.changes || []).map((change) => (
              <li key={change.id}>
                <strong>{change.title}</strong>
                <ul>
                  {(change.summaryLines || []).map((line) => (
                    <li key={`${change.id}-${line}`}>{line}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mm-sheet-actions">
          <button type="button" className="mm-btn mm-btn-secondary" onClick={onClose}>
            Keep editing
          </button>
          <button
            type="button"
            className="mm-btn mm-btn-primary"
            data-testid="confirm-publish-changes"
            disabled={readOnly || publishing || !diff?.hasChanges}
            onClick={onConfirmPublish}
          >
            {publishing ? "Publishing…" : "Publish changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

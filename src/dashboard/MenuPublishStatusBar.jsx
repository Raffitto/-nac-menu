import React, { memo } from "react";
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, Loader2 } from "lucide-react";
import MenuManagerTooltip from "./MenuManagerTooltip";
import { MENU_TOOLTIPS } from "./menuManagerUx";

function MenuPublishStatusBar({
  state,
  friendlyError,
  publishing,
  onPublish,
  onRetry,
  liveMenuUrl,
  readOnly,
  lastPublishedLabel,
}) {
  const publishDisabled = publishing || readOnly;

  return (
    <div
      className={`mm-publish-bar mm-publish-bar--${state}`}
      data-testid="menu-publish-status-bar"
      role="status"
      aria-live="polite"
    >
      {state === "live" && (
        <>
          <CheckCircle2 size={16} className="mm-publish-bar-icon mm-publish-bar-icon--live" aria-hidden="true" />
          <span className="mm-publish-bar-message">
            Guest menu is up to date.
            {lastPublishedLabel ? (
              <span className="mm-publish-bar-meta" data-testid="publish-last-updated">
                {" "}
                Last updated {lastPublishedLabel}.
              </span>
            ) : null}
          </span>
        </>
      )}

      {state === "waiting" && (
        <>
          <Circle size={10} className="mm-publish-bar-icon mm-publish-bar-icon--waiting" aria-hidden="true" fill="currentColor" />
          <span className="mm-publish-bar-message">You have unpublished changes.</span>
          {!readOnly ? (
            <MenuManagerTooltip label={MENU_TOOLTIPS.publish}>
              <button
                type="button"
                className="mm-btn mm-btn-primary mm-publish-bar-action"
                onClick={onPublish}
                disabled={publishDisabled}
                aria-label="Publish menu changes to guest menu"
                data-testid="publish-menu-button"
              >
                Publish
              </button>
            </MenuManagerTooltip>
          ) : null}
        </>
      )}

      {state === "publishing" && (
        <>
          <Loader2 size={16} className="mm-publish-bar-icon mm-spin-icon" aria-hidden="true" />
          <span className="mm-publish-bar-message">Publishing menu…</span>
          <button
            type="button"
            className="mm-btn mm-btn-primary mm-publish-bar-action"
            disabled
            aria-disabled="true"
            data-testid="publish-menu-button"
          >
            Publish
          </button>
        </>
      )}

      {state === "failed" && (
        <>
          <AlertTriangle size={16} className="mm-publish-bar-icon mm-publish-bar-icon--failed" aria-hidden="true" />
          <span className="mm-publish-bar-message">
            Publishing failed.
            {friendlyError ? (
              <span className="mm-publish-bar-error" data-testid="publish-friendly-error">
                {" "}
                {friendlyError}
              </span>
            ) : null}
          </span>
          {!readOnly ? (
            <button
              type="button"
              className="mm-btn mm-btn-primary mm-publish-bar-action"
              onClick={onRetry}
              disabled={publishDisabled}
              data-testid="retry-publish-button"
            >
              Retry
            </button>
          ) : null}
        </>
      )}

      {liveMenuUrl ? (
        <a
          className="mm-publish-bar-link"
          href={liveMenuUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open live guest menu in a new tab"
        >
          <ExternalLink size={14} aria-hidden="true" />
          Live menu
        </a>
      ) : null}
    </div>
  );
}

export default memo(MenuPublishStatusBar);

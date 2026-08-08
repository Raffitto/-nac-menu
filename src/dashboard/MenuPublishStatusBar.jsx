import React, { memo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Eye,
  History,
  Loader2,
} from "lucide-react";
import MenuManagerTooltip from "./MenuManagerTooltip";
import { MENU_TOOLTIPS } from "./menuManagerUx";

function MenuPublishStatusBar({
  state,
  friendlyError,
  publishing,
  onPublish,
  onRetry,
  onPreview,
  onViewChanges,
  onViewVersions,
  liveMenuUrl,
  readOnly,
  lastPublishedLabel,
  liveVersion = null,
  pendingChangeCount = 0,
}) {
  const publishDisabled = publishing || readOnly || (state === "live" && pendingChangeCount < 1);
  const quietPublish = state === "live" && pendingChangeCount < 1;

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
            Guest menu is up to date
            {liveVersion != null ? (
              <span className="mm-publish-bar-meta"> · Version {liveVersion} live</span>
            ) : null}
            {lastPublishedLabel ? (
              <span className="mm-publish-bar-meta" data-testid="publish-last-updated">
                {" "}
                · {lastPublishedLabel}
              </span>
            ) : null}
            <span className="mm-publish-bar-meta"> · No unpublished guest-facing changes.</span>
          </span>
        </>
      )}

      {state === "waiting" && (
        <>
          <Circle size={10} className="mm-publish-bar-icon mm-publish-bar-icon--waiting" aria-hidden="true" fill="currentColor" />
          <span className="mm-publish-bar-message">
            Changes waiting
            <span className="mm-publish-bar-meta">
              {" "}
              · {pendingChangeCount > 0
                ? `${pendingChangeCount} unpublished guest-facing change${pendingChangeCount === 1 ? "" : "s"}.`
                : "Unpublished guest-facing changes."}
            </span>
          </span>
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
                Publish changes
              </button>
            </MenuManagerTooltip>
          ) : null}
        </>
      )}

      {state === "publishing" && (
        <>
          <Loader2 size={16} className="mm-publish-bar-icon mm-spin-icon" aria-hidden="true" />
          <span className="mm-publish-bar-message">
            Publishing…
            {liveVersion != null ? (
              <span className="mm-publish-bar-meta"> Preparing next version after {liveVersion}.</span>
            ) : null}
          </span>
          <button
            type="button"
            className="mm-btn mm-btn-primary mm-publish-bar-action"
            disabled
            aria-disabled="true"
            data-testid="publish-menu-button"
          >
            Publishing…
          </button>
        </>
      )}

      {state === "failed" && (
        <>
          <AlertTriangle size={16} className="mm-publish-bar-icon mm-publish-bar-icon--failed" aria-hidden="true" />
          <span className="mm-publish-bar-message">
            Publish failed
            <span className="mm-publish-bar-meta">
              {" "}
              · Changes are still saved as draft. Guest verified version unchanged.
            </span>
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
              disabled={publishing}
              data-testid="retry-publish-button"
            >
              Retry
            </button>
          ) : null}
        </>
      )}

      <div className="mm-publish-bar-tools">
        {onViewChanges ? (
          <button
            type="button"
            className="mm-publish-bar-linkish"
            onClick={onViewChanges}
            data-testid="view-unpublished-changes"
          >
            Changes
          </button>
        ) : null}
        {onPreview ? (
          <button
            type="button"
            className="mm-publish-bar-linkish"
            onClick={onPreview}
            data-testid="open-menu-preview"
          >
            <Eye size={13} aria-hidden="true" />
            Preview
          </button>
        ) : null}
        {onViewVersions ? (
          <button
            type="button"
            className="mm-publish-bar-linkish"
            onClick={onViewVersions}
            data-testid="open-version-history"
          >
            <History size={13} aria-hidden="true" />
            Versions
          </button>
        ) : null}
        {quietPublish && !readOnly ? (
          <button
            type="button"
            className="mm-btn mm-btn-secondary mm-publish-bar-action is-quiet"
            disabled
            data-testid="publish-menu-button"
            aria-label="Publish disabled — no unpublished changes"
          >
            Publish
          </button>
        ) : null}
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
    </div>
  );
}

export default memo(MenuPublishStatusBar);

import React, { useMemo, useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { diffMenuSnapshots, summarizeDiffForPublish } from "../../lib/menuPublishDiff";
import { fetchMenuPublicationById } from "../../lib/menuApi";
import { publicationListLabel } from "../../lib/menuPublishSnapshots";

export default function MenuVersionHistorySheet({
  open,
  history = [],
  livePublication = null,
  onClose,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [compare, setCompare] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const liveId = livePublication?.id;

  const rows = useMemo(() => history || [], [history]);

  if (!open) return null;

  const openDetail = async (row) => {
    setSelectedId(row.id);
    setCompare(null);
    setLoadingDetail(true);
    try {
      const { data, error } = await fetchMenuPublicationById(row.id);
      if (error) throw error;
      setDetail(data);
    } catch {
      setDetail(row);
    } finally {
      setLoadingDetail(false);
    }
  };

  const compareToLive = async (row) => {
    if (!livePublication?.snapshot || !row?.id) return;
    setLoadingDetail(true);
    try {
      const { data, error } = await fetchMenuPublicationById(row.id);
      if (error) throw error;
      const diff = diffMenuSnapshots(data?.snapshot, livePublication.snapshot);
      setCompare({
        fromVersion: data?.version,
        toVersion: livePublication.version,
        summary: summarizeDiffForPublish(diff),
        changes: diff.changes,
      });
      setDetail(data);
      setSelectedId(row.id);
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div className="mm-sheet-backdrop" onClick={onClose} data-testid="version-history-sheet">
      <div
        className="mm-sheet mm-version-history-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Menu version history"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mm-sheet-header">
          <h3>Menu versions</h3>
          <button type="button" className="mm-btn mm-btn-secondary" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <p className="mm-publish-diff-meta">
          Version restore remains deferred — rollback rewrites live branch tables and needs a safer confirmation path.
        </p>

        <ul className="mm-version-list">
          {rows.map((row) => {
            const isLive = row.id === liveId || (row.status === "live" && row.version === livePublication?.version);
            return (
              <li key={row.id} className={selectedId === row.id ? "is-selected" : ""}>
                <button type="button" className="mm-version-row" onClick={() => openDetail(row)}>
                  <span className="mm-version-row-title">
                    Version {row.version}
                    {isLive ? <span className="mm-version-live-pill">Live</span> : null}
                  </span>
                  <span className="mm-version-row-meta">{publicationListLabel(row)}</span>
                  {row.actor_email ? (
                    <span className="mm-version-row-meta">Published by {row.actor_email}</span>
                  ) : null}
                </button>
                {!isLive && livePublication?.snapshot ? (
                  <button
                    type="button"
                    className="mm-version-compare-btn"
                    onClick={() => compareToLive(row)}
                    aria-label={`Compare version ${row.version} with live`}
                  >
                    <GitCompareArrows size={14} />
                    Compare with live
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {loadingDetail ? <p className="mm-publish-diff-meta">Loading version…</p> : null}

        {detail ? (
          <div className="mm-version-detail" data-testid="version-detail">
            <h4>Version {detail.version}</h4>
            <p>Status: {detail.status}</p>
            {detail.actor_email ? <p>Actor: {detail.actor_email}</p> : null}
            {detail.change_summary?.action ? (
              <p>Action: {detail.change_summary.action}</p>
            ) : null}
          </div>
        ) : null}

        {compare ? (
          <div className="mm-version-compare" data-testid="version-compare">
            <h4>
              Compare v{compare.fromVersion} → v{compare.toVersion}
            </h4>
            <p>{compare.summary.headline}</p>
            <ul>
              {compare.summary.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

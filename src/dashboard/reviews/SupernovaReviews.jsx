import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import "../styles/supernova-reviews.css";

const QR_URL = "https://nac-os.netlify.app/r/supernova";

export default function SupernovaReviews() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!supabase) {
      setError("Scan statistics are unavailable: Supabase is not configured.");
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase.rpc("get_supernova_scan_summary", { p_days: days });
    if (queryError) {
      setSummary(null);
      setError("Scan statistics could not be loaded. Try again shortly.");
    } else setSummary(data);
    setLoading(false);
  }, [days]);

  useEffect(() => { refresh(); }, [refresh]);

  const history = Array.isArray(summary?.daily_history) ? summary.daily_history : [];
  const maxScans = Math.max(1, ...history.map((row) => Number(row.scans) || 0));
  const number = (value) => Number(value || 0).toLocaleString("en-US");

  return (
    <section className="supernova-reviews" aria-label="Supernova review QR scan performance">
      <div className="supernova-reviews__intro">
        <div>
          <p className="supernova-reviews__eyebrow">Supernova Burger Khobar</p>
          <h2>Google review QR</h2>
          <p>One QR for the whole brand. Each scan opens Google’s review form directly.</p>
        </div>
        <div className="supernova-reviews__actions">
          <a href="/supernova-review-card.pdf" download className="supernova-reviews__button">Download print card</a>
          <button type="button" className="supernova-reviews__button supernova-reviews__button--quiet" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="supernova-reviews__body">
        <div className="supernova-reviews__metrics" aria-live="polite">
          {[
            ["Total scans", summary?.total_scans],
            ["Today", summary?.today_scans],
            ["Last 7 days", summary?.last_7_days],
            ["Last 30 days", summary?.last_30_days],
            ["Approx. unique", summary?.approximate_unique_scans],
            ["Repeat scans", summary?.repeat_scans],
          ].map(([label, value]) => (
            <div className="supernova-reviews__metric" key={label}>
              <span>{label}</span>
              <strong>{loading && !summary ? "—" : number(value)}</strong>
            </div>
          ))}
        </div>

        <div className="supernova-reviews__qr-panel">
          <img src="/supernova-review-qr.png" alt="Supernova Google review QR code" width="220" height="220" />
          <div>
            <h3>Permanent QR link</h3>
            <a href={QR_URL} target="_blank" rel="noopener noreferrer">{QR_URL} <ExternalLink size={14} /></a>
            <p>Use the print card for customers. The link remains stable if Google changes the review address.</p>
          </div>
        </div>

        <div className="supernova-reviews__history-header">
          <div>
            <h3>Daily scan history</h3>
            <p>Days use Saudi Arabia local time.</p>
          </div>
          <label>Show <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>365 days</option>
          </select></label>
        </div>

        {error ? <p className="supernova-reviews__error" role="alert">{error}</p> : null}
        {!error && history.length > 0 && (
          <div className="supernova-reviews__history" role="table" aria-label="Daily Supernova QR scans">
            {[...history].reverse().map((row) => (
              <div className="supernova-reviews__history-row" role="row" key={row.date}>
                <time role="cell" dateTime={row.date}>{row.date}</time>
                <div role="cell" className="supernova-reviews__bar-track"><span style={{ width: `${Math.max(0, (Number(row.scans) || 0) / maxScans * 100)}%` }} /></div>
                <strong role="cell">{number(row.scans)}</strong>
              </div>
            ))}
          </div>
        )}
        <p className="supernova-reviews__note">Scans are QR opens, not confirmed Google review submissions. Unique scans are an estimate based on repeat visits from the same browser; private browsing or another device may count separately.</p>
      </div>
    </section>
  );
}

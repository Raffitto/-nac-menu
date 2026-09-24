import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const POLL_INTERVAL = 20000;

export default function LiveActivity({
  supabase,
  session,
  CATEGORY_NAMES,
  activeSessions: activeSessionsProp,
  enabled = true,
  status: statusProp = null,
}) {
  const [data, setData] = useState(null);
  const [pollStatus, setPollStatus] = useState("loading");
  const mountedRef = useRef(true);
  const inflightRef = useRef(false);
  const generationRef = useRef(0);
  const categoryMap = CATEGORY_NAMES || {};

  const fetchLive = useCallback(async () => {
    if (!enabled || !supabase || !session) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    const requestGen = generationRef.current + 1;
    generationRef.current = requestGen;
    try {
      const { data: result, error } = await supabase.rpc("get_live_activity");
      if (!mountedRef.current || requestGen !== generationRef.current) return;
      if (error || result == null) {
        setPollStatus((prev) => (prev === "success" ? "stale" : "unavailable"));
        return;
      }
      setData(result);
      setPollStatus("success");
    } catch (_) {
      if (mountedRef.current && requestGen === generationRef.current) {
        setPollStatus((prev) => (prev === "success" ? "stale" : "unavailable"));
      }
    } finally {
      inflightRef.current = false;
    }
  }, [supabase, session, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    mountedRef.current = true;
    fetchLive();
    const id = setInterval(fetchLive, POLL_INTERVAL);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchLive, enabled]);

  if (!supabase || !session) return null;

  const status = statusProp || pollStatus;
  const polledActive = data?.active_sessions;
  const activeSessions =
    activeSessionsProp != null && activeSessionsProp !== undefined
      ? activeSessionsProp
      : polledActive;
  const languages = data?.languages || {};
  const hotCategory = data?.hot_category ?? null;
  const recentItems = (data?.recent_items || []).slice(0, 8);
  const unavailable = status === "unavailable" || activeSessions == null;

  const hotCategoryName = hotCategory
    ? categoryMap[hotCategory] || hotCategory
    : "—";

  return (
    <motion.div
      className="nac-bi-live"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="nac-bi-live-header">
        <span className="nac-bi-live-dot" />
        <span>Guests Active Now</span>
      </div>

      <div className="nac-bi-live-count">
        {unavailable ? "—" : Number(activeSessions) || 0}
      </div>
      {unavailable ? (
        <p className="nac-bi-live-sub" style={{ opacity: 0.7, fontSize: 12 }}>
          Live guests unavailable — not a verified zero
        </p>
      ) : null}

      <div className="nac-bi-live-pills">
        {Object.entries(languages).map(([lang, count]) => (
          <span key={lang} className="nac-bi-live-pill">
            {lang.toUpperCase()}: {count}
          </span>
        ))}
      </div>

      {hotCategoryName && (
        <div className="nac-bi-live-hot">
          <span className="nac-bi-live-hot-label">Hot Category</span>
          <span className="nac-bi-live-hot-value">{hotCategoryName}</span>
        </div>
      )}

      <div className="nac-bi-live-stream">
        <AnimatePresence initial={false}>
          {recentItems.map((item, i) => (
            <motion.div
              key={item?.id || `${item?.name}-${i}`}
              className="nac-bi-live-stream-item"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <span className="nac-bi-live-stream-name">{item?.name || "Unknown"}</span>
              <span className="nac-bi-live-stream-time">
                {item?.timestamp
                  ? new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

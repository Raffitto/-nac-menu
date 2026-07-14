import React, { useCallback, useEffect, useRef, useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  QrCode,
  Star,
  Eye,
  FolderOpen,
  Languages,
  PlusCircle,
  MousePointerClick,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { branchDisplayName, rangeToSince } from "../utils/rangeState";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { applyPlatformFilters } from "../utils/platformFilterApply";
import { shouldCountReviewEvent } from "../utils/isProductionStaff";
import { resolveRbacQueryBranch } from "../../lib/rbacQueryScope";
import { resolveReviewScope } from "../../lib/unifiedReviewTruth";

const ICONS = {
  qr_scan: QrCode,
  review_page_open: Star,
  review_generate: Star,
  google_redirect: MousePointerClick,
  review_google_click: MousePointerClick,
  item_open: Eye,
  category_open: FolderOpen,
  language_button_click: Languages,
  add_on_click: PlusCircle,
  qr_session_start: QrCode,
};

function formatRelative(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

function eventLabel(row) {
  const t = row.event_type || "event";
  const staff = row.employee_name ? ` · ${row.employee_name}` : "";
  const branch = row.branch_id ? ` · ${branchDisplayName(row.branch_id)}` : "";
  if (t === "qr_scan") return `QR scan${staff}${branch}`;
  if (t === "google_redirect" || t === "review_google_click") return `Google review click${staff}${branch}`;
  if (t === "item_open") return `Item viewed${row.metadata?.item_name ? `: ${row.metadata.item_name}` : ""}${branch}`;
  if (t === "category_open") return `Category opened${branch}`;
  if (t === "language_button_click") {
    const lang = row.language || row.metadata?.language;
    return `Language → ${lang || "switched"}${branch}`;
  }
  if (t === "add_on_click") return `Add-on selected${branch}`;
  return `${t.replace(/_/g, " ")}${staff}${branch}`;
}

function normalizeRow(row, source) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    id: row.id || `${source}-${row.created_at}-${row.event_type}`,
    event_type: row.event_type,
    created_at: row.created_at,
    branch_id: row.branch_id || meta.branch_id || meta.branch,
    employee_name: row.employee_name || meta.employee_name || meta.staff_name,
    employee_role: row.employee_role || meta.employee_role || meta.role,
    language: row.language || meta.language,
    metadata: meta,
    source,
  };
}

function LiveActivityFeed({ maxItems = 25 }) {
  const filters = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const fetchRecent = useCallback(async () => {
    if (!supabase || !isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    const since = rangeToSince(filters?.selectedRange || "today");
    const requestedBranch = filters?.branch || null;
    const menuBranch = resolveRbacQueryBranch(rbac?.profile, requestedBranch);
    const reviewBranch = resolveReviewScope(rbac?.profile, requestedBranch).queryBranch;

    try {
      let menuQ = supabase
        .from("menu_events")
        .select("id,event_type,created_at,branch_id,metadata,language")
        .order("created_at", { ascending: false })
        .limit(40);
      let reviewQ = supabase
        .from("review_events")
        .select("id,event_type,created_at,branch_id,employee_name,employee_role,metadata")
        .order("created_at", { ascending: false })
        .limit(40);

      if (since) {
        menuQ = menuQ.gte("created_at", since);
        reviewQ = reviewQ.gte("created_at", since);
      }
      if (menuBranch) menuQ = menuQ.eq("branch_id", menuBranch);
      if (reviewBranch) reviewQ = reviewQ.eq("branch_id", reviewBranch);

      const [{ data: menu }, { data: review }] = await Promise.all([menuQ, reviewQ]);
      if (!mounted.current) return;

      const merged = applyPlatformFilters(
        [
          ...(menu || []).map((r) => normalizeRow(r, "menu")),
          ...(review || []).map((r) => normalizeRow(r, "review")),
        ],
        filters,
      )
        .filter((row) => {
          if (row.source !== "review") return true;
          return shouldCountReviewEvent({
            employee_name: row.employee_name,
            metadata: row.metadata,
            review_session_id: row.metadata?.review_session_id,
            event_source: row.metadata?.event_source,
          });
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, maxItems);

      setItems(merged);
    } catch {
      /* keep last items */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [maxItems, filters, rbac?.profile]);

  useEffect(() => {
    mounted.current = true;
    fetchRecent();
    const poll = setInterval(fetchRecent, 8000);

    if (!supabase) return () => clearInterval(poll);

    const channel = supabase
      .channel("nac-live-activity-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "review_events" },
        () => fetchRecent(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "menu_events" },
        () => fetchRecent(),
      )
      .subscribe();

    return () => {
      mounted.current = false;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [fetchRecent]);

  if (!isSupabaseConfigured()) {
    return <p className="nac-empty-state">Connect Supabase to enable live activity.</p>;
  }

  return (
    <div className="nac-glass-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 500 }}>Live activity</h3>
        <span className="nac-live-feed-time">
          <span className="nac-bi-live-pulse" style={{ width: 8, height: 8, display: "inline-block", marginRight: 6 }} />
          Real-time
        </span>
      </div>

      {loading && items.length === 0 ? (
        <motion.div className="nac-live-feed">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="nac-bi-skeleton" style={{ height: 56, borderRadius: 12 }} />
          ))}
        </motion.div>
      ) : items.length === 0 ? (
        <p className="nac-empty-state">No recent activity in this period.</p>
      ) : (
        <div className="nac-live-feed">
          <AnimatePresence initial={false}>
            {items.map((row) => {
              const Icon = ICONS[row.event_type] || Star;
              return (
                <motion.div
                  key={row.id}
                  className="nac-live-feed-item"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  layout
                >
                  <motion.div className="nac-live-feed-icon">
                    <Icon size={18} />
                  </motion.div>
                  <div>
                    <div style={{ fontSize: "0.88rem", color: "#f9f9f7" }}>{eventLabel(row)}</div>
                    <div className="nac-live-feed-meta">
                      {row.employee_name ? `${row.employee_name} · ` : ""}
                      {row.employee_role ? `${row.employee_role} · ` : ""}
                      {row.branch_id ? `${branchDisplayName(row.branch_id)} · ` : ""}
                      {row.source === "review" ? "Reviews" : "Menu"}
                    </div>
                  </div>
                  <span className="nac-live-feed-time">{formatRelative(row.created_at)}</span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default memo(LiveActivityFeed);

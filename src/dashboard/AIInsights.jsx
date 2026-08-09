import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Zap,
  TrendingUp,
  AlertTriangle,
  Users,
  Globe,
  ShoppingBag,
  FileText,
  ChevronRight,
  Filter,
  Send,
  Loader2,
  Info,
  ArrowRight,
  Clock,
  Activity,
} from "lucide-react";
import { isSupabaseConfigured } from "../lib/supabase";
import { getFoodicsIntelligenceContext } from "../lib/foodicsApi";
import { useMenuBiDashboardContext } from "./context/MenuBiDashboardContext";
import PlatformStatusBanner from "./components/PlatformStatusBanner";
import { defaultBranchId } from "./utils/rangeState";
import { fetchReviewIntelligence, fetchBranchComparison } from "./utils/unifiedIntelligenceApi";
import { buildEmployeePerformance } from "./engines/employeePerformanceEngine";
import {
  buildInsightCards,
  buildManagementSummary,
  getBestAction,
  answerQuestion,
  buildFoodicsInsightCards,
  buildVisibilityInsightCards,
} from "./utils/aiInsightEngine";
import "./styles/ai-insights.css";
import { usePlatformFiltersOptional } from "./context/PlatformFiltersContext";
import { useRbacOptional } from "./context/RbacContext";
import GoogleReputationStrip from "./components/GoogleReputationStrip";

const GROUP_ICONS = {
  "Revenue Opportunities": <TrendingUp size={16} />,
  "Menu Problems": <AlertTriangle size={16} />,
  "Guest Behavior": <Users size={16} />,
  "Search Intent": <Search size={16} />,
  "Language Behavior": <Globe size={16} />,
  "Add-on Opportunities": <ShoppingBag size={16} />,
};

const SEVERITY_COLORS = { high: "#ff6b6b", medium: "#f5a623", low: "#4ecdc4" };
const IMPACT_COLORS = { high: "#ff6b6b", medium: "#f5a623", low: "#4ecdc4" };

const TIME_FILTERS = [
  { label: "Today", value: 24 },
  { label: "7D", value: 168 },
  { label: "This Month", value: 999 },
  { label: "All", value: 0 },
];

const SUGGESTED_QUESTIONS = [
  "What time did the most scans happen?",
  "What should I improve today?",
  "Which items sell visually?",
  "Which items attract attention but don't sell?",
  "Which items are waiter driven?",
  "Are guests searching for something we do not offer?",
  "Which items need more explanation?",
  "What should I tell management?",
  "Which employees drive reviews best?",
  "Which waiters influence dessert sales?",
  "Which branches convert browsing into sales best?",
  "How does Khobar compare to Riyadh visually?",
];

export default function AIInsights() {
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const {
    data,
    loading: biLoading,
    error: biError,
    needsAuth,
    platformStatus,
  } = useMenuBiDashboardContext();
  const [error, setError] = useState("");
  const [timeRangeLocal, setTimeRangeLocal] = useState(24);
  const timeRange = platform?.timeRangeHours ?? timeRangeLocal;
  const setTimeRange = platform ? (h) => platform.setTimeRangeHours(h) : setTimeRangeLocal;
  const [severityFilter, setSeverityFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [displayedAnswer, setDisplayedAnswer] = useState("");
  const [answering, setAnswering] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showMgmt, setShowMgmt] = useState(false);
  const [foodics, setFoodics] = useState(null);
  const [reviewIntel, setReviewIntel] = useState(null);
  const [branchComparison, setBranchComparison] = useState([]);
  const streamRef = useRef(null);

  const configured = isSupabaseConfigured();
  const loading = biLoading;

  const loadSupplemental = useCallback(async () => {
    if (!data || needsAuth) return;
    try {
      const foodicsCtx = await getFoodicsIntelligenceContext(data);
      setFoodics(foodicsCtx);
      const [rev, branches] = await Promise.all([
        fetchReviewIntelligence(defaultBranchId(), timeRange, rbac?.profile),
        fetchBranchComparison(timeRange, rbac?.profile),
      ]);
      setReviewIntel(rev);
      setBranchComparison(Array.isArray(branches) ? branches : []);
    } catch {
      setReviewIntel(null);
      setBranchComparison([]);
    }
  }, [data, needsAuth, timeRange, rbac?.profile]);

  useEffect(() => {
    if (needsAuth) {
      setError("Please log in from the Dashboard tab first.");
      return;
    }
    if (biError) setError(biError);
    else if (!configured) setError("Supabase not configured");
    else setError("");
    loadSupplemental();
  }, [needsAuth, biError, configured, loadSupplemental]);

  const insightCards = useMemo(() => {
    const base = buildInsightCards(data);
    const foodicsCards = buildFoodicsInsightCards(foodics);
    const visibilityCards = buildVisibilityInsightCards(data, foodics);
    return [...base, ...foodicsCards, ...visibilityCards];
  }, [data, foodics]);
  const managementSummary = useMemo(() => buildManagementSummary(data), [data]);
  const bestAction = useMemo(() => getBestAction(data), [data]);

  const totalEvents = Number(data?.total_events) || 0;
  const totalSessions = Number(data?.total_sessions) || 0;

  const filteredCards = useMemo(() => {
    let cards = insightCards;
    if (severityFilter !== "all") cards = cards.filter((c) => c.severity === severityFilter);
    if (groupFilter !== "all") cards = cards.filter((c) => c.group === groupFilter);
    return cards;
  }, [insightCards, severityFilter, groupFilter]);

  const groups = useMemo(() => {
    const g = {};
    filteredCards.forEach((c) => {
      if (!g[c.group]) g[c.group] = [];
      g[c.group].push(c);
    });
    return g;
  }, [filteredCards]);

  const streamText = useCallback((text) => {
    setDisplayedAnswer("");
    let i = 0;
    if (streamRef.current) clearInterval(streamRef.current);
    streamRef.current = setInterval(() => {
      i += 2;
      if (i >= text.length) {
        setDisplayedAnswer(text);
        clearInterval(streamRef.current);
      } else {
        setDisplayedAnswer(text.slice(0, i));
      }
    }, 18);
  }, []);

  const handleAsk = useCallback((q) => {
    const query = q || question;
    if (!query.trim()) return;
    setAnswering(true);
    setAnswer(null);
    setDisplayedAnswer("");
    setQuestion(query);
    setTimeout(() => {
      const employees = buildEmployeePerformance(reviewIntel?.top_employees || []);
      const result = answerQuestion(query, data, {
        periodHours: timeRange,
        foodics,
        reviewIntelligence: reviewIntel,
        branchComparison,
        employees,
      });
      setAnswer(result);
      setAnswering(false);
      streamText(result.answer);
    }, 900);
  }, [question, data, foodics, timeRange, streamText, reviewIntel, branchComparison]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") handleAsk();
  }, [handleAsk]);

  useEffect(() => {
    return () => { if (streamRef.current) clearInterval(streamRef.current); };
  }, []);

  if (!configured) {
    return (
      <div className="ai-insights-empty">
        <Sparkles size={48} />
        <h2>AI Insights</h2>
        <p>Connect Supabase to unlock intelligence.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ai-insights-loading">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}>
          <Loader2 size={32} />
        </motion.div>
        <p>Loading intelligence…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ai-insights-empty">
        <AlertTriangle size={48} />
        <h2>Cannot Load Insights</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="ai-insights">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <Sparkles size={22} className="ai-header-icon" />
          <div>
            <h1 className="ai-title">AI Insights</h1>
            <p className="ai-subtitle">Rule-based intelligence from {totalEvents.toLocaleString()} events across {totalSessions.toLocaleString()} sessions</p>
          </div>
        </div>
        <div className="ai-header-actions">
          <button className={`ai-filter-btn ${showMgmt ? "active" : ""}`} onClick={() => setShowMgmt(!showMgmt)}>
            <FileText size={14} />
            Management Summary
          </button>
          <button className={`ai-filter-btn ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            <Filter size={14} />
            Filters
          </button>
        </div>
      </div>

      <GoogleReputationStrip />

      <PlatformStatusBanner platformStatus={platformStatus} />

      <p className="cr-teaser-link" style={{ marginTop: 0 }}>
        Open Intelligence → Market → Competitors for competitor reputation.
      </p>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div className="ai-filters" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {!platform && (
            <div className="ai-filter-group">
              <span className="ai-filter-label">Time</span>
              <div className="ai-filter-pills">
                {TIME_FILTERS.map((f) => (
                  <button key={f.value} className={`ai-pill ${timeRange === f.value ? "active" : ""}`} onClick={() => setTimeRange(f.value)}>{f.label}</button>
                ))}
              </div>
            </div>
            )}
            <div className="ai-filter-group">
              <span className="ai-filter-label">Severity</span>
              <div className="ai-filter-pills">
                {["all", "high", "medium", "low"].map((s) => (
                  <button key={s} className={`ai-pill ${severityFilter === s ? "active" : ""}`} onClick={() => setSeverityFilter(s)}>
                    {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="ai-filter-group">
              <span className="ai-filter-label">Type</span>
              <div className="ai-filter-pills">
                <button className={`ai-pill ${groupFilter === "all" ? "active" : ""}`} onClick={() => setGroupFilter("all")}>All</button>
                {Object.keys(GROUP_ICONS).map((g) => (
                  <button key={g} className={`ai-pill ${groupFilter === g ? "active" : ""}`} onClick={() => setGroupFilter(g)}>{g}</button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Management Summary Panel */}
      <AnimatePresence>
        {showMgmt && managementSummary && (
          <motion.div className="ai-management" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="ai-management-header">
              <FileText size={18} />
              <h2>30-Second Executive Brief</h2>
            </div>
            <div className="ai-mgmt-kpis">
              <div className="ai-mgmt-kpi"><span className="ai-mgmt-kpi-val">{managementSummary.qrStarts}</span><span className="ai-mgmt-kpi-label">QR Scans</span></div>
              <div className="ai-mgmt-kpi"><span className="ai-mgmt-kpi-val">{managementSummary.addOnRate}%</span><span className="ai-mgmt-kpi-label">Add-on Rate</span></div>
              <div className="ai-mgmt-kpi"><span className="ai-mgmt-kpi-val">{managementSummary.bounceRate}%</span><span className="ai-mgmt-kpi-label">Bounce</span></div>
              <div className="ai-mgmt-kpi"><span className="ai-mgmt-kpi-val">{managementSummary.returningRate}%</span><span className="ai-mgmt-kpi-label">Returning</span></div>
            </div>
            <div className="ai-management-grid">
              <SummarySection title="What is working" items={managementSummary.working} color="#4ecdc4" />
              <SummarySection title="Needs attention" items={managementSummary.needsAttention || managementSummary.weak} color="#ff6b6b" />
              <SummarySection title="Do today" items={managementSummary.improve} color="#f5a623" />
              <SummarySection title="Monitor next" items={managementSummary.monitor} color="#8b5cf6" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ask Anything */}
      <div className="ai-ask-section">
        <div className="ai-ask-box">
          <Sparkles size={18} className="ai-ask-icon" />
          <input
            className="ai-ask-input"
            placeholder="Ask anything about your menu performance…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="ai-ask-send" onClick={() => handleAsk()} disabled={answering || !question.trim()}>
            {answering ? <Loader2 size={16} className="ai-spin" /> : <Send size={16} />}
          </button>
        </div>
        <div className="ai-ask-suggestions">
          {SUGGESTED_QUESTIONS.map((sq) => (
            <button key={sq} className="ai-suggestion-pill" onClick={() => handleAsk(sq)}>{sq}</button>
          ))}
        </div>

        <AnimatePresence>
          {answering && (
            <motion.div className="ai-analyzing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Loader2 size={14} className="ai-spin" />
              <span>Analyzing {totalEvents.toLocaleString()} events across {totalSessions.toLocaleString()} sessions…</span>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {answer && !answering && (
            <motion.div className="ai-answer-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="ai-answer-header">
                <Sparkles size={16} className="ai-answer-icon" />
                <span className="ai-answer-label">Intelligence</span>
                <ConfidenceMeter level={answer.confidence} />
              </div>
              <p className="ai-answer-text">{displayedAnswer}<span className="ai-cursor" /></p>
              {(answer.trustPhrase || answer.dataContext) && (
                <p className="ai-answer-trust">
                  {answer.trustPhrase && <span>{answer.trustPhrase}.</span>}
                  {answer.dataContext && <span className="ai-answer-data">{answer.dataContext}</span>}
                </p>
              )}
              {(answer.intent || answer.metric || answer.period) && (
                <motion.div className="ai-answer-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
                  {answer.confidence && <span>Confidence: {answer.confidence}</span>}
                  {answer.period && <span>Period: {answer.period}</span>}
                  {answer.metric && <span>Source: {answer.metric}</span>}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Today's Best Action */}
      {bestAction && (
        <motion.div className="ai-hero-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="ai-hero-top">
            <div className="ai-hero-badge"><Zap size={14} />Today's Best Action</div>
            {bestAction.urgency && <span className="ai-urgency-badge">{bestAction.urgency}</span>}
          </div>
          <p className="ai-hero-action">{bestAction.action}</p>
          <p className="ai-hero-reason">{bestAction.reason}</p>
          <span className="ai-hero-source">Source: {bestAction.source}</span>
        </motion.div>
      )}

      {/* What Changed Section */}
      <motion.div className="ai-what-changed" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <div className="ai-wc-header">
          <Activity size={16} />
          <h3>What Changed?</h3>
        </div>
        <p className="ai-wc-body">
          {totalSessions > 50
            ? `Based on ${totalEvents.toLocaleString()} menu events across ${totalSessions.toLocaleString()} sessions. Switch Today / 7D / This Month to compare periods.${foodics?.previousBatch ? " Foodics trends compare against your previous import." : ""}`
            : "Early signal — more accurate comparisons will appear after more sessions are collected."
          }
        </p>
      </motion.div>

      {/* Insight Cards by Group */}
      <div className="ai-groups">
        {Object.entries(groups).map(([groupName, cards], gi) => (
          <motion.div key={groupName} className="ai-group" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + gi * 0.05 }}>
            <div className="ai-group-header">
              {GROUP_ICONS[groupName] || <Info size={16} />}
              <h3>{groupName}</h3>
              <span className="ai-group-count">{cards.length}</span>
            </div>
            <div className="ai-cards-grid">
              {cards.map((card) => (
                <InsightCard key={card.id} card={card} />
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      {filteredCards.length === 0 && !loading && (
        <div className="ai-no-insights">
          <Info size={32} />
          <p>No insights match your current filters, or not enough data has been collected yet.</p>
        </div>
      )}
    </div>
  );
}

function ConfidenceMeter({ level }) {
  const levels = { low: 1, medium: 2, high: 3 };
  const n = levels[level] || 1;
  return (
    <div className="ai-conf-meter" title={`${level} confidence`}>
      {[1, 2, 3].map((i) => (
        <div key={i} className={`ai-conf-bar ${i <= n ? `active-${level}` : ""}`} />
      ))}
      <span className="ai-conf-label">{level}</span>
    </div>
  );
}

function InsightCard({ card }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div className={`ai-insight-card severity-${card.severity}`} whileHover={{ y: -2 }} layout>
      <div className="ai-card-top" onClick={() => setExpanded(!expanded)}>
        <div className="ai-card-severity" style={{ background: SEVERITY_COLORS[card.severity] }} />
        <div className="ai-card-content">
          <h4 className="ai-card-title">{card.title}</h4>
          <p className="ai-card-explanation">{card.explanation}</p>
        </div>
        <ChevronRight size={14} className={`ai-card-chevron ${expanded ? "open" : ""}`} />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div className="ai-card-expanded" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {/* Why This Matters */}
            {card.whyMatters && (
              <div className="ai-card-why">
                <span className="ai-card-why-label">Why this matters</span>
                <p>{card.whyMatters}</p>
              </div>
            )}

            {/* Recommended Action */}
            <div className="ai-card-action">
              <ArrowRight size={12} />
              <span>{card.action}</span>
            </div>

            {/* Impact Scores */}
            {card.impact && (
              <div className="ai-card-impact">
                <ImpactPill label="Revenue" level={card.impact.revenue} />
                <ImpactPill label="UX" level={card.impact.ux} />
                <div className="ai-urgency-pill">
                  <Clock size={10} />
                  {card.impact.urgency}
                </div>
              </div>
            )}

            {/* Metric & Confidence */}
            <div className="ai-card-meta">
              <ConfidenceMeter level={card.confidence} />
              {card.metric && <span className="ai-card-metric">{card.metric}</span>}
            </div>
            <div className="ai-card-source-row">
              <span className="ai-card-source">Source: {card.source}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ImpactPill({ label, level }) {
  return (
    <span className="ai-impact-pill" style={{ borderColor: IMPACT_COLORS[level], color: IMPACT_COLORS[level] }}>
      {label}: {level}
    </span>
  );
}

function SummarySection({ title, items, color }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="ai-summary-section">
      <h4 style={{ color }}>{title}</h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

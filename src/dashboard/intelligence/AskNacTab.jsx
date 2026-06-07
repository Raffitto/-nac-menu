import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Send,
  Loader2,
  Sparkles,
  Server,
  ServerOff,
  BarChart3,
  Users,
  GitBranch,
  HelpCircle,
  TrendingUp,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { askNac, isAskNacServerConfigured } from "../../intelligence/askNac";
import AskNacAnswerCard from "./AskNacAnswerCard";
import AskNacDataVaultPanel from "./AskNacDataVaultPanel";
import "../styles/ask-nac.css";
import "../styles/ask-nac-data-vault.css";

const SUGGESTED_PROMPTS = [
  { text: "How many menu QR scans today?", icon: BarChart3 },
  { text: "Google redirects in the last 7 days", icon: Sparkles },
  { text: "Which staff drove the most Google redirects?", icon: Users },
  { text: "Compare branches this month", icon: GitBranch },
  { text: "What were sales in May?", icon: TrendingUp },
  { text: "What were the top 10 items last month?", icon: TrendingUp },
  { text: "Which item entered the top 10 compared to last month?", icon: TrendingUp },
  { text: "Which item dropped from the top 10?", icon: TrendingUp },
  { text: "Rank items by quantity instead of sales.", icon: TrendingUp },
  { text: "Which category generated the most revenue?", icon: TrendingUp },
  { text: "What is average spend per guest?", icon: HelpCircle },
  { text: "Delivery platform sales this week", icon: HelpCircle },
  { text: "What happened in Khobar on 5 June?", icon: TrendingUp },
  { text: "Generate management report for Khobar on 5 June.", icon: TrendingUp },
  { text: "Which uploaded files cover June?", icon: HelpCircle },
  { text: "Summarize reception performance on 5 June.", icon: TrendingUp },
];

export default function AskNacTab({
  initialQuestion = "",
  prefillSeed = 0,
  onInitialQuestionConsumed,
}) {
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const serverConfigured = isAskNacServerConfigured();
  const session = rbac?.session;
  const serverConnected = response?.serverConnected === true;
  const localFallback = response?.localFallback === true;
  const aiConnected = response?.aiConnected === true;
  const aiExplained = response?.isAiGenerated === true;

  const statusBadge = useMemo(() => {
    if (aiExplained) {
      return { label: "AI explained", tone: "ai" };
    }
    if (response && aiConnected) {
      return { label: "AI connected", tone: "connected" };
    }
    if (response && serverConnected && !localFallback) {
      return { label: "Verified deterministic", tone: "connected" };
    }
    if (response && localFallback) {
      return { label: "Local fallback", tone: "local" };
    }
    if (serverConfigured && session?.access_token) {
      return { label: "AI connected", tone: "connected" };
    }
    if (serverConfigured) {
      return { label: "Local fallback", tone: "local" };
    }
    return { label: "Local fallback", tone: "local" };
  }, [aiExplained, aiConnected, response, serverConnected, localFallback, serverConfigured, session]);

  const filters = useMemo(
    () => ({
      branch: platform?.branch ?? null,
      selectedRange: platform?.selectedRange ?? "today",
      timeRangeHours: platform?.timeRangeHours ?? 24,
      language: platform?.language,
      shift: platform?.shift,
      eventType: platform?.eventType,
      dayType: platform?.dayType,
      role: platform?.role,
    }),
    [platform],
  );

  const submitQuestion = useCallback(
    async (q) => {
      const text = String(q || question).trim();
      if (!text) return;

      setLoading(true);
      setError("");
      setResponse(null);

      try {
        const result = await askNac({
          question: text,
          supabase,
          session,
          profile: rbac?.profile ?? null,
          filters,
        });
        setResponse(result);
        setQuestion(text);
      } catch (err) {
        setError(err?.message || "Ask NAC failed.");
      } finally {
        setLoading(false);
      }
    },
    [question, session, rbac?.profile, filters],
  );

  useEffect(() => {
    const prefill = String(initialQuestion || "").trim();
    if (!prefill || !prefillSeed) return;
    setQuestion(prefill);
    submitQuestion(prefill);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, prefillSeed, onInitialQuestionConsumed, submitQuestion]);

  const onSubmit = (e) => {
    e.preventDefault();
    submitQuestion(question);
  };

  return (
    <div className="nac-ask-nac-tab">
      <header className="nac-glass-panel nac-ask-nac-hero">
        <div className="nac-ask-nac-hero__top">
          <div>
            <p className="nac-ask-nac-eyebrow">Business intelligence copilot</p>
            <h2>Ask NAC</h2>
            <p className="nac-ask-nac-subtitle">
              Answers come from verified Supabase metrics only — never guessed. OpenAI (when connected
              on the server) may explain structured facts returned by internal tools.
            </p>
          </div>
          <div
            className={`nac-ask-nac-server-status nac-ask-nac-server-status--${statusBadge.tone}`}
            title={
              statusBadge.label === "AI explained"
                ? "OpenAI narrated verified facts on the server"
                : statusBadge.label === "AI connected"
                  ? "Ask NAC Edge Function connected — server-side tools and optional AI narration"
                  : statusBadge.label === "Verified deterministic"
                    ? "Verified facts from server tools without AI rewrite"
                    : "Deterministic answers computed locally in the browser"
            }
          >
            {statusBadge.tone === "local" ? <ServerOff size={16} /> : <Server size={16} />}
            <span>{statusBadge.label}</span>
          </div>
        </div>

        {!isSupabaseConfigured() ? (
          <p className="nac-ask-nac-config-warn">Supabase is not configured — metric queries will not run.</p>
        ) : null}
      </header>

      <section className="nac-glass-panel nac-ask-nac-compose">
        <form onSubmit={onSubmit} className="nac-ask-nac-form">
          <label htmlFor="ask-nac-input" className="sr-only">
            Ask a question
          </label>
          <textarea
            id="ask-nac-input"
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How many menu QR scans today in Khobar?"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !question.trim()} className="nac-ask-nac-submit">
            {loading ? <Loader2 size={18} className="nac-bi-spin" /> : <Send size={18} />}
            <span>{loading ? "Querying…" : "Ask"}</span>
          </button>
        </form>

        <div className="nac-ask-nac-suggestions">
          <span className="nac-ask-nac-suggestions__label">Try:</span>
          {SUGGESTED_PROMPTS.map(({ text, icon: Icon }) => (
            <button
              key={text}
              type="button"
              className="nac-ask-nac-chip"
              disabled={loading}
              onClick={() => {
                setQuestion(text);
                submitQuestion(text);
              }}
            >
              <Icon size={14} aria-hidden />
              {text}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div className="nac-ask-nac-error nac-glass-panel" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <section className="nac-glass-panel nac-ask-nac-loading" aria-live="polite">
          <Loader2 size={22} className="nac-bi-spin" />
          <p>Querying verified metrics…</p>
        </section>
      ) : response ? (
        <AskNacAnswerCard response={response} question={question} filters={filters} />
      ) : (
        <section className="nac-glass-panel nac-ask-nac-empty">
          <Sparkles size={20} aria-hidden />
          <p>
            Ask about menu QR scans, sessions, Google redirects, review QR, staff leaderboard, branch
            comparison, Foodics sales (totals, top items, categories), and Data Vault operational reports.
            Planned metrics like average spend and delivery sales return a clear missing-data report — never
            fabricated numbers.
          </p>
        </section>
      )}

      <AskNacDataVaultPanel session={session} />
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Server,
  ServerOff,
  BarChart3,
  Users,
  GitBranch,
  HelpCircle,
  TrendingUp,
  MessageSquarePlus,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { askNac, isAskNacServerConfigured } from "../../intelligence/askNac";
import AskNacComposer from "./AskNacComposer";
import AskNacMessageList from "./AskNacMessageList";
import AskNacDataVaultPanel from "./AskNacDataVaultPanel";
import { createAssistantMessage, createUserMessage } from "./askNacChatUtils";
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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const scrollAnchorRef = useRef(null);

  const serverConfigured = isAskNacServerConfigured();
  const session = rbac?.session;

  const lastResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.response) return msg.response;
    }
    return null;
  }, [messages]);

  const serverConnected = lastResponse?.serverConnected === true;
  const localFallback = lastResponse?.localFallback === true;
  const aiConnected = lastResponse?.aiConnected === true;
  const aiExplained = lastResponse?.isAiGenerated === true;

  const statusBadge = useMemo(() => {
    if (aiExplained) {
      return { label: "AI explained", tone: "ai" };
    }
    if (lastResponse && aiConnected) {
      return { label: "AI connected", tone: "connected" };
    }
    if (lastResponse && serverConnected && !localFallback) {
      return { label: "Verified deterministic", tone: "connected" };
    }
    if (lastResponse && localFallback) {
      return { label: "Local fallback", tone: "local" };
    }
    if (serverConfigured && session?.access_token) {
      return { label: "AI connected", tone: "connected" };
    }
    if (serverConfigured) {
      return { label: "Local fallback", tone: "local" };
    }
    return { label: "Local fallback", tone: "local" };
  }, [aiExplained, aiConnected, lastResponse, serverConnected, localFallback, serverConfigured, session]);

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

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setDraft("");
    focusInput();
  }, [focusInput]);

  const submitQuestion = useCallback(
    async (q) => {
      const text = String(q ?? draft).trim();
      if (!text || loading) return;

      const userMessage = createUserMessage(text);
      setMessages((prev) => [...prev, userMessage]);
      setDraft("");
      setLoading(true);

      try {
        const result = await askNac({
          question: text,
          supabase,
          session,
          profile: rbac?.profile ?? null,
          filters,
        });
        setMessages((prev) => [
          ...prev,
          createAssistantMessage({ question: text, response: result }),
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          createAssistantMessage({
            question: text,
            error: err?.message || "Ask NAC failed.",
          }),
        ]);
      } finally {
        setLoading(false);
        focusInput();
      }
    },
    [draft, loading, session, rbac?.profile, filters, focusInput],
  );

  useEffect(() => {
    const prefill = String(initialQuestion || "").trim();
    if (!prefill || !prefillSeed) return;
    submitQuestion(prefill);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, prefillSeed, onInitialQuestionConsumed, submitQuestion]);

  const showEmptyState = messages.length === 0 && !loading;

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
          <div className="nac-ask-nac-hero__actions">
            {messages.length ? (
              <button
                type="button"
                className="nac-ask-nac-new-chat"
                onClick={clearChat}
                disabled={loading}
                aria-label="Start a new chat"
              >
                <MessageSquarePlus size={16} aria-hidden />
                <span>New chat</span>
              </button>
            ) : null}
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
        </div>

        {!isSupabaseConfigured() ? (
          <p className="nac-ask-nac-config-warn">Supabase is not configured — metric queries will not run.</p>
        ) : null}
      </header>

      <section className="nac-glass-panel nac-ask-nac-chat">
        {showEmptyState ? (
          <div className="nac-ask-nac-empty nac-ask-nac-empty--chat">
            <Sparkles size={20} aria-hidden />
            <p>
              Ask about menu QR scans, sessions, Google redirects, review QR, staff leaderboard, branch
              comparison, Foodics sales, and Data Vault operational reports. Press Enter to send.
            </p>
          </div>
        ) : null}

        <AskNacMessageList
          messages={messages}
          loading={loading}
          filters={filters}
          scrollAnchorRef={scrollAnchorRef}
        />

        <AskNacComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submitQuestion}
          loading={loading}
          suggestions={messages.length === 0 ? SUGGESTED_PROMPTS : SUGGESTED_PROMPTS.slice(0, 8)}
          inputRef={inputRef}
        />
      </section>

      <AskNacDataVaultPanel session={session} />
    </div>
  );
}

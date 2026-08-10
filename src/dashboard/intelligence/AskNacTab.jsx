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
  Menu,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "../../lib/supabase";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useRbacOptional } from "../context/RbacContext";
import { askNac } from "../../intelligence/askNac";
import {
  createEmptyConversationContext,
  resetConversationContext,
  updateConversationContext,
} from "../../intelligence/askNac/conversation/conversationContext";
import AskNacComposer from "./AskNacComposer";
import AskNacMessageList from "./AskNacMessageList";
import AskNacDataVaultPanel from "./AskNacDataVaultPanel";
import IntelligenceMobileMoreMenu from "./mobile/IntelligenceMobileMoreMenu";
import { useAskNacConnectionStatus } from "./useAskNacConnectionStatus";
import { createAssistantMessage, createUserMessage, resolveAskNacSuggestions } from "./askNacChatUtils";
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

const MOBILE_SUGGESTED_PROMPTS = [
  { text: "What were sales in May?", icon: TrendingUp },
  { text: "Which category generated the most revenue?", icon: TrendingUp },
  { text: "Who drove the most Google redirects?", icon: Users },
];

const MOBILE_WELCOME =
  "Ask NAC anything about sales, menu performance, reviews, staff, branches, or uploaded reports.";

const MOBILE_WELCOME_EXAMPLES = [
  "What were sales in May?",
  "Which category generated the most revenue?",
  "Who drove the most Google redirects?",
  "What happened in Khobar on 5 June?",
];

export default function AskNacTab({
  initialQuestion = "",
  prefillSeed = 0,
  onInitialQuestionConsumed,
  mobileFirst = false,
  showVaultPanel = false,
  maxSuggestions = 8,
  onMobileNavigate,
}) {
  const platform = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [conversationContext, setConversationContext] = useState(() => createEmptyConversationContext());
  const [loading, setLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const inputRef = useRef(null);
  const scrollAnchorRef = useRef(null);

  const session = rbac?.session;
  const statusBadge = useAskNacConnectionStatus({ messages, session });

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
    setConversationContext(resetConversationContext());
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
          conversationContext,
        });
        setConversationContext((prev) =>
          result.nextContext
            ? result.nextContext
            : updateConversationContext(prev, {
              question: text,
              resolvedQuestion: result.conversationResolution?.resolvedQuestion || text,
              response: result,
            }),
        );
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
    [draft, loading, session, rbac?.profile, filters, conversationContext, focusInput],
  );

  useEffect(() => {
    const prefill = String(initialQuestion || "").trim();
    if (!prefill || !prefillSeed) return;
    submitQuestion(prefill);
    onInitialQuestionConsumed?.();
  }, [initialQuestion, prefillSeed, onInitialQuestionConsumed, submitQuestion]);

  const suggestions = useMemo(
    () =>
      resolveAskNacSuggestions({
        mobileFirst,
        maxSuggestions,
        messageCount: messages.length,
        allPrompts: SUGGESTED_PROMPTS,
        mobilePrompts: MOBILE_SUGGESTED_PROMPTS,
      }),
    [mobileFirst, maxSuggestions, messages.length],
  );

  const composerPlaceholder = mobileFirst
    ? "Ask NAC anything…"
    : "Ask about menu scans, sales, staff, branches, Foodics, or vault reports…";

  if (mobileFirst) {
    return (
      <div className="nac-ask-nac-mobile">
        <header className="nac-intelligence-mobile-topbar">
          <div className="nac-intelligence-mobile-topbar__title">
            <p className="nac-intelligence-mobile-topbar__kicker">NAC</p>
            <h1>Ask NAC</h1>
          </div>
          <div
            className={`nac-ask-nac-server-status nac-ask-nac-server-status--${statusBadge.tone} nac-intelligence-mobile-topbar__status`}
            title={statusBadge.label}
          >
            {statusBadge.tone === "local" ? <ServerOff size={14} /> : <Server size={14} />}
            <span>{statusBadge.shortLabel}</span>
          </div>
          <button
            type="button"
            className="nac-intelligence-mobile-topbar__more"
            aria-label="Open Intelligence menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <Menu size={20} />
          </button>
        </header>

        <main className="nac-ask-nac-mobile__body">
          {messages.length === 0 && !loading ? (
            <div className="nac-ask-nac-mobile__empty">
              <p className="nac-ask-nac-mobile__welcome">{MOBILE_WELCOME}</p>
              <ul className="nac-ask-nac-mobile__examples" aria-label="Example questions">
                {MOBILE_WELCOME_EXAMPLES.map((example) => (
                  <li key={example}>
                    <button type="button" onClick={() => submitQuestion(example)} disabled={loading}>
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AskNacMessageList
            messages={messages}
            loading={loading}
            filters={filters}
            scrollAnchorRef={scrollAnchorRef}
            compact={true}
          />
        </main>

        <footer className="nac-ask-nac-mobile__footer">
          <AskNacComposer
            value={draft}
            onChange={setDraft}
            onSubmit={submitQuestion}
            loading={loading}
            suggestions={suggestions}
            inputRef={inputRef}
            placeholder={composerPlaceholder}
            variant="mobile"
          />
        </footer>

        <IntelligenceMobileMoreMenu
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onSelect={onMobileNavigate}
          showNewChat={messages.length > 0}
          onNewChat={clearChat}
        />
      </div>
    );
  }

  const showEmptyState = messages.length === 0 && !loading;
  const inConversation = messages.length > 0 || loading;

  return (
    <div className="nac-ask-nac-tab nac-ask-nac-workspace" data-testid="ask-nac-workspace">
      <div className="nac-ask-nac-workspace__column">
        <header
          className={`nac-glass-panel nac-ask-nac-hero${inConversation ? " nac-ask-nac-hero--compact" : ""}`.trim()}
        >
          <div className="nac-ask-nac-hero__top">
            <div>
              <p className="nac-ask-nac-eyebrow">Business intelligence copilot</p>
              <h2>Ask NAC</h2>
              {!inConversation ? (
                <p className="nac-ask-nac-subtitle">
                  Answers come from verified Supabase metrics and Company Knowledge — never guessed.
                </p>
              ) : null}
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
                title={statusBadge.label}
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

        <section className="nac-ask-nac-chat nac-ask-nac-chat--page" data-testid="ask-nac-chat-page">
          {showEmptyState ? (
            <div className="nac-ask-nac-empty nac-ask-nac-empty--chat">
              <Sparkles size={20} aria-hidden />
              <p>
                Ask about menu QR scans, sessions, Google redirects, review QR, staff leaderboard, branch
                comparison, Foodics sales, and uploaded operational reports. Press Enter to send.
              </p>
            </div>
          ) : null}

          <AskNacMessageList
            messages={messages}
            loading={loading}
            filters={filters}
            scrollAnchorRef={scrollAnchorRef}
          />
        </section>

        <AskNacComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submitQuestion}
          loading={loading}
          suggestions={suggestions}
          inputRef={inputRef}
          placeholder={composerPlaceholder}
        />
      </div>

      {showVaultPanel ? <AskNacDataVaultPanel session={session} /> : null}
    </div>
  );
}

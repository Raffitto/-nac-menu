import React, { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import { hasExportableContent } from "../../intelligence/askNac/export/askNacExportPayload";
import AskNacExportButton from "../../intelligence/askNac/export/AskNacExportButton";
import AskNacMobileExportSheet from "./AskNacMobileExportSheet";
import { formatMobileAnswerLead } from "./askNacAnswerPresentation";
import { getMobileTrustSummary, getTechnicalTrustDetails } from "./askNacTrustLabels";
import { shouldRenderCashUpExecutiveBrief } from "./askNacExecutiveBriefUi";
import { shouldShowCashUpDebugPanel } from "./askNacCashUpDebugUi";
import {
  applyExecutiveMetricDisplayLabels,
  extractExecutiveKpiMetrics,
} from "../../intelligence/askNac/export/executiveBriefExport";
import {
  resolveAskNacDirectAnswer,
  resolveAskNacDirectAnswerWithMeta,
} from "../../intelligence/askNac/conversation/coercePlainTextDirectAnswer";
import {
  buildConversationChartPayload,
  resolveVisualizationPresentation,
} from "../../intelligence/askNac/conversation/conversationVisualization";
import AskNacConversationChart from "./AskNacConversationChart";

function ExecutiveBriefBulletSection({ title, items = [] }) {
  if (!items.length) return null;
  return (
    <div className="nac-ask-nac-block nac-ask-nac-executive-brief__section">
      <h4>{title}</h4>
      <ul>
        {items.map((line) => (
          <li key={`${title}-${line}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function ExecutiveKpiGrid({ metrics = [] }) {
  const kpis = extractExecutiveKpiMetrics(metrics);
  if (!kpis.length) return null;
  return (
    <div className="nac-ask-nac-executive-kpis" data-testid="cash-up-executive-kpis">
      {kpis.map((metric) => (
        <div key={metric.key} className="nac-ask-nac-executive-kpis__card">
          <span className="nac-ask-nac-executive-kpis__label">{metric.label}</span>
          <strong className="nac-ask-nac-executive-kpis__value">
            {typeof metric.value === "number" ? metric.value.toLocaleString() : metric.value}
            {metric.unit ? ` ${metric.unit}` : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

function CashUpExecutiveBriefView({ brief, keyMetrics = [] }) {
  if (!brief) return null;
  return (
    <div className="nac-ask-nac-executive-brief" data-testid="cash-up-executive-brief">
      <div className="nac-ask-nac-block">
        <h4>Executive Summary</h4>
        <p className="nac-ask-nac-executive-brief__summary">{brief.executiveSummary}</p>
      </div>
      <ExecutiveKpiGrid metrics={keyMetrics} />
      <ExecutiveBriefBulletSection title="Key Findings" items={brief.keyFindings} />
      <ExecutiveBriefBulletSection title="Operational Risks" items={brief.operationalRisks} />
      <ExecutiveBriefBulletSection title="Recommended Actions" items={brief.recommendedActions} />
      <ExecutiveBriefBulletSection title="Data Sources" items={brief.dataSources} />
    </div>
  );
}

function ConversationVisualizationSection({ response }) {
  const chart = response?.conversationChart || buildConversationChartPayload(response);
  const { fallback } = resolveVisualizationPresentation(response);

  if (chart) {
    return <AskNacConversationChart chart={chart} />;
  }
  if (fallback) {
    return (
      <p className="nac-ask-nac-visualization-fallback" data-testid="ask-nac-visualization-fallback">
        {fallback}
      </p>
    );
  }
  return null;
}

function stampCoverageMeta(response) {
  if (typeof window === "undefined") return;
  const meta = resolveAskNacDirectAnswerWithMeta(response);
  window.__NAC_ASKNAC_COVERAGE__ = {
    correctionNeeded: Boolean(meta.correctionNeeded || response?.responseMeta?.correctionNeeded),
    narrationSkipped: Boolean(response?.responseMeta?.narrationSkipped),
    coverageStatus: response?.coverageContract?.coverageStatus || null,
    spokenLabel: response?.coverageContract?.spokenLabel || null,
    timingMs: response?.responseMeta?.timingMs || null,
  };
}

function PrimaryAnswerContent({ response }) {
  stampCoverageMeta(response);
  if (shouldRenderCashUpExecutiveBrief(response)) {
    return (
      <CashUpExecutiveBriefView
        brief={response.executiveBrief}
        keyMetrics={response.keyMetrics}
      />
    );
  }
  return (
    <>
      <p className="nac-ask-nac-response__answer">{resolveAskNacDirectAnswer(response)}</p>
      <ConversationVisualizationSection response={response} />
    </>
  );
}

function MobilePrimaryAnswerContent({ response }) {
  if (shouldRenderCashUpExecutiveBrief(response)) {
    return (
      <CashUpExecutiveBriefView
        brief={response.executiveBrief}
        keyMetrics={response.keyMetrics}
      />
    );
  }
  const answerLead = formatMobileAnswerLead({
    ...response,
    directAnswer: resolveAskNacDirectAnswer(response),
  });
  return (
    <>
      <p className="nac-ask-nac-response__answer nac-ask-nac-response__answer--lead">{answerLead}</p>
      <ConversationVisualizationSection response={response} />
    </>
  );
}

function MetricList({ metrics, compact = false }) {
  if (!metrics?.length) return null;
  return (
    <ul className={`nac-ask-nac-metrics ${compact ? "nac-ask-nac-metrics--compact" : ""}`.trim()}>
      {metrics.map((m) => (
        <li key={`${m.label}-${m.value}`}>
          <span className="nac-ask-nac-metrics__label">{m.label}</span>
          <span className="nac-ask-nac-metrics__value">
            {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
            {m.unit ? ` ${m.unit}` : ""}
          </span>
          {m.note && !compact ? <span className="nac-ask-nac-metrics__note">{m.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function MiniMetricsTable({ metrics }) {
  if (!metrics?.length) return null;
  return (
    <div className="nac-ask-nac-mini-table-wrap">
      <table className="nac-ask-nac-mini-table">
        <tbody>
          {metrics.slice(0, 6).map((m) => (
            <tr key={`${m.label}-${m.value}`}>
              <th scope="row">{m.label}</th>
              <td>
                {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                {m.unit ? ` ${m.unit}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CashUpProductionTracePanel({ trace }) {
  if (!trace) return null;

  return (
    <div className="nac-ask-nac-cashup-debug nac-ask-nac-cashup-debug--trace" role="region" aria-label="Cash-up production trace">
      <h4>Cash-up production trace (temporary)</h4>
      <dl className="nac-ask-nac-details__meta">
        <dt>Routed intent</dt>
        <dd>{trace.routedIntent || "—"}</dd>
        <dt>Selected tool</dt>
        <dd>{trace.selectedTool || "—"}</dd>
        <dt>Branch filter</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.branchFilter || {}, null, 2)}
          </pre>
        </dd>
        <dt>Readiness</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.readiness || {}, null, 2)}
          </pre>
        </dd>
        <dt>Pipeline</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.pipeline || {}, null, 2)}
          </pre>
        </dd>
        <dt>Coverage query</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.coverageQuery || {}, null, 2)}
          </pre>
        </dd>
        <dt>Business date query</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.businessDateQuery || {}, null, 2)}
          </pre>
        </dd>
        <dt>Facts query</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.factsQuery || {}, null, 2)}
          </pre>
        </dd>
        <dt>Facts row count</dt>
        <dd>{trace.factsRowCount ?? 0}</dd>
        <dt>Failure point</dt>
        <dd className="nac-ask-nac-cashup-debug__failure">{trace.failurePoint || "—"}</dd>
        <dt>Generic fallback</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(trace.genericFallback || {}, null, 2)}
          </pre>
        </dd>
      </dl>
    </div>
  );
}

function CashUpDebugPanel({ debug, productionTrace }) {
  if (!shouldShowCashUpDebugPanel()) return null;
  if (!debug && !productionTrace) return null;

  const panelBody = !debug ? (
    <CashUpProductionTracePanel trace={productionTrace} />
  ) : (
    <>
      <dl className="nac-ask-nac-details__meta">
        <dt>Intent</dt>
        <dd>{debug.intent || "—"}</dd>
        <dt>Selected tool</dt>
        <dd>{debug.selectedTool || "—"}</dd>
        <dt>Normalized branch</dt>
        <dd>{debug.normalizedBranch ?? "null (network)"}</dd>
        <dt>Selected coverage row</dt>
        <dd>
          {debug.selectedCoverageRow
            ? `${debug.selectedCoverageRow.fileTitle || "—"} · ${debug.selectedCoverageRow.reportType || "—"} · ${debug.selectedCoverageRow.periodStart || "—"} – ${debug.selectedCoverageRow.periodEnd || "—"} · facts=${debug.selectedCoverageRow.factCount ?? "—"}`
            : "—"}
        </dd>
        <dt>Facts query filters</dt>
        <dd>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(debug.factsQueryFilters || {}, null, 2)}
          </pre>
        </dd>
        <dt>Facts row count</dt>
        <dd>{debug.factsRowCount ?? 0}</dd>
        <dt>Failure reason</dt>
        <dd className="nac-ask-nac-cashup-debug__failure">{debug.failureReason || "—"}</dd>
      </dl>
      {debug.firstFacts?.length ? (
        <div className="nac-ask-nac-cashup-debug__facts">
          <h5>First facts</h5>
          <pre className="nac-ask-nac-cashup-debug__json">
            {JSON.stringify(debug.firstFacts, null, 2)}
          </pre>
        </div>
      ) : null}
      <CashUpProductionTracePanel trace={productionTrace} />
    </>
  );

  return (
    <details className="nac-ask-nac-cashup-debug" data-testid="cash-up-debug-panel">
      <summary>Cash-up debug (developer)</summary>
      <div role="region" aria-label="Cash-up debug trace">
        {panelBody}
      </div>
    </details>
  );
}

function AskNacAnswerDetails({ response, isMissing, isError }) {
  const technical = getTechnicalTrustDetails(response);

  return (
    <div className="nac-ask-nac-details">
      {response.title ? (
        <div className="nac-ask-nac-details__block">
          <h4>Report title</h4>
          <p>{response.title}</p>
        </div>
      ) : null}

      {response.conversationResolution?.usedContext && response.conversationResolution?.resolvedQuestion ? (
        <div className="nac-ask-nac-details__block">
          <h4>Resolved as</h4>
          <p className="nac-ask-nac-details__resolved">
            &ldquo;{response.conversationResolution.resolvedQuestion}&rdquo;
          </p>
        </div>
      ) : null}

      {technical.length ? (
        <div className="nac-ask-nac-details__block">
          <h4>Diagnostics</h4>
          <dl className="nac-ask-nac-details__meta">
            {technical.map((row) => (
              <React.Fragment key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      ) : null}

      {response.insights?.length ? (
        <div className="nac-ask-nac-details__block">
          <h4>Insights</h4>
          <ul>
            {response.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.recommendations?.length ? (
        <div className="nac-ask-nac-details__block">
          <h4>Recommendations</h4>
          <ul>
            {response.recommendations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.missingData?.length ? (
        <div className="nac-ask-nac-details__block nac-ask-nac-details__block--missing">
          <h4>Missing data</h4>
          <ul>
            {response.missingData.map((m) => (
              <li key={m.intent || m.label}>{m.label || m.intent}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.sources?.length ? (
        <div className="nac-ask-nac-details__block">
          <h4>Sources</h4>
          <div className="nac-ask-nac-sources nac-ask-nac-sources--compact">
            {response.sources.map((s) => (
              <span key={s.name} className="nac-ask-nac-source-chip" title={s.detail}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {response.vaultSources?.length ? (
        <div className="nac-ask-nac-details__block">
          <h4>Vault files</h4>
          <div className="nac-ask-nac-sources nac-ask-nac-sources--compact">
            {response.vaultSources.map((s) => (
              <span
                key={s.fileId || s.title}
                className="nac-ask-nac-source-chip nac-ask-nac-vault-chip"
                title={
                  s.confidence != null
                    ? `${s.reportType || "vault"} · ${Math.round(s.confidence * 100)}% parse confidence`
                    : s.reportType || "uploaded file"
                }
              >
                {s.title}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <CashUpDebugPanel debug={response.cashUpDebug} productionTrace={response.cashUpProductionTrace} />

      {response.warnings?.length ? (
        <div className={`nac-ask-nac-warnings nac-ask-nac-warnings--compact ${isMissing || isError ? "nac-ask-nac-warnings--alert" : ""}`}>
          <AlertTriangle size={14} aria-hidden />
          <ul>
            {response.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isMissing ? (
        <p className="nac-ask-nac-missing-banner nac-ask-nac-missing-banner--compact" role="note">
          This question is recognized, but the required data is not uploaded or wired yet. No numbers were
          estimated.
        </p>
      ) : null}

      <p className="nac-ask-nac-details__verbatim">
        <span className="nac-ask-nac-details__verbatim-label">Verified answer</span>
        {resolveAskNacDirectAnswer(response)}
      </p>
    </div>
  );
}

function AskNacAnswerCardMobile({ response, question, filters, exportStatus, setExportStatus }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isMissing = response.answerType === ANSWER_TYPES.MISSING_DATA;
  const isError = response.answerType === ANSWER_TYPES.ERROR;
  const showExport =
    hasExportableContent(response) && response.answerType !== ANSWER_TYPES.UNKNOWN;
  const trust = getMobileTrustSummary(response);
  const metrics = applyExecutiveMetricDisplayLabels(response.keyMetrics || []);
  const showMiniTable = metrics.length > 3;

  return (
    <article
      className={`nac-ask-nac-response nac-ask-nac-response--mobile nac-ask-nac-response--${response.answerType}`}
      aria-live="polite"
    >
      <div className="nac-ask-nac-response__mobile-head">
        <span className={`nac-ask-nac-trust-pill nac-ask-nac-trust-pill--${trust.tone}`}>{trust.label}</span>
      </div>

      <MobilePrimaryAnswerContent response={response} />

      <CashUpDebugPanel debug={response.cashUpDebug} productionTrace={response.cashUpProductionTrace} />

      {showMiniTable ? (
        <MiniMetricsTable metrics={metrics} />
      ) : (
        <MetricList metrics={metrics} compact />
      )}

      <button
        type="button"
        className={`nac-ask-nac-details-toggle ${detailsOpen ? "is-open" : ""}`.trim()}
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <span>Details</span>
        <ChevronDown size={16} aria-hidden />
      </button>

      {detailsOpen ? <AskNacAnswerDetails response={response} isMissing={isMissing} isError={isError} /> : null}

      {showExport ? (
        <AskNacMobileExportSheet
          question={question}
          response={response}
          filters={filters}
          onStatus={setExportStatus}
        />
      ) : null}

      {exportStatus ? (
        <p className="nac-ask-nac-export-status nac-ask-nac-export-status--compact" role="status" aria-live="polite">
          {exportStatus}
        </p>
      ) : null}
    </article>
  );
}

/**
 * @param {{ response: object, question: string, filters?: object, variant?: 'desktop' | 'mobile' }} props
 */
export default function AskNacAnswerCard({
  response,
  question = "",
  filters = {},
  variant = "desktop",
}) {
  const [exportStatus, setExportStatus] = useState("");

  if (!response) return null;

  if (variant === "mobile") {
    return (
      <AskNacAnswerCardMobile
        response={response}
        question={question}
        filters={filters}
        exportStatus={exportStatus}
        setExportStatus={setExportStatus}
      />
    );
  }

  const isMissing = response.answerType === ANSWER_TYPES.MISSING_DATA;
  const isError = response.answerType === ANSWER_TYPES.ERROR;
  const showExport =
    hasExportableContent(response) && response.answerType !== ANSWER_TYPES.UNKNOWN;

  return (
    <article
      className={`nac-ask-nac-response nac-ask-nac-response--${response.answerType}`}
      aria-live="polite"
    >
      <header className="nac-ask-nac-response__header">
        <h3>{response.title}</h3>
        <div className="nac-ask-nac-response__meta">
          {response.isAiGenerated ? (
            <span className="nac-ask-nac-badge nac-ask-nac-badge--ai">AI explained</span>
          ) : response.serverConnected && !response.localFallback ? (
            <span className="nac-ask-nac-badge nac-ask-nac-badge--verified">Verified deterministic</span>
          ) : (
            <span className="nac-ask-nac-badge nac-ask-nac-badge--verified">Verified data</span>
          )}
          {response.localFallback ? (
            <span className="nac-ask-nac-badge nac-ask-nac-badge--local">Local fallback</span>
          ) : null}
          {response.confidence ? (
            <span className="nac-ask-nac-badge">{response.confidence} confidence</span>
          ) : null}
        </div>
      </header>

      <PrimaryAnswerContent response={response} />

      <CashUpDebugPanel debug={response.cashUpDebug} productionTrace={response.cashUpProductionTrace} />

      <MetricList metrics={applyExecutiveMetricDisplayLabels(response.keyMetrics)} />

      {response.insights?.length ? (
        <div className="nac-ask-nac-block">
          <h4>Insights</h4>
          <ul>
            {response.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.recommendations?.length ? (
        <div className="nac-ask-nac-block">
          <h4>Recommendations</h4>
          <ul>
            {response.recommendations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.missingData?.length ? (
        <div className="nac-ask-nac-block nac-ask-nac-block--missing">
          <h4>Missing data</h4>
          <ul>
            {response.missingData.map((m) => (
              <li key={m.intent || m.label}>{m.label || m.intent}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {response.sources?.length ? (
        <div className="nac-ask-nac-sources">
          <span>Sources:</span>
          {response.sources.map((s) => (
            <span key={s.name} className="nac-ask-nac-source-chip" title={s.detail}>
              {s.name}
            </span>
          ))}
        </div>
      ) : null}

      {response.vaultSources?.length ? (
        <div className="nac-ask-nac-sources nac-ask-nac-vault-sources">
          <span>Vault files:</span>
          {response.vaultSources.map((s) => (
            <span
              key={s.fileId || s.title}
              className="nac-ask-nac-source-chip nac-ask-nac-vault-chip"
              title={
                s.confidence != null
                  ? `${s.reportType || "vault"} · ${Math.round(s.confidence * 100)}% parse confidence`
                  : s.reportType || "uploaded file"
              }
            >
              {s.title}
            </span>
          ))}
        </div>
      ) : null}

      {response.warnings?.length ? (
        <div className={`nac-ask-nac-warnings ${isMissing || isError ? "nac-ask-nac-warnings--alert" : ""}`}>
          <AlertTriangle size={14} aria-hidden />
          <ul>
            {response.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {isMissing ? (
        <p className="nac-ask-nac-missing-banner" role="note">
          This question is recognized, but the required data is not uploaded or wired yet. No numbers were
          estimated.
        </p>
      ) : null}

      {showExport ? (
        <AskNacExportButton
          question={question}
          response={response}
          filters={filters}
          onStatus={setExportStatus}
        />
      ) : null}

      {exportStatus ? (
        <p className="nac-ask-nac-export-status" role="status" aria-live="polite">
          {exportStatus}
        </p>
      ) : null}
    </article>
  );
}

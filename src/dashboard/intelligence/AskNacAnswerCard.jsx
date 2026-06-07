import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import { hasExportableContent } from "../../intelligence/askNac/export/askNacExportPayload";
import AskNacExportButton from "../../intelligence/askNac/export/AskNacExportButton";

function MetricList({ metrics }) {
  if (!metrics?.length) return null;
  return (
    <ul className="nac-ask-nac-metrics">
      {metrics.map((m) => (
        <li key={`${m.label}-${m.value}`}>
          <span className="nac-ask-nac-metrics__label">{m.label}</span>
          <span className="nac-ask-nac-metrics__value">
            {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
            {m.unit ? ` ${m.unit}` : ""}
          </span>
          {m.note ? <span className="nac-ask-nac-metrics__note">{m.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{ response: object, question: string, filters?: object }} props
 */
export default function AskNacAnswerCard({ response, question = "", filters = {} }) {
  const [exportStatus, setExportStatus] = useState("");

  if (!response) return null;

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
          ) : (
            <span className="nac-ask-nac-badge nac-ask-nac-badge--verified">Verified data</span>
          )}
          {response.confidence ? (
            <span className="nac-ask-nac-badge">{response.confidence} confidence</span>
          ) : null}
        </div>
      </header>

      <p className="nac-ask-nac-response__answer">{response.directAnswer}</p>

      <MetricList metrics={response.keyMetrics} />

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

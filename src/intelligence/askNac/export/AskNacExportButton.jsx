import React, { useMemo } from "react";
import { FileText, Briefcase, List, FileJson, Table2 } from "lucide-react";
import { ASK_NAC_EXPORT_ACTIONS, useAskNacExport } from "./useAskNacExport";

const EXPORT_ICONS = {
  pdf: FileText,
  executive: Briefcase,
  detailed: List,
  json: FileJson,
  csv: Table2,
};

/**
 * @param {{ question: string, response: object, filters?: object, onStatus?: (msg: string) => void }} props
 */
export default function AskNacExportButton({ question, response, filters = {}, onStatus }) {
  const { busy, canExport, runExport, isDisabled } = useAskNacExport({
    question,
    response,
    filters,
    onStatus,
  });

  const actions = useMemo(
    () =>
      ASK_NAC_EXPORT_ACTIONS.map((action) => ({
        ...action,
        icon: EXPORT_ICONS[action.id] || FileText,
      })),
    [],
  );

  if (!canExport) return null;

  return (
    <div className="nac-ask-nac-export">
      <span className="nac-ask-nac-export__label">Export</span>
      <div className="nac-ask-nac-export__actions" role="group" aria-label="Export answer">
        {actions.map(({ id, label, icon: Icon, title }) => (
          <button
            key={id}
            type="button"
            className="nac-ask-nac-export__btn"
            title={title}
            disabled={isDisabled(id)}
            aria-busy={busy === id}
            onClick={() => runExport(id)}
          >
            <Icon size={14} aria-hidden />
            <span>{busy === id ? "…" : label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

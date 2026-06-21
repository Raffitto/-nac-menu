/**
 * Temporary production E2E trace for cash-up Ask NAC queries.
 * Instrumentation only — remove after root cause is confirmed.
 */

export type CashUpProductionTrace = {
  tracedAt: string;
  question: string | null;
  routedIntent: string | null;
  selectedTool: string | null;
  branchFilter: {
    rawBranchFromFilters: unknown;
    rawBranchFromRequest: unknown;
    branchMention: string | null;
    normalizedBranch: string | null;
    profileHint: unknown;
  };
  readiness: {
    status: unknown;
    canQuery: boolean;
    reasons: unknown;
  } | null;
  pipeline: {
    isVaultDataIntent: boolean;
    isVaultDocumentIntent: boolean;
    toolWasNull: boolean;
    answerBuilderPath: string;
  } | null;
  coverageQuery: {
    postgrestEquivalent: string;
    filters: Record<string, unknown>;
    error: string | null;
    rowCount: number;
    allMatchingRows: Record<string, unknown>[];
    selectedRow: Record<string, unknown> | null;
  } | null;
  businessDateQuery: {
    postgrestEquivalent: string;
    filters: Record<string, unknown>;
    error: string | null;
    resolvedBusinessDate: string | null;
  } | null;
  factsQuery: {
    postgrestEquivalent: string;
    filters: Record<string, unknown>;
    error: string | null;
    rowCount: number;
    firstTenFacts: Record<string, unknown>[];
  } | null;
  factsRowCount: number;
  failurePoint: string | null;
  genericFallback: {
    triggered: boolean;
    codePath: string | null;
    reason: string | null;
  };
};

export function createEmptyCashUpProductionTrace(): CashUpProductionTrace {
  return {
    tracedAt: new Date().toISOString(),
    question: null,
    routedIntent: null,
    selectedTool: null,
    branchFilter: {
      rawBranchFromFilters: null,
      rawBranchFromRequest: null,
      branchMention: null,
      normalizedBranch: null,
      profileHint: null,
    },
    readiness: null,
    pipeline: null,
    coverageQuery: null,
    businessDateQuery: null,
    factsQuery: null,
    factsRowCount: 0,
    failurePoint: null,
    genericFallback: {
      triggered: false,
      codePath: null,
      reason: null,
    },
  };
}

export function buildPostgrestEquivalent(
  table: string,
  {
    select,
    eq = {},
    neq = {},
    not = [],
    inFilters = {},
    lte = {},
    gte = {},
    order,
    limit,
  }: {
    select: string;
    eq?: Record<string, string>;
    neq?: Record<string, string>;
    not?: Array<{ column: string; op: string; value: string }>;
    inFilters?: Record<string, string[]>;
    lte?: Record<string, string>;
    gte?: Record<string, string>;
    order?: string;
    limit?: number;
  },
): string {
  const params: string[] = [`select=${encodeURIComponent(select)}`];
  for (const [key, value] of Object.entries(eq)) {
    params.push(`${key}=eq.${encodeURIComponent(value)}`);
  }
  for (const [key, value] of Object.entries(neq)) {
    params.push(`${key}=neq.${encodeURIComponent(value)}`);
  }
  for (const entry of not) {
    params.push(`${entry.column}=not.${entry.op}.${entry.value}`);
  }
  for (const [key, values] of Object.entries(inFilters)) {
    params.push(`${key}=in.(${values.map((v) => encodeURIComponent(v)).join(",")})`);
  }
  for (const [key, value] of Object.entries(lte)) {
    params.push(`${key}=lte.${encodeURIComponent(value)}`);
  }
  for (const [key, value] of Object.entries(gte)) {
    params.push(`${key}=gte.${encodeURIComponent(value)}`);
  }
  if (order) params.push(`order=${order}`);
  if (limit != null) params.push(`limit=${limit}`);
  return `/rest/v1/${table}?${params.join("&")}`;
}

export function summarizeCoverageRawRow(row: Record<string, unknown>) {
  const file = row.source_file as Record<string, unknown> | undefined;
  return {
    id: row.id,
    branch_id: row.branch_id,
    report_type: row.report_type,
    period_start: row.period_start,
    period_end: row.period_end,
    fact_count: row.fact_count,
    readiness_status: row.readiness_status,
    last_ingested_at: row.last_ingested_at,
    source_file_id: row.source_file_id,
    file_title: file?.title || file?.original_filename || null,
  };
}

export function summarizeFactRawRow(row: Record<string, unknown>) {
  const file = row.file as Record<string, unknown> | undefined;
  return {
    id: row.id,
    file_id: row.file_id,
    branch_id: row.branch_id,
    report_type: row.report_type,
    metric_key: row.metric_key,
    metric_value: row.metric_value,
    period_start: row.period_start,
    period_end: row.period_end,
    grain: row.grain,
    file_title: file?.title || file?.original_filename || null,
  };
}

export function summarizeMappedFactRow(fact: Record<string, unknown>) {
  return {
    metricKey: fact.metricKey,
    metricValue: fact.metricValue,
    periodStart: fact.periodStart,
    periodEnd: fact.periodEnd,
    fileTitle: fact.fileTitle,
    branchId: fact.branchId,
    reportType: fact.reportType,
  };
}

const GENERIC_NO_TOOL_MESSAGE =
  "Query tool returned no data for this route. The document or report may exist, but no matching structured result was produced.";

export function finalizeCashUpProductionTrace(
  trace: CashUpProductionTrace,
  {
    routedIntent,
    effectiveQuestion,
    readiness,
    tool,
    answerBuilderUsed,
    isVaultDataIntent,
    isVaultDocumentIntent,
    directAnswer,
  }: {
    routedIntent: string;
    effectiveQuestion: string;
    readiness: { status?: unknown; canQuery?: boolean; reasons?: unknown };
    tool: Record<string, unknown> | null;
    answerBuilderUsed: "buildVaultAnswer" | "buildDeterministicAskNacAnswer";
    isVaultDataIntent: boolean;
    isVaultDocumentIntent: boolean;
    directAnswer: string;
  },
): CashUpProductionTrace {
  trace.routedIntent = routedIntent;
  trace.question = effectiveQuestion;
  trace.readiness = {
    status: readiness?.status,
    canQuery: Boolean(readiness?.canQuery),
    reasons: readiness?.reasons,
  };

  const toolWasNull = !tool;
  let answerBuilderPath = answerBuilderUsed;

  if (answerBuilderUsed === "buildDeterministicAskNacAnswer") {
    if (readiness?.status === "blocked") {
      answerBuilderPath = "buildBlockedResponse(readiness.blocked)";
    } else if (routedIntent === "unknown") {
      answerBuilderPath = "buildUnknownResponse";
    } else if (readiness?.status === "missing" && !readiness?.canQuery) {
      answerBuilderPath = "buildMissingDataResponse(readiness.missing)";
    } else if (isVaultDataIntent || isVaultDocumentIntent) {
      answerBuilderPath = "buildVaultAnswer(via buildDeterministicAskNacAnswer)";
    } else if (toolWasNull) {
      answerBuilderPath = "buildBlockedResponse(!tool)";
    }
  } else if (answerBuilderUsed === "buildVaultAnswer") {
    if (routedIntent === "vault_cash_up_summary") {
      if (toolWasNull) {
        answerBuilderPath = "buildVaultCashUpAnswer(tool=null)";
      } else if (tool?.queryStatus === "connection_error") {
        answerBuilderPath = "buildVaultCashUpAnswer(connection_error)";
      } else if (!((tool?.facts as unknown[]) || []).length) {
        answerBuilderPath = "buildVaultCashUpAnswer(no_facts)";
      } else {
        answerBuilderPath = "buildVaultCashUpAnswer(success)";
      }
    } else {
      answerBuilderPath = `buildVaultAnswer(${routedIntent})`;
    }
  }

  const genericTriggered =
    directAnswer.includes(GENERIC_NO_TOOL_MESSAGE)
    || answerBuilderPath === "buildBlockedResponse(!tool)";

  let genericReason: string | null = null;
  if (genericTriggered) {
    if (answerBuilderPath === "buildBlockedResponse(!tool)") {
      genericReason =
        `buildDeterministicAskNacAnswer: intent=${routedIntent}, isVaultDataIntent=${isVaultDataIntent}, isVaultDocumentIntent=${isVaultDocumentIntent}, toolWasNull=true → ${GENERIC_NO_TOOL_MESSAGE}`;
    } else {
      genericReason = directAnswer;
    }
  }

  trace.pipeline = {
    isVaultDataIntent,
    isVaultDocumentIntent,
    toolWasNull,
    answerBuilderPath,
  };
  trace.genericFallback = {
    triggered: genericTriggered,
    codePath: genericTriggered ? answerBuilderPath : null,
    reason: genericReason,
  };

  if (!readiness?.canQuery && !trace.failurePoint) {
    trace.failurePoint = "readiness_blocked";
    trace.selectedTool = trace.selectedTool || "none (readiness blocked)";
  }

  if (!trace.branchFilter.normalizedBranch && tool?.branch) {
    trace.branchFilter.normalizedBranch = String(tool.branch);
  }

  return trace;
}

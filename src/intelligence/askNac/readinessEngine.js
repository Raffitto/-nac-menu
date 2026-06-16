/**
 * Ask NAC data readiness — verifies tools can answer before querying (and flags missing-data intents).
 */

import { METRIC_DEFINITIONS, METRIC_IDS } from "../metrics/metricDefinitions";
import {
  ASK_NAC_INTENTS,
  isFoodicsCompareIntent,
  isFoodicsDataIntent,
  isMissingDataIntent,
  isVaultDataIntent,
  isVaultDocumentSearchIntent,
  isVaultDocumentSummaryIntent,
  vaultReportTypesForIntent,
} from "./intentRouter";
import { isSalesPerformanceExecutiveQuery } from "./vault/vaultSalesPerformanceIntelligence";
import { isSupabaseConfigured } from "../../lib/supabase";
import { canFetchCrossBranchComparison } from "../../lib/rbacQueryScope";
import { branchDisplayName } from "../../dashboard/utils/rangeState";
import { probeFoodicsBatchForPeriod } from "./foodics/foodicsQueryTools";
import { extractDocumentSearchTerms, probeVaultCoverage } from "./vault/vaultQueryTools";
import { probeGoogleReviewSnapshots } from "./googleReviews/googleReviewQueryTools";
import {
  assessNetworkDataConfidence,
  evaluateExecutiveRankingEligibility,
  requiresExecutiveRankingSafeguard,
} from "./confidence/dataConfidenceLayer";
import { CONFIDENCE } from "../../platform/contracts/dataConfidence";

const READINESS = Object.freeze({
  READY: "ready",
  PARTIAL: "partial",
  MISSING: "missing",
  BLOCKED: "blocked",
});

export { READINESS };

function metricDef(id) {
  return METRIC_DEFINITIONS[id] || null;
}

function branchLabel(branch) {
  return branch ? branchDisplayName(branch) : "your scoped branch or network";
}

function foodicsMissingMessage({ startDate, endDate, branch, periodLabel }) {
  const range = periodLabel || (startDate && endDate ? `${startDate} to ${endDate}` : "the requested period");
  return `No Foodics waiter/product sales import covers ${range} for ${branchLabel(branch)}. Upload a matching batch in Sales Intelligence — Ask NAC never estimates missing months.`;
}

function vaultMissingMessage({ periodLabel, branch, reportTypes = [] }) {
  const types = reportTypes.length ? reportTypes.join(", ") : "uploaded reports";
  return `No Data Vault coverage for ${types} on ${periodLabel || "the requested period"} for ${branchLabel(branch)}. Upload matching files in Ask NAC Data Vault.`;
}

function vaultCrossBranchBlocked(branchMention, profile) {
  if (!profile?.authenticated || profile.allBranches) return null;
  if (!branchMention || branchMention === profile.branchScope) return null;
  return `Your role is scoped to ${branchDisplayName(profile.branchScope)} — you cannot query vault data for ${branchDisplayName(branchMention)}.`;
}

/**
 * Synchronous readiness for routing / UI hints (no network).
 */
export function assessIntentReadinessSync(
  intent,
  {
    profile = null,
    supabaseConfigured = isSupabaseConfigured(),
    foodicsPeriod = null,
    foodicsCompare = null,
    vaultPeriod = null,
    branchMention = null,
    question = "",
  } = {},
) {
  if (isMissingDataIntent(intent)) {
    return buildMissingReadiness(intent);
  }

  if (!supabaseConfigured) {
    return {
      status: READINESS.BLOCKED,
      canQuery: false,
      reasons: ["Supabase is not configured — connect REACT_APP_SUPABASE_URL."],
      missingData: [],
    };
  }

  if (
    (intent === ASK_NAC_INTENTS.BRANCH_COMPARISON || intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS) &&
    profile?.authenticated &&
    !canFetchCrossBranchComparison(profile)
  ) {
    return {
      status: READINESS.BLOCKED,
      canQuery: false,
      reasons: [
        intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS
          ? "Executive network analysis requires network-wide access. Your role is scoped to one branch."
          : "Branch comparison requires network-wide access. Your role is scoped to one branch.",
      ],
      missingData: [],
    };
  }

  if (intent === ASK_NAC_INTENTS.BRANCH_SALES && profile?.authenticated && !profile.allBranches) {
    return {
      status: READINESS.BLOCKED,
      canQuery: false,
      reasons: ["Branch sales comparison requires network-wide access. Your role is scoped to one branch."],
      missingData: [],
    };
  }

  if (intent === ASK_NAC_INTENTS.UNKNOWN) {
    return {
      status: READINESS.MISSING,
      canQuery: false,
      reasons: ["Could not map this question to a supported metric intent."],
      missingData: [],
    };
  }

  if (isVaultDocumentSearchIntent(intent)) {
    const crossBranch = vaultCrossBranchBlocked(branchMention, profile);
    if (crossBranch) {
      return {
        status: READINESS.BLOCKED,
        canQuery: false,
        reasons: [crossBranch],
        missingData: [],
      };
    }

    const searchTerms = extractDocumentSearchTerms(question);
    if (!searchTerms || searchTerms.length < 2) {
      return {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: [
          "Could not extract search terms. Try “Find mentions of terrace AC” or “Search uploaded reports for complaints”.",
        ],
        missingData: [{ intent, label: "Document search terms", planned: false }],
      };
    }

    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      searchTerms,
      note: "Document keyword search — no calendar period required.",
    };
  }

  if (isVaultDocumentSummaryIntent(intent)) {
    const crossBranch = vaultCrossBranchBlocked(branchMention, profile);
    if (crossBranch) {
      return {
        status: READINESS.BLOCKED,
        canQuery: false,
        reasons: [crossBranch],
        missingData: [],
      };
    }

    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      note: "Document summary from uploaded chunks — no structured facts or metric period required.",
    };
  }

  if (intent === ASK_NAC_INTENTS.VAULT_OPERATIONAL_REVIEW) {
    const crossBranch = vaultCrossBranchBlocked(branchMention, profile);
    if (crossBranch) {
      return {
        status: READINESS.BLOCKED,
        canQuery: false,
        reasons: [crossBranch],
        missingData: [],
      };
    }

    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      note: "Cross-document operational review — no calendar period required.",
    };
  }

  if (isVaultDataIntent(intent)) {
    const crossBranch = vaultCrossBranchBlocked(branchMention, profile);
    if (crossBranch) {
      return {
        status: READINESS.BLOCKED,
        canQuery: false,
        reasons: [crossBranch],
        missingData: [],
      };
    }

    if (!vaultPeriod?.startDate || !vaultPeriod?.endDate) {
      if (intent === ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY && isSalesPerformanceExecutiveQuery(question)) {
        return {
          status: READINESS.READY,
          canQuery: true,
          reasons: [],
          missingData: [],
          note: "Latest sales performance query — period resolved from most recent upload.",
        };
      }
      return {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: [
          "Could not parse a calendar day or month for this vault question. Try “5 June”, “05/06/2026”, or “June”.",
        ],
        missingData: [{ intent, label: "Vault period", planned: false }],
      };
    }

    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      note: "Vault coverage verified asynchronously before querying.",
      vaultPeriod,
    };
  }

  if (intent === ASK_NAC_INTENTS.FOODICS_QUERY) {
    return {
      status: READINESS.MISSING,
      canQuery: false,
      reasons: [
        "Try a specific Foodics question such as total sales for a month, top items, category revenue, or rank changes.",
      ],
      missingData: [
        {
          intent,
          metricId: METRIC_IDS.AVG_SPEND_PER_GUEST,
          label: "Foodics sales import",
          planned: false,
        },
      ],
    };
  }

  if (isFoodicsDataIntent(intent)) {
    const period = foodicsCompare?.current || foodicsPeriod || null;
    if (!period?.startDate || !period?.endDate) {
      return {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: [
          "Could not parse a calendar month or date range for this Foodics question. Try “May”, “last month”, or “this month”.",
        ],
        missingData: [{ intent, label: "Foodics period", planned: false }],
      };
    }
    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      note: "Foodics batch coverage verified asynchronously before querying.",
      foodicsPeriod: period,
    };
  }

  const defMap = {
    [ASK_NAC_INTENTS.MENU_QR_SCANS]: METRIC_IDS.MENU_QR_SCAN,
    [ASK_NAC_INTENTS.MENU_SESSIONS]: METRIC_IDS.SESSION,
    [ASK_NAC_INTENTS.GOOGLE_REDIRECTS]: METRIC_IDS.GOOGLE_REDIRECT,
    [ASK_NAC_INTENTS.REVIEW_QR_SCANS]: METRIC_IDS.REVIEW_QR_SCAN,
    [ASK_NAC_INTENTS.STAFF_REDIRECT_LEADERBOARD]: METRIC_IDS.STAFF_ATTRIBUTION,
    [ASK_NAC_INTENTS.BRANCH_COMPARISON]: METRIC_IDS.MENU_QR_SCAN,
    [ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS]: METRIC_IDS.MENU_QR_SCAN,
    [ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE]: METRIC_IDS.MENU_QR_SCAN,
    [ASK_NAC_INTENTS.GOOGLE_REVIEWS]: METRIC_IDS.GOOGLE_REVIEW,
  };

  const def = metricDef(defMap[intent]);
  return {
    status: READINESS.READY,
    canQuery: true,
    reasons: [],
    missingData: [],
    metricDefinition: def,
    partialNote: def?.warningWhenPartial || null,
  };
}

function buildMissingReadiness(intent) {
  const map = {
    [ASK_NAC_INTENTS.AVG_SPEND_PER_GUEST]: {
      metricId: METRIC_IDS.AVG_SPEND_PER_GUEST,
      message: "Average spend per guest needs POS guest-count coverage — planned for a future import phase.",
    },
    [ASK_NAC_INTENTS.DELIVERY_SALES]: {
      metricId: METRIC_IDS.DELIVERY_SALES,
      message: "Delivery platform sales parsing is not enabled yet.",
    },
  };

  const entry = map[intent] || { message: "Data source not available for this intent." };
  const def = metricDef(entry.metricId);

  return {
    status: READINESS.MISSING,
    canQuery: false,
    reasons: [entry.message],
    missingData: [
      {
        intent,
        metricId: entry.metricId,
        label: def?.label || intent,
        planned: def?.dataAvailability === "planned",
      },
    ],
  };
}

async function verifyFoodicsBatch(supabase, { branch, period, profile }) {
  if (!supabase || !period?.startDate || !period?.endDate) return null;
  return probeFoodicsBatchForPeriod(supabase, {
    branch,
    startDate: period.startDate,
    endDate: period.endDate,
    profile,
  });
}

function buildFoodicsMissingReadiness(intent, { branch, period, compare, missingCurrent, missingPrevious }) {
  const reasons = [];
  const missingData = [];

  if (missingCurrent) {
    reasons.push(
      foodicsMissingMessage({
        startDate: period?.startDate,
        endDate: period?.endDate,
        branch,
        periodLabel: period?.label,
      }),
    );
    missingData.push({
      intent,
      label: "Foodics sales import (current period)",
      period: period?.label || `${period?.startDate} – ${period?.endDate}`,
    });
  }

  if (missingPrevious && compare?.previous) {
    reasons.push(
      foodicsMissingMessage({
        startDate: compare.previous.startDate,
        endDate: compare.previous.endDate,
        branch,
        periodLabel: compare.previous.label,
      }),
    );
    missingData.push({
      intent,
      label: "Foodics sales import (previous period)",
      period: compare.previous.label || `${compare.previous.startDate} – ${compare.previous.endDate}`,
    });
  }

  return {
    status: READINESS.MISSING,
    canQuery: false,
    reasons,
    missingData,
  };
}

function buildVaultMissingReadiness(intent, { branch, vaultPeriod, missingTypes, partialTypes, lowConfidenceFiles }) {
  const reasons = [];
  const missingData = [];

  if (missingTypes?.length) {
    reasons.push(
      vaultMissingMessage({
        periodLabel: vaultPeriod?.label || `${vaultPeriod?.startDate} – ${vaultPeriod?.endDate}`,
        branch,
        reportTypes: missingTypes,
      }),
    );
    missingTypes.forEach((type) => {
      missingData.push({
        intent,
        label: `Vault ${type}`,
        period: vaultPeriod?.label,
      });
    });
  }

  if (partialTypes?.length) {
    reasons.push(`Partial vault parse for: ${partialTypes.join(", ")} — review uploaded files.`);
  }

  if (lowConfidenceFiles?.length) {
    reasons.push("Some vault source files have low parser confidence — figures may be provisional.");
  }

  return {
    status: READINESS.MISSING,
    canQuery: false,
    reasons: reasons.length ? reasons : ["No vault coverage under your access scope."],
    missingData,
  };
}

/** Async readiness for intents that need Foodics batch probes. */
export async function assessIntentReadiness(intent, context = {}) {
  const sync = assessIntentReadinessSync(intent, context);
  if (!sync.canQuery && sync.status !== READINESS.READY) {
    return sync;
  }

  if (isVaultDocumentSearchIntent(intent) || isVaultDocumentSummaryIntent(intent)) {
    return sync;
  }

  if (isVaultDataIntent(intent)) {
    if (!context.supabase) return sync;

    const branch = context.branch ?? null;
    const vaultPeriod = context.vaultPeriod || sync.vaultPeriod;
    const reportTypes = vaultReportTypesForIntent(intent);

    const probe = await probeVaultCoverage(context.supabase, {
      branch,
      startDate: vaultPeriod?.startDate,
      endDate: vaultPeriod?.endDate,
      reportTypes: reportTypes.length ? reportTypes : undefined,
      profile: context.profile,
      branchMention: context.branchMention,
    }).catch(() => null);

    if (!probe) {
      return buildVaultMissingReadiness(intent, {
        branch,
        vaultPeriod,
        missingTypes: reportTypes,
      });
    }

    if (intent === ASK_NAC_INTENTS.VAULT_COVERAGE_LIST) {
      if (!probe.hasAny) {
        return buildVaultMissingReadiness(intent, {
          branch,
          vaultPeriod,
          missingTypes: [],
        });
      }
      return {
        status: probe.partialTypes?.length ? READINESS.PARTIAL : READINESS.READY,
        canQuery: true,
        reasons: probe.partialTypes?.length
          ? [`Partial vault coverage: ${probe.partialTypes.join(", ")}`]
          : [],
        missingData: [],
        vaultCoverage: probe,
        warnings: probe.lowConfidenceFiles?.length ? ["Low parser confidence on some vault files."] : [],
      };
    }

    if (reportTypes.length && probe.missingTypes?.length === reportTypes.length) {
      return buildVaultMissingReadiness(intent, {
        branch,
        vaultPeriod,
        missingTypes: probe.missingTypes,
        partialTypes: probe.partialTypes,
        lowConfidenceFiles: probe.lowConfidenceFiles,
      });
    }

    const status =
      probe.missingTypes?.length || probe.partialTypes?.length ? READINESS.PARTIAL : READINESS.READY;

    return {
      status,
      canQuery: true,
      reasons: [
        ...(probe.missingTypes?.length
          ? [`Missing vault report types: ${probe.missingTypes.join(", ")}`]
          : []),
        ...(probe.partialTypes?.length ? [`Partial parse: ${probe.partialTypes.join(", ")}`] : []),
      ].filter(Boolean),
      missingData: [],
      vaultCoverage: probe,
      warnings: probe.lowConfidenceFiles?.length ? ["Low parser confidence on some vault files."] : [],
    };
  }

  if (intent === ASK_NAC_INTENTS.EXECUTIVE_ANALYSIS && context.supabase) {
    const hours = context.hours || context.filters?.timeRangeHours;
    const assessment = await assessNetworkDataConfidence(context.supabase, {
      hours,
      profile: context.profile,
    }).catch(() => null);

    if (!assessment) {
      return {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: ["Could not assess network data coverage for executive analysis."],
        missingData: [],
      };
    }

    const executiveKind = context.executiveKind || null;
    const eligibility = evaluateExecutiveRankingEligibility(assessment, executiveKind || "general");
    if (!eligibility.allowed && requiresExecutiveRankingSafeguard(executiveKind || "general")) {
      return {
        status: READINESS.READY,
        canQuery: true,
        reasons: [eligibility.reason],
        missingData: [],
        dataConfidence: assessment,
        executiveCoverageBlocked: true,
      };
    }

    return {
      status: assessment.confidenceLevel === CONFIDENCE.LOW ? READINESS.PARTIAL : READINESS.READY,
      canQuery: true,
      reasons:
        assessment.confidenceLevel === CONFIDENCE.LOW
          ? ["Network data confidence is low — executive conclusions may be directional only."]
          : [],
      missingData: [],
      dataConfidence: assessment,
      warnings:
        assessment.confidenceLevel !== CONFIDENCE.HIGH
          ? [`Coverage confidence: ${assessment.confidenceLevel}`]
          : [],
    };
  }

  if (intent === ASK_NAC_INTENTS.GOOGLE_REVIEWS && context.supabase) {
    const probe = await probeGoogleReviewSnapshots().catch(() => ({ hasSnapshots: false, count: 0 }));
    if (!probe.hasSnapshots) {
      return {
        status: READINESS.MISSING,
        canQuery: false,
        reasons: [
          "No Google review snapshots are stored yet. Capture daily Google review snapshots from Intelligence dashboards.",
        ],
        missingData: [{ intent, label: "Google review snapshots", planned: false }],
      };
    }
    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      warnings: probe.count < 3 ? ["Limited snapshot history — review deltas may be partial."] : [],
    };
  }

  if (intent === ASK_NAC_INTENTS.OPERATIONAL_KNOWLEDGE) {
    return {
      ...sync,
      canQuery: Boolean(context.supabase),
      status: context.supabase ? READINESS.READY : READINESS.MISSING,
    };
  }

  if (!isFoodicsDataIntent(intent) || intent === ASK_NAC_INTENTS.FOODICS_QUERY) {
    return sync;
  }

  if (!context.supabase) {
    return sync;
  }

  const branch = context.branch ?? null;
  const period = context.foodicsCompare?.current || context.foodicsPeriod || sync.foodicsPeriod || null;
  const compare = context.foodicsCompare || null;

  if (!period?.startDate) {
    return {
      status: READINESS.MISSING,
      canQuery: false,
      reasons: sync.reasons?.length
        ? sync.reasons
        : ["Could not parse a Foodics calendar period from this question."],
      missingData: [{ intent, label: "Foodics period", planned: false }],
    };
  }

  const currentBatch = await verifyFoodicsBatch(context.supabase, { branch, period, profile: context.profile }).catch(
    () => null,
  );

  if (isFoodicsCompareIntent(intent)) {
    const previousPeriod = compare?.previous || null;
    const previousBatch = previousPeriod
      ? await verifyFoodicsBatch(context.supabase, {
          branch,
          period: previousPeriod,
          profile: context.profile,
        }).catch(() => null)
      : null;

    if (!currentBatch || !previousBatch) {
      return buildFoodicsMissingReadiness(intent, {
        branch,
        period,
        compare,
        missingCurrent: !currentBatch,
        missingPrevious: !previousBatch,
      });
    }

    return {
      status: READINESS.READY,
      canQuery: true,
      reasons: [],
      missingData: [],
      batchCoverage: {
        current: currentBatch,
        previous: previousBatch,
      },
    };
  }

  if (!currentBatch) {
    return buildFoodicsMissingReadiness(intent, {
      branch,
      period,
      compare: null,
      missingCurrent: true,
      missingPrevious: false,
    });
  }

  return {
    status: READINESS.READY,
    canQuery: true,
    reasons: [],
    missingData: [],
    batchCoverage: { current: currentBatch },
  };
}

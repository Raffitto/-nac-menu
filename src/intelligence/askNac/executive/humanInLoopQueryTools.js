/**
 * Human-in-the-loop vault query tools.
 */

import { resolveRbacQueryBranch } from "../../../lib/rbacQueryScope";
import { branchDisplayName } from "../../../dashboard/utils/rangeState";
import { parseTeachNacCommand } from "./teachNacParser";
import { storeOperatorMemory } from "./operatorMemory";
import { runWeeklyDashboardSession, resolveWeekEndingPeriod } from "./weeklyDashboardSession";

function resolveBranch(context) {
  const branch = resolveRbacQueryBranch(context.profile, context.branchMention || context.filters?.branch);
  const raw = String(branch || "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "brand" || raw === "network") return null;
  return branch;
}

function resolveUserEmail(context) {
  return String(
    context.userEmail
    || context.profile?.email
    || context.session?.user?.email
    || "",
  ).trim().toLowerCase() || null;
}

export async function teachOperatorMemory(supabase, context = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  const teach = context.teachPayload || parseTeachNacCommand(context.question || "");
  if (!teach?.fact) throw new Error("No operator knowledge text found.");
  if (!userEmail) throw new Error("Authenticated user email required to teach operator knowledge.");

  const result = await storeOperatorMemory(supabase, {
    branch,
    fact: teach.fact,
    taughtBy: userEmail,
  });

  return {
    branch,
    branchLabel: branch ? branchDisplayName(branch) : "Network",
    ...result,
  };
}

export async function provideManualInputForSession(supabase, context = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  const manualInput = context.manualInputPayload;
  const pendingSession = context.pendingSession;
  const vaultPeriod = pendingSession?.context?.vaultPeriod
    || resolveWeekEndingPeriod(context.question || "");

  if (!branch || !userEmail || !manualInput) {
    throw new Error("Manual input requires branch, user, and parsed value.");
  }

  return runWeeklyDashboardSession(supabase, {
    branch,
    branchLabel: branchDisplayName(branch),
    userEmail,
    question: context.question,
    period: vaultPeriod,
    pendingSessionId: pendingSession?.id,
    manualInput,
    profile: context.profile,
  });
}

export async function generateWeeklyDashboard(supabase, context = {}) {
  const branch = resolveBranch(context);
  const userEmail = resolveUserEmail(context);
  if (!branch) throw new Error("Branch scope required for weekly dashboard.");
  if (!userEmail) throw new Error("Authenticated user email required.");

  const vaultPeriod = resolveWeekEndingPeriod(context.question || "");

  return runWeeklyDashboardSession(supabase, {
    branch,
    branchLabel: branchDisplayName(branch),
    userEmail,
    question: context.question,
    period: vaultPeriod,
    pendingSessionId: context.conversationContext?.pendingSessionId || null,
    profile: context.profile,
  });
}

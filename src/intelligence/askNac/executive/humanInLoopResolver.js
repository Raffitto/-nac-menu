/**
 * Resolve human-in-the-loop turns before standard intent routing.
 */

import { parseTeachNacCommand } from "./teachNacParser";
import { parseManualInputAnswer, isLikelyManualInputAnswer } from "./manualInputParser";
import { fetchPendingSession, fetchActivePendingSession } from "./pendingSessions";
import { ASK_NAC_INTENTS } from "../intentRouter";

export async function resolveHumanInTheLoopTurn({
  question,
  conversationContext = null,
  supabase = null,
  branch = null,
  userEmail = null,
} = {}) {
  const teach = parseTeachNacCommand(question);
  if (teach) {
    return {
      overrideIntent: ASK_NAC_INTENTS.VAULT_TEACH_OPERATOR,
      teachPayload: teach,
      resolutionNotes: ["Recognized Teach NAC / operator knowledge command."],
    };
  }

  if (!supabase || !branch || !userEmail) return null;

  let pendingSession = null;
  const sessionId = conversationContext?.pendingSessionId;
  if (sessionId) {
    pendingSession = await fetchPendingSession(supabase, sessionId);
  }
  for (const sessionType of ["weekly_dashboard", "executive_evidence"]) {
    if (pendingSession?.status === "pending") break;
    pendingSession = await fetchActivePendingSession(supabase, {
      branch,
      createdBy: userEmail,
      sessionType,
    });
    if (pendingSession?.status === "pending") break;
  }

  if (!pendingSession || pendingSession.status !== "pending") return null;

  const awaitingInput = conversationContext?.awaitingInput || pendingSession.status === "pending";
  if (!isLikelyManualInputAnswer(question, { pendingSessionId: pendingSession.id, awaitingInput })) {
    return null;
  }

  const parsed = parseManualInputAnswer(question, pendingSession.missingFields);
  if (!parsed) return null;

  return {
    overrideIntent: ASK_NAC_INTENTS.VAULT_PROVIDE_MANUAL_INPUT,
    manualInputPayload: parsed,
    pendingSession,
    resolutionNotes: [`Recognized manual input for pending session ${pendingSession.id.slice(0, 8)}…`],
  };
}

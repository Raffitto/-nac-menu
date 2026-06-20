import { ANSWER_TYPES } from "../../intelligence/askNac/askNacContract";
import { ASK_NAC_INTENTS } from "../../intelligence/askNac/intentRouter";

/**
 * Cash-up only: render structured executiveBrief instead of legacy directAnswer block.
 */
export function shouldRenderCashUpExecutiveBrief(response) {
  if (!response?.executiveBrief) return false;
  if (response.answerType !== ANSWER_TYPES.EXECUTIVE) return false;
  return response.intent === ASK_NAC_INTENTS.VAULT_CASH_UP_SUMMARY;
}

/**
 * Edge-side Ask NAC conversation follow-up resolution (Conversation Intelligence V1).
 */

export {
  resolveFollowUpQuestion,
  prepareAskNacQuestionEdge,
  updateConversationContextEdge,
  createEmptyConversationContext,
  conversationStateFromLegacyContext,
  captureConversationStateFromTurn,
  FOLLOW_UP_CATEGORIES,
} from "./conversationIntelligence.ts";

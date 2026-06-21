/**
 * WhatsApp intelligence layer — foundation exports.
 */

export {
  WHATSAPP_MESSAGE_CATEGORIES,
  WHATSAPP_VAULT_ROLE_DEFAULTS,
  WHATSAPP_RESPONSE_TYPES,
  WHATSAPP_DENIAL_REASONS,
  normalizePhoneE164,
  classifyWhatsAppMessage,
  detectBranchMention,
  resolveAllowedBranchIds,
  whatsappUserHasCrossBranchAccess,
  buildWhatsAppHelpText,
} from "./whatsappContract";

export {
  resolveWhatsAppBranch,
  isBranchPermittedForWhatsAppUser,
  checkWhatsAppCategoryPermission,
} from "./whatsappBranchResolver";

export {
  formatAskNacAnswerForWhatsApp,
  formatWhatsAppDenial,
} from "./whatsappResponseFormatter";

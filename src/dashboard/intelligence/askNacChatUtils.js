/** Pure helpers for Ask NAC chat UX (keyboard + message model). */

let messageCounter = 0;

export function nextMessageId() {
  messageCounter += 1;
  return `ask-nac-msg-${Date.now()}-${messageCounter}`;
}

export function createUserMessage(content) {
  return {
    id: nextMessageId(),
    role: "user",
    content: String(content || "").trim(),
  };
}

export function createAssistantMessage({ question, response = null, error = null }) {
  return {
    id: nextMessageId(),
    role: "assistant",
    question: String(question || "").trim(),
    response,
    error: error ? String(error) : null,
  };
}

export function isComposingKeyboardEvent(event) {
  return Boolean(event?.nativeEvent?.isComposing || event?.isComposing);
}

/** Enter without Shift submits; Shift+Enter inserts newline. */
export function shouldSubmitOnEnter(event) {
  if (event?.key !== "Enter") return false;
  if (isComposingKeyboardEvent(event)) return false;
  if (event.shiftKey) return false;
  return true;
}

/** Cmd/Ctrl+Enter also submits. */
export function shouldSubmitOnModifierEnter(event) {
  if (event?.key !== "Enter") return false;
  if (isComposingKeyboardEvent(event)) return false;
  return Boolean(event.metaKey || event.ctrlKey);
}

export function shouldSubmitComposer(event) {
  return shouldSubmitOnEnter(event) || shouldSubmitOnModifierEnter(event);
}

export function handleComposerKeyDown(event, { onSubmit, disabled = false } = {}) {
  if (disabled || typeof onSubmit !== "function") return false;
  if (!shouldSubmitComposer(event)) return false;
  event.preventDefault();
  onSubmit();
  return true;
}

export const COMPOSER_MAX_HEIGHT_PX = 160;
export const COMPOSER_MIN_HEIGHT_PX = 52;

export function resizeComposerTextarea(textarea, maxHeight = COMPOSER_MAX_HEIGHT_PX) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const next = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${Math.max(next, COMPOSER_MIN_HEIGHT_PX)}px`;
}

/** Suggestion chips — mobile collapses after first message; desktop keeps post-chat chips. */
export function resolveAskNacSuggestions({
  mobileFirst = false,
  maxSuggestions = 8,
  messageCount = 0,
  allPrompts = [],
  mobilePrompts = [],
}) {
  if (messageCount > 0) {
    return mobileFirst ? [] : allPrompts.slice(0, maxSuggestions);
  }
  if (mobileFirst) {
    return mobilePrompts.slice(0, maxSuggestions);
  }
  return allPrompts;
}

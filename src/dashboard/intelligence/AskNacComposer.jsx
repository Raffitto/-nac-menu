import React, { useCallback, useEffect, useRef } from "react";
import { Loader2, Send } from "lucide-react";
import {
  COMPOSER_MAX_HEIGHT_PX,
  handleComposerKeyDown,
  resizeComposerTextarea,
} from "./askNacChatUtils";

/**
 * Chat-style composer — Enter sends, Shift+Enter newline, gold send button.
 */
export default function AskNacComposer({
  value = "",
  onChange,
  onSubmit,
  loading = false,
  suggestions = [],
  inputRef = null,
  placeholder = "Ask about menu scans, sales, staff, branches, Foodics, or vault reports…",
}) {
  const localRef = useRef(null);
  const textareaRef = inputRef || localRef;

  const resize = useCallback(() => {
    resizeComposerTextarea(textareaRef.current, COMPOSER_MAX_HEIGHT_PX);
  }, [textareaRef]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const submit = useCallback(() => {
    if (loading || !String(value).trim()) return;
    onSubmit?.(value);
  }, [loading, onSubmit, value]);

  const onKeyDown = useCallback(
    (event) => {
      handleComposerKeyDown(event, { onSubmit: submit, disabled: loading });
    },
    [loading, submit],
  );

  const onFormSubmit = (event) => {
    event.preventDefault();
    submit();
  };

  return (
    <div className="nac-ask-nac-composer">
      {suggestions?.length ? (
        <div className="nac-ask-nac-suggestions nac-ask-nac-suggestions--scroll">
          <span className="nac-ask-nac-suggestions__label">Try:</span>
          <div className="nac-ask-nac-suggestions__track">
            {suggestions.map(({ text, icon: Icon }) => (
              <button
                key={text}
                type="button"
                className="nac-ask-nac-chip"
                disabled={loading}
                onClick={() => onSubmit?.(text)}
              >
                {Icon ? <Icon size={14} aria-hidden /> : null}
                {text}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <form onSubmit={onFormSubmit} className="nac-ask-nac-form nac-ask-nac-form--chat">
        <label htmlFor="ask-nac-input" className="sr-only">
          Ask NAC a question
        </label>
        <textarea
          id="ask-nac-input"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={loading}
          aria-label="Ask NAC a question"
          aria-busy={loading}
        />
        <button
          type="submit"
          disabled={loading || !String(value).trim()}
          className="nac-ask-nac-submit"
          aria-label={loading ? "Querying verified metrics" : "Send question"}
        >
          {loading ? <Loader2 size={20} className="nac-bi-spin" /> : <Send size={20} />}
          <span className="nac-ask-nac-submit__label">{loading ? "…" : "Send"}</span>
        </button>
      </form>
      <p className="nac-ask-nac-composer__hint">
        <span className="nac-ask-nac-composer__hint-desktop">Enter to send · Shift+Enter for new line</span>
        <span className="nac-ask-nac-composer__hint-mobile">Tap Send or press Enter</span>
      </p>
    </div>
  );
}

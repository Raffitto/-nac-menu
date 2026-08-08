import React, { useEffect, useMemo, useState } from "react";

export default function MenuCommandPalette({
  open,
  commands = [],
  onClose,
  onRun,
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 40);
    return commands
      .filter((cmd) => {
        const hay = `${cmd.label} ${cmd.keywords || ""}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 40);
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className="mm-palette-backdrop" data-testid="menu-command-palette" onClick={onClose}>
      <div className="mm-palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="mm-palette-input"
          placeholder="Search commands or items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose?.();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const cmd = filtered[index];
              if (cmd) {
                onRun?.(cmd);
                onClose?.();
              }
            }
          }}
        />
        <div className="mm-palette-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="mm-palette-empty">No matches</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={`mm-palette-item ${i === index ? "is-active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  onRun?.(cmd);
                  onClose?.();
                }}
              >
                <span>{cmd.label}</span>
                {cmd.group ? <em>{cmd.group}</em> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

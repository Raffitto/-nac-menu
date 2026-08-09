import React, { useEffect, useMemo, useState } from "react";

/**
 * Lightweight Cmd/Ctrl+K palette for Intelligence destinations.
 * Reuses Hub styling language; does not import Menu Manager palette code.
 */
export default function IntelligenceCommandPalette({ open, commands, onClose, onSelect }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        (cmd.keywords || "").toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const run = (cmd) => {
    if (!cmd) return;
    onSelect?.(cmd);
    onClose?.();
  };

  return (
    <div className="nac-intel-palette-backdrop" data-testid="intelligence-command-palette" onClick={onClose}>
      <div
        className="nac-intel-palette"
        role="dialog"
        aria-label="Intelligence command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="nac-intel-palette-input"
          autoFocus
          value={query}
          placeholder="Go to Ask NAC, Operations, Commercial, Market…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose?.();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              run(filtered[index]);
            }
          }}
        />
        <div className="nac-intel-palette-list" role="listbox">
          {!filtered.length ? (
            <div className="nac-intel-palette-empty">No matches</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={i === index}
                className={`nac-intel-palette-item ${i === index ? "is-active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(cmd)}
              >
                {cmd.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

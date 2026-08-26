import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Search, X } from "lucide-react";
import { DRINK_BIBLE_CATEGORIES, DRINK_BIBLE_ITEMS, DRINK_BIBLE_SOURCE } from "./drinkBible";
import "./drinkBible.css";

function Detail({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="db-modal" role="dialog" aria-modal="true" aria-label={`${item.name} recipe`} onMouseDown={onClose}>
      <article className={`db-detail ${item.needsReview ? "db-detail--review" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="db-close" aria-label="Close Drink Bible card" onClick={onClose}><X size={20} /></button>
        <div className="db-detail-head">
          <div>
            <p>{item.category}</p>
            <h2>{item.name}</h2>
          </div>
          {item.needsReview ? <span className="db-review-badge"><AlertTriangle size={15} /> Needs review</span> : <span className="db-ok-badge"><CheckCircle2 size={15} /> Source complete</span>}
        </div>
        {item.needsReview ? (
          <section className="db-review-panel">
            <strong>Review before treating as final</strong>
            <ul>{item.reviewReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </section>
        ) : null}
        <dl className="db-meta">
          {item.glass ? <><dt>Glass</dt><dd>{item.glass}</dd></> : null}
          {item.ice ? <><dt>Ice</dt><dd>{item.ice}</dd></> : null}
          {item.garnish ? <><dt>Garnish</dt><dd>{item.garnish}</dd></> : null}
          {item.portion ? <><dt>Portion</dt><dd>{item.portion}</dd></> : null}
          {item.batch ? <><dt>Batch</dt><dd>{item.batch}</dd></> : null}
          {item.workingNotes ? <><dt>Notes</dt><dd>{item.workingNotes}</dd></> : null}
        </dl>
        <section>
          <h3>Ingredients</h3>
          {item.ingredients.length ? (
            <div className="db-table-wrap"><table className="db-table"><thead><tr><th>Ingredient / component</th><th>Quantity</th><th>Unit</th><th>Notes</th></tr></thead><tbody>{item.ingredients.map((line, idx) => <tr key={`${line.name}-${idx}`}><td>{line.name}</td><td>{line.quantity || "—"}</td><td>{line.unit || "—"}</td><td>{line.notes || ""}</td></tr>)}</tbody></table></div>
          ) : <p className="db-empty">No detailed ingredient card is present in the supplied source.</p>}
        </section>
        <section><h3>Method</h3><p>{item.method || "No detailed method is present in the supplied source."}</p></section>
        <section className="db-source"><h3>Source / working notes</h3><p>{item.sourceNotes || DRINK_BIBLE_SOURCE}</p></section>
      </article>
    </div>
  );
}

export default function DrinkBibleView() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return DRINK_BIBLE_ITEMS.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (status === "review" && !item.needsReview) return false;
      if (status === "ready" && item.needsReview) return false;
      if (!term) return true;
      return [item.name, item.category, item.sourceNotes, ...(item.ingredients || []).map((line) => line.name)].filter(Boolean).join(" ").toLowerCase().includes(term);
    });
  }, [search, category, status]);

  const needsReview = DRINK_BIBLE_ITEMS.filter((item) => item.needsReview).length;
  const complete = DRINK_BIBLE_ITEMS.length - needsReview;

  return (
    <section className="db-view" data-testid="drink-bible-view">
      <div className="db-summary">
        <article><strong>{DRINK_BIBLE_ITEMS.length}</strong><span>Drink identities</span></article>
        <article className="db-summary-review"><strong>{needsReview}</strong><span>Needs review</span></article>
        <article><strong>{complete}</strong><span>Source-complete</span></article>
        <article><strong>{DRINK_BIBLE_CATEGORIES.length}</strong><span>Sections</span></article>
      </div>
      <div className="db-toolbar">
        <label className="db-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search drinks or ingredients" /></label>
        <select aria-label="Drink Bible category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All sections</option>{DRINK_BIBLE_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        <select aria-label="Drink Bible review status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="review">Needs review</option><option value="ready">Source-complete</option></select>
      </div>
      <p className="db-source-line">Source: {DRINK_BIBLE_SOURCE}. Values are preserved from the working file; unresolved fields are deliberately not guessed.</p>
      <div className="db-grid">
        {filtered.map((item) => (
          <button type="button" key={item.id} className={`db-card ${item.needsReview ? "db-card--review" : ""}`} onClick={() => setSelected(item)}>
            <span className="db-card-category">{item.category}</span>
            <strong>{item.name}</strong>
            <span className={item.needsReview ? "db-card-status db-card-status--review" : "db-card-status"}>{item.needsReview ? <><AlertTriangle size={14} /> Needs review</> : <><CheckCircle2 size={14} /> Source-complete</>}</span>
            {item.needsReview ? <small>{item.reviewReasons[0]}</small> : <small>{item.ingredients.length} documented ingredient line{item.ingredients.length === 1 ? "" : "s"}</small>}
          </button>
        ))}
      </div>
      {!filtered.length ? <p className="db-empty">No drinks match these filters.</p> : null}
      <Detail item={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

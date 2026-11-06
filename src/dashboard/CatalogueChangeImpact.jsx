import React from "react";

export default function CatalogueChangeImpact({ impact }) {
  if (!impact) return null;
  return (
    <section className="mm-linked-sync-note" aria-label="Change impact" data-testid="catalogue-change-impact">
      <p>{impact.productName} — change impact</p>
      <ul>
        {impact.lines.map((line) => (
          <li key={line.id}>{line.label}: {line.value}</li>
        ))}
      </ul>
      <p>This preview does not publish.</p>
    </section>
  );
}

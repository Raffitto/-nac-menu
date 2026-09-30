import React, { useEffect, useState } from "react";
import {
  attachSupplierToInvoice,
  confirmLineMapping,
  confirmLinePack,
  confirmDocumentReceivingTreatment,
  createIngredient,
  assignHumanCode,
  supplierCandidatesForInvoice,
} from "../lib/inventoryApi";
import { CANONICAL_UNITS } from "./ingredientMaster";
import {
  classifySupplierCandidates,
  packCountChoices,
  RECEIVING_POLICY_CHOICES,
  supplierWordingFromInvoice,
} from "./procurement/supplierOnboarding";
import { classifyDocumentKind, interpretSupplierPack, suggestCodeFamily, suggestReceivingTreatment } from "./procurement/receivingPolicy";

const FAMILIES = [
  ["P", "Packaging"],
  ["C", "Consumable"],
  ["CL", "Cleaning"],
  ["F", "Food"],
  ["B", "Bar"],
  ["E", "Equipment"],
  ["M", "Maintenance"],
];

export default function InvoiceOnboarding({
  invoice,
  ingredients = [],
  profileConfirmed = false,
  onChanged,
  run,
}) {
  const wording = supplierWordingFromInvoice(invoice);
  const suggestion = suggestReceivingTreatment({
    documentKind: classifyDocumentKind(`${invoice?.raw_ocr_text || ""} ${invoice?.notes || ""} ${invoice?.structured_extraction?.documentLabel || ""}`),
    lines: invoice?.inventory_invoice_lines || [],
  });
  const [candidates, setCandidates] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [policyChoice, setPolicyChoice] = useState("");
  const [otherPack, setOtherPack] = useState("");
  const supplierKnown = Boolean(invoice?.supplier_id);

  useEffect(() => {
    if (!invoice?.id || supplierKnown) return undefined;
    let cancelled = false;
    supplierCandidatesForInvoice(invoice.id)
      .then((result) => {
        if (cancelled) return;
        const classified = classifySupplierCandidates({
          name: result?.name || wording.name,
          vat: result?.vat || wording.vat,
          suppliers: result?.candidates || [],
        });
        setCandidates(classified);
      })
      .catch((error) => {
        if (!cancelled) setSetupError(error.message || "Supplier setup is not available for this role.");
      });
    return () => {
      cancelled = true;
    };
  }, [invoice?.id, supplierKnown, wording.name, wording.vat]);

  if (!invoice) return null;

  const attach = (input) => run("supplier", async () => {
    await attachSupplierToInvoice({ invoiceId: invoice.id, ...input });
    await onChanged();
  }, "Supplier saved on this document. No stock was posted.");

  return (
    <section className="inv-onboard" data-testid="supplier-onboarding">
      {!supplierKnown && (
        <div>
          <p className="inv-kicker">{wording.name || "Supplier name not read"}</p>
          <h3>Supplier not recognized</h3>
          {wording.vat && <p>VAT on the document: {wording.vat}</p>}
          {setupError && <p>{setupError}</p>}
          {(candidates?.candidates || []).map((candidate) => (
            <div key={candidate.id} className="inv-onboard-choice">
              <p>Possible existing supplier</p>
              <strong>{candidate.name}</strong>
              <p>{candidate.strength === "vat" ? "Same VAT on the document." : "Similar name. This is not an automatic match."}</p>
              <button type="button" className="inv-button inv-button--primary" onClick={() => attach({ supplierId: candidate.id })}>
                Use this
              </button>
              {candidates.allowSeparate && (
                <button
                  type="button"
                  className="inv-button inv-button--secondary"
                  onClick={() => attach({ createName: wording.name, confirmSeparate: true })}
                >
                  Create separate supplier
                </button>
              )}
            </div>
          ))}
          {candidates?.decision === "create" && (
            <button
              type="button"
              className="inv-button inv-button--primary"
              disabled={!wording.name}
              onClick={() => attach({ createName: wording.name })}
            >
              Create supplier
            </button>
          )}
          {candidates?.decision !== "create" && (
            <p>Match an existing supplier above, or create one only if it is truly separate.</p>
          )}
        </div>
      )}

      {supplierKnown && !profileConfirmed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const choice = RECEIVING_POLICY_CHOICES.find((item) => item.id === policyChoice);
            if (!choice) return;
            run("treatment", async () => {
              await confirmDocumentReceivingTreatment({
                invoiceId: invoice.id,
                treatment: choice.treatment,
              });
              await onChanged();
            }, "This document’s receiving choice was saved. Future invoices from this supplier are unchanged. No stock was posted.");
          }}
        >
          <h3>How should this delivery be received?</h3>
          <p>This choice applies to this document only.</p>
          {suggestion.treatment && (
            <p>Suggested: {RECEIVING_POLICY_CHOICES.find((choice) => choice.id === suggestion.treatment)?.title}. {suggestion.reason}</p>
          )}
          {!suggestion.treatment && <p>{suggestion.reason}</p>}
          {RECEIVING_POLICY_CHOICES.map((choice) => (
            <label key={choice.id} className="inv-onboard-choice">
              <input
                type="radio"
                name="receivingTreatment"
                value={choice.id}
                checked={policyChoice === choice.id}
                onChange={() => setPolicyChoice(choice.id)}
              />
              <strong>{choice.title}</strong>
              <span>{choice.detail}</span>
            </label>
          ))}
          <button className="inv-button inv-button--primary" type="submit" disabled={!policyChoice}>
            Save this document only
          </button>
        </form>
      )}

      {supplierKnown && profileConfirmed && (invoice.inventory_invoice_lines || []).filter((line) => line.active !== false && !line.ingredient_id).map((line) => {
        const suggestion = suggestCodeFamily(line.original_description);
        const matches = ingredients.filter((ingredient) => {
          const token = String(line.original_description || "").toLowerCase().split(/\s+/).find((part) => part.length >= 6);
          return token && String(ingredient.canonical_name || "").toLowerCase().includes(token);
        }).slice(0, 3);
        return (
          <article key={line.id} className="inv-onboard-choice">
            <strong>{line.original_description}</strong>
            <p>{line.original_quantity ?? "—"} {line.original_unit || ""} · SKU {line.supplier_sku || "—"}</p>
            {matches.map((ingredient) => (
              <button
                key={ingredient.id}
                type="button"
                className="inv-button inv-button--secondary"
                onClick={() => run(`map:${line.id}`, async () => {
                  await confirmLineMapping({
                    invoiceLineId: line.id,
                    ingredientId: ingredient.id,
                    conversionFactor: "1",
                    canonicalQuantity: line.original_quantity,
                    canonicalUnit: ingredient.base_inventory_unit,
                    createVerifiedAlias: true,
                    reason: "matched_on_invoice",
                  });
                  await onChanged();
                }, "Item matched. No stock was posted.")}
              >
                Use {ingredient.canonical_name}
              </button>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                run(`create:${line.id}`, async () => {
                  const created = await createIngredient({
                    canonicalName: values.get("name"),
                    category: suggestion.label,
                    baseInventoryUnit: values.get("baseUnit"),
                  });
                  await assignHumanCode(created.id, values.get("family"));
                  await confirmLineMapping({
                    invoiceLineId: line.id,
                    ingredientId: created.id,
                    conversionFactor: "1",
                    canonicalQuantity: line.original_quantity,
                    canonicalUnit: values.get("baseUnit"),
                    createVerifiedAlias: false,
                    reason: "created_on_invoice",
                  });
                  await onChanged();
                }, "Item created and mapped. No stock was posted.");
              }}
            >
              <p>Create new item</p>
              <input name="name" required defaultValue={line.original_description || ""} />
              <select name="family" required defaultValue={suggestion.family || ""}>
                <option value="">Choose a family</option>
                {FAMILIES.map(([code, label]) => (
                  <option key={code} value={code}>{suggestion.family === code ? `Suggested: ${label}` : label}</option>
                ))}
              </select>
              <p>
                {suggestion.family
                  ? `Next available ${suggestion.label} code will be allocated when confirmed.`
                  : "Choose a family. Food is not the default, and no code is allocated until you confirm."}
              </p>
              <select name="baseUnit" required defaultValue={String(line.original_unit || "").toLowerCase() === "each" ? "each" : ""}>
                <option value="">Base unit</option>
                {CANONICAL_UNITS.map((unit) => (
                  <option key={unit.value} value={unit.value}>{unit.label}</option>
                ))}
              </select>
              <button className="inv-button inv-button--primary" type="submit">Create and map</button>
            </form>
          </article>
        );
      })}

      {supplierKnown && profileConfirmed && (invoice.inventory_invoice_lines || []).filter((line) => {
        const pack = interpretSupplierPack({
          description: line.original_description,
          quantity: line.original_quantity,
          learned: line.pack_status === "verified" ? { status: "verified", conversionFactor: Number(line.conversion_factor || 1) } : null,
        });
        return line.ingredient_id && pack.blocksPosting;
      }).map((line) => (
        <article key={`pack-${line.id}`} className="inv-onboard-choice">
          <h3>How should NAC count this item?</h3>
          <p>Supplier delivered: {line.original_quantity} × {line.original_description}</p>
          {packCountChoices({ description: line.original_description, quantity: line.original_quantity }).map((choice) => (
            <button
              key={choice.id}
              type="button"
              className="inv-button inv-button--secondary"
              onClick={() => run(`pack:${line.id}`, async () => {
                await confirmLineMapping({
                  invoiceLineId: line.id,
                  ingredientId: line.ingredient_id,
                  conversionFactor: choice.conversionFactor,
                  canonicalQuantity: choice.canonicalQuantity,
                  canonicalUnit: choice.canonicalUnit,
                  createVerifiedAlias: false,
                  reason: `pack_${choice.interpretation}`,
                });
                await confirmLinePack(invoice.id, line.id, "verified");
                await onChanged();
              }, "Pack conversion saved for this supplier SKU. No stock was posted.")}
            >
              {choice.title}
            </button>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const pieces = Number(otherPack);
              if (!pieces) return;
              run(`pack:${line.id}`, async () => {
                await confirmLineMapping({
                  invoiceLineId: line.id,
                  ingredientId: line.ingredient_id,
                  conversionFactor: String(pieces),
                  canonicalQuantity: String(Number(line.original_quantity) * pieces),
                  canonicalUnit: "each",
                  createVerifiedAlias: false,
                  reason: "pack_other",
                });
                await confirmLinePack(invoice.id, line.id, "verified");
                await onChanged();
              }, "Pack conversion saved for this supplier SKU. No stock was posted.");
            }}
          >
            <label>Enter another conversion
              <input value={otherPack} onChange={(event) => setOtherPack(event.target.value)} inputMode="decimal" placeholder="Pieces in one supplier unit" />
            </label>
            <button className="inv-button inv-button--secondary" type="submit">Save other conversion</button>
          </form>
        </article>
      ))}
    </section>
  );
}

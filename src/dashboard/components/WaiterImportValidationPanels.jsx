import React from "react";
import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
function TotalsTable({ validation, showRowCount = true }) {
  if (!validation?.creators?.length) {
    return <p className="fi-muted">No rows to display.</p>;
  }
  return (
    <table className="fi-table fi-table--compact">
      <thead>
        <tr>
          <th>Creator</th>
          <th>Role</th>
          <th>Gross SAR</th>
          <th>Net SAR</th>
          <th>Qty</th>
          {showRowCount && <th>Rows</th>}
        </tr>
      </thead>
      <tbody>
        {validation.creators.map((c) => (
          <tr key={c.waiter}>
            <td>{c.waiter}</td>
            <td>{c.roleLabel}</td>
            <td>{c.gross_sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td>{c.net_sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td>{c.quantity}</td>
            {showRowCount && <td>{c.row_count}</td>}
          </tr>
        ))}
        <tr className="fi-validation-total">
          <td colSpan={2}>
            <strong>Grand total</strong>
          </td>
          <td>
            <strong>
              {validation.totals.gross_sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </strong>
          </td>
          <td>
            <strong>
              {validation.totals.net_sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </strong>
          </td>
          <td>
            <strong>{validation.totals.quantity}</strong>
          </td>
          {showRowCount && <td><strong>{validation.totals.row_count}</strong></td>}
        </tr>
      </tbody>
    </table>
  );
}

export default function WaiterImportValidationPanels({
  rawValidation,
  previewValidation,
  lastSavedValidation,
  lastSavedLabel,
  importDebug,
  pivotMismatch,
}) {
  return (
    <div className="fi-waiter-validation-stack">
      {rawValidation && (
        <motion.div className="fi-validation-panel fi-validation-panel--raw" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h4>1. Raw parsed totals (from file, before menu matching)</h4>
          <p className="fi-muted">
            Target: ~155,848 SAR gross · 4,327 qty · compare to Foodics Sales by Creator pivot
          </p>
          {importDebug && (
            <motion.div className="fi-debug-counts">
              <span>Raw rows parsed: <strong>{importDebug.rawRowsParsed}</strong></span>
              <span>With creator: <strong>{importDebug.rowsWithCreator}</strong></span>
              <span>Creator + sales: <strong>{importDebug.rowsWithCreatorAndSales}</strong></span>
              <span>Raw gross: <strong>{importDebug.rawGross?.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAR</strong></span>
              <span>Raw qty: <strong>{importDebug.rawQty}</strong></span>
            </motion.div>
          )}
          <TotalsTable validation={rawValidation} showRowCount />
        </motion.div>
      )}

      {previewValidation && (
        <motion.div className="fi-validation-panel fi-validation-panel--preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h4>2. Current preview — totals to be saved</h4>
          <p className="fi-muted">Includes unmatched, future menu, and classified rows when they have sales</p>
          {importDebug && (
            <motion.div className="fi-debug-counts">
              <span>After match: <strong>{importDebug.rowsAfterMatch}</strong></span>
              <span>Zero-value excluded: <strong>{importDebug.rowsZeroExcluded}</strong></span>
              <span>Rows to save: <strong>{importDebug.rowsSaved}</strong></span>
              <span>Save gross: <strong>{importDebug.saveGross?.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAR</strong></span>
              <span>Save qty: <strong>{importDebug.saveQty}</strong></span>
              <span>Unmatched saved: <strong>{importDebug.rowsUnmatchedButSaved}</strong></span>
            </motion.div>
          )}
          {pivotMismatch && (
            <div className="fi-pivot-warning" role="alert">
              <AlertTriangle size={18} />
              <motion.div>
                <strong>If preview totals do not match your Foodics pivot, do not save.</strong>
                <p>
                  Preview gross/qty differs from raw parsed totals. Re-check column mapping (Creator, Gross Sales, Net Quantity) or re-export from Foodics.
                </p>
              </motion.div>
            </div>
          )}
          <TotalsTable validation={previewValidation} showRowCount />
        </motion.div>
      )}

      {lastSavedValidation && (
        <motion.section className="fi-validation-panel fi-validation-panel--saved">
          <h4>3. Last saved import (database)</h4>
          <p className="fi-muted">
            {lastSavedLabel || "From the most recent successful Save import — not the current preview"}
          </p>
          <TotalsTable validation={lastSavedValidation} showRowCount={false} />
        </motion.section>
      )}
    </div>
  );
}

import React from "react";
import { motion } from "framer-motion";
import { Package, UserCircle, CheckCircle2, Clock } from "lucide-react";
import FoodicsIntelligence from "../FoodicsIntelligence";
import { IMPORT_LANES, normalizeImportType } from "../config/foodicsImportTypes";
import "../styles/foodics-import-lanes.css";

export default function FoodicsImportLane({ importType, latestBatch, onImported }) {
  const meta = IMPORT_LANES[importType];
  const Icon = importType === "waiter_product_sales" ? UserCircle : Package;
  const batchType = latestBatch ? normalizeImportType(latestBatch) : null;

  return (
    <motion.article className="fi-lane" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <header className="fi-lane-header">
        <div className="fi-lane-icon">
          <Icon size={22} />
        </div>
        <div>
          <h3>{meta.title}</h3>
          <p>{meta.subtitle}</p>
        </div>
      </header>

      <div className="fi-lane-instructions">
        <p className="fi-lane-report"><strong>Foodics report:</strong> {meta.foodicsReport}</p>
        <ul>
          {meta.instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="fi-lane-used">
          <span>Used for</span>
          {meta.usedFor.map((u) => (
            <span key={u} className="fi-lane-tag">{u}</span>
          ))}
        </div>
      </div>

      {latestBatch ? (
        <div className="fi-lane-last-batch">
          <CheckCircle2 size={14} color="#4ecdc4" />
          <span>
            Last upload: {latestBatch.period_start} → {latestBatch.period_end}
            {" · "}
            {latestBatch.branch_id}
            {batchType && batchType !== importType ? " (different type)" : ""}
          </span>
          {latestBatch.uploaded_at && (
            <span className="fi-lane-batch-time">
              <Clock size={12} />
              {new Date(latestBatch.uploaded_at).toLocaleString()}
            </span>
          )}
        </div>
      ) : (
        <p className="fi-lane-empty">No batch uploaded yet for this lane</p>
      )}

      <FoodicsIntelligence
        importType={importType}
        embedded
        laneBranch={latestBatch?.branch_id}
        onImported={onImported}
      />
    </motion.article>
  );
}

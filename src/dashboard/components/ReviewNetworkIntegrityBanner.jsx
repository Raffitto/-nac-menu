import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Shown when coaching insights reference branch activity but tables show zero (scope drift).
 */
export default function ReviewNetworkIntegrityBanner({ integrity = null, className = "" }) {
  if (!integrity?.warnings?.length) return null;

  return (
    <div className={`nac-review-integrity ${className}`.trim()} role="alert">
      <AlertTriangle size={14} aria-hidden />
      <div>
        <strong>Review data scope warning</strong>
        <ul>
          {integrity.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

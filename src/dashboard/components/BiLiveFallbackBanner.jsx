import React from "react";

/**
 * Subtle internal notice when primary RPC was empty but menu_events fallback supplied data.
 */
export default function BiLiveFallbackBanner({ visible }) {
  if (!visible) return null;

  return (
    <p className="nac-bi-live-fallback" role="status">
      Live fallback active
    </p>
  );
}

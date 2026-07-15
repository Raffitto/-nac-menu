import React, { memo } from "react";

function MenuManagerTooltip({ label, children, className = "" }) {
  if (!label) return children;

  return (
    <span className={`mm-tooltip-wrap ${className}`.trim()}>
      {children}
      <span className="mm-tooltip-bubble" role="tooltip">
        {label}
      </span>
    </span>
  );
}

export default memo(MenuManagerTooltip);

import React from "react";
import "../styles/admin-dashboard.css";
import "../styles/platform-os.css";

/**
 * Immediate Tier-0 chrome while auth/session or route chunk resolves.
 * Avoids a blank/frozen first paint on nac-os cold boot.
 */
export default function AdminBootShell({ message = "Opening NAC Hospitality OS…" }) {
  return (
    <div className="admin-shell" data-testid="admin-boot-shell">
      <div className="admin-bg-glow" />
      <aside className="admin-sidebar" aria-label="Primary navigation" aria-busy="true">
        <div>
          <div className="sidebar-header-row">
            <p className="sidebar-logo">NAC HOSPITALITY OS</p>
          </div>
          <div className="sidebar-menu">
            {["Overview", "Intelligence", "Reviews", "Menu", "Branches", "Settings"].map((label) => (
              <div key={label} className="sidebar-item" style={{ opacity: 0.45, pointerEvents: "none" }}>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <main className="admin-content">
        <header className="nac-platform-header">
          <p className="nac-platform-kicker">NAC Hospitality OS</p>
          <h1>Overview</h1>
          <p className="nac-platform-sub">{message}</p>
        </header>
        <section className="stats-grid" style={{ marginTop: 28 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="nac-bi-skeleton" style={{ height: 140 }} />
          ))}
        </section>
      </main>
    </div>
  );
}

import React from "react";
import AskNacDataVaultPanel from "../AskNacDataVaultPanel";
import "../../styles/ask-nac-data-vault.css";

export default function IntelligenceVaultTab({ session }) {
  return (
    <div className="nac-intelligence-mobile-vault">
      <header className="nac-intelligence-mobile-section-header">
        <p className="nac-intelligence-mobile-kicker">Company Knowledge</p>
        <h2>Knowledge Base</h2>
        <p className="nac-intelligence-mobile-sub">
          Upload operational reports, connect Google Drive, and review what Ask NAC knows about your branches.
        </p>
      </header>
      <AskNacDataVaultPanel session={session} />
    </div>
  );
}

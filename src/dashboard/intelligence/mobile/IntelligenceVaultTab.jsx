import React from "react";
import AskNacDataVaultPanel from "../AskNacDataVaultPanel";
import "../../styles/ask-nac-data-vault.css";

export default function IntelligenceVaultTab({ session }) {
  return (
    <div className="nac-intelligence-mobile-vault">
      <header className="nac-intelligence-mobile-section-header">
        <p className="nac-intelligence-mobile-kicker">Data Vault</p>
        <h2>Vault</h2>
        <p className="nac-intelligence-mobile-sub">
          Upload operational reports and browse registry history. Permissions apply per role and department.
        </p>
      </header>
      <AskNacDataVaultPanel session={session} />
    </div>
  );
}

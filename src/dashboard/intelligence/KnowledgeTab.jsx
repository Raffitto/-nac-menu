import React from "react";
import AskNacDataVaultPanel from "./AskNacDataVaultPanel";
import { useRbacOptional } from "../context/RbacContext";
import "../styles/ask-nac-data-vault.css";

/**
 * Intelligence → Knowledge subview.
 * Company Knowledge lives here — not under the Ask NAC conversation.
 */
export default function KnowledgeTab() {
  const rbac = useRbacOptional();
  const session = rbac?.session;

  return (
    <div className="nac-intelligence-panel nac-knowledge-tab" data-testid="intelligence-knowledge-tab">
      <header className="nac-intel-section-intro">
        <h2 className="nac-intel-section-intro__title">Company Knowledge</h2>
        <p>
          Upload reports, connect Google Drive, and manage the operational knowledge that powers Ask NAC
          answers.
        </p>
      </header>
      <AskNacDataVaultPanel session={session} />
    </div>
  );
}

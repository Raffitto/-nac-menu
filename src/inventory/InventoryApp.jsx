import React, { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import NacAnalyticsSignIn from "../dashboard/components/NacAnalyticsSignIn";
import { usePlatformSession } from "../dashboard/hooks/usePlatformSession";
import { supabase } from "../lib/supabase";
import InvoiceIntakeView from "./InvoiceIntakeView";
import IngredientMasterView from "./IngredientMasterView";
import {
  INVENTORY_BRANCHES,
  INVENTORY_TABS,
  inventoryBranchFromLocation,
  inventoryTabFromLocation,
  syncInventoryLocation,
} from "./inventoryShared";
import "./invoice-intake.css";

export default function InventoryApp() {
  const { session, checked, issue } = usePlatformSession();
  const [branchId, setBranchId] = useState(inventoryBranchFromLocation);
  const [activeTab, setActiveTab] = useState(inventoryTabFromLocation);

  useEffect(() => {
    syncInventoryLocation({ branchId, activeTab });
  }, [branchId, activeTab]);

  if (!checked || !session) {
    return (
      <NacAnalyticsSignIn
        checking={!checked}
        kicker="NAC Inventory"
        title={activeTab === "ingredients" ? "Ingredient master" : "Invoice intake"}
        subtitle="Authorized purchasing, inventory, and operations team members"
        sessionIssue={issue}
      />
    );
  }

  return (
    <main className="inv-page">
      <header className="inv-header">
        <div>
          <p className="inv-kicker">NAC Hospitality OS</p>
          <h1>Inventory</h1>
          <p>Review supplier invoices and manage the canonical ingredient list for this branch.</p>
          <nav className="inv-tabs" aria-label="Inventory sections">
            {INVENTORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`inv-tab${activeTab === tab.id ? " inv-tab--active" : ""}`}
                aria-current={activeTab === tab.id ? "page" : undefined}
                data-testid={`inventory-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="inv-header-actions">
          <label>
            <span>Branch</span>
            <select
              value={branchId}
              aria-label="Inventory branch"
              onChange={(event) => setBranchId(event.target.value)}
            >
              {INVENTORY_BRANCHES.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.label}</option>
              ))}
            </select>
          </label>
          <button className="inv-button inv-button--ghost" type="button" onClick={() => supabase?.auth.signOut()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </header>

      {activeTab === "invoices" ? (
        <InvoiceIntakeView embedded branchId={branchId} setBranchId={setBranchId} />
      ) : (
        <IngredientMasterView branchId={branchId} />
      )}
    </main>
  );
}

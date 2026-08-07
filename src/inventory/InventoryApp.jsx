import React, { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import NacAnalyticsSignIn from "../dashboard/components/NacAnalyticsSignIn";
import { usePlatformSession } from "../dashboard/hooks/usePlatformSession";
import { supabase } from "../lib/supabase";
import InvoiceIntakeView from "./InvoiceIntakeView";
import IngredientMasterView from "./IngredientMasterView";
import FoodBibleView from "./FoodBibleView";
import OperationalControlView from "./OperationalControlView";
import ProcurementControlView from "./ProcurementControlView";
import TransferCountControlView from "./TransferCountControlView";
import InventoryCommandCenter from "./InventoryCommandCenter";
import { fetchInventoryStaffAccess } from "../lib/inventoryApi";
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
  const [access, setAccess] = useState(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    fetchInventoryStaffAccess()
      .then((value) => {
        if (!active) return;
        setAccess(value);
        const globalRole = ["ceo", "super_admin", "ops_manager"].includes(value?.vaultRole);
        if (!globalRole && value?.branchIds?.length) {
          setBranchId((current) => value.branchIds.includes(current) ? current : value.branchIds[0]);
        }
      })
      .catch(() => {
        if (active) setAccess(null);
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    syncInventoryLocation({ branchId, activeTab });
  }, [branchId, activeTab]);

  if (!checked || !session) {
    return (
      <NacAnalyticsSignIn
        checking={!checked}
        kicker="NAC Inventory"
        title={
          activeTab === "ingredients"
            ? "Ingredient master"
            : activeTab === "food-bible"
              ? "Food Bible"
              : ["purchase-orders", "purchases", "returns"].includes(activeTab)
                ? INVENTORY_TABS.find(({ id }) => id === activeTab)?.label
              : activeTab === "operations"
                ? "Operations & Waste"
              : "Invoice intake"
        }
        subtitle="Authorized purchasing, inventory, and operations team members"
        sessionIssue={issue}
      />
    );
  }

  const globalBranchAccess = ["ceo", "super_admin", "ops_manager"].includes(access?.vaultRole);
  const availableBranches = globalBranchAccess || !access?.branchIds?.length
    ? INVENTORY_BRANCHES
    : INVENTORY_BRANCHES.filter(({ id }) => access.branchIds.includes(id));

  return (
    <main className="inv-page">
      <header className="inv-header">
        <div>
          <p className="inv-kicker">NAC Hospitality OS</p>
          <h1>Inventory</h1>
          <p>Review supplier invoices, manage ingredients, and document the Food Bible for this branch.</p>
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
              {availableBranches.map((branch) => (
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
      ) : activeTab === "overview" ? (
        <InventoryCommandCenter branchId={branchId} />
      ) : ["purchase-orders", "purchases", "returns"].includes(activeTab) ? (
        <ProcurementControlView branchId={branchId} mode={activeTab} />
      ) : ["transfers", "stock-counts"].includes(activeTab) ? (
        <TransferCountControlView branchId={branchId} mode={activeTab} />
      ) : activeTab === "ingredients" ? (
        <IngredientMasterView branchId={branchId} />
      ) : activeTab === "food-bible" ? (
        <FoodBibleView
          branchId={branchId}
          onOpenIngredients={() => setActiveTab("ingredients")}
        />
      ) : (
        <OperationalControlView branchId={branchId} />
      )}
    </main>
  );
}

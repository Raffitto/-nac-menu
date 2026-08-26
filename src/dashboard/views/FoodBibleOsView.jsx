import React, { useMemo, useState } from "react";
import { usePlatformFilters } from "../context/PlatformFiltersContext";
import { useRbac } from "../context/RbacContext";
import { allowedBranchIds } from "../config/rbac";
import { branchDashboardName } from "../config/branchDisplayConfig";
import { normalizeBranchId } from "../utils/branchIdentity";
import FoodBibleView from "../../inventory/FoodBibleView";
import DrinkBibleView from "../../inventory/DrinkBibleView";
import "../../inventory/invoice-intake.css";
import "../styles/food-bible-os.css";
import "../../inventory/foodBibleEditorUx.css";

function resolveFoodBibleBranch(profile, requested) {
  const allowed = allowedBranchIds(profile);
  const requestedId = normalizeBranchId(requested);
  if (requestedId && allowed.includes(requestedId)) return requestedId;
  return profile?.branchScope || allowed[0] || "khobar";
}

function initialBibleTab() {
  if (typeof window === "undefined") return "food";
  return new URLSearchParams(window.location.search).get("bible") === "drinks" ? "drinks" : "food";
}

export default function FoodBibleOsView() {
  const rbac = useRbac();
  const filters = usePlatformFilters();
  const allowed = allowedBranchIds(rbac.profile);
  const [branchId, setBranchId] = useState(() => resolveFoodBibleBranch(rbac.profile, filters.branch));
  const [bibleTab, setBibleTab] = useState(initialBibleTab);

  const options = useMemo(
    () => (allowed.length ? allowed : ["khobar"]).map((id) => ({
      id,
      label: branchDashboardName(id),
    })),
    [allowed],
  );

  const switchBible = (next) => {
    setBibleTab(next);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (next === "drinks") params.set("bible", "drinks");
      else params.delete("bible");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
  };

  const drinks = bibleTab === "drinks";

  return (
    <section className="nacos-food-bible" data-testid="nacos-food-bible">
      <header className="nacos-food-bible-header">
        <div>
          <p className="nac-platform-kicker">NAC Hospitality OS</p>
          <h1>{drinks ? "Drink Bible" : "Food Bible"}</h1>
          <p className="nac-platform-sub">{drinks ? "NAC drink standards, prep recipes and source-review status. Anything unresolved is visibly flagged in red." : "Canonical recipes for the live menu. Preparation truth lives here; selling truth stays on Menu."}</p>
        </div>
        {!drinks ? (
          <label className="nacos-food-bible-branch">
            <span>Branch</span>
            <select
              aria-label="Food Bible branch"
              data-testid="nacos-food-bible-branch"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {options.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.label}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <div className="nacos-bible-tabs" role="tablist" aria-label="Recipe bibles">
        <button type="button" role="tab" aria-selected={!drinks} onClick={() => switchBible("food")}>Food Bible</button>
        <button type="button" role="tab" aria-selected={drinks} onClick={() => switchBible("drinks")}>Drink Bible</button>
      </div>
      {drinks ? (
        <DrinkBibleView />
      ) : (
        <FoodBibleView
          branchId={branchId}
          onOpenIngredients={() => {
            window.location.assign(`/inventory?branch=${encodeURIComponent(branchId)}&view=ingredients`);
          }}
        />
      )}
    </section>
  );
}

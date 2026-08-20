import React, { useMemo, useState } from "react";
import { usePlatformFilters } from "../context/PlatformFiltersContext";
import { useRbac } from "../context/RbacContext";
import { allowedBranchIds } from "../config/rbac";
import { branchDashboardName } from "../config/branchDisplayConfig";
import { normalizeBranchId } from "../utils/branchIdentity";
import FoodBibleView from "../../inventory/FoodBibleView";
import "../../inventory/invoice-intake.css";
import "../styles/food-bible-os.css";

function resolveFoodBibleBranch(profile, requested) {
  const allowed = allowedBranchIds(profile);
  const requestedId = normalizeBranchId(requested);
  if (requestedId && allowed.includes(requestedId)) return requestedId;
  return profile?.branchScope || allowed[0] || "khobar";
}

export default function FoodBibleOsView() {
  const rbac = useRbac();
  const filters = usePlatformFilters();
  const allowed = allowedBranchIds(rbac.profile);
  const [branchId, setBranchId] = useState(() => resolveFoodBibleBranch(rbac.profile, filters.branch));

  const options = useMemo(
    () => (allowed.length ? allowed : ["khobar"]).map((id) => ({
      id,
      label: branchDashboardName(id),
    })),
    [allowed],
  );

  return (
    <section className="nacos-food-bible" data-testid="nacos-food-bible">
      <header className="nacos-food-bible-header">
        <div>
          <p className="nac-platform-kicker">NAC Hospitality OS</p>
          <h1>Food Bible</h1>
          <p className="nac-platform-sub">Canonical recipes for the live menu. Preparation truth lives here; selling truth stays on Menu.</p>
        </div>
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
      </header>
      <FoodBibleView
        branchId={branchId}
        onOpenIngredients={() => {
          window.location.assign(`/inventory?branch=${encodeURIComponent(branchId)}&view=ingredients`);
        }}
      />
    </section>
  );
}

import React, { useCallback, useState } from "react";
import { FileDown } from "lucide-react";
import { usePlatformFiltersOptional } from "../context/PlatformFiltersContext";
import { useMenuBiDashboardContext } from "../context/MenuBiDashboardContext";
import { useRbacOptional } from "../context/RbacContext";
import { BRANCH_OPTIONS } from "../config/foodicsImportTypes";
import ExecutiveExportModal from "./ExecutiveExportModal";
import { useExecutiveUnifiedExport } from "../hooks/useExecutiveUnifiedExport";

/**
 * Single entry point — "Executive Export" button + configuration modal.
 */
export default function ExecutiveExportButton({ className = "" }) {
  const filters = usePlatformFiltersOptional();
  const rbac = useRbacOptional();
  const { data: biData } = useMenuBiDashboardContext();
  const dashboardRange = filters?.selectedRange || "7d";
  const defaultBranch = rbac?.scope?.defaultBranch || filters?.branch || "khobar";
  const branchOptions = rbac?.exportBranchOptions?.length
    ? rbac.exportBranchOptions
    : BRANCH_OPTIONS;
  const [open, setOpen] = useState(false);

  const { busy, catalogItems, catalogLoading, loadUpsellCatalog, generatePdf } =
    useExecutiveUnifiedExport({
      dashboardRange,
      menuSessions: biData?.total_sessions || 0,
    });

  const handleOpen = useCallback(() => {
    setOpen(true);
    loadUpsellCatalog(defaultBranch);
  }, [loadUpsellCatalog, defaultBranch]);

  const handleGenerate = useCallback(
    async (opts) => {
      await generatePdf(opts);
      setOpen(false);
    },
    [generatePdf],
  );

  return (
    <>
      <button
        type="button"
        className={`rev-export-btn rev-export-btn--audit exec-export-trigger ${className}`.trim()}
        onClick={handleOpen}
        disabled={busy}
      >
        <FileDown size={14} />
        Executive Export
      </button>

      <ExecutiveExportModal
        open={open}
        onCancel={() => setOpen(false)}
        onGenerate={handleGenerate}
        busy={busy}
        dashboardRange={dashboardRange}
        catalogItems={catalogItems}
        catalogLoading={catalogLoading}
        defaultBranch={defaultBranch}
        onBranchChange={loadUpsellCatalog}
        branchOptions={branchOptions}
      />
    </>
  );
}

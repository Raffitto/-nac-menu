import { exportVisualPdfByMode } from "./visualPdfByMode";

/**
 * Route Visual OS PDF export to mode-specific layouts (not one shared template).
 */
export function exportExecutiveVisualPDF(payload) {
  exportVisualPdfByMode(payload);
}

/** Bridge from legacy export name */
export function exportVisualIntelligencePDF(payload) {
  exportExecutiveVisualPDF(payload);
}

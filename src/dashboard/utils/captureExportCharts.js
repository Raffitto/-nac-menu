/**
 * Capture chart nodes from off-screen export render root.
 * @returns {Promise<Record<string, string>>} map of chartId → PNG data URL
 */
export async function captureVisualCharts(rootEl) {
  if (!rootEl) return {};
  const { default: html2canvas } = await import("html2canvas");
  const nodes = rootEl.querySelectorAll("[data-export-chart]");
  const out = {};

  await Promise.all(
    Array.from(nodes).map(async (node) => {
      const id = node.getAttribute("data-export-chart");
      if (!id) return;
      try {
        const canvas = await html2canvas(node, {
          backgroundColor: "#0c0c0e",
          scale: 2,
          logging: false,
          useCORS: true,
        });
        out[id] = canvas.toDataURL("image/png");
      } catch {
        /* skip failed chart */
      }
    }),
  );

  return out;
}

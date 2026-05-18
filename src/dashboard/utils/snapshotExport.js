/** PNG export for WhatsApp-friendly share cards (1080×1350). */

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

export async function exportElementToPng(element, filename = "nac-snapshot.png") {
  if (!element) return;
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, {
    backgroundColor: "#0a0908",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export { CARD_WIDTH, CARD_HEIGHT };

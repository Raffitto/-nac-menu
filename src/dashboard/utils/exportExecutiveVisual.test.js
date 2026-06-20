import {
  EXPORT_PRIMARY,
  TABLE_ROW_A,
  TABLE_ROW_B,
  TABLE_TEXT_DARK,
  resolveExportTableTextColor,
} from "./exportExecutiveVisual";
import {
  applyExportTableTextContrast,
  buildExportTableStyles,
} from "../engines/pdfVisualTheme";

describe("exportExecutiveVisual table contrast", () => {
  test("resolveExportTableTextColor uses dark text on light fills", () => {
    expect(resolveExportTableTextColor([255, 255, 255])).toEqual(TABLE_TEXT_DARK);
    expect(resolveExportTableTextColor([245, 241, 232])).toEqual(TABLE_TEXT_DARK);
  });

  test("resolveExportTableTextColor uses light text on dark fills", () => {
    expect(resolveExportTableTextColor(TABLE_ROW_A)).toEqual(EXPORT_PRIMARY);
    expect(resolveExportTableTextColor(TABLE_ROW_B)).toEqual(EXPORT_PRIMARY);
    expect(resolveExportTableTextColor([36, 40, 48])).toEqual(EXPORT_PRIMARY);
  });

  test("buildExportTableStyles sets dark body row background by default", () => {
    const styles = buildExportTableStyles();
    expect(styles.styles.fillColor).toEqual(TABLE_ROW_A);
    expect(styles.alternateRowStyles.fillColor).toEqual(TABLE_ROW_B);
  });

  test("applyExportTableTextContrast adjusts body text for light stripe rows", () => {
    const cell = { styles: { fillColor: [255, 255, 255], textColor: EXPORT_PRIMARY } };
    applyExportTableTextContrast({ section: "body", cell });
    expect(cell.styles.textColor).toEqual(TABLE_TEXT_DARK);
  });
});

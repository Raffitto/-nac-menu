import { resolveMappingTarget } from "./mappingTargetResolution";
import checkpoint from "../../scripts/reconciliation/checkpoint.json";

test("all351 recorded links resolve in the correct domain, including ten valid add-on targets", () => {
  const before = JSON.stringify(checkpoint);
  const results = checkpoint.historicalLinks.map((r) => resolveMappingTarget(r.matched_menu_item_id, checkpoint));
  expect(results.filter((r) => r.status === "resolved_menu_item")).toHaveLength(341);
  expect(results.filter((r) => r.status === "resolved_addon")).toHaveLength(10);
  expect(JSON.stringify(checkpoint)).toBe(before);
});

test("missing, ambiguous, inactive and explicit target types are distinguished", () => {
  const data = { menuItems: [{ id: "same", active: false }], addons: [{ id: "same" }] };
  expect(resolveMappingTarget("same", data).status).toBe("ambiguous_target");
  expect(resolveMappingTarget("same", { ...data, targetKind: "menu_item" }).status).toBe("resolved_menu_item");
  expect(resolveMappingTarget("same", { ...data, targetKind: "addon" }).status).toBe("resolved_addon");
  expect(resolveMappingTarget("missing", data).status).toBe("unresolved");
  expect(resolveMappingTarget(null, data).reason).toBe("missing_target_id");
  expect(resolveMappingTarget("same", { ...data, targetKind: "recipe" }).reason).toBe("unsupported_target_kind");
});

test("same-domain duplicate IDs are ambiguous and labels never substitute for IDs", () => {
  expect(resolveMappingTarget("x", { menuItems: [{ id: "x" }, { id: "x" }] }).status).toBe("ambiguous_target");
  expect(resolveMappingTarget("x", { menuItems: [{ id: "y", name_en: "x" }] }).status).toBe("unresolved");
});

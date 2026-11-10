import React, { useMemo } from "react";
import baseline from "../catalogue/guest-menu-baseline-khobar.json";
import { buildOrderingCatalogue } from "./catalogueAdapter";
import ServiceShell from "./service/ServiceShell";

export function orderingMenuForBranch(branchId) {
  const catalogue = buildOrderingCatalogue(baseline, { branchId });
  return (catalogue.lines || []).filter((line) => line.available !== false).map((line) => ({
    id: line.itemId,
    name: line.name,
    price: line.price,
    modifiers: line.modifiers,
    available: line.available,
  }));
}

export default function RestaurantSim({ databaseMode = false }) {
  const menu = useMemo(() => orderingMenuForBranch("khobar"), []);
  return <ServiceShell databaseMode={databaseMode} menu={menu} menuForBranch={orderingMenuForBranch} />;
}

/** Visual OS export targeting — sections, sorts, and target modes */

export const EXPORT_SECTIONS = {
  executive: { id: "executive", label: "Executive summary" },
  product: { id: "product", label: "Product performance" },
  waiter: { id: "waiter", label: "Waiter performance" },
  modifier: { id: "modifier", label: "Modifier / add-on intelligence" },
  attachment: { id: "attachment", label: "Attachment rates" },
  missed: { id: "missed", label: "Missed upsells" },
  menuEng: { id: "menuEng", label: "Menu engineering quadrant" },
  heat: { id: "heat", label: "Heat score" },
  ai: { id: "ai", label: "AI operational insights" },
  waiterTargets: { id: "waiterTargets", label: "Per-waiter target cards" },
};

export const WAITER_SORT_OPTIONS = [
  { id: "net_sales", label: "Net sales" },
  { id: "quantity", label: "Quantity sold" },
  { id: "modifierAttachPct", label: "Modifier attachment %" },
  { id: "dessert_qty", label: "Dessert sales" },
  { id: "beverage_qty", label: "Beverage sales" },
  { id: "modifier_qty", label: "Upsell / modifier units" },
];

export const PRODUCT_SORT_OPTIONS = [
  { id: "revenue", label: "Revenue" },
  { id: "quantity", label: "Quantity" },
  { id: "conversion", label: "Conversion" },
  { id: "heatIndex", label: "Heat score" },
  { id: "highInterest", label: "High interest · low sales" },
];

export const EXPORT_TARGET_MODES = {
  weekly_staff: {
    id: "weekly_staff",
    label: "Weekly staff target report",
    description: "Targets, weaknesses, and push recommendations per waiter",
    sections: {
      executive: true,
      waiter: true,
      modifier: true,
      attachment: true,
      missed: false,
      product: false,
      menuEng: false,
      heat: false,
      ai: true,
      waiterTargets: true,
    },
    waiterSort: "modifierAttachPct",
    productSort: "revenue",
    allWaiters: false,
  },
  manager_review: {
    id: "manager_review",
    label: "Manager review report",
    description: "Balanced ops view — staff + product + gaps",
    sections: {
      executive: true,
      waiter: true,
      product: true,
      modifier: true,
      attachment: true,
      missed: true,
      menuEng: true,
      heat: true,
      ai: true,
      waiterTargets: true,
    },
    waiterSort: "net_sales",
    productSort: "revenue",
    allWaiters: true,
  },
  executive_boardroom: {
    id: "executive_boardroom",
    label: "Executive boardroom report",
    description: "KPIs, insights, top performers, opportunities",
    sections: {
      executive: true,
      waiter: true,
      product: true,
      modifier: true,
      attachment: true,
      missed: true,
      menuEng: true,
      heat: true,
      ai: true,
      waiterTargets: false,
    },
    waiterSort: "net_sales",
    productSort: "heatIndex",
    allWaiters: true,
  },
  menu_engineering: {
    id: "menu_engineering",
    label: "Menu engineering report",
    description: "Quadrants, heat, attachment, product ranking",
    sections: {
      executive: true,
      waiter: false,
      product: true,
      modifier: true,
      attachment: true,
      missed: true,
      menuEng: true,
      heat: true,
      ai: true,
      waiterTargets: false,
    },
    waiterSort: "net_sales",
    productSort: "conversion",
    allWaiters: true,
  },
};

export function defaultExportConfig(waiterNames = []) {
  const mode = EXPORT_TARGET_MODES.manager_review;
  return {
    dateFrom: weekAgoISO(),
    dateTo: todayISO(),
    branch: "khobar",
    targetMode: mode.id,
    sections: { ...mode.sections },
    waiterSort: mode.waiterSort,
    productSort: mode.productSort,
    allWaiters: mode.allWaiters,
    selectedWaiters: waiterNames,
    waiterSearch: "",
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function applyTargetMode(config, modeId) {
  const mode = EXPORT_TARGET_MODES[modeId];
  if (!mode) return config;
  return {
    ...config,
    targetMode: modeId,
    sections: { ...mode.sections },
    waiterSort: mode.waiterSort,
    productSort: mode.productSort,
    allWaiters: mode.allWaiters,
  };
}

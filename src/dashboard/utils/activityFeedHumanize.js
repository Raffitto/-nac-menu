/**
 * Guest-readable labels for operational activity feed (never raw event_type).
 */

import { CATEGORY_NAMES } from "./formatters";

const EVENT_LABELS = {
  qr_session_start: () => "Guest started a menu session",
  category_open: (row) => {
    const cat = CATEGORY_NAMES[row.category_id] || row.category_id;
    return cat ? `Guest opened ${cat}` : "Guest opened a menu category";
  },
  menu_tab_open: (row) => {
    const cat = CATEGORY_NAMES[row.category_id] || row.category_id;
    return cat ? `Guest opened ${cat} menu` : "Guest switched menu tab";
  },
  item_open: (row) => {
    const name = row.item_name_en || row.item_name;
    return name ? `Guest viewed ${name}` : "Guest viewed a menu item";
  },
  item_impression: (row) => {
    const name = row.item_name_en || row.item_name;
    return name ? `Guest scrolled past ${name}` : "Guest saw a menu item";
  },
  add_on_click: (row) => {
    const item = row.item_name_en || "item";
    const addon = row.add_on_name;
    return addon ? `Guest explored add-on on ${item}` : `Guest tapped add-ons on ${item}`;
  },
  search_used: (row) =>
    row.search_query ? `Guest searched “${row.search_query}”` : "Guest used menu search",
  search_submit: (row) =>
    row.search_query ? `Guest searched “${row.search_query}”` : "Guest submitted a search",
  time_spent: () => "Guest session ended",
  menu_exit: () => "Guest left the menu",
  review_click: () => "Guest opened review options",
};

export function humanizeActivityFeedRow(row = {}) {
  const type = row.event_type || "";
  const fn = EVENT_LABELS[type];
  if (fn) return fn(row);
  if (row.item_name_en) return `Guest interacted with ${row.item_name_en}`;
  if (row.category_id) {
    const cat = CATEGORY_NAMES[row.category_id] || row.category_id;
    return `Guest activity on ${cat}`;
  }
  return "Guest menu activity";
}

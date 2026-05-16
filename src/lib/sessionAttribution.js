import { supabase } from "./supabase";

const LINK_KEY = "nac_session_link_logged";
const ATTRIBUTION_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const MENU_ACTIVITY_KEY = "nac_menu_last_active";

/** Call from menu app when guest interacts (lightweight heartbeat). */
export function markMenuActivity() {
  try {
    localStorage.setItem(MENU_ACTIVITY_KEY, String(Date.now()));
  } catch {}
}

function recentMenuActivity() {
  try {
    const t = Number(localStorage.getItem(MENU_ACTIVITY_KEY) || 0);
    return t > 0 && Date.now() - t <= ATTRIBUTION_WINDOW_MS;
  } catch {
    return false;
  }
}

function attributionConfidence({ employee_name, recentMenu }) {
  if (employee_name && recentMenu) return "high";
  if (employee_name || recentMenu) return "medium";
  return "low";
}

/**
 * Link menu session ↔ review session once per review session (privacy-safe, device-local).
 */
export async function tryLinkMenuReviewSession({
  branch_id,
  menu_session_id,
  review_session_id,
  employee_name,
  employee_role,
}) {
  if (!supabase || !menu_session_id || !review_session_id) return;

  try {
    const dedupeKey = `${LINK_KEY}_${review_session_id}`;
    if (sessionStorage.getItem(dedupeKey)) return;

    const recentMenu = recentMenuActivity();
    if (!recentMenu && !employee_name) return;

    const row = {
      branch_id: (branch_id || "khobar").toLowerCase(),
      menu_session_id,
      review_session_id,
      employee_name: employee_name || null,
      employee_role: employee_role || null,
      attribution_confidence: attributionConfidence({ employee_name, recentMenu }),
      metadata: {
        window_hours: ATTRIBUTION_WINDOW_MS / 3600000,
        menu_recent: recentMenu,
      },
    };

    const { error } = await supabase.from("review_session_links").insert(row);
    if (!error) sessionStorage.setItem(dedupeKey, "1");
  } catch {
    /* non-blocking */
  }
}

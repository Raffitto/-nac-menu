import { useState, useEffect, useRef } from "react";
import { isSupabaseConfigured } from "./supabase";

const CACHE_KEY = "nac_menu_cache";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedMenu() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCachedMenu(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Hook that provides menu data from Supabase with hardcoded fallback.
 * Returns { categories, menuData, addOns, allergenLabels, loading, fromSupabase }
 * 
 * @param {object} fallback - { categories, menuData, addOns, allergenLabels } from hardcoded data
 */
export function useMenuData(fallback) {
  const [menuState, setMenuState] = useState(() => {
    const cached = getCachedMenu();
    if (cached) {
      return { ...cached, loading: false, fromSupabase: true };
    }
    return { ...fallback, loading: isSupabaseConfigured(), fromSupabase: false };
  });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !isSupabaseConfigured()) return;
    fetchedRef.current = true;

    let cancelled = false;

    async function fetchMenu() {
      try {
        const { getFullMenu } = await import("./menuApi");
        const result = await getFullMenu();

        if (cancelled) return;
        if (result && result.categories && result.categories.length > 0) {
          const data = {
            categories: result.categories,
            menuData: result.menuData,
            addOns: result.addOns,
            allergenLabels: result.allergenLabels,
          };
          setCachedMenu(data);
          setMenuState({ ...data, loading: false, fromSupabase: true });
        } else {
          setMenuState({ ...fallback, loading: false, fromSupabase: false });
        }
      } catch {
        if (!cancelled) {
          setMenuState({ ...fallback, loading: false, fromSupabase: false });
        }
      }
    }

    fetchMenu();
    return () => { cancelled = true; };
  }, [fallback]);

  return menuState;
}

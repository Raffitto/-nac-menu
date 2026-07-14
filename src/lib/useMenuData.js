import { useState, useEffect, useRef, useCallback } from "react";
import { isSupabaseConfigured, supabase } from "./supabase";
import { invalidateMenuCache, MENU_CACHE_KEY } from "./menuApi";
import { resolvePublicBranchFromLocation } from "../dashboard/config/branchDisplayConfig";
import { filterPublicMenuData, nextVisibilityExpiryMs } from "./menuVisibility";

function setCachedMenu(data) {
  try {
    localStorage.setItem(
      MENU_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
    );
    localStorage.removeItem("nac_menu_cache");
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Guest menu data from Supabase. Hardcoded fallback is used ONLY when Supabase is not configured.
 */
export function useMenuData(fallback) {
  const supabaseReady = isSupabaseConfigured();
  const [menuState, setMenuState] = useState(() => {
    if (!supabaseReady) {
      return { ...fallback, loading: false, fromSupabase: false, menuError: null };
    }
    return {
      categories: [],
      menuData: {},
      addOns: fallback.addOns || {},
      allergenLabels: fallback.allergenLabels || {},
      loading: true,
      fromSupabase: false,
      menuError: null,
    };
  });
  const fetchGenRef = useRef(0);

  const loadFromSupabase = useCallback(async () => {
    if (!supabaseReady) return false;
    const gen = ++fetchGenRef.current;
    invalidateMenuCache();
    try {
      const branchId = resolvePublicBranchFromLocation();
      const { getFullMenu } = await import("./menuApi");
      const { data, error } = await getFullMenu({ bypassCache: true, branchId });
      if (gen !== fetchGenRef.current) return false;
      if (error) throw error;
      if (data?.categories?.length > 0) {
        const payload = {
          categories: data.categories,
          menuData: filterPublicMenuData(data.menuData),
          addOns: data.addOns,
          allergenLabels: data.allergenLabels,
        };
        setCachedMenu(payload);
        setMenuState({
          ...payload,
          loading: false,
          fromSupabase: true,
          menuError: null,
        });
        return true;
      }
      setMenuState((prev) => ({
        ...prev,
        loading: false,
        fromSupabase: false,
        menuError: "Menu returned empty from Supabase",
      }));
      return false;
    } catch (err) {
      if (gen === fetchGenRef.current) {
        setMenuState((prev) => ({
          ...prev,
          loading: false,
          fromSupabase: false,
          menuError: err?.message || "Failed to load menu",
        }));
      }
      return false;
    }
  }, [supabaseReady]);

  useEffect(() => {
    if (!supabaseReady) return undefined;
    loadFromSupabase();

    const channel = supabase
      ?.channel("nac-public-menu")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items" },
        () => loadFromSupabase(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sections" },
        () => loadFromSupabase(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "categories" },
        () => loadFromSupabase(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "add_ons" },
        () => loadFromSupabase(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_addons" },
        () => loadFromSupabase(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_allergens" },
        () => loadFromSupabase(),
      )
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") loadFromSupabase();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      fetchGenRef.current += 1;
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadFromSupabase, supabaseReady]);

  useEffect(() => {
    const expiry = nextVisibilityExpiryMs(menuState.menuData);
    if (!expiry || !menuState.fromSupabase) return undefined;
    const delay = Math.max(1000, expiry - Date.now() + 500);
    const t = setTimeout(() => loadFromSupabase(), delay);
    return () => clearTimeout(t);
  }, [menuState.menuData, menuState.fromSupabase, loadFromSupabase]);

  if (!supabaseReady) {
    return { ...fallback, loading: false, fromSupabase: false, menuError: null };
  }

  if (!menuState.fromSupabase && !menuState.loading && menuState.menuError) {
    return {
      categories: [],
      menuData: {},
      addOns: menuState.addOns || {},
      allergenLabels: menuState.allergenLabels || {},
      loading: false,
      fromSupabase: false,
      menuError: menuState.menuError,
    };
  }

  return menuState;
}

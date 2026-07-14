import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { usePlatformFiltersOptional } from "./PlatformFiltersContext";
import { normalizeBranchId } from "../utils/branchIdentity";
import {
  buildRbacScope,
  buildBranchFilterOptions,
  buildExportBranchOptions,
  canAccessAllBranches,
  canAccessNetworkReviews,
  canAccessIntelligenceTab,
  canAccessNav,
  canAccessReviewsTab,
  hasPermission,
  resolveRbacProfile,
} from "../config/rbac";

const RbacContext = createContext(null);

export function RbacProvider({ children, session: sessionProp = undefined }) {
  const [sessionState, setSessionState] = React.useState(null);

  useEffect(() => {
    if (sessionProp !== undefined) return undefined;
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSessionState(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessionState(s));
    return () => sub.subscription.unsubscribe();
  }, [sessionProp]);

  const session = sessionProp !== undefined ? sessionProp : sessionState;
  const profile = useMemo(() => resolveRbacProfile(session), [session]);
  const scope = useMemo(() => buildRbacScope(profile), [profile]);

  const value = useMemo(
    () => ({
      session,
      profile,
      scope,
      branchFilterOptions: buildBranchFilterOptions(profile),
      exportBranchOptions: buildExportBranchOptions(profile),
      canAccessNav: (navId) => canAccessNav(profile, navId),
      canAccessIntelligenceTab: (tabId) => canAccessIntelligenceTab(profile, tabId),
      canAccessReviewsTab: (tabId) => canAccessReviewsTab(profile, tabId),
      hasPermission: (perm) => hasPermission(profile, perm),
      canAccessAllBranches: () => canAccessAllBranches(profile),
      effectiveBranch: (requested) => scope.effectiveBranch(requested),
      filterRows: (rows, branchKey) => scope.filterRows(rows, branchKey),
    }),
    [session, profile, scope],
  );

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

export function useRbac() {
  const ctx = useContext(RbacContext);
  if (!ctx) {
    throw new Error("useRbac must be used within RbacProvider");
  }
  return ctx;
}

export function useRbacOptional() {
  return useContext(RbacContext);
}

/** Clamp platform branch filter to RBAC scope when user is branch-restricted. */
export function RbacBranchConstraint({ activeView = null }) {
  const rbac = useRbacOptional();
  const filters = usePlatformFiltersOptional();
  const previousViewRef = useRef(activeView);

  useEffect(() => {
    if (!rbac?.profile?.authenticated || rbac.canAccessAllBranches()) return;
    const enteredReviews =
      activeView === "reviews" && previousViewRef.current !== "reviews";
    previousViewRef.current = activeView;
    if (activeView === "reviews" && canAccessNetworkReviews(rbac.profile)) {
      if (enteredReviews) filters?.setBranch?.(null);
      return;
    }
    const scopeBranch = rbac.profile.branchScope;
    if (!scopeBranch) return;
    const current = normalizeBranchId(filters?.branch);
    if (current !== scopeBranch) {
      filters?.setBranch?.(scopeBranch);
    }
  }, [rbac, filters, activeView]);

  return null;
}

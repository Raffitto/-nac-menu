import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SettingsView from "./SettingsView";
import { RBAC_ROLES, PERMISSIONS } from "../config/rbac";
import { SIDEBAR_KEYS, writeSidebarCollapsed } from "../../lib/sidebarPrefs";

jest.mock("../../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), signOut: jest.fn() } },
  isSupabaseConfigured: () => true,
}));

jest.mock("../../lib/platformAuth", () => ({
  signOutPlatform: jest.fn(() => Promise.resolve()),
  mapAuthError: (m) => m || "error",
}));

jest.mock("../utils/intelligenceCache", () => ({
  clearSessionIntelligenceCaches: jest.fn(),
}));

const raffiSession = {
  user: { email: "raffi@nac.com" },
};

const raffiRbac = {
  session: raffiSession,
  profile: {
    authenticated: true,
    email: "raffi@nac.com",
    name: "Raffi",
    role: RBAC_ROLES.DEVELOPER,
    permissions: Object.values(PERMISSIONS),
    branchScope: null,
    allBranches: true,
    userId: "raffi",
  },
  branchFilterOptions: [
    { value: "all", label: "All branches" },
    { value: "khobar", label: "Khobar" },
    { value: "riyadh", label: "Riyadh" },
    { value: "jeddah", label: "Jeddah" },
  ],
  canAccessNav: () => true,
  hasPermission: () => true,
};

const fadySession = {
  user: { email: "fady@nac.com" },
};

const fadyRbac = {
  session: fadySession,
  profile: {
    authenticated: true,
    email: "fady@nac.com",
    name: "Fady",
    role: RBAC_ROLES.BRANCH_GM,
    permissions: [PERMISSIONS.VIEW_OVERVIEW, PERMISSIONS.VIEW_SETTINGS, PERMISSIONS.VIEW_MENU],
    branchScope: "khobar",
    allBranches: false,
    userId: "fady",
  },
  branchFilterOptions: [{ value: "khobar", label: "Khobar" }],
  canAccessNav: (id) => ["overview", "settings", "menu"].includes(id),
  hasPermission: (p) => fadyRbac.profile.permissions.includes(p),
};

jest.mock("../context/RbacContext", () => ({
  useRbacOptional: jest.fn(),
}));

const { useRbacOptional } = require("../context/RbacContext");

describe("SettingsView", () => {
  beforeEach(() => {
    useRbacOptional.mockReset();
    writeSidebarCollapsed(SIDEBAR_KEYS.global, false);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, false);
  });

  test("authenticated super-admin sees account, access, workspace, security — not Sign In CTA", () => {
    useRbacOptional.mockReturnValue(raffiRbac);
    render(<SettingsView session={raffiSession} />);

    expect(screen.getByTestId("settings-account")).toBeInTheDocument();
    expect(screen.getByText("Raffi")).toBeInTheDocument();
    expect(screen.getByText("raffi@nac.com")).toBeInTheDocument();
    expect(screen.getAllByText("Super Admin").length).toBeGreaterThan(0);
    expect(screen.getByTestId("settings-access")).toBeInTheDocument();
    expect(screen.getByText("Network-wide")).toBeInTheDocument();
    expect(screen.getAllByText("Khobar").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Riyadh").length).toBeGreaterThan(0);
    expect(screen.getByTestId("settings-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("settings-system")).toBeInTheDocument();
    expect(screen.getByTestId("settings-security")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-sign-in")).not.toBeInTheDocument();
  });

  test("branch manager sees Khobar scope only and no system panel", () => {
    useRbacOptional.mockReturnValue(fadyRbac);
    render(<SettingsView session={fadySession} />);

    expect(screen.getByText("Fady")).toBeInTheDocument();
    expect(screen.getAllByText("Branch Manager").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Khobar").length).toBeGreaterThan(0);
    expect(screen.queryByText("Riyadh")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-system")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-sign-in")).not.toBeInTheDocument();
  });

  test("unauthenticated user sees sign-in section only", () => {
    useRbacOptional.mockReturnValue({
      session: null,
      profile: { authenticated: false, role: RBAC_ROLES.RESTRICTED, permissions: [] },
      canAccessNav: () => false,
      hasPermission: () => false,
      branchFilterOptions: [],
    });
    render(<SettingsView session={null} />);
    expect(screen.getByTestId("settings-sign-in")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-account")).not.toBeInTheDocument();
  });

  test("reset sidebar layout expands both sidebars", () => {
    useRbacOptional.mockReturnValue(raffiRbac);
    writeSidebarCollapsed(SIDEBAR_KEYS.global, true);
    writeSidebarCollapsed(SIDEBAR_KEYS.menu, true);
    render(<SettingsView session={raffiSession} />);
    fireEvent.click(screen.getByTestId("settings-reset-sidebars"));
    expect(screen.getByText("Sidebar layout reset to expanded.")).toBeInTheDocument();
    expect(window.localStorage.getItem(SIDEBAR_KEYS.global)).toBe("0");
    expect(window.localStorage.getItem(SIDEBAR_KEYS.menu)).toBe("0");
  });
});

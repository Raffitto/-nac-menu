jest.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

import {
  mapAuthError,
  formatSupabaseSetupMessage,
  validateRbacUsersEnv,
  isBrowserOffline,
  readPersistedAuthSession,
  subscribePlatformSession,
  AUTH_STORAGE_KEY,
} from "./platformAuth";
import { supabase } from "./supabase";

describe("platformAuth", () => {
  test("mapAuthError handles invalid credentials", () => {
    expect(mapAuthError("Invalid login credentials")).toMatch(/incorrect/i);
  });

  test("mapAuthError handles jwt expiry", () => {
    expect(mapAuthError("JWT expired")).toMatch(/expired/i);
  });

  test("formatSupabaseSetupMessage hides dev paths in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    expect(formatSupabaseSetupMessage()).not.toMatch(/\.env/i);
    process.env.NODE_ENV = prev;
  });

  test("validateRbacUsersEnv accepts missing env", () => {
    const prev = process.env.REACT_APP_RBAC_USERS;
    delete process.env.REACT_APP_RBAC_USERS;
    expect(validateRbacUsersEnv().ok).toBe(true);
    if (prev !== undefined) process.env.REACT_APP_RBAC_USERS = prev;
  });

  test("validateRbacUsersEnv rejects malformed JSON", () => {
    const prev = process.env.REACT_APP_RBAC_USERS;
    process.env.REACT_APP_RBAC_USERS = "{not-json";
    expect(validateRbacUsersEnv().ok).toBe(false);
    if (prev === undefined) delete process.env.REACT_APP_RBAC_USERS;
    else process.env.REACT_APP_RBAC_USERS = prev;
  });

  test("isBrowserOffline reflects navigator", () => {
    expect(typeof isBrowserOffline()).toBe("boolean");
  });

  test("readPersistedAuthSession returns a stored JWT session", () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: "tok",
        refresh_token: "ref",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "raffi@nac.com" },
      }),
    );
    expect(readPersistedAuthSession(AUTH_STORAGE_KEY)?.user?.email).toBe("raffi@nac.com");
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  });

  test("subscribePlatformSession keeps a persisted session when getSession times out", async () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: "tok",
        refresh_token: "ref",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: "u1", email: "raffi@nac.com" },
      }),
    );
    supabase.auth.getSession.mockImplementation(() => new Promise(() => {}));
    const seen = [];
    const unsub = subscribePlatformSession((state) => seen.push(state));
    expect(seen[0]?.session?.user?.email).toBe("raffi@nac.com");
    expect(seen[0]?.checked).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.every((s) => s.session?.user?.email === "raffi@nac.com")).toBe(true);
    expect(seen.some((s) => s.session == null)).toBe(false);
    unsub();
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  });
});

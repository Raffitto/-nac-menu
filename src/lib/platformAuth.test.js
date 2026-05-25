import {
  mapAuthError,
  formatSupabaseSetupMessage,
  validateRbacUsersEnv,
  isBrowserOffline,
} from "./platformAuth";

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
});

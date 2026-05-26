import {
  getPasswordResetRedirectUrl,
  PRODUCTION_PASSWORD_RESET_URL,
  SUPABASE_AUTH_REDIRECT_ALLOWLIST,
  passwordsMatch,
} from "./passwordRecovery";

describe("password recovery redirects", () => {
  const originalEnv = process.env.REACT_APP_AUTH_RESET_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REACT_APP_AUTH_RESET_URL;
    } else {
      process.env.REACT_APP_AUTH_RESET_URL = originalEnv;
    }
  });

  test("allowlist includes localhost and production Netlify reset paths", () => {
    expect(SUPABASE_AUTH_REDIRECT_ALLOWLIST).toEqual(
      expect.arrayContaining([
        "http://localhost:3000/reset-password",
        PRODUCTION_PASSWORD_RESET_URL,
        "https://nacmenu.netlify.app/reset-password",
        "https://nac-khobar-reviews.netlify.app/reset-password",
      ]),
    );
  });

  test("uses explicit env override when set", () => {
    process.env.REACT_APP_AUTH_RESET_URL = "https://nacmenu.netlify.app/reset-password";
    expect(getPasswordResetRedirectUrl()).toBe("https://nacmenu.netlify.app/reset-password");
  });

  test("production build uses nac-os reset URL when not on localhost", () => {
    delete process.env.REACT_APP_AUTH_RESET_URL;
    const origin = window.location.origin;
    Object.defineProperty(window, "location", {
      value: { ...window.location, origin: "https://nac-os.netlify.app" },
      writable: true,
    });
    expect(getPasswordResetRedirectUrl()).toBe(PRODUCTION_PASSWORD_RESET_URL);
    Object.defineProperty(window, "location", {
      value: { ...window.location, origin },
      writable: true,
    });
  });
});

describe("password recovery validation", () => {
  test("passwordsMatch requires identical non-empty strings", () => {
    expect(passwordsMatch("secret123", "secret123")).toBe(true);
    expect(passwordsMatch("secret123", "secret124")).toBe(false);
    expect(passwordsMatch("", "")).toBe(false);
  });
});

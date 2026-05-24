import {
  PLATFORM_MODES,
  normalizePlatformMode,
  getPlatformMode,
  isAdminPlatformMode,
  isPublicPlatformMode,
  resolveRootAppKind,
} from "./platformMode";
import { detectReviewQrMode } from "./reviewPortalParams";

describe("platform mode normalization", () => {
  test("missing env defaults to public mode", () => {
    expect(normalizePlatformMode(undefined)).toBe(PLATFORM_MODES.PUBLIC);
    expect(normalizePlatformMode("")).toBe(PLATFORM_MODES.PUBLIC);
  });

  test("invalid env defaults to public mode", () => {
    expect(normalizePlatformMode("staging")).toBe(PLATFORM_MODES.PUBLIC);
    expect(normalizePlatformMode("administrator")).toBe(PLATFORM_MODES.PUBLIC);
    expect(normalizePlatformMode(" adminx")).toBe(PLATFORM_MODES.PUBLIC);
  });

  test("admin mode accepts case-insensitive admin", () => {
    expect(normalizePlatformMode("admin")).toBe(PLATFORM_MODES.ADMIN);
    expect(normalizePlatformMode("ADMIN")).toBe(PLATFORM_MODES.ADMIN);
    expect(normalizePlatformMode(" admin ")).toBe(PLATFORM_MODES.ADMIN);
  });

  test("explicit public mode stays public", () => {
    expect(normalizePlatformMode("public")).toBe(PLATFORM_MODES.PUBLIC);
    expect(normalizePlatformMode("PUBLIC")).toBe(PLATFORM_MODES.PUBLIC);
  });
});

describe("platform mode helpers", () => {
  const original = process.env.REACT_APP_PLATFORM_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REACT_APP_PLATFORM_MODE;
    } else {
      process.env.REACT_APP_PLATFORM_MODE = original;
    }
  });

  test("getPlatformMode reflects env at build time", () => {
    delete process.env.REACT_APP_PLATFORM_MODE;
    expect(getPlatformMode()).toBe(PLATFORM_MODES.PUBLIC);
    process.env.REACT_APP_PLATFORM_MODE = "admin";
    expect(getPlatformMode()).toBe(PLATFORM_MODES.ADMIN);
  });

  test("isAdminPlatformMode and isPublicPlatformMode are mutually exclusive", () => {
    process.env.REACT_APP_PLATFORM_MODE = "admin";
    expect(isAdminPlatformMode()).toBe(true);
    expect(isPublicPlatformMode()).toBe(false);
    process.env.REACT_APP_PLATFORM_MODE = "public";
    expect(isAdminPlatformMode()).toBe(false);
    expect(isPublicPlatformMode()).toBe(true);
  });
});

describe("resolveRootAppKind routing", () => {
  test("public mode default is guest menu at root", () => {
    expect(resolveRootAppKind({ pathname: "/", platformMode: "public" })).toBe("public-menu");
    expect(resolveRootAppKind({ pathname: "/", platformMode: undefined })).toBe("public-menu");
  });

  test("admin mode default is NAC OS dashboard at root", () => {
    expect(resolveRootAppKind({ pathname: "/", platformMode: "admin" })).toBe("admin");
  });

  test("/reset-password is unaffected in admin mode", () => {
    expect(resolveRootAppKind({ pathname: "/reset-password", platformMode: "admin" })).toBe(
      "reset-password",
    );
    expect(resolveRootAppKind({ pathname: "/reset-password", platformMode: "public" })).toBe(
      "reset-password",
    );
  });

  test("review QR routes take priority over admin platform mode", () => {
    expect(
      resolveRootAppKind({
        pathname: "/",
        platformMode: "admin",
        isReviewQr: true,
      }),
    ).toBe("review");
  });

  test("review QR detection unchanged for staff query params", () => {
    expect(detectReviewQrMode("?s=Alex&role=waiter&store=Khobar", "nacos.netlify.app")).toBe(true);
    expect(detectReviewQrMode("", "nac-khobar-reviews.netlify.app")).toBe(true);
    expect(detectReviewQrMode("", "nacmenu.netlify.app")).toBe(false);
  });

  test("leaderboard route unaffected", () => {
    expect(resolveRootAppKind({ pathname: "/leaderboard", platformMode: "admin" })).toBe(
      "leaderboard",
    );
  });
});

describe("RBAC compatibility in admin mode", () => {
  test("admin platform mode does not alter RBAC resolution path", () => {
    process.env.REACT_APP_PLATFORM_MODE = "admin";
    expect(isAdminPlatformMode()).toBe(true);
    expect(resolveRootAppKind({ pathname: "/", platformMode: getPlatformMode() })).toBe("admin");
  });
});

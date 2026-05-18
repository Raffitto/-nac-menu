/**
 * Runs before the React bundle. Sets window.__NAC_REVIEW_MODE__ and optional redirect.
 * Keep in sync with src/lib/reviewPortalParams.js (detectReviewQrMode).
 *
 * Printed QR hosts (*-reviews.netlify.app): Option A — serve ReviewPortal in place
 * (no redirect; URL bar stays nac-khobar-reviews.netlify.app/...).
 */
console.log("NAC REVIEW ROUTING LOADED", window.location.href);

(function (w) {
  var CANONICAL_REVIEW_ORIGIN = "https://nacmenu.netlify.app";

  /** Hosts on printed QR/NFC cards — must NOT redirect away from this domain. */
  var PRINTED_QR_REVIEW_HOSTS = {
    "nac-khobar-reviews.netlify.app": true,
  };

  var REVIEW_ONLY_HOST_PATTERNS = [
    /-reviews\.netlify\.app$/i,
    /reviews\.netlify\.app$/i,
  ];

  var STAFF_KEYS = [
    "s",
    "staff",
    "staff_name",
    "employee",
    "employee_name",
    "emp",
    "name",
  ];

  function hasParam(params, key) {
    var v = params.get(key);
    return v != null && String(v).trim() !== "";
  }

  function isReviewOnlyHost(host) {
    var h = (host || "").toLowerCase();
    if (PRINTED_QR_REVIEW_HOSTS[h]) return true;
    for (var i = 0; i < REVIEW_ONLY_HOST_PATTERNS.length; i++) {
      if (REVIEW_ONLY_HOST_PATTERNS[i].test(h)) return true;
    }
    return false;
  }

  function detectReviewQrMode(search, hostname) {
    var params = new URLSearchParams(search || "");
    var host = (hostname || "").toLowerCase();

    if (params.get("app") === "review") return true;
    if (isReviewOnlyHost(host)) return true;

    for (var i = 0; i < STAFF_KEYS.length; i++) {
      if (hasParam(params, STAFF_KEYS[i])) return true;
    }

    if (
      hasParam(params, "role") &&
      (hasParam(params, "store") || hasParam(params, "branch"))
    ) {
      return true;
    }

    return false;
  }

  /** Option B: branch menu domains with staff params → canonical app (preserves query). */
  var BRANCH_MENU_REVIEW_HOSTS = {
    "nacriyadh.netlify.app": true,
    "nac-jeddah.netlify.app": true,
  };

  function shouldRedirectToCanonical(host, search) {
    var h = (host || "").toLowerCase();
    if (
      h === "nacmenu.netlify.app" ||
      h === "localhost" ||
      h === "127.0.0.1"
    ) {
      return false;
    }
    /* Option A: printed *-reviews.netlify.app URLs stay on this host. */
    if (isReviewOnlyHost(h)) return false;
    if (BRANCH_MENU_REVIEW_HOSTS[h] && detectReviewQrMode(search, host)) {
      return true;
    }
    return false;
  }

  function buildCanonicalReviewUrl(search) {
    var target = new URL(CANONICAL_REVIEW_ORIGIN);
    var params = new URLSearchParams(search || "");
    if (!params.get("app")) params.set("app", "review");
    target.search = params.toString();
    return target.href;
  }

  function applyRouting() {
    var host = (w.location.hostname || "").toLowerCase();
    var search = w.location.search || "";

    if (shouldRedirectToCanonical(host, search)) {
      try {
        var targetHref = buildCanonicalReviewUrl(search);
        if (w.location.href !== targetHref) {
          console.log("NAC REVIEW CANONICAL REDIRECT", targetHref);
          w.location.replace(targetHref);
          return;
        }
      } catch (e) {
        console.error("NAC REVIEW REDIRECT ERROR", e);
      }
    }

    var isReview = detectReviewQrMode(search, host);
    w.__NAC_REVIEW_MODE__ = isReview;
    w.__NAC_DETECT_REVIEW_QR_MODE__ = detectReviewQrMode;
    w.__NAC_PRINTED_QR_HOST__ = isReviewOnlyHost(host);

    console.log(
      "ROUTING MODE",
      isReview ? "review" : "menu",
      w.location.hostname,
      w.location.search,
      isReviewOnlyHost(host) ? "(printed QR host — in place)" : "",
    );
  }

  applyRouting();
})(window);

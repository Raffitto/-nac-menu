/**
 * Writes REACT_APP_BUILD_ID for cache busting (Netlify sets COMMIT_REF).
 */
const fs = require("fs");
const path = require("path");

const buildId =
  process.env.COMMIT_REF ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  `local-${Date.now()}`;

const envPath = path.join(__dirname, "..", ".env.production.local");
const line = `REACT_APP_BUILD_ID=${buildId}\n`;

fs.writeFileSync(envPath, line, "utf8");
console.log("[generate-build-id]", buildId);

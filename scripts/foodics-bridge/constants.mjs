/**
 * Repo-side Foodics bridge scheduler contract.
 * LaunchAgent is installed on Raffi's Mac; this cloud worker does not execute it.
 */

export const FOODICS_BRIDGE_LABEL = "com.nac.foodics-bridge.nightly";
export const FOODICS_BRIDGE_NIGHTLY = Object.freeze({
  timezone: "Asia/Riyadh",
  hour: 1,
  minute: 30,
});
export const ENTRYPOINT_REL = "scripts/foodics-bridge/run-nightly.mjs";
export const INSTALL_REL = "scripts/foodics-bridge/install-launchagent.mjs";
export const STATUS_REL = "scripts/foodics-bridge/status.mjs";
export const HARDENED_BRIDGE_FN = "runAuthenticatedFoodicsBridge";

/** Out-of-repo laptop runtime that already holds the Foodics session/env. */
export const DEFAULT_FOODICS_BRIDGE_HOME =
  "/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge";

export const DEFAULT_BRANCH = "khobar";
export const PROOF_SCHEMA = "nac-foodics-bridge-proof-v1";
export const STATE_SCHEMA = "nac-foodics-bridge-state-v1";

export const BEFORE_ENTRYPOINT =
  "out-of-repo foodics-bridge nightly (label com.nac.foodics-bridge.nightly; ProgramArguments not in git)";
export const AFTER_ENTRYPOINT = ENTRYPOINT_REL;

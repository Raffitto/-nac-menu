const constants = require("./constants");
const phone = require("./phone");
const allowlist = require("./allowlist");
const normalizer = require("./normalizer");
const outbound = require("./outbound");
const githubIntegration = require("./githubIntegration");
const hostingVerdict = require("./hostingVerdict");

module.exports = {
  ...constants,
  ...phone,
  ...allowlist,
  ...normalizer,
  ...outbound,
  ...githubIntegration,
  ...hostingVerdict,
};

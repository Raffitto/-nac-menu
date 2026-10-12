#!/usr/bin/env bash
# No-secrets gate (no third-party action). Scans git-TRACKED text files for credential-shaped strings
# and forbidden credential files. Prints ONLY file:line and the rule name, never the matched value
# (matches are piped straight into `cut`/awk that emit location + rule only).
# Suppress a reviewed false positive by adding the marker "no-secrets-allow" on that line.
#
# Binary files are skipped EXPLICITLY (`git grep -I`): images, PDFs, fonts, archives, xlsx etc. are
# not scanned. A credential embedded in a binary is NOT detected.
#
# LIMITATIONS (this is a tripwire, not a full scanner; GitHub secret scanning / gitleaks are stronger):
#   * Regex/heuristic only: no provider verification, no base64/hex/URL decoding, no detection of
#     values split across lines or built by string concatenation (e.g. a JWT assembled from parts).
#   * Scans the current tree of tracked files only: not git history (a secret removed in a later
#     commit is not flagged), not untracked/ignored files, not CI logs, not hosted env settings.
#   * Any line carrying "no-secrets-allow" is skipped; review such lines (CODEOWNERS recommended).
#   * The generic rule covers *_KEY/*_SECRET/*_TOKEN/*_PASSWORD/*_PASSWD and bare password/
#     passwd/secret keys (YAML/JSON). It needs a literal >= 24-char value with letters AND digits
#     and Shannon entropy >= 3.5 bits/char. Values that START with test/dummy/example/fake/
#     placeholder/changeme/your/sample/mock, or contain xxxx/redacted, are treated as fixtures;
#     lowercase dotted/dashed identifiers (>= 3 segments, none longer than 16 chars, e.g. storage
#     keys) are ignored. Short, low-entropy or identifier-shaped secrets therefore pass.
#   * Twilio auth tokens and Account SIDs are only matched next to a "twilio" name.
#   * The scanner also scans itself (its regexes do not match their own source).
#   * File paths containing ':' may be reported with a truncated path.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0

# Forbidden files (templates like .env.example are allowed).
while IFS= read -r f; do
  case "$f" in
    *.env.example|*.env.sample|*.env.template) ;;
    .env|*/.env|.env.*|*/.env.*|*.pem|*.p12|*.pfx|*.key|*service-account*.json|*credentials*.json|.npmrc|*/.npmrc)
      echo "FORBIDDEN-FILE  $f"; fail=1 ;;
  esac
done < <(git ls-files)

RULES=(
  "private-key|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----"
  "supabase-service-role-jwt|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*(c2VydmljZV9yb2xl|NlcnZpY2Vfcm9sZ|zZXJ2aWNlX3JvbG)[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}"
  "jwt|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  "supabase-secret-key|sb_secret_[A-Za-z0-9_-]{16,}"
  "supabase-pat|sbp_[A-Za-z0-9]{32,}"
  "google-oauth-secret|GOCSPX-[A-Za-z0-9_-]{16,}"
  "google-oauth-refresh-token|(^|[^A-Za-z0-9/:])1//0[A-Za-z0-9_-]{30,}"
  "google-api-key|AIza[0-9A-Za-z_-]{35}"
  "openai-key|(^|[^A-Za-z0-9])sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}"
  "stripe-live-key|(sk|rk)_live_[0-9A-Za-z]{20,}"
  "github-token|(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"
  "slack-token|xox[abprs]-[A-Za-z0-9-]{10,}"
  "aws-access-key|AKIA[0-9A-Z]{16}"
  "twilio-api-key|(^|[^A-Za-z0-9])SK[0-9a-fA-F]{32}([^A-Za-z0-9]|$)"
  "twilio-credential|[Tt][Ww][Ii][Ll][Ii][Oo][A-Za-z0-9_]*['\"]?[[:space:]]*[:=][[:space:]]*['\"]?(AC)?[0-9a-f]{32}"
  "sendgrid-key|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}"
  "npm-token|(npm_[A-Za-z0-9]{36}|_authToken=[^\$[:space:]{]{8,})"
  "netlify-token|nfp_[A-Za-z0-9]{36,}"
  "resend-key|(^|[^A-Za-z0-9_])re_[A-Za-z0-9]{8}_[A-Za-z0-9]{16,}"
  "hex-api-key|(^|[^A-Za-z0-9_])key_[0-9a-f]{64}([^0-9a-f]|$)"
  "db-url-with-password|(postgres(ql)?|mysql|mongodb(\+srv)?|rediss?)://[^:/@[:space:]]+:([^@[:space:]<{\$]|\$[^{@[:space:]]){6,}@"
)

report() { # stdin: "file:line" ; $1 rule
  while IFS= read -r loc; do
    [ -n "$loc" ] || continue
    echo "SECRET-PATTERN  $loc  rule=$1"; fail=1
  done
}

for rule in "${RULES[@]}"; do
  name="${rule%%|*}"; re="${rule#*|}"
  # -I: skip binaries explicitly. Content never leaves the pipe: allow-marker filter, then cut.
  report "$name" < <(git grep -I -n -E -e "$re" -- . 2>/dev/null \
    | grep -v "no-secrets-allow" | cut -d: -f1,2 || true)
done

# Generic high-entropy literal assigned to *_KEY / *_SECRET / *_TOKEN (any case).
report "generic-high-entropy-assignment" < <(git grep -I -n -i -E \
    -e "[A-Za-z0-9]_?(KEY|SECRET|TOKEN|PASSWORD|PASSWD)['\"]?[[:space:]]*(:|=|:=|=>)[[:space:]]*['\"\`]?[A-Za-z0-9+/_.=-]{24,}" \
    -e "(^|[^A-Za-z0-9])(PASSWORD|PASSWD|SECRET)['\"]?[[:space:]]*(:|=|:=|=>)[[:space:]]*['\"\`]?[A-Za-z0-9+/_.=-]{24,}" \
    -- . 2>/dev/null | grep -v "no-secrets-allow" | awk '
  function entropy(s,   i, n, c, h, cnt) {
    n = length(s); delete cnt
    for (i = 1; i <= n; i++) cnt[substr(s, i, 1)]++
    h = 0; for (c in cnt) h -= (cnt[c] / n) * log(cnt[c] / n) / log(2)
    return h
  }
  {
    split($0, p, ":"); loc = p[1] ":" p[2]
    line = substr($0, length(p[1]) + length(p[2]) + 3)
    l = tolower(line)
    while (match(l, /([a-z0-9]_?(key|secret|token|password|passwd)|(^|[^a-z0-9])(password|passwd|secret))["\047]?[ \t]*(:|=|:=|=>)[ \t]*["\047`]?[a-z0-9+\/_.=-]+/)) {
      m = substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH); l = substr(l, RSTART + RLENGTH)
      match(m, /(:|=)[ \t]*["\047`]?/); v = substr(m, RSTART + RLENGTH)   # leftmost separator
      sub(/^>[ \t]*["\047`]?/, "", v)                                     # "=>" form
      if (length(v) < 24) continue
      if (v !~ /[0-9]/ || v !~ /[A-Za-z]/) continue
      # fixture values: only a LEADING marker word (test-..., dummy_...) or obvious redaction
      if (tolower(v) ~ /^(test|dummy|example|fake|placeholder|changeme|your|sample|mock)([-_.]|$)/ || tolower(v) ~ /(xxxx|redacted)/) continue
      if (entropy(v) < 3.5) continue
      # dotted/dashed lowercase identifiers (storage keys, event names), every segment <= 16 chars
      if (v ~ /^[a-z0-9]+([._:-][a-z0-9]+)+$/) {
        ns = split(v, seg, /[._:-]/); longest = 0
        for (k = 1; k <= ns; k++) if (length(seg[k]) > longest) longest = length(seg[k])
        if (ns >= 3 && longest <= 16) continue
      }
      print loc; break
    }
  }' || true)

if [ "$fail" -ne 0 ]; then
  echo "no-secrets check FAILED. Remove the credential (and rotate it), or mark a reviewed false positive with 'no-secrets-allow'." >&2
  exit 1
fi
echo "no-secrets check passed ($(git ls-files | wc -l | tr -d ' ') tracked files; binaries skipped)."

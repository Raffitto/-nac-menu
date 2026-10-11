#!/usr/bin/env bash
# No-secrets gate (no third-party action). Scans git-tracked files for credential-shaped strings
# and forbidden credential files. Prints ONLY file:line and the rule name — never the match.
# Suppress a reviewed false positive by adding the marker "no-secrets-allow" on that line.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SELF="scripts/check-no-secrets.sh"
fail=0

# Forbidden files (templates like .env.example are allowed).
while IFS= read -r f; do
  case "$f" in
    *.env.example|*.env.sample|*.env.template) ;;
    .env|*/.env|.env.*|*/.env.*|*.pem|*.p12|*.pfx|*.key|*service-account*.json|*credentials*.json)
      echo "FORBIDDEN-FILE  $f"; fail=1 ;;
  esac
done < <(git ls-files)

RULES=(
  "private-key|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----"
  "jwt|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  "supabase-secret-key|sb_secret_[A-Za-z0-9_-]{16,}"
  "supabase-pat|sbp_[A-Za-z0-9]{32,}"
  "google-oauth-secret|GOCSPX-[A-Za-z0-9_-]{16,}"
  "google-api-key|AIza[0-9A-Za-z_-]{35}"
  "openai-key|(^|[^A-Za-z0-9])sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}"
  "github-token|(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})"
  "slack-token|xox[abprs]-[A-Za-z0-9-]{10,}"
  "aws-access-key|AKIA[0-9A-Z]{16}"
  "db-url-with-password|postgres(ql)?://[^:/@[:space:]]+:[^@/[:space:]\$\{<]{6,}@"
)

for rule in "${RULES[@]}"; do
  name="${rule%%|*}"; re="${rule#*|}"
  # -I skip binaries; -n line numbers; -o not used so values are never printed.
  while IFS= read -r hit; do
    file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"
    [ "$file" = "$SELF" ] && continue
    if sed -n "${line}p" "$file" | grep -q "no-secrets-allow"; then continue; fi
    echo "SECRET-PATTERN  $file:$line  rule=$name"; fail=1
  done < <(git ls-files -z | xargs -0 grep -I -n -E -- "$re" 2>/dev/null | cut -d: -f1,2 || true)
done

if [ "$fail" -ne 0 ]; then
  echo "no-secrets check FAILED. Remove the credential (and rotate it), or mark a reviewed false positive with 'no-secrets-allow'." >&2
  exit 1
fi
echo "no-secrets check passed ($(git ls-files | wc -l | tr -d ' ') tracked files)."

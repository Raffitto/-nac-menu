#!/usr/bin/env bash
# Fixture test for scripts/check-no-secrets.sh in a throw-away repo. All "secrets" are random,
# synthetic and generated at runtime; the test asserts that NONE of them appear in the output.
set -uo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/check-no-secrets.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T" && git init -q && mkdir -p scripts src && cp "$SRC" scripts/
r() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2"; }
AN='A-Za-z0-9'; HEX='0-9a-f'
b64() { printf '%s' "$1" | base64 | tr '+/' '-_' | tr -d '=\n'; }
SRJWT="$(b64 '{"alg":"HS256","typ":"JWT"}').$(b64 '{"iss":"supabase","role":"service_role","ref":"'$(r a-z 20)'"}').$(r "$AN" 43)"
# Keys are quoted. Unquoted hyphenated subscripts are arithmetic, and `set -u`
# then aborts on the first word (observed: "stripe: unbound variable") before
# any fixture runs. CI uses Bash 5; this is the form Bash 4+ accepts.
declare -A POS=(
  ["stripe-live-key"]="sk_live_$(r "$AN" 30)"
  ["stripe-live-key#rk"]="rk_live_$(r "$AN" 30)"
  ["google-oauth-refresh-token"]="1//0$(r "$AN" 60)"
  ["supabase-service-role-jwt"]="$SRJWT"
  ["twilio-api-key"]="SK$(r "$HEX" 32)"
  ["twilio-credential"]="AC$(r "$HEX" 32)"
  ["sendgrid-key"]="SG.$(r "$AN" 22).$(r "$AN" 43)"
  ["npm-token"]="npm_$(r "$AN" 36)"
  ["generic-high-entropy-assignment"]="$(r "$AN" 40)"
  ["openai-key"]="sk-proj-$(r "$AN" 40)"
  ["github-token"]="ghp_$(r "$AN" 36)"
  ["netlify-token"]="nfp_$(r "$AN" 40)"
  ["resend-key"]="re_$(r "$AN" 8)_$(r "$AN" 24)"
  ["hex-api-key"]="key_$(r "$HEX" 64)"
  ["db-url-with-password"]="postgresql://app:$(r "$AN" 6)\$$(r "$AN" 4)/$(r "$AN" 6)@db.internal:5432/x"
  ["generic-high-entropy-assignment#yaml"]="$(r "$AN" 32)"
  ["generic-high-entropy-assignment#b64pad"]="$(r "$AN" 30)=="
  ["generic-high-entropy-assignment#midword"]="$(r "$AN" 12)test$(r "$AN" 20)"
)
i=0
for k in "${!POS[@]}"; do
  i=$((i+1)); v="${POS[$k]}"
  case "$k" in
    twilio-credential) printf 'TWILIO_ACCOUNT_SID = "%s"\n' "$v" ;;
    generic-high-entropy-assignment) printf 'const PAYMENT_WEBHOOK_SECRET = "%s";\n' "$v" ;;
    generic-high-entropy-assignment#yaml) printf 'database:\n  password: %s\n' "$v" | tail -n 1 ;;
    generic-high-entropy-assignment#b64pad) printf 'SIGNING_KEY=%s\n' "$v" ;;
    generic-high-entropy-assignment#midword) printf 'export WEBHOOK_TOKEN="%s"\n' "$v" ;;
    *) printf 'value = "%s"\n' "$v" ;;
  esac > "src/pos_$i.txt"
  echo "${k%%#*}" > "src/pos_$i.expect"
done
# negatives (must NOT be reported)
cat > src/neg.ts <<'N'
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const ONBOARDING_STORAGE_KEY = "nac.menu-manager.onboarding.v1.dismissed";
export const SERVICE_KEY = "test-service-role-key-0123456789abcdef";
const token = process.env.GITHUB_TOKEN;
api_key: ${{ secrets.API_KEY }}
const url = "postgresql://app:${PGPASSWORD}@db.internal:5432/x";
password: ${{ secrets.DB_PASSWORD }}
const passwordHint = "use-at-least-twelve-characters";
export const SCHED_SECRET = "dummy_scheduled_secret_1234567890";
N
printf 'const STRIPE = "sk_live_%s"; // no-secrets-allow\n' "$(r "$AN" 30)" > src/allowed.ts
# binary file containing a secret-shaped string: skipped explicitly (-I)
{ printf '\x00\x01PNG\x00'; printf 'sk_live_%s' "$(r "$AN" 30)"; printf '\x00\xff'; } > src/blob.bin
git add -A >/dev/null 2>&1
OUT=$(bash scripts/check-no-secrets.sh 2>&1); RC=$?
echo "$OUT"; echo "exit=$RC"
pass=1
for e in src/pos_*.expect; do
  f="${e%.expect}.txt"; rule=$(cat "$e")
  if echo "$OUT" | grep -q "^SECRET-PATTERN  $f:1  rule=$rule\$"; then echo "OK   detected $rule ($f)"; else echo "FAIL missed $rule ($f)"; pass=0; fi
done
for f in src/neg.ts src/allowed.ts src/blob.bin; do
  if echo "$OUT" | grep -q " $f:"; then echo "FAIL false positive in $f"; pass=0; else echo "OK   not reported: $f"; fi
done
leak=0; for v in "${POS[@]}"; do case "$OUT" in *"$v"*) leak=1;; esac; done
for frag in sk_live_ rk_live_ 'SG.' npm_ ghp_ '1//0' eyJ nfp_ re_ key_ 'postgresql://'; do case "$OUT" in *"$frag"*) leak=1;; esac; done
[ "$leak" -eq 0 ] && echo "OK   no secret value (or prefix) printed" || { echo "FAIL value printed"; pass=0; }
[ "$RC" -eq 1 ] && echo "OK   exit code 1" || { echo "FAIL exit code $RC"; pass=0; }
[ "$pass" -eq 1 ] && echo "FIXTURE TEST PASSED" || { echo "FIXTURE TEST FAILED"; exit 1; }

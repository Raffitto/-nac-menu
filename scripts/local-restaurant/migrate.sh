#!/bin/sh
# Apply restaurant migrations to the local development database.
# The API does not create schema. This script does, and it sets the API role
# password from LOCAL_API_ROLE_PASSWORD. That password is never written into SQL.
set -eu
cd "$(dirname "$0")/../.."
if [ -f scripts/local-restaurant/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . scripts/local-restaurant/.env
  set +a
fi
if [ -z "${LOCAL_DB_PASSWORD:-}" ]; then
  echo "LOCAL_DB_PASSWORD is missing from scripts/local-restaurant/.env" >&2
  exit 1
fi
if [ -z "${LOCAL_API_ROLE_PASSWORD:-}" ]; then
  LOCAL_API_ROLE_PASSWORD="$(openssl rand -hex 24)"
  printf '\nLOCAL_API_ROLE_PASSWORD=%s\n' "$LOCAL_API_ROLE_PASSWORD" >> scripts/local-restaurant/.env
fi
if [ -z "${LOCAL_GUEST_TOKEN_SECRET:-}" ]; then
  LOCAL_GUEST_TOKEN_SECRET="$(openssl rand -hex 32)"
  printf '\nLOCAL_GUEST_TOKEN_SECRET=%s\n' "$LOCAL_GUEST_TOKEN_SECRET" >> scripts/local-restaurant/.env
fi
ROOT="${LOCAL_RESTAURANT_MIGRATIONS:-/Users/raffiazarian/Desktop/nac-reservations-persistence/supabase/migrations}"
if [ ! -d "$ROOT" ]; then
  echo "Restaurant schema is not in this branch. Set LOCAL_RESTAURANT_MIGRATIONS to the PR #83 migration directory." >&2
  exit 1
fi
PSQL="docker exec -i nac-reservations-dev psql -v ON_ERROR_STOP=1 -U postgres -d nac_reservations_dev"
for file in \
  "$ROOT/20261109210000_restaurant_order_modifiers.sql" \
  "$ROOT/20261109211000_restaurant_dev_access.sql" \
  "$ROOT/20261109220000_restaurant_bill_adjustments.sql" \
  "$ROOT/20261109223000_restaurant_unpaid_checks.sql" \
  "$ROOT/20261109224000_restaurant_kitchen_items.sql" \
  "$ROOT/20261109225000_restaurant_waitlist_visits.sql" \
  "$ROOT/20261109230000_restaurant_passkeys.sql" \
  "$ROOT/20261109231000_restaurant_guest_access.sql" \
  "$ROOT/20261110120000_restaurant_owner_controls.sql" \
  "$ROOT/20261110133000_restaurant_pilot_mode.sql"
do
  echo "apply $(basename "$file")"
  $PSQL < "$file"
done
docker exec -i nac-reservations-dev psql -v ON_ERROR_STOP=1 -U postgres -d nac_reservations_dev \
  -c "alter role nac_restaurant_api password '${LOCAL_API_ROLE_PASSWORD}'" >/dev/null
echo "local restaurant migrations applied"

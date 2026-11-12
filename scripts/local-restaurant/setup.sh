#!/bin/sh
# Persistent local restaurant database. Bound to 127.0.0.1. Not production.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
persist=/Users/raffiazarian/Desktop/nac-reservations-persistence
envfile="$root/scripts/local-restaurant/.env"
name=nac-reservations-dev
port=54329
if [ ! -f "$envfile" ]; then
  password=$(openssl rand -hex 18)
  printf 'LOCAL_DB_PASSWORD=%s\nLOCAL_DEV_PASSWORD=local-dev\n' "$password" > "$envfile"
fi
# shellcheck disable=SC1090
. "$envfile"
if ! docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
  docker volume create nac_reservations_dev >/dev/null
  docker run -d --name "$name" \
    -e POSTGRES_PASSWORD="$LOCAL_DB_PASSWORD" \
    -e POSTGRES_DB=nac_reservations_dev \
    -p 127.0.0.1:${port}:5432 \
    -v nac_reservations_dev:/var/lib/postgresql/data \
    postgres:16 >/dev/null
fi
docker start "$name" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
psql() { docker exec -i "$name" psql -U postgres -d nac_reservations_dev -v ON_ERROR_STOP=1 "$@"; }
psql < "$persist/scripts/restaurant-foundation-fixture.sql" >/dev/null
psql < "$persist/supabase/migrations/20261109183000_restaurant_service_foundation.sql" >/dev/null
psql < "$persist/supabase/migrations/20261109193000_restaurant_service_permissions.sql" >/dev/null
psql < "$persist/supabase/migrations/20261109201000_restaurant_service_turnover.sql" >/dev/null
psql < "$root/scripts/local-restaurant/seed.sql" >/dev/null
echo "local restaurant database is ready on 127.0.0.1:${port}"
echo "synthetic staff password: local-dev"

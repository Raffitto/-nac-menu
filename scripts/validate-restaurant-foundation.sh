#!/bin/sh
# Isolated Postgres only. Does not use the Supabase project or production.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
name=nac-res-foundation-$$
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=nac_res postgres:16 >/dev/null
cleanup() { docker rm -f "$name" >/dev/null; }
trap cleanup EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 < "$root/scripts/restaurant-foundation-fixture.sql" >/dev/null
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 < "$root/supabase/migrations/20261109183000_restaurant_service_foundation.sql" >/dev/null
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 < "$root/supabase/migrations/20261109193000_restaurant_service_permissions.sql" >/dev/null
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 < "$root/supabase/migrations/20261109201000_restaurant_service_turnover.sql" >/dev/null
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 <<'SQL'
insert into public.restaurant_staff_grants (email, branch_id, role) values
  ('host.khobar@nac.test', 'khobar', 'host'),
  ('host.riyadh@nac.test', 'riyadh', 'host'),
  ('kitchen.khobar@nac.test', 'khobar', 'kitchen'),
  ('cashier.khobar@nac.test', 'khobar', 'cashier')
on conflict do nothing;
SQL
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 < "$root/scripts/restaurant-foundation-checks.sql"
docker exec -i "$name" psql -U postgres -d nac_res -v ON_ERROR_STOP=1 <<'SQL'
select set_config('request.jwt.claim.email', 'host.khobar@nac.test', false);
insert into public.restaurant_reservations (id, branch_id, guest_id, party_size, status, revision)
select '11111111-1111-1111-1111-111111111111', 'khobar', id, 2, 'arrived', 0
from public.restaurant_guests where name = 'Hana';
insert into public.restaurant_reservations (id, branch_id, guest_id, party_size, status, revision)
select '22222222-2222-2222-2222-222222222222', 'khobar', id, 2, 'arrived', 0
from public.restaurant_guests where name = 'Hana';
SQL
docker exec -d "$name" psql -U postgres -d nac_res -c "select set_config('request.jwt.claim.email','host.khobar@nac.test',false); begin; select public.restaurant_assign_table('11111111-1111-1111-1111-111111111111','khobar:22',0); select pg_sleep(2); commit;"
sleep 0.6
docker exec "$name" psql -U postgres -d nac_res -c "select set_config('request.jwt.claim.email','host.khobar@nac.test',false); select public.restaurant_assign_table('22222222-2222-2222-2222-222222222222','khobar:22',0);" > /tmp/nac-res-race.out 2>&1 || true
if ! grep -q "table_unavailable" /tmp/nac-res-race.out; then
  echo "concurrent assignment was not rejected" >&2
  cat /tmp/nac-res-race.out >&2
  exit 1
fi
echo concurrent_assignment_rejected


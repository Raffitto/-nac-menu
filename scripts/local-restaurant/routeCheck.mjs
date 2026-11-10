import pg from "pg";

const client = new pg.Client({
  host: "127.0.0.1",
  port: Number(process.env.LOCAL_DB_PORT),
  database: process.env.LOCAL_DB_NAME,
  user: "postgres",
  password: process.env.LOCAL_DB_PASSWORD,
});

async function expectError(fn, pattern) {
  await client.query("savepoint guard");
  try {
    await fn();
  } catch (error) {
    await client.query("rollback to savepoint guard");
    if (!pattern.test(error.message)) throw error;
    return;
  }
  await client.query("rollback to savepoint guard");
  throw new Error(`expected ${pattern}`);
}

await client.connect();
try {
  await client.query("begin");
  const legacy = (await client.query(
    "select count(line_minor)::int as priced from restaurant_order_items where item_name = '2 Eggs Any Style' and quantity = 2",
  )).rows[0].priced;
  if (legacy !== 0) throw new Error("historical eggs price was rewritten");
  const sessionsBefore = (await client.query("select count(*)::int as rows from restaurant_sessions")).rows[0].rows;
  const reservationsBefore = (await client.query("select count(*)::int as rows from restaurant_reservations")).rows[0].rows;
  await client.query(
    `insert into restaurant_staff_grants (email, branch_id, role) values
      ('route.manager.khobar@nac.test', 'khobar', 'manager'),
      ('route.waiter.khobar@nac.test', 'khobar', 'waiter'),
      ('route.kitchen.khobar@nac.test', 'khobar', 'kitchen'),
      ('route.manager.riyadh@nac.test', 'riyadh', 'manager')
     on conflict do nothing`,
  );
  const table = (await client.query(
    `select t.id from restaurant_tables t
     where t.branch_id = 'khobar'
       and not exists (
         select 1 from restaurant_reservations r
         where r.table_id = t.id and r.status in ('booked', 'arrived', 'seated')
       )
     limit 1`,
  )).rows[0];
  if (!table) throw new Error("no free khobar table");
  await client.query("insert into restaurant_guests (id, branch_id, name) values ('71717171-7171-4171-8171-717171717171', 'khobar', 'Route Check')");
  await client.query(
    `insert into restaurant_reservations (id, branch_id, guest_id, party_size, status, table_id, revision)
     values ('81818181-8181-4181-8181-818181818181', 'khobar', '71717171-7171-4171-8171-717171717171', 2, 'seated', $1, 0)`,
    [table.id],
  );
  await client.query(
    `insert into restaurant_sessions (id, branch_id, reservation_id, table_id, status)
     values ('session-route-check', 'khobar', '81818181-8181-4181-8181-818181818181', $1, 'open')`,
    [table.id],
  );
  await client.query(
    `insert into restaurant_orders (id, session_id, branch_id, status)
     values ('order-route-check', 'session-route-check', 'khobar', 'open')`,
  );
  await client.query("select set_config('request.jwt.claim.email', 'route.manager.khobar@nac.test', true)");
  const station = (await client.query(
    "select id, code, name from restaurant_create_station('khobar', 'test-pass', 'Test Pass')",
  )).rows[0];
  await client.query("select set_config('request.jwt.claim.email', 'route.waiter.khobar@nac.test', true)");
  const item = (await client.query(
    `select id, station_code, line_minor, status from restaurant_submit_priced_item(
      'order-route-check', 'egg-route', '2 Eggs Any Style', 2, 'No salt', 'Eggs', 'eggs-route',
      3100, $1::jsonb, 5000, 10000, 'SAR', null, null)`,
    [JSON.stringify([
      { id: "fried", name: "Fried", unitMinor: 0 },
      { id: "bacon", name: "Beef Bacon", unitMinor: 1900 },
    ])],
  )).rows[0];
  if (item.station_code || item.line_minor !== 10000) throw new Error("unassigned snapshot was not saved");
  await expectError(
    () => client.query("select restaurant_set_item_status($1, 'preparing')", [item.id]),
    /station_not_configured/,
  );
  await expectError(
    () => client.query("select restaurant_route_unassigned_item($1, $2)", [item.id, station.id]),
    /role_forbidden/,
  );
  await client.query("select set_config('request.jwt.claim.email', 'route.manager.riyadh@nac.test', true)");
  await expectError(
    () => client.query("select restaurant_route_unassigned_item($1, $2)", [item.id, station.id]),
    /role_forbidden/,
  );
  await client.query("select set_config('request.jwt.claim.email', 'route.manager.khobar@nac.test', true)");
  const routed = (await client.query(
    "select station_code, station_name, line_minor from restaurant_route_unassigned_item($1, $2)",
    [item.id, station.id],
  )).rows[0];
  const again = (await client.query(
    "select station_code, line_minor from restaurant_route_unassigned_item($1, $2)",
    [item.id, station.id],
  )).rows[0];
  const copies = (await client.query(
    "select count(*)::int as rows from restaurant_order_items where order_id = 'order-route-check' and client_key = 'eggs-route'",
  )).rows[0].rows;
  if (routed.station_code !== "test-pass" || routed.line_minor !== 10000 || again.line_minor !== 10000 || copies !== 1) {
    throw new Error("routing changed the price or duplicated the item");
  }
  const audit = (await client.query(
    "select count(*)::int as rows from restaurant_audit_events where action = 'item_routed' and entity_id = $1",
    [item.id],
  )).rows[0].rows;
  if (audit !== 1) throw new Error("routing was not audited once");
  await client.query("select set_config('request.jwt.claim.email', 'route.kitchen.khobar@nac.test', true)");
  await client.query("select restaurant_set_item_status($1, 'accepted')", [item.id]);
  await client.query("select restaurant_set_item_status($1, 'preparing')", [item.id]);
  await client.query("select restaurant_set_item_status($1, 'ready')", [item.id]);
  const ready = (await client.query("select status, line_minor from restaurant_order_items where id = $1", [item.id])).rows[0];
  if (ready.status !== "ready" || ready.line_minor !== 10000) throw new Error("preparation changed the saved price");
  await client.query("select set_config('request.jwt.claim.email', 'route.waiter.khobar@nac.test', true)");
  const repeat = (await client.query(
    `select line_minor, station_code from restaurant_submit_priced_item(
      'order-route-check', 'egg-route', '2 Eggs Any Style', 2, 'No salt', 'Eggs', 'eggs-route',
      4000, '[]'::jsonb, 4000, 8000, 'SAR', null, null)`,
  )).rows[0];
  const afterRepeat = (await client.query(
    "select count(*)::int as rows from restaurant_order_items where client_key = 'eggs-route'",
  )).rows[0].rows;
  if (repeat.line_minor !== 10000 || repeat.station_code !== "test-pass" || afterRepeat !== 1) {
    throw new Error("the repeated submission replaced the original ticket");
  }
  await client.query("select set_config('request.jwt.claim.email', 'route.manager.khobar@nac.test', true)");
  await client.query("select restaurant_update_station($1, 'Renamed Pass', true)", [station.id]);
  const frozen = (await client.query("select station_name, line_minor from restaurant_order_items where id = $1", [item.id])).rows[0];
  if (frozen.station_name !== "Test Pass" || frozen.line_minor !== 10000) throw new Error("renaming a station rewrote the ticket");
  const legacyAfter = (await client.query(
    `select count(line_minor)::int as priced from restaurant_order_items
     where item_name = '2 Eggs Any Style' and quantity = 2 and order_id <> 'order-route-check'`,
  )).rows[0].priced;
  const sessionsAfter = (await client.query(
    "select count(*)::int as rows from restaurant_sessions where id <> 'session-route-check'",
  )).rows[0].rows;
  const reservationsAfter = (await client.query(
    "select count(*)::int as rows from restaurant_reservations where id <> '81818181-8181-4181-8181-818181818181'",
  )).rows[0].rows;
  if (legacyAfter !== 0 || sessionsAfter !== sessionsBefore || reservationsAfter !== reservationsBefore) {
    throw new Error("existing service rows changed");
  }
  console.log(JSON.stringify({
    pending: true,
    routed: routed.station_code,
    lineMinor: frozen.line_minor,
    status: ready.status,
    duplicates: afterRepeat,
    audit,
    historicalName: frozen.station_name,
  }));
} finally {
  await client.query("rollback");
  await client.end();
}

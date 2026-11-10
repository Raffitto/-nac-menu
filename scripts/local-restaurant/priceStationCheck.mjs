import pg from "pg";

const eggsId = "7b879a69-8d4d-4853-8bea-544266c9cf61";
const client = new pg.Client({
  host: "127.0.0.1",
  port: Number(process.env.LOCAL_DB_PORT),
  database: process.env.LOCAL_DB_NAME,
  user: "postgres",
  password: process.env.LOCAL_DB_PASSWORD,
});

function snapshotArgs(base, modifierMinor, quantity, stationId, key) {
  const unit = base + modifierMinor;
  const modifiers = [
    { id: "fried", name: "Fried", unitMinor: 0 },
    { id: "bacon", name: "Beef Bacon", unitMinor: modifierMinor },
  ];
  return [
    "order-price-check",
    eggsId,
    "2 Eggs Any Style",
    quantity,
    "No salt",
    null,
    key,
    base,
    JSON.stringify(modifiers),
    unit,
    unit * quantity,
    "SAR",
    null,
    stationId,
  ];
}

await client.connect();
try {
  await client.query("begin");
  const legacy = await client.query(
    `select count(*)::int as rows, count(line_minor)::int as priced
     from restaurant_order_items where item_name = '2 Eggs Any Style' and quantity = 2`,
  );
  if (legacy.rows[0].priced !== 0) throw new Error("historical eggs price was rewritten");

  await client.query(
    `insert into restaurant_staff_grants (email, branch_id, role) values
      ('price.manager.khobar@nac.test', 'khobar', 'manager'),
      ('price.waiter.khobar@nac.test', 'khobar', 'waiter'),
      ('price.kitchen.khobar@nac.test', 'khobar', 'kitchen'),
      ('price.cashier.khobar@nac.test', 'khobar', 'cashier'),
      ('price.manager.riyadh@nac.test', 'riyadh', 'manager')
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
  if (!table) throw new Error("no free khobar table for the isolated check");
  await client.query(
    `insert into restaurant_guests (id, branch_id, name) values ('77777777-7777-4777-8777-777777777777', 'khobar', 'Price Check')`,
  );
  await client.query(
    `insert into restaurant_reservations (id, branch_id, guest_id, party_size, status, table_id, revision)
     values ('88888888-8888-4888-8888-888888888888', 'khobar', '77777777-7777-4777-8777-777777777777', 2, 'seated', $1, 0)`,
    [table.id],
  );
  await client.query("select set_config('request.jwt.claim.email', 'price.manager.khobar@nac.test', true)");
  const station = (await client.query(
    "select id, code, name from restaurant_create_station('khobar', 'kitchen', 'Test Kitchen')",
  )).rows[0];
  await client.query("select restaurant_assign_item_station('khobar', $1, $2)", [eggsId, station.id]);
  await client.query("savepoint branch_guard");
  let forbidden = false;
  try {
    await client.query("select set_config('request.jwt.claim.email', 'price.manager.riyadh@nac.test', true)");
    await client.query("select restaurant_create_station('khobar', 'bar', 'Bar')");
  } catch (error) {
    forbidden = /role_forbidden|branch_forbidden/.test(error.message);
    await client.query("rollback to savepoint branch_guard");
  }
  if (!forbidden) throw new Error("riyadh manager configured a khobar station");
  await client.query("savepoint waiter_guard");
  await client.query("select set_config('request.jwt.claim.email', 'price.waiter.khobar@nac.test', true)");
  let waiterBlocked = false;
  try {
    await client.query("select restaurant_create_station('khobar', 'bar', 'Bar')");
  } catch (error) {
    waiterBlocked = /role_forbidden/.test(error.message);
    await client.query("rollback to savepoint waiter_guard");
  }
  if (!waiterBlocked) throw new Error("waiter created a station");
  await client.query(
    `insert into restaurant_sessions (id, branch_id, reservation_id, table_id, status)
     values ('session-price-check', 'khobar', '88888888-8888-4888-8888-888888888888', $1, 'open')`,
    [table.id],
  );
  await client.query(
    `insert into restaurant_orders (id, session_id, branch_id, status)
     values ('order-price-check', 'session-price-check', 'khobar', 'open')`,
  );
  const unassigned = (await client.query(
    `select station_code, line_minor from restaurant_submit_priced_item(
      'order-price-check', 'other-item', 'Unassigned Toast', 1, null, null, 'plain',
      5900, '[]'::jsonb, 5900, 5900, 'SAR', null, null)`,
  )).rows[0];
  if (unassigned.station_code || unassigned.line_minor !== 5900) throw new Error("unassigned item was routed or unpriced");
  const first = (await client.query(
    `select station_code, station_name, line_minor, unit_minor, base_unit_minor, currency, tax_minor, priced_at
     from restaurant_submit_priced_item($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    snapshotArgs(3100, 1900, 2, station.id, "eggs-1"),
  )).rows[0];
  if (first.station_code !== "kitchen" || first.line_minor !== 10000 || first.unit_minor !== 5000 || first.currency !== "SAR" || first.tax_minor != null || !first.priced_at) {
    throw new Error(`eggs snapshot mismatch ${JSON.stringify(first)}`);
  }
  const repeat = (await client.query(
    `select line_minor from restaurant_submit_priced_item($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    snapshotArgs(4000, 2500, 2, station.id, "eggs-1"),
  )).rows[0];
  const count = (await client.query(
    "select count(*)::int as rows from restaurant_order_items where order_id = 'order-price-check' and client_key = 'eggs-1'",
  )).rows[0].rows;
  if (repeat.line_minor !== 10000 || count !== 1) throw new Error("repeated submission changed or duplicated the charge");
  const next = (await client.query(
    `select line_minor from restaurant_submit_priced_item($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    snapshotArgs(4000, 2500, 2, station.id, "eggs-2"),
  )).rows[0];
  const original = (await client.query(
    "select line_minor, modifier_snapshot from restaurant_order_items where client_key = 'eggs-1'",
  )).rows[0];
  if (next.line_minor !== 13000 || original.line_minor !== 10000 || original.modifier_snapshot[1].unitMinor !== 1900) {
    throw new Error("a later catalogue price changed the submitted order");
  }
  await client.query("select set_config('request.jwt.claim.email', 'price.kitchen.khobar@nac.test', true)");
  await client.query("select restaurant_set_item_status((select id from restaurant_order_items where client_key = 'eggs-1'), 'preparing')");
  await client.query("select restaurant_set_item_status((select id from restaurant_order_items where client_key = 'eggs-1'), 'ready')");
  const ready = (await client.query("select status, station_code from restaurant_order_items where client_key = 'eggs-1'")).rows[0];
  if (ready.status !== "ready" || ready.station_code !== "kitchen") throw new Error("kitchen status was not saved on the routed item");
  const barVisible = (await client.query(
    "select count(*)::int as rows from restaurant_order_items where order_id = 'order-price-check' and station_code = 'bar'",
  )).rows[0].rows;
  const kitchenVisible = (await client.query(
    "select count(*)::int as rows from restaurant_order_items where order_id = 'order-price-check' and station_code = 'kitchen' and status <> 'cancelled'",
  )).rows[0].rows;
  if (barVisible !== 0 || kitchenVisible !== 2) throw new Error("station filter would show the wrong items");
  const persisted = (await client.query(
    "select coalesce(sum(line_minor), 0)::int as minor from restaurant_order_items where order_id = 'order-price-check' and status <> 'cancelled' and line_minor is not null",
  )).rows[0].minor;
  const cashier = 10000 + 13000 + 5900;
  if (persisted !== cashier) throw new Error(`cashier total ${persisted} does not match persisted lines ${cashier}`);
  const legacyAfter = (await client.query(
    `select count(line_minor)::int as priced from restaurant_order_items
     where item_name = '2 Eggs Any Style' and quantity = 2 and id <> all (
       select id from restaurant_order_items where order_id = 'order-price-check'
     )`,
  )).rows[0].priced;
  if (legacyAfter !== 0) throw new Error("historical eggs price was rewritten during the check");
  console.log(JSON.stringify({
    legacyUnpriced: true,
    unassignedSaved: true,
    routedStation: first.station_code,
    originalLineMinor: original.line_minor,
    repeatLineMinor: repeat.line_minor,
    updatedCatalogueLineMinor: next.line_minor,
    duplicateRows: count,
    status: ready.status,
    cashierMinor: persisted,
    branchIsolation: true,
  }));
} finally {
  await client.query("rollback");
  await client.end();
}

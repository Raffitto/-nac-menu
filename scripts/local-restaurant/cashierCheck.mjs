import pg from "pg";

const client = new pg.Client({
  host: "127.0.0.1",
  port: Number(process.env.LOCAL_DB_PORT),
  database: process.env.LOCAL_DB_NAME,
  user: "postgres",
  password: process.env.LOCAL_DB_PASSWORD,
});

await client.connect();
try {
  await client.query("begin");
  const legacy = (await client.query(
    "select count(line_minor)::int as priced, count(tax_minor)::int as taxed from restaurant_order_items where item_name = '2 Eggs Any Style' and quantity = 2",
  )).rows[0];
  if (legacy.priced !== 0 || legacy.taxed !== 0) throw new Error("historical eggs financial fields were rewritten");
  const setting = (await client.query(
    "select treatment, rate_numerator, rate_denominator from restaurant_tax_settings where branch_id = 'khobar'",
  )).rows[0];
  if (setting.treatment !== "inclusive" || setting.rate_numerator !== 15) throw new Error("Khobar tax setting does not match the verified inclusive 15% source");
  await client.query(
    `insert into restaurant_staff_grants (email, branch_id, role) values
      ('cash.manager.khobar@nac.test', 'khobar', 'manager'),
      ('cash.waiter.khobar@nac.test', 'khobar', 'waiter'),
      ('cash.cashier.khobar@nac.test', 'khobar', 'cashier'),
      ('cash.cashier.riyadh@nac.test', 'riyadh', 'cashier')
     on conflict do nothing`,
  );
  const table = (await client.query(
    `select t.id from restaurant_tables t
     where t.branch_id = 'khobar' and not exists (
       select 1 from restaurant_reservations r where r.table_id = t.id and r.status in ('booked','arrived','seated')
     ) limit 1`,
  )).rows[0];
  await client.query("insert into restaurant_guests (id, branch_id, name) values ('72727272-7272-4272-8272-727272727272', 'khobar', 'Cash Check')");
  await client.query(
    `insert into restaurant_reservations (id, branch_id, guest_id, party_size, status, table_id, revision)
     values ('82828282-8282-4282-8282-828282828282', 'khobar', '72727272-7272-4272-8272-727272727272', 2, 'seated', $1, 0)`,
    [table.id],
  );
  await client.query(
    `insert into restaurant_sessions (id, branch_id, reservation_id, table_id, status)
     values ('session-cash-check', 'khobar', '82828282-8282-4282-8282-828282828282', $1, 'open')`,
    [table.id],
  );
  await client.query("insert into restaurant_orders (id, session_id, branch_id, status) values ('order-cash-check', 'session-cash-check', 'khobar', 'open')");
  await client.query("select set_config('request.jwt.claim.email', 'cash.waiter.khobar@nac.test', true)");
  await client.query("select restaurant_open_bill('bill:cash-check', 'session-cash-check')");
  const item = (await client.query(
    `select id, line_minor from restaurant_submit_priced_item(
      'order-cash-check', 'cash-item', '2 Eggs Any Style', 2, 'No salt', null, 'cash-eggs',
      3100, $1::jsonb, 5000, 10000, 'SAR', null, null)`,
    [JSON.stringify([{ id: "fried", name: "Fried", unitMinor: 0 }, { id: "bacon", name: "Beef Bacon", unitMinor: 1900 }])],
  )).rows[0];
  await client.query("select set_config('request.jwt.claim.email', 'cash.manager.khobar@nac.test', true)");
  await client.query(
    "select restaurant_record_adjustment('bill:cash-check', 'discount', null, 'amount', 1000, null, 'Authorized test discount', 'discount-1', null)",
  );
  const due = (await client.query("select restaurant_bill_gross('bill:cash-check') as minor")).rows[0].minor;
  if (due !== 9000 || item.line_minor !== 10000) throw new Error("discount changed the stored item price");
  await client.query("select set_config('request.jwt.claim.email', 'cash.cashier.khobar@nac.test', true)");
  await client.query("select restaurant_record_simulated_payment('bill:cash-check', 'cash', 4000, 'pay-1')");
  const repeat = (await client.query("select count(*)::int as rows from restaurant_payments where bill_id = 'bill:cash-check'")).rows[0].rows;
  await client.query("select restaurant_record_simulated_payment('bill:cash-check', 'cash', 4000, 'pay-1')");
  const afterRepeat = (await client.query("select count(*)::int as rows from restaurant_payments where bill_id = 'bill:cash-check'")).rows[0].rows;
  if (repeat !== 1 || afterRepeat !== 1) throw new Error("repeated payment was duplicated");
  let overpaid = false;
  await client.query("savepoint overpay");
  try {
    await client.query("select restaurant_record_simulated_payment('bill:cash-check', 'card', 6000, 'pay-over')");
  } catch (error) {
    overpaid = /overpayment/.test(error.message);
    await client.query("rollback to savepoint overpay");
  }
  if (!overpaid) throw new Error("overpayment was accepted");
  await client.query("select restaurant_record_simulated_payment('bill:cash-check', 'card', 5000, 'pay-2')");
  const settled = (await client.query("select gross_minor, vat_minor, taxable_minor, tax_treatment from restaurant_finalize_simulated_bill('bill:cash-check')")).rows[0];
  if (settled.gross_minor !== 9000 || settled.vat_minor !== 1174 || settled.taxable_minor !== 7826 || settled.tax_treatment !== "inclusive") {
    throw new Error(`tax snapshot mismatch ${JSON.stringify(settled)}`);
  }
  await client.query("select restaurant_open_shift('khobar', 20000)");
  const shift = (await client.query("select id from restaurant_shifts where branch_id = 'khobar' and status = 'open'")).rows[0];
  const closed = (await client.query(
    "select expected_cash_minor, counted_cash_minor, variance_minor from restaurant_close_shift($1, 23000, 'Counted in the isolated test')",
    [shift.id],
  )).rows[0];
  if (closed.expected_cash_minor !== 24000 || closed.variance_minor !== -1000) throw new Error("cash variance was discarded");
  const legacyAfter = (await client.query(
    "select count(line_minor)::int as priced from restaurant_order_items where item_name = '2 Eggs Any Style' and quantity = 2 and order_id <> 'order-cash-check'",
  )).rows[0].priced;
  if (legacyAfter !== 0) throw new Error("historical order price changed");
  console.log(JSON.stringify({ due, vat: settled.vat_minor, taxable: settled.taxable_minor, variance: closed.variance_minor, payments: afterRepeat }));
} finally {
  await client.query("rollback");
  await client.end();
}

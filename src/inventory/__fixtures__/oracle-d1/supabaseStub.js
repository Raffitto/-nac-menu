/**
 * In-memory Supabase client stub for the Oracle D1 acceptance tests.
 * SYNTHETIC ONLY. It never touches the network.
 *
 * - Chainable read API: from/select/eq/neq/gte/lte/gt/lt/in/is/ilike/or/order/range/limit.
 * - `tables[name]` holds rows that are filtered and sorted like PostgREST.
 * - `pages[name]({ call, from, to, filters })` returns programmed pages instead.
 * - `maxRows[name]` caps every response (simulates PostgREST max_rows).
 * - `errors[name]` makes every read of that table fail.
 * - Every method call is recorded in `calls`. Writes and rpc are recorded and
 *   refused; `writeCalls()` lists them (T28).
 */

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

function likeToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function parseOr(expression) {
  return String(expression).split(",").map((part) => {
    const [column, op, ...rest] = part.split(".");
    return { column, op, value: rest.join(".") };
  });
}

function matchOrClause(row, clause) {
  const value = row[clause.column];
  if (clause.op === "is" && clause.value === "null") return value == null;
  if (clause.op === "eq") return String(value) === clause.value;
  return false;
}

function applyFilters(rows, filters) {
  return rows.filter((row) => filters.every((filter) => {
    const value = row[filter.column];
    switch (filter.op) {
      case "eq": return value === filter.value || String(value) === String(filter.value);
      case "neq": return String(value) !== String(filter.value);
      case "gte": return value != null && String(value) >= String(filter.value);
      case "lte": return value != null && String(value) <= String(filter.value);
      case "gt": return value != null && String(value) > String(filter.value);
      case "lt": return value != null && String(value) < String(filter.value);
      case "in": return filter.value.map(String).includes(String(value));
      case "is": return filter.value === null ? value == null : value === filter.value;
      case "ilike": return value != null && likeToRegExp(filter.value).test(String(value));
      case "or": return parseOr(filter.value).some((clause) => matchOrClause(row, clause));
      default: return true;
    }
  }));
}

function applyOrder(rows, orders) {
  if (!orders.length) return rows;
  return [...rows].sort((left, right) => {
    for (const { column, ascending } of orders) {
      const a = left[column];
      const b = right[column];
      if (a === b) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const cmp = String(a) < String(b) ? -1 : 1;
      return ascending ? cmp : -cmp;
    }
    return 0;
  });
}

export function createSupabaseStub({ tables = {}, pages = {}, errors = {}, maxRows = {} } = {}) {
  const calls = [];
  const readCounts = {};

  function builder(table) {
    const state = { table, filters: [], orders: [], range: null, limit: null, write: null };
    const record = (method, args) => calls.push({ table, method, args });
    const api = {};
    const chain = (method, fn) => {
      api[method] = (...args) => {
        record(method, args);
        if (fn) fn(...args);
        return api;
      };
    };
    chain("select");
    for (const op of ["eq", "neq", "gte", "lte", "gt", "lt", "is", "ilike"]) {
      chain(op, (column, value) => state.filters.push({ op, column, value }));
    }
    // Accepted but not evaluated (recorded only).
    for (const op of ["not", "contains", "containedBy", "match", "filter", "textSearch", "abortSignal", "returns", "csv"]) chain(op);
    chain("in", (column, value) => state.filters.push({ op: "in", column, value: [...value] }));
    chain("or", (value) => state.filters.push({ op: "or", value }));
    chain("order", (column, options = {}) => state.orders.push({ column, ascending: options.ascending !== false }));
    chain("range", (from, to) => { state.range = { from, to }; });
    chain("limit", (count) => { state.limit = count; });
    for (const method of WRITE_METHODS) {
      api[method] = (...args) => {
        record(method, args);
        state.write = method;
        return api;
      };
    }
    api.maybeSingle = () => { record("maybeSingle", []); return api.then((res) => ({ ...res, data: res.data?.[0] || null })); };
    api.single = () => { record("single", []); return api.then((res) => ({ ...res, data: res.data?.[0] || null })); };
    api.then = (resolve, reject) => Promise.resolve(execute(state)).then(resolve, reject);
    return api;
  }

  function execute(state) {
    if (state.write) {
      return { data: null, error: { message: `oracle-d1 stub refuses ${state.write} on ${state.table}` } };
    }
    if (errors[state.table]) return { data: null, error: errors[state.table] };
    readCounts[state.table] = (readCounts[state.table] || 0) + 1;
    let data;
    if (typeof pages[state.table] === "function") {
      data = pages[state.table]({
        call: readCounts[state.table] - 1,
        from: state.range?.from ?? 0,
        to: state.range?.to ?? null,
        filters: state.filters,
        orders: state.orders,
      }) || [];
    } else {
      const rows = applyOrder(applyFilters(tables[state.table] || [], state.filters), state.orders);
      const from = state.range?.from ?? 0;
      const to = state.range ? state.range.to + 1 : rows.length;
      data = rows.slice(from, to);
    }
    if (state.limit != null) data = data.slice(0, state.limit);
    if (maxRows[state.table] != null) data = data.slice(0, maxRows[state.table]);
    return { data, error: null };
  }

  return {
    calls,
    from(table) {
      calls.push({ table, method: "from", args: [table] });
      return builder(table);
    },
    rpc(name, args) {
      calls.push({ table: null, method: "rpc", args: [name, args] });
      return Promise.resolve({ data: null, error: { message: "oracle-d1 stub refuses rpc" } });
    },
    writeCalls() {
      return calls.filter((call) => WRITE_METHODS.has(call.method) || call.method === "rpc");
    },
    readsOf(table, method) {
      return calls.filter((call) => call.table === table && (!method || call.method === method));
    },
  };
}

/** Every stub created in this module instance (one per Jest test file). */
const created = [];
export function trackedStub(options) {
  const stub = createSupabaseStub(options);
  created.push(stub);
  return stub;
}
export function allTrackedWriteCalls() {
  return created.flatMap((stub) => stub.writeCalls());
}
export function trackedStubCount() {
  return created.length;
}

// Offline stand-in for https://esm.sh/@supabase/supabase-js@2.49.1.
// Service-role client: unrestricted. User client: identity from the bearer token (state.users),
// minimal RLS emulation for ask_nac_drive_sync_folders (connection ownership, as in production policy).
import { type Row, state, table } from "./state.ts";
import { SQL_HELPERS } from "./sqlHelpers.ts";

export type SupabaseClient = any;

type Ctx = { service: boolean; email: string | null };

function ownsConnection(email: string | null, connectionId: unknown) {
  return Boolean(email) && table("ask_nac_drive_connections").some((c) => c.id === connectionId && String(c.user_email).toLowerCase() === email);
}
function rlsVisible(ctx: Ctx, name: string, row: Row) {
  if (ctx.service) return true;
  if (name === "ask_nac_drive_sync_folders") return ownsConnection(ctx.email, row.connection_id);
  return true;
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private op: "select" | "update" | "insert" | "upsert" = "select";
  private payload: Row | null = null;
  private onConflict: string[] = [];
  constructor(private ctx: Ctx, private name: string) {}
  select(_cols?: string) { return this; }
  order() { return this; }
  limit() { return this; }
  eq(col: string, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  neq(col: string, v: unknown) { this.filters.push((r) => r[col] !== v); return this; }
  lt(col: string, v: any) { this.filters.push((r) => r[col] != null && r[col] < v); return this; }
  lte(col: string, v: any) { this.filters.push((r) => r[col] != null && r[col] <= v); return this; }
  gt(col: string, v: any) { this.filters.push((r) => r[col] != null && r[col] > v); return this; }
  gte(col: string, v: any) { this.filters.push((r) => r[col] != null && r[col] >= v); return this; }
  is(col: string, v: unknown) { this.filters.push((r) => (v === null ? r[col] == null : r[col] === v)); return this; }
  match(obj: Record<string, unknown>) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  range() { return this; }
  ilike() { return this; }
  contains() { return this; }
  filter() { return this; }
  in(col: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[col])); return this; }
  not(col: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filters.push((r) => r[col] != null);
    return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map((p) => p.split("."));
    this.filters.push((r) => parts.some(([c, o, v]) =>
      (o === "is" && v === "null" && r[c] == null) || (o === "eq" && String(r[c]) === v)));
    return this;
  }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  insert(row: Row) { this.op = "insert"; this.payload = row; return this; }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = "upsert"; this.payload = row;
    this.onConflict = String(opts?.onConflict || "id").split(",").map((s) => s.trim());
    return this;
  }
  private run(): { data: any; error: any } {
    if (!this.ctx.service && this.ctx.email && state.rpcErrors.has(this.ctx.email)) {
      return { data: null, error: { message: "stub: read failure" } };
    }
    if (this.ctx.service && state.failTables.has(this.name)) {
      return { data: null, error: { message: "stub: service read failure" } };
    }
    const rows = table(this.name);
    const client = this.ctx.service ? "service" : "user";
    if (this.op === "insert" || this.op === "upsert") {
      const row = { ...this.payload! };
      if (!rlsVisible(this.ctx, this.name, row)) return { data: null, error: { message: "new row violates row-level security policy" } };
      const existing = this.op === "upsert"
        ? rows.find((r) => this.onConflict.every((k) => r[k] === row[k]))
        : undefined;
      let out: Row;
      if (existing) { Object.assign(existing, row); out = existing; }
      else { out = { id: row.id ?? `${this.name}-${++state.seq}`, ...row }; rows.push(out); }
      state.writes.push({ table: this.name, op: this.op, client, row: { ...out } });
      return { data: [out], error: null };
    }
    const matched = rows.filter((r) => rlsVisible(this.ctx, this.name, r) && this.filters.every((f) => f(r)));
    if (this.op === "update") {
      for (const r of matched) Object.assign(r, this.payload);
      for (const r of matched) state.writes.push({ table: this.name, op: "update", client, row: { ...r } });
      return { data: matched, error: null };
    }
    return { data: matched, error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); }
  single() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: "no rows" }) }); }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
}

export function createClient(_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) {
  const service = key === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = String(opts?.global?.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const email = service ? null : (state.users[bearer] ?? null);
  const ctx: Ctx = { service, email };
  return {
    from: (name: string) => new Query(ctx, name),
    rpc: (fn: string, args: Row = {}) => {
      state.rpcCalls.push({ email, fn, args });
      // Explicit per-user override first (used for fail-closed tests), else emulate the SQL helper
      // from the fake tables. Unknown functions / no session => error.
      const perm = email ? state.perms[email]?.[fn] : undefined;
      if (perm !== undefined) return Promise.resolve({ data: typeof perm === "function" ? perm(args) : perm, error: null });
      if (email && state.rpcErrors.has(email)) return Promise.resolve({ data: null, error: { message: "stub: rpc failure" } });
      const helper = SQL_HELPERS[fn];
      if (!email || !helper) return Promise.resolve({ data: null, error: { message: `stub: rpc ${fn} not available` } });
      return Promise.resolve({ data: helper(email, args), error: null });
    },
    storage: { from: () => new Query(ctx, "__storage") },
    auth: {
      getUser: () => Promise.resolve(email
        ? { data: { user: { email } }, error: null }
        : { data: { user: null }, error: { message: "invalid JWT" } }),
    },
  };
}

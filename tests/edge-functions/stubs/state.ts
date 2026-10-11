// Shared in-memory state for the offline Supabase / Drive / Google stubs. No network is used.
export type Row = Record<string, any>;
export type RpcPerms = Record<string, boolean | ((args: Row) => boolean)>;
export const state = {
  tables: {} as Record<string, Row[]>,
  /** bearer access token -> user email (what auth.getUser() returns) */
  users: {} as Record<string, string>,
  /** user email -> rpc name -> result (unknown rpc => error, i.e. fail-closed) */
  perms: {} as Record<string, RpcPerms>,
  rpcCalls: [] as Array<{ email: string | null; fn: string; args: Row }>,
  writes: [] as Array<{ table: string; op: string; client: "service" | "user"; row: Row }>,
  createdRuns: [] as Array<{ runId: string; folderId: string; branchId: string | null; triggerType: string }>,
  processedRuns: [] as Array<{ runId: string; folderId: string; email: string }>,
  reviewTrackingIngests: [] as Array<{ triggerType: unknown }>,
  reviewTrackingResolves: [] as Array<{ connectionId: unknown; branchId: unknown }>,
  seq: 0,
};
export function resetState() {
  state.tables = {};
  state.users = {};
  state.perms = {};
  state.rpcCalls = [];
  state.writes = [];
  state.createdRuns = [];
  state.processedRuns = [];
  state.reviewTrackingIngests = [];
  state.reviewTrackingResolves = [];
  state.seq = 0;
}
export function table(name: string): Row[] {
  return (state.tables[name] ??= []);
}

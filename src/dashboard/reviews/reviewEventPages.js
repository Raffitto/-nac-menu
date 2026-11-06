/** Complete, bounded-page review event read for custom export periods. */
export async function fetchAllReviewEvents(supabase, { select, range, branch = null, pageSize = 500 }) {
  if (!range?.sinceIso || !range?.untilIso) {
    throw new Error("A bounded review export period is required.");
  }
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("review_events")
      .select(select)
      .gte("created_at", range.sinceIso)
      .lte("created_at", range.untilIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (branch) query = query.eq("branch_id", branch);
    query = query.range(offset, offset + pageSize - 1);
    const { data, error } = await query;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Review export page is unavailable.");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

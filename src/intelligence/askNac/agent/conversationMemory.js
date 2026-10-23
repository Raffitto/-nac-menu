import { boundConversationContext } from "./agentPolicy";

const TABLE = "ask_nac_conversation_memory";

export async function loadConversationMemory(supabase, userId, branchKey = "") {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("context, updated_at")
    .eq("user_id", userId)
    .eq("branch_key", branchKey || "")
    .maybeSingle();
  if (error || !data?.context) return null;
  const updated = new Date(data.updated_at || 0).getTime();
  if (!Number.isFinite(updated) || Date.now() - updated > 30 * 24 * 60 * 60 * 1000) return null;
  return boundConversationContext(data.context);
}

export async function saveConversationMemory(supabase, userId, branchKey, context) {
  if (!supabase || !userId || !context) return;
  const bounded = boundConversationContext(context);
  const { error } = await supabase.from(TABLE).upsert({
    user_id: userId,
    branch_key: branchKey || "",
    context: bounded,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,branch_key" });
  if (error) return;
}

export async function clearConversationMemory(supabase, userId, branchKey = "") {
  if (!supabase || !userId) return;
  await supabase.from(TABLE).delete().eq("user_id", userId).eq("branch_key", branchKey || "");
}

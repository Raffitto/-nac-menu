/** Verify a Supabase access token. The anon key identifies the project. It is not a database password. */

let verifier = null;

export function setSupabaseUserVerifier(next) {
  verifier = next;
}

export async function verifySupabaseAccessToken(token, fetchImpl = fetch) {
  if (!token || String(token).split(".").length < 3) return null;
  if (verifier) return verifier(token);
  const url = process.env.SUPABASE_URL || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) return null;
  const response = await fetchImpl(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email) return null;
  return { email, id: body.id || "" };
}

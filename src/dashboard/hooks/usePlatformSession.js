import { useEffect, useState } from "react";
import { readPersistedAuthSession, subscribePlatformSession } from "../../lib/platformAuth";

/**
 * Shared Supabase session bootstrap for NAC OS surfaces.
 */
export function usePlatformSession() {
  const persisted = readPersistedAuthSession();
  const [session, setSession] = useState(persisted);
  const [checked, setChecked] = useState(Boolean(persisted));
  const [issue, setIssue] = useState(null);

  useEffect(() => {
    return subscribePlatformSession(({ session: s, checked: c, issue: i }) => {
      setSession(s);
      setChecked(c);
      setIssue(i ?? null);
    });
  }, []);

  return { session, checked, issue };
}

import { useEffect, useState } from "react";
import { subscribePlatformSession } from "../../lib/platformAuth";

/**
 * Shared Supabase session bootstrap for NAC OS surfaces.
 */
export function usePlatformSession() {
  const [session, setSession] = useState(null);
  const [checked, setChecked] = useState(false);
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

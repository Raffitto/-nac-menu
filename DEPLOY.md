# Netlify deploy — printed QR URLs must keep working

## Printed card URL (do not change)

Example that **must** keep working forever:

```
https://nac-khobar-reviews.netlify.app/?store=NAC%20Khobar&s=Boy%20Boy&role=receptionist
```

Expected `review_events` on scan:

- `qr_scan`, `review_page_open`
- `branch_id` = `khobar`
- `employee_name` = `Boy Boy`
- `employee_role` = `receptionist`

## Option A (implemented): same URL, same host

`*-reviews.netlify.app` (including `nac-khobar-reviews`) **does not redirect**. It serves this React app in place so the printed URL stays valid.

## Option B (branch menu sites only)

`nacriyadh.netlify.app` / `nac-jeddah.netlify.app` with `s=` + `role` + `store` redirect to:

`https://nacmenu.netlify.app/?app=review&…` (all query params preserved).

---

## One-time fix: link `nac-khobar-reviews` to this repo

If the site still shows the old static “NAC Khobar Review” page, **no code push will help** until Netlify serves this build.

1. Netlify → **nac-khobar-reviews** → **Build & deploy** → **Link repository** → `Raffitto/-nac-menu`
2. **Branch:** `main` · **Publish:** `build` · use **`netlify.toml`**
3. **Environment variables** (copy from nacmenu):
   - `REACT_APP_SUPABASE_URL`
   - `REACT_APP_SUPABASE_ANON_KEY`
   - `REACT_APP_NAC_BRANCH_ID` = `khobar` (optional)
4. **Deploys** → **Clear cache and deploy site**

### Success check

Open the printed URL → View Source must include:

- `NAC HTML SHELL LOADED`
- `NAC PRINTED QR HOST`
- `review-routing.js?v=…`

Console must show:

- `ROUTING MODE review … (printed QR host — in place)`
- `REVIEW EVENT PAYLOAD` with `employee_name: "Boy Boy"`

---

## All sites (same repo, same `main`)

| Site | Printed QR? | Behavior |
|------|-------------|----------|
| nacmenu.netlify.app | Optional `?app=review` | Menu + ReviewPortal |
| nac-khobar-reviews.netlify.app | **Yes** | ReviewPortal in place |
| nacriyadh.netlify.app | Staff params | Redirect → nacmenu review |
| nac-jeddah.netlify.app | Staff params | Redirect → nacmenu review |

Run `supabase/review_events_rls_fix.sql` once in Supabase.

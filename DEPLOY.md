# Netlify deploy — all sites must use this repo

Every NAC site should be a **separate Netlify site** pointing at the **same GitHub repo**:

| Site | Branch | Build command | Publish |
|------|--------|---------------|---------|
| nacmenu.netlify.app | `main` | `npm run build` | `build` |
| nac-khobar-reviews.netlify.app | `main` | `npm run build` | `build` |
| nacriyadh.netlify.app | `main` | `npm run build` | `build` |
| nac-jeddah.netlify.app | `main` | `npm run build` | `build` |

`netlify.toml` in the repo root applies when **“Use config file settings”** is enabled.

## Verify deploy after push

1. Netlify → each site → **Deploys** → latest deploy commit matches `git log -1` on `main`.
2. Open site → View deploy log → confirm `REACT_APP_BUILD_ID` / `[generate-build-id]` in build output.
3. Hard refresh review QR URL → browser console **must** show (in order):
   - `NAC HTML SHELL LOADED`
   - `NAC REVIEW ROUTING LOADED`
   - `NAC INDEX BOOT`
   - `REVIEW ANALYTICS MODULE LOADED`

If none appear, the site is **not** serving this build (wrong repo, branch, or cached old deploy).

## Env vars (set on every site)

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_NAC_BRANCH_ID` (optional: `khobar` | `riyadh` | `jeddah`)

Use the **same Supabase project** as the admin dashboard.

## Trigger redeploy

Netlify → Deploys → **Trigger deploy** → **Clear cache and deploy site**.

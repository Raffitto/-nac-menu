# NAC OS Internal Deployment (nacos)

Deploy the **same GitHub repo** as a separate Netlify site for managers and staff. Public guest menu behavior on `nacmenu.netlify.app` stays unchanged.

## Platform mode

| Variable | Value | Site behavior |
|----------|-------|---------------|
| `REACT_APP_PLATFORM_MODE` | *(missing)* | **Public** — current nacmenu guest menu (default) |
| `REACT_APP_PLATFORM_MODE` | `public` | **Public** — guest menu at `/` |
| `REACT_APP_PLATFORM_MODE` | `admin` | **Admin** — NAC OS dashboard at `/` |

**Safety rule:** If the variable is missing, empty, or any value other than `admin`, the app runs in **public** mode. Admin behavior never activates unless you explicitly set `REACT_APP_PLATFORM_MODE=admin` on a Netlify site.

## What each mode does

### Public (nacmenu.netlify.app)

- Root `/` → guest QR menu (unchanged)
- Review QR URLs → ReviewPortal (unchanged)
- Analytics tracking → unchanged
- Admin entry via logo-area password on public menu (unchanged)
- `/reset-password` → password recovery page

### Admin (nacos.netlify.app)

- Root `/` → NAC OS / AdminDashboard directly (no guest menu homepage)
- Supabase Auth + RBAC unchanged
- Forgot password + `/reset-password` unchanged
- Review QR params still route to ReviewPortal if present (edge case)

## Netlify setup — new nacos site

1. **Netlify → Add new site → Import an existing project**
2. Connect the same GitHub repo as nacmenu (`-nac-menu` / `nac-menu`)
3. **Site name:** `nacos` (URL: `https://nacos.netlify.app`)
4. **Branch:** `main`
5. **Build command:** `npm run build`
6. **Publish directory:** `build`
7. **Environment variables:** Copy all vars from the nacmenu site, then add:

   ```
   REACT_APP_PLATFORM_MODE=admin
   ```

8. **Supabase redirect URLs** — add if not already present:

   ```
   https://nacos.netlify.app/reset-password
   ```

9. Deploy.

## Netlify setup — existing nacmenu site (no change required)

Leave `REACT_APP_PLATFORM_MODE` **unset** or set explicitly:

```
REACT_APP_PLATFORM_MODE=public
```

Both behave identically. Production nacmenu behavior is preserved.

## Shared build config

`netlify.toml` in the repo applies to both sites:

- Build: `npm run build`
- Publish: `build`
- SPA fallback: `/* → /index.html` (200)

No separate codebase or build pipeline.

## Rollback

If nacos causes issues:

1. **Disable or delete** the nacos Netlify site only
2. **nacmenu.netlify.app is unaffected** — it does not use `REACT_APP_PLATFORM_MODE=admin`
3. Remove `https://nacos.netlify.app/reset-password` from Supabase redirect URLs if desired

## Local verification

```bash
# Public mode (default) — guest menu
npm start

# Admin mode — NAC OS at root
REACT_APP_PLATFORM_MODE=admin npm start
```

Also verify:

- `http://localhost:3000/reset-password` works in both modes
- Review QR: `http://localhost:3000/?s=Test&role=waiter&store=Khobar` loads ReviewPortal
- RBAC after Supabase sign-in on admin mode site

## Tests

```bash
npm test -- --watchAll=false --testPathPattern=platformMode
```

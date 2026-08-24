# 13:30 Handover Meeting — Run Sheet

A run sheet for the daily 13:30 handover meeting, served behind a password gate via a Cloudflare Worker, with multi-device sync handled by Cloudflare KV — no third-party service and no secret that ever reaches the browser.

## What changed from the old version

The old version was a single static `index.html` you could drag onto Netlify or Cloudflare Pages, with no password and a sync key visible to anyone who viewed page source. This version fixes both, matching the pattern already in use on the Daily Packaging Handover and Logistics Daily Handover sites (with one refinement — see below):

- **Every route is password-gated** by a Cloudflare Worker, via a signed, HttpOnly session cookie — checked before anything is served, including the static files themselves.
- **Multi-device sync is new** (this site didn't have it before). It's handled at `/api/sync`, which reads/writes a single key in a **Cloudflare KV namespace** bound directly to the Worker. This started out proxying to JSONBin.io the same way the sibling sites do, but moved to native Cloudflare KV instead after hitting JSONBin's free-tier bin-creation limit — KV needed no external account, no API key to manage, and is native to the same platform this is already deployed on.
- There's no more per-room link (`#room=xxxxx`) — everyone who signs in shares the one run sheet, the same way the sibling sites work.

## Repo structure

```
wrangler.jsonc       — Worker config (points at src/worker.js, public/, and the KV namespace)
package.json         — just the wrangler dev dependency
src/worker.js        — the entire server: auth gate + /api/sync (KV-backed) + static file fallback
public/               — the actual site (index.html, manifest.json, icons)
```

## One-time setup

### 1. Create a KV namespace

1. In the Cloudflare dashboard: **Workers & Pages → KV → Create a namespace**.
2. Name it anything (e.g. `handover-runsheet-kv`) — this is cosmetic.
3. Copy its **Namespace ID** once created.
4. Open `wrangler.jsonc` in this repo and paste that ID in as the `id` under `kv_namespaces` (replacing `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`).

### 2. Push this repo to GitHub

Create a new GitHub repo and push these files to it (a private repo is recommended, though nothing sensitive lives in the code itself since secrets are set separately in Cloudflare).

### 3. Connect it to Cloudflare via Workers Builds (Git integration)

Drag-and-drop won't work here since a Worker script has to actually run — this needs the Git-connected deploy path:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Workers Builds** (or **Connect to Git** if prompted from the Workers overview).
2. Pick the GitHub repo you just created.
3. Build settings: no build command needed — Wrangler picks up `wrangler.jsonc` automatically (including the KV binding). Leave the root directory as `/`.
4. Deploy. The first deploy will fail health checks until secrets are set (next step) — that's expected.

### 4. Set the two secrets

In the Worker's **Settings → Variables and Secrets**, add these two as type **Secret** (not Text):

| Name | Value |
|---|---|
| `SITE_PASSWORD` | The shared password your team will type in to get past the login screen |
| `SESSION_SECRET` | A long random string (e.g. generate one with `openssl rand -base64 32`) — used to sign session cookies. Don't reuse this across the sibling sites. |

After saving secrets, redeploy (or it may auto-redeploy) and the site should come up behind the login screen.

## Local development

```
npm install
cp .dev.vars.example .dev.vars   # then fill in real values
npm run dev
```

`.dev.vars` holds secrets for local `wrangler dev` only — it's gitignored, never commit it. Wrangler loads it automatically. Local dev uses a simulated local KV store by default (separate from the real deployed one), so it's safe to experiment with.

## Using it day to day

- **Sign in**: everyone uses the same `SITE_PASSWORD`. The session lasts 7 days per browser before it asks again.
- **Log out**: button in the top-right of the run sheet.
- **New meeting**: clears all fields (the date resets to today automatically) — everyone signed in shares this same sheet, so this affects what everyone else sees too.
- **Copy for email**: copies a formatted summary of the whole sheet to the clipboard (as both rich text and plain text) — open a new email, paste, and it drops in styled like the page itself. Only sections with something actually filled in are included.
- **Download PDF**: opens the browser's print dialog with a clean, full-content printable version of the sheet pre-loaded — choose "Save as PDF" as the destination.
- **Prioritized tasks**: a checklist — tick the box and add a short description for whichever apply.
- **Attendance**: the staff list is pre-loaded and greyed out by default. Click a name to mark them present (it turns green); click again to undo. Use "+ Add" for anyone not on the list.

## Home screen / shortcut icon

Bookmarking the site or using "Add to Home Screen" (iOS or Android) shows the smiley logo as the icon, labeled "Handover." This relies on `manifest.json` and `icon-192.png` / `icon-512.png` in `public/` alongside `index.html`.

## If something's not syncing

- Check the Worker's logs in the Cloudflare dashboard (Observability is enabled in `wrangler.jsonc`) — an error on `/api/sync` most likely means the `RUNSHEET_KV` binding in `wrangler.jsonc` still has the placeholder ID rather than your real namespace's ID (or the binding name doesn't match what `worker.js` expects: `RUNSHEET_KV`).
- The site still falls back to saving locally on that device if `/api/sync` is unreachable, so nobody loses their in-progress edits even if sync is temporarily down.
- The status pill in the header (top-right) shows "Live — synced" vs "Offline — saved on this device" in real time — check that first before digging into logs.

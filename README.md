# 13:30 Handover Meeting — Run Sheet

A run sheet for the daily 13:30 handover meeting, now served behind a password gate via a Cloudflare Worker, with multi-device sync proxied server-side through JSONBin.io so no secret ever reaches the browser.

## What changed from the old version

The old version was a single static `index.html` you could drag onto Netlify or Cloudflare Pages, with no password and a sync key visible to anyone who viewed page source. This version fixes both, matching the pattern already in use on the Daily Packaging Handover and Logistics Daily Handover sites:

- **Every route is password-gated** by a Cloudflare Worker, via a signed, HttpOnly session cookie — checked before anything is served, including the static files themselves.
- **Multi-device sync is new** (this site didn't have it before). It's proxied through a `/api/sync` endpoint the Worker handles server-side; the real JSONBin Bin ID and API key live only as Worker secrets, never in client-side code.
- There's no more per-room link (`#room=xxxxx`) — everyone who signs in shares the one run sheet, the same way the sibling sites work.

## Repo structure

```
wrangler.jsonc       — Worker config (points at src/worker.js and public/)
package.json         — just the wrangler dev dependency
src/worker.js        — the entire server: auth gate + /api/sync proxy + static file fallback
public/               — the actual site (index.html, manifest.json, icons)
```

## One-time setup

### 1. Create a JSONBin.io bin

1. Sign up at [jsonbin.io](https://jsonbin.io) (free tier is plenty for this).
2. Get your **Master Key** (X-Master-Key) from the API Keys page.
3. Create a new bin with an empty JSON object as its content, e.g. `{}`. Copy its **Bin ID** from the URL or dashboard.

### 2. Push this repo to GitHub

Create a new GitHub repo and push these files to it (a private repo is recommended, though nothing sensitive lives in the code itself since secrets are set separately in Cloudflare).

### 3. Connect it to Cloudflare via Workers Builds (Git integration)

Drag-and-drop won't work here since a Worker script has to actually run — this needs the Git-connected deploy path:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Workers Builds** (or **Connect to Git** if prompted from the Workers overview).
2. Pick the GitHub repo you just created.
3. Build settings: no build command needed — Wrangler picks up `wrangler.jsonc` automatically. Leave the root directory as `/`.
4. Deploy. The first deploy will fail health checks until secrets are set (next step) — that's expected.

### 4. Set the four secrets

In the Worker's **Settings → Variables and Secrets**, add these four as type **Secret** (not Text):

| Name | Value |
|---|---|
| `SITE_PASSWORD` | The shared password your team will type in to get past the login screen |
| `SESSION_SECRET` | A long random string (e.g. generate one with `openssl rand -base64 32`) — used to sign session cookies. Don't reuse this across the sibling sites. |
| `JSONBIN_BIN_ID` | The Bin ID from step 1 |
| `JSONBIN_API_KEY` | The X-Master-Key from step 1 |

After saving secrets, redeploy (or it may auto-redeploy) and the site should come up behind the login screen.

## Local development

```
npm install
cp .dev.vars.example .dev.vars   # then fill in real values
npm run dev
```

`.dev.vars` holds secrets for local `wrangler dev` only — it's gitignored, never commit it. Wrangler loads it automatically.

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

- Check the Worker's logs in the Cloudflare dashboard (Observability is enabled in `wrangler.jsonc`) — a 502 from `/api/sync` usually means the JSONBin Bin ID or API key secret is wrong.
- The site still falls back to saving locally on that device if `/api/sync` is unreachable, so nobody loses their in-progress edits even if sync is temporarily down.

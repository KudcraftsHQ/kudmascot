# kudmascot

A personal Android icon pack in the Kudcrafts mascot style. Each app's signature object becomes a chunky
cream (#FEF8E8) character with a small, low face, on a dusty version of the brand colour. It works in Nova
Launcher and any launcher that reads the standard ADW/Nova icon-pack format (Lawnchair, Apex, ADW, GO,
Action, Smart, Hyperion…).

Icons ship as **adaptive icons**. Each drawable is an `<adaptive-icon>` whose background layer is the full-bleed
square art, inset 16.667% so the whole square fills the 72 dp viewport. The launcher then masks it to whatever
icon shape you pick (circle, squircle, square, teardrop). There is no baked-in frame or circle.

It also has a pipeline: **request → draft → approve → publish**.

```
phone (kudmascot app)            hammas-dev (kudmascot.service)                 GitHub
─────────────────────            ──────────────────────────────                 ──────
lists launcher activities ──POST /api/requests──▶ sqlite queue
"Request all missing"                             worker: 2 variants per app
                                                  via gpt-image-2 bridge
                                                  → style/mute.py (mute, square)
                                 review page  ◀── you approve / note+regenerate / skip
                                 "Publish N"  ──▶ ~/.local/share/kudmascot/repo
                                                  writes icons/*.png + catalog.json,
                                                  commit, push main ──────────▶ release.yml
                                                                                 gen-resources.py
                                                                                 signed APK
Obtainium ◀───────────────────────────────────────────────────────────────── GitHub Release
```

## Layout

| Path | What |
|---|---|
| `style/prompt.md` | The master prompt and its per-app slots. The single source of truth; the worker re-reads it on every job |
| `style/mute.py` | The deterministic post-process: `Color.enhance(0.62)`, blend 8% `#F4ECDC`, crop to a 512 px full-bleed square |
| `style/refs/` | `family.png` (Hammas's four mascots), `family-clean.png` (the same four without frames or wallpaper; this is what gets sent to the model) |
| `icons/catalog.json`, `icons/*.png` | The published icons. Written only by the server's publish step |
| `scripts/gen-resources.py` | Catalog → `res/xml/appfilter.xml`, `drawable.xml`, `assets/`, `drawable-nodpi/<d>_art.png`, `drawable-anydpi-v26/<d>.xml`. CI runs it; the outputs are gitignored |
| `android/` | Kotlin + Compose app, `com.kudcrafts.kudmascot`, minSdk 26 |
| `server/` | Bun + Hono + bun:sqlite: phone API, review page, generation worker, publisher |
| `.github/workflows/release.yml` | Every push to main that touches `android/`, `icons/` or the generator builds a signed APK and publishes Release `v1.0.<run>` |

## Install and update with Obtainium

Releases are tagged `v1.0.<run number>` (versionCode = run number) with one asset, `kudmascot-v1.0.<n>.apk`, plus
`SHA256SUMS`. This is the same scheme as ntfy Kudcrafts.

1. In Obtainium, choose **Add app** and enter `https://github.com/KudcraftsHQ/kudmascot`.
2. The repo is public, so no GitHub token is needed — same as ntfy Kudcrafts.
3. Install. Then in Nova go to Settings → Look & feel → Icon style → Icon theme → **kudmascot**, or tap **Apply in Nova** in the app.
4. **After an update, re-apply the pack in Nova if icons don't refresh.**

In the app, open **Settings** and enter the server URL (default `https://hammas-dev.tailaf13a.ts.net:4488`, which needs
Tailscale on the phone) and the token from `~/.config/kudmascot/env`.

## The server

- Service: systemd **user** unit `~/.config/systemd/user/kudmascot.service` runs `bun server/src/index.ts`
  from this checkout on `127.0.0.1:4488`.
- HTTPS on the tailnet: `sudo tailscale serve --bg --https=4488 http://127.0.0.1:4488`, which gives
  **https://hammas-dev.tailaf13a.ts.net:4488**. The review page is at `/`, and it asks for the token once, then keeps a cookie.
- Data: `~/.local/share/kudmascot/` (`kudmascot.sqlite`, `originals/`, `drafts/`, and `repo/`, the server-owned
  checkout it publishes from, which is separate from this working copy).
- Logs: `~/.local/state/kudmascot/server.log` (events), `stdout.log`, `jobs/<drawable>-r<round>.log` (bridge output).

```bash
systemctl --user status kudmascot
systemctl --user restart kudmascot          # after editing server code (prompt.md edits need no restart)
tail -f ~/.local/state/kudmascot/server.log
```

API (bearer token): `POST /api/requests {requests:[{package,activity,label,icon(base64 png)}]}`,
`GET /api/status`, `GET /api/review`, `POST /api/apps/:drawable/{approve|regenerate|skip|restore}`,
`POST /api/publish`.

Requests dedupe by component (`pkg/activity`). Every activity of a package shares one drawable (`com.whatsapp` →
`com_whatsapp`). The worker makes 2 variants per request, one at a time (each bridge call uses ChatGPT quota).

## Secrets: where they live

| Secret | Where |
|---|---|
| Server bearer token | `~/.config/kudmascot/env` (`KUDMASCOT_TOKEN`). Never committed |
| Release keystore | `~/.config/kudmascot/kudmascot-release.p12` (PKCS12, alias `kudmascot`), password in `~/.config/kudmascot/signing.env` |
| CI copies | Repo secrets `KC_KEYSTORE_BASE64`, `KC_KEYSTORE_PASSWORD`, `KC_KEY_ALIAS`, `KC_KEY_PASSWORD` |

**Back up the keystore and its password somewhere other than hammas-dev.** If you lose it, every future APK is
signed with a different key, and Android refuses to update the installed app. You would then have to uninstall it
and reinstall, and pick the icon pack again in Nova.

# kudmascot

A personal Android icon pack, and a macOS menu-bar app, in the Kudcrafts mascot style. Each app's signature object becomes a chunky
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
| `style/macos.py` | The macOS shape: 1024 canvas, 824 px continuous-corner squircle body, soft drop shadow, transparent outside (ntfy-bar's Mac grid) |
| `macos/` | Swift menu-bar app "kudmascot" (SwiftPM, macOS 13+, Sparkle 2) that applies the icons to Mac apps |
| `.github/workflows/release.yml` | Every push to main that touches `android/`, `icons/` or the generator builds a signed APK and publishes Release `v1.0.<run>` |
| `.github/workflows/mac.yml` | Every push to main that touches `macos/` builds and tests the Mac app and publishes pre-release `mac-v1.0.<run>` (never "latest") |

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

API (bearer token): `POST /api/requests {requests:[{package,activity,label,icon(base64 png)}]}`
(Mac: `{platform:"mac", requests:[{bundleId,name,icon}]}`), `GET /api/status` (Android components only),
`GET /api/mac/icons` → `{icons:[{bundleId,drawable,version,url}]}` for every Mac app whose drawing is approved or
published (no APK publish needed), `GET /api/mac/icon/<drawable>.png` (stable URL, Mac-shaped 1024 px),
`GET /api/mac/status`, `POST /api/apps/:drawable/{merge|separate}`, `GET /api/review`, `POST /api/apps/:drawable/{queue|unqueue|approve|regenerate|skip|restore}`,
`POST /api/publish`.

Requests dedupe by component (`pkg/activity`). Every activity of a package shares one drawable (`com.whatsapp` →
`com_whatsapp`). Phone requests only land in the review page's **Inbox**; nothing is generated until you press **Generate** there (status `requested` → `queued`). Queued apps are drawn in batches: up to 9 per image call as one grid (`style/grid.py`), one draft each, starting 45 s after the last Generate tap. Regenerating with a note redraws that app alone with 2 variants (each bridge call uses ChatGPT quota).

## Secrets: where they live

| Secret | Where |
|---|---|
| Server bearer token | `~/.config/kudmascot/env` (`KUDMASCOT_TOKEN`). Never committed |
| Release keystore | `~/.config/kudmascot/kudmascot-release.p12` (PKCS12, alias `kudmascot`), password in `~/.config/kudmascot/signing.env` |
| CI copies | Repo secrets `KC_KEYSTORE_BASE64`, `KC_KEYSTORE_PASSWORD`, `KC_KEY_ALIAS`, `KC_KEY_PASSWORD` |
| Sparkle EdDSA key (Mac updates) | `~/.config/kudmascot/sparkle_ed25519_private.key` (base64 seed; public key in `macos/Resources/Info.plist` `SUPublicEDKey`), CI copy in repo secret `SPARKLE_ED_PRIVATE_KEY` |
| Mac app token | On the Mac, `~/Library/Application Support/kudmascot/token` (0600). A file rather than the Keychain, so ad-hoc-signed updates don't ask for Keychain access again |

**Back up the keystore and its password somewhere other than hammas-dev.** If you lose it, every future APK is
signed with a different key, and Android refuses to update the installed app. You would then have to uninstall it
and reinstall, and pick the icon pack again in Nova.

## Platforms and shared drawings

The unit of art is a **drawing** (`apps.drawable`). Components point at a drawing and carry a `platform`:
Android launcher components are `pkg/activity`, Mac apps are `mac:<bundleId>`. One drawing can serve both.

When a Mac request arrives, the server looks for the same app on Android: a built-in table of known pairs
(`server/src/match.ts`: WhatsApp, Chrome, Telegram, Spotify, Slack, Discord, Notion, Zoom, Figma, 1Password, Arc…)
and then the normalised name ("Google Chrome" ≈ "Chrome"). It works the other way round for Android requests
that match a Mac-only drawing. **It never merges on its own**: the Inbox shows the row with both icons and two
buttons. **Use same drawing** attaches the request to the existing drawing with no generation (if that drawing is
approved or published, the Mac gets it on its next sync). **Draw separately** queues it like Generate.

Only Android components ever reach the APK: a drawing used only on the Mac stays `approved` and is served to the
Mac straight from the server. Every row has a small Android / Mac tag, and drawings with a Mac component show a
macOS-shaped preview (made by `style/macos.py` from the same muted art) next to the Android masks.

## The Mac app

A menu-bar app (macOS 13 or later) that scans `/Applications`, `~/Applications` and `/Applications/Utilities`,
shows how many apps are applied / ready / requested / suggested / missing, sends **Request missing** (bundle id,
name and the current icon as a 256 px PNG) and applies the approved art with `NSWorkspace.setIcon`. It polls
`/api/mac/icons` every 15 minutes, on demand, and whenever an app folder changes; it remembers what it applied
(bundle id → version) and re-applies when an app update drops the custom icon. The Dock is restarted
(`killall Dock`) only when something changed. Apps in `/System/Applications` are on the sealed system volume
and are listed as "can't change". Per app, the ⋯ menu restores the original icon; **More → Restore all** undoes
everything.

### Install

1. Download `kudmascot-mac-<version>.zip` from the newest **Mac** release (tags `mac-v1.0.<n>`, marked pre-release:
   https://github.com/KudcraftsHQ/kudmascot/releases). Unzip it and move `kudmascot.app` to `/Applications`.
2. First launch only: it is ad-hoc signed, so **right-click → Open**, then Open again (same as ntfy-bar). If macOS
   still refuses, System Settings → Privacy & Security → Open Anyway.
3. Settings opens on first launch: the server URL (default `https://hammas-dev.tailaf13a.ts.net:4488`, needs
   Tailscale) and the token from `~/.config/kudmascot/env` on hammas-dev. Turn on **Launch at login** there.

### Permissions

- Apps you own change silently. **Root-owned and App Store apps** fail with your user's rights; the menu then
  offers **Apply with password…**, which runs the app's own binary as root (`kudmascot --apply-icons <manifest>`
  through `osascript … with administrator privileges`), so you type the password once per batch.
- macOS 13+ also has **App Management** (System Settings → Privacy & Security → App Management). If it blocks
  changes to other apps, allow kudmascot there; the menu links to that pane.

### Updates

Sparkle 2, EdDSA-signed. The feed is a stable URL that does not depend on the repo's "latest" release:
`https://github.com/KudcraftsHQ/kudmascot/releases/download/mac-appcast/appcast.xml`, the asset of a rolling
`mac-appcast` pre-release that `mac.yml` re-uploads on every Mac release. The app checks daily and installs on
quit (or **More → Check for Updates…**). Gatekeeper is only needed for the first install.

**Mac releases never become "latest"**: they are created with `--prerelease --latest=false`, and the workflow
fails if `releases/latest` is ever a `mac-*` tag. Obtainium keeps following the Android APK (`v1.0.<n>`).
`mac.yml` triggers only on `macos/**`; `release.yml` (Android) only on `android/**`, `icons/**` and the generator.

**Back up the Sparkle private key too.** If it is lost, no future Mac build can be signed for the installed app,
so it stops updating; you would have to download and install a new build by hand (after rotating `SUPublicEDKey`).

# kudmascot build log

## 2026-10-09
- Survey: repo empty except style/. cutroom.service = bun on 127.0.0.1:4477 + `tailscale serve --https=4477`. Picked port 4488 (free).
- style/prompt.md + style/mute.py written. Launcher icon generated (cream tile holding a coral paintbrush on dusty ochre); judged in-family against refs/family.png.
- Spec change from Hammas (via coordinator): no dark frame, no circle mask. mute.py now outputs an opaque full-bleed 512px square;
  the pack ships each icon as `<adaptive-icon>` (art = background layer, inset 16.667% so the whole square fills the 72dp viewport;
  transparent foreground), so Nova/Lawnchair mask it to the user's icon shape. Prompt gained a SAFE ZONE rule (face + identity cues inside central 66%).
  Review page mock shows circle / squircle / square at 48px, no frame.
- Spec change: release flow mirrors ntfy-android kc-release (KC_* secrets, env-driven signing, apksigner verify, asset `kudmascot-<tag>.apk` + SHA256SUMS,
  release title `kudmascot <version>`). Tag `v1.0.<run_number>` per push to main, versionCode = run number.
- Server (Bun + Hono + bun:sqlite) running as systemd user service kudmascot.service, fronted by `sudo tailscale serve --bg --https=4488`.
- No Java locally: keystore made with openssl as PKCS12 (RSA 4096, 30 years), storeType pkcs12 in Gradle. Backed up to ~/.config/kudmascot/.
- Gradle wrapper jar copied from ntfy-android, distribution pinned to 8.11.1 (AGP 8.7.3, Kotlin 2.0.21, compileSdk 35).

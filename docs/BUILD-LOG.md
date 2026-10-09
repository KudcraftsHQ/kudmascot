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
- First CI run green (4m43s), Release v1.0.1 with kudmascot-v1.0.1.apk + SHA256SUMS. Release builds shorten res/ paths
  (res/0Z.png), so `unzip -l` can't show resource names; CI now runs `aapt2 dump resources` and fails if a catalog drawable is missing.
- Generation round 1–2 (WhatsApp): the model collaged the reference images (dark Nova frames, wallpaper, the four mascots around a
  WhatsApp logo). Two causes: raw family.png is a screenshot, and the shared bridge's --ref wording says "output is an edit of /
  variation on them" (written for people). Fixes: style/refs/family-clean.png (four mascots cut out, plain cream), explicit
  "draw ONE new icon, never collage" in the prompt, and a vendored bridge `server/bin/gpt-image-icon` with style-reference wording
  (the shared skill is untouched).
- Round 3: v1 recognisable and in-family (cream speech bubble, green glyph, dusty green bg ~60% cover) but upright, uncropped, face high;
  v2 copied the dark frame from my screenshot crop. Prompt: solid cream body (never a ring), ignore the original's container/background,
  visibly tilted + bottom runs off the edge, no dark bg unless brand is black, face below centre and below the glyph.
- Round 4: tilt/crop still ignored, one variant drew an outline ring. Added `style/refs/ntfy-D2.png` as a COMPOSITION reference
  (ref order now: family-clean, ntfy-D2, original, [reviewed draft]); "no outline/stroke/ring".
- Round 5: in-family (tilted, edge-cropped, face low, ~60% cream) but no cheeks, variants near-identical. Made cheeks explicitly
  required; variant B wording is a strong mirror (the model still keeps WhatsApp's tail bottom-left; acceptable).
- Round 6 v2 approved (cheeks, small low face, tilt, crop, green clearly visible). Published via `POST /api/publish` →
  commit d298c65 by the server checkout → CI run 37876200151 green → Release v1.0.3. `aapt2 dump` in CI shows xml/appfilter,
  xml/drawable, array/icon_pack, drawable/com_whatsapp; assets/appfilter.xml maps com.whatsapp/com.whatsapp.Main; the 235781-byte
  PNG in the APK is byte-identical in size to icons/com_whatsapp.png.
- Bridge calls take ~45–60 s each here (not 4–6 min), so a request is ~2 min for 2 variants.

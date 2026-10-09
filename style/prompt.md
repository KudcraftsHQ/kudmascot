# kudmascot master prompt

The single source of truth for how every icon is generated. The server reads the
block between the `<!-- prompt:start -->` and `<!-- prompt:end -->` markers and fills
the `{{SLOTS}}`. Edit here, restart nothing: the worker re-reads this file on every job.

## Reference images (attached on every call, in this order)

1. `style/refs/family-clean.png` — Hammas's four existing mascot icons (cut from `style/refs/family.png`, frames and
   wallpaper removed, on plain cream). THE style reference. Attaching the raw `family.png` made the model collage the
   screenshot (dark frames, wallpaper) instead of drawing one icon, so it is not sent.
2. `style/refs/ntfy-D2.png` — Hammas's ntfy mascot, full bleed. The COMPOSITION reference: tilted, oversized, cut off by
   the edges, small low face. (Its cream covers a bit too much; the prompt asks for more background.)
3. The app's original icon (192 px PNG the phone sent). Identity reference only.
4. (regenerations only) the variant the reviewer commented on, so the note has context.

## Per-app slots

| Slot | Filled with |
|---|---|
| `{{LABEL}}` | App label from the phone, e.g. `WhatsApp` |
| `{{PACKAGE}}` | Package name, e.g. `com.whatsapp` |
| `{{HINT}}` | Optional line naming the signature object and brand colour, if a human gave one |
| `{{VARIANT}}` | Per-variant direction so the two drafts differ (lean, crop) |
| `{{NOTE}}` | Reviewer's note when regenerating, else empty |

## Template

<!-- prompt:start -->
Draw ONE brand-new square app icon (1:1, full bleed, no border, no rounded corners, no frame, no circle) for the Android app "{{LABEL}}" ({{PACKAGE}}). The attached images are guides only: do NOT reproduce, collage, tile or include them, do not draw several icons, do not draw a phone screen or wallpaper. The output is a single icon that fills the whole canvas edge to edge.

STYLE — copy exactly the style of the FIRST reference image (four example mascot icons — style only, never copy their subjects or their circular crops): flat cut-paper illustration, soft paper grain, a few big flat shapes, no outlines, no gloss, no gradients beyond very subtle paper texture, no 3D, no shadows except a faint flat offset if the brand mark has one, no text, no letters, no logos-as-text.

SUBJECT — take the app's signature object/glyph from the THIRD reference image (the app's real icon) and turn it into a chunky cream (#FEF8E8) mascot character: a SOLID filled cream body, never an outline or a ring. Use only the glyph and its brand colours from that image; ignore its container, launcher frame and any dark or white background around it. Flat shapes only: no outline, no stroke, no ring or border around the body. Keep the brand's silhouette so it is instantly recognisable at 48 dp, and keep the brand's accent details (inner glyph, coloured stripes, dots) in the brand's own colours, slightly dusty. {{HINT}}

COMPOSITION — follow the SECOND reference image (tilted cream body cut off by the canvas edges, small face low on it), but leave more background visible. The cream object is oversized and visibly tilted 8–15° (not upright), and big enough that part of it runs off the canvas edge (its bottom part is cut off by the bottom edge), but it covers only about 60% of the tile: a clear, generous area of the background colour must stay visible around it (at least the top and one side). Never a black or dark-grey background unless the brand colour itself is black. The background is a single flat, dusty, slightly desaturated version of the app's main brand colour (for apps whose icon background is white, use the brand's main accent colour instead). SAFE ZONE: the launcher masks the icon to the user's chosen shape (circle, squircle, square, teardrop). The face and every identity cue (the brand glyph, accent colour details, the recognisable part of the silhouette) must sit inside the central 66% of the canvas, so a circle mask never cuts them. Only the cream body and plain background may run out to the outer edges. {{VARIANT}}

FACE — a SMALL face sitting LOW on the object, below its centre and below any inner glyph (in the lower third of the visible body, still inside the safe zone): two tiny dark ink dot eyes set fairly wide, a tiny curved smile between them, faint pink cheek blushes just outside the eyes (the cheeks are required, even though the second reference image has none). The face is small relative to the object, never huge or chibi.

{{NOTE}}
<!-- prompt:end -->

## Batch template (grid mode)

The default path. The worker takes up to 9 queued apps (no reviewer note) and draws them in ONE call as a
`{{COLS}}`×`{{ROWS}}` contact sheet, then `style/grid.py split` cuts the cells and `mute.py` runs on each.
Refs for a batch: `family-clean.png`, `ntfy-D2.png`, then a ref sheet of the apps' original icons laid out in
the same cell order (`grid.py refsheet`). `{{CELLS}}` is one numbered line per app. Regenerating with a note
always uses the single-icon template above (2 variants).

<!-- grid:start -->
Draw a contact sheet of {{N}} brand-new square Android app icons arranged in a grid of {{COLS}} columns × {{ROWS}} rows, read left to right, top to bottom. Each icon is a full-bleed square tile with sharp corners (no rounded corners, no frame, no circle), all tiles the same size, separated by thin PURE WHITE gutters, with a thin pure white margin around the sheet. No labels, no numbers, no text anywhere. Leave any unused cell pure white.

The attached images are guides only, never copy them into the sheet. FIRST reference = the STYLE (four example mascot icons: style only, never their subjects or circular crops). SECOND reference = the COMPOSITION (tilted cream body cut off by the tile edges, small low face). THIRD reference = the real icons of these {{N}} apps, laid out in the SAME grid order as the cells below: cell 1 is top-left. Take each cell's glyph and brand colours from the matching icon there; ignore their containers, frames and backgrounds.

Every tile follows the same rules:
STYLE: flat cut-paper illustration, soft paper grain, a few big flat shapes, no outlines, no gloss, no 3D, no text or letters.
SUBJECT: the app's signature object/glyph becomes a chunky cream (#FEF8E8) mascot character, a SOLID filled cream body (never an outline or ring), keeping the brand's silhouette so it is recognisable at 48 dp, with the brand's accent details in its own colours, slightly dusty.
COMPOSITION: the cream object is oversized, visibly tilted 8–15°, part of it runs off the tile edge, but it covers only about 60% of the tile: a generous area of background stays visible. Background = one flat, dusty, slightly desaturated version of the app's main brand colour (if the icon background is white, use the brand's main accent colour; never black or dark grey unless the brand colour is black).
SAFE ZONE: the face and every identity cue sit inside the central 66% of each tile; only cream body and plain background may run to the tile edges.
FACE: a SMALL face LOW on the object (lower third of the visible body): two tiny dark ink dot eyes set fairly wide, a tiny curved smile, faint pink cheek blushes. Small, never chibi.
All tiles must look like one family drawn by the same hand.

The cells:
{{CELLS}}
<!-- grid:end -->

## Variant directions

The worker makes two drafts per request with these `{{VARIANT}}` lines:

- A: `Lean the object to the right (clockwise), cropped by the bottom and right edges.`
- B: `Mirror the usual layout: lean the object to the LEFT (counter-clockwise), with its body running off the bottom and LEFT edges and the open background at the top-right.`

## Post-processing (deterministic, `style/mute.py`)

1. `ImageEnhance.Color(img).enhance(0.62)`
2. `Image.blend(img, solid #F4ECDC, 0.08)`
3. Centre-crop, resize to 512×512, save an opaque full-bleed square PNG. **No mask**: the pack ships each
   icon as an `<adaptive-icon>` (art as the background layer, inset 16.667% so the whole square fills the
   72 dp viewport), so Nova/Lawnchair apply the user's own icon shape.

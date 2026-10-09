# kudmascot master prompt

The single source of truth for how every icon is generated. The server reads the
block between the `<!-- prompt:start -->` and `<!-- prompt:end -->` markers and fills
the `{{SLOTS}}`. Edit here, restart nothing: the worker re-reads this file on every job.

## Reference images (attached on every call, in this order)

1. `style/refs/family-clean.png` — Hammas's four existing mascot icons (cut from `style/refs/family.png`, frames and
   wallpaper removed, on plain cream). THE style reference. Attaching the raw `family.png` made the model collage the
   screenshot (dark frames, wallpaper) instead of drawing one icon, so it is not sent.
2. The app's original icon (192 px PNG the phone sent). Identity reference only.
3. (regenerations only) the variant the reviewer commented on, so the note has context.

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

STYLE — copy exactly the style of the FIRST reference image (four example mascot icons — style only, never copy their subjects): flat cut-paper illustration, soft paper grain, a few big flat shapes, no outlines, no gloss, no gradients beyond very subtle paper texture, no 3D, no shadows except a faint flat offset if the brand mark has one, no text, no letters, no logos-as-text.

SUBJECT — take the app's signature object/glyph from the SECOND reference image (the app's real icon) and turn it into a chunky cream (#FEF8E8) mascot character: a SOLID filled cream body, never an outline or a ring. Use only the glyph and its brand colours from that image; ignore its container, launcher frame and any dark or white background around it. Keep the brand's silhouette so it is instantly recognisable at 48 dp, and keep the brand's accent details (inner glyph, coloured stripes, dots) in the brand's own colours, slightly dusty. {{HINT}}

COMPOSITION — the cream object is oversized and visibly tilted 8–15° (not upright), and big enough that part of it runs off the canvas edge (its bottom part is cut off by the bottom edge), but it covers only about 60% of the tile: a clear, generous area of the background colour must stay visible around it (at least the top and one side). Never a black or dark-grey background unless the brand colour itself is black. The background is a single flat, dusty, slightly desaturated version of the app's main brand colour (for apps whose icon background is white, use the brand's main accent colour instead). SAFE ZONE: the launcher masks the icon to the user's chosen shape (circle, squircle, square, teardrop). The face and every identity cue (the brand glyph, accent colour details, the recognisable part of the silhouette) must sit inside the central 66% of the canvas, so a circle mask never cuts them. Only the cream body and plain background may run out to the outer edges. {{VARIANT}}

FACE — a SMALL face sitting LOW on the object, below its centre and below any inner glyph (in the lower third of the visible body, still inside the safe zone): two tiny dark ink dot eyes set fairly wide, a tiny curved smile between them, faint pink cheek blushes just outside the eyes. The face is small relative to the object, never huge or chibi.

{{NOTE}}
<!-- prompt:end -->

## Variant directions

The worker makes two drafts per request with these `{{VARIANT}}` lines:

- A: `Lean the object to the right (clockwise), cropped by the bottom and right edges.`
- B: `Lean the object to the left (counter-clockwise), cropped by the bottom and left edges.`

## Post-processing (deterministic, `style/mute.py`)

1. `ImageEnhance.Color(img).enhance(0.62)`
2. `Image.blend(img, solid #F4ECDC, 0.08)`
3. Centre-crop, resize to 512×512, save an opaque full-bleed square PNG. **No mask**: the pack ships each
   icon as an `<adaptive-icon>` (art as the background layer, inset 16.667% so the whole square fills the
   72 dp viewport), so Nova/Lawnchair apply the user's own icon shape.

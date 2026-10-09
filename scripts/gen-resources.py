#!/usr/bin/env python3
"""Generate the icon-pack resources from icons/catalog.json + icons/*.png.

Run by CI before every build (and locally to check). Never hand-edit the outputs;
they are .gitignored.

Writes, under android/app/src/main/:
  res/drawable-nodpi/<d>_art.png         full-bleed square art (the plain PNG)
  res/drawable-anydpi-v26/<d>.xml        <adaptive-icon>: art as background, inset 16.667%
                                         so the whole square fills the 72dp viewport and
                                         the launcher masks it to the user's icon shape
  res/xml/appfilter.xml, assets/appfilter.xml   component -> drawable map (ADW/Nova format)
  res/xml/drawable.xml,  assets/drawable.xml    icon list for launcher icon pickers
  res/values/iconpack.xml                       ADW string-arrays (icon_pack, icons_preview)
"""
import json
import re
import shutil
import sys
from pathlib import Path
from xml.sax.saxutils import quoteattr

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
MAIN = ROOT / "android/app/src/main"
RES = MAIN / "res"
NAME = re.compile(r"^[a-z][a-z0-9_]*$")


def main() -> int:
    cat_path = ICONS / "catalog.json"
    cat = json.loads(cat_path.read_text()) if cat_path.exists() else {"icons": []}
    icons = sorted(cat.get("icons", []), key=lambda i: i["drawable"])

    nodpi = RES / "drawable-nodpi"
    anydpi = RES / "drawable-anydpi-v26"
    for d in (nodpi, anydpi):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
    (RES / "xml").mkdir(parents=True, exist_ok=True)
    (RES / "values").mkdir(parents=True, exist_ok=True)
    (MAIN / "assets").mkdir(parents=True, exist_ok=True)

    errors = []
    filter_items, drawables = [], []
    for icon in icons:
        d = icon["drawable"]
        png = ICONS / f"{d}.png"
        if not NAME.match(d):
            errors.append(f"bad drawable name: {d}")
            continue
        if not png.exists():
            errors.append(f"missing {png.relative_to(ROOT)}")
            continue
        shutil.copyfile(png, nodpi / f"{d}_art.png")
        (anydpi / f"{d}.xml").write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            "    <background>\n"
            f'        <inset android:drawable="@drawable/{d}_art" android:inset="16.667%" />\n'
            "    </background>\n"
            '    <foreground android:drawable="@android:color/transparent" />\n'
            "</adaptive-icon>\n"
        )
        drawables.append(d)
        for comp in icon.get("components", []):
            filter_items.append(f"    <item component={quoteattr('ComponentInfo{' + comp + '}')} drawable={quoteattr(d)} />")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1

    appfilter = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + "\n".join(filter_items) + ("\n" if filter_items else "") + "</resources>\n"
    drawable_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <version>1</version>\n    <category title="kudmascot" />\n'
        + "".join(f"    <item drawable={quoteattr(d)} />\n" for d in drawables)
        + "</resources>\n"
    )
    arrays = "".join(f"        <item>{d}</item>\n" for d in drawables)
    values = (
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <string-array name="icon_pack">\n{arrays}    </string-array>\n'
        f'    <string-array name="icons_preview">\n{arrays}    </string-array>\n'
        "</resources>\n"
    )
    for path, text in (
        (RES / "xml/appfilter.xml", appfilter),
        (MAIN / "assets/appfilter.xml", appfilter),
        (RES / "xml/drawable.xml", drawable_xml),
        (MAIN / "assets/drawable.xml", drawable_xml),
        (RES / "values/iconpack.xml", values),
    ):
        path.write_text(text)
    print(f"generated {len(drawables)} icons, {len(filter_items)} components")
    return 0


if __name__ == "__main__":
    sys.exit(main())

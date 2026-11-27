"""Build the 64x64 AR1MA skin used for the author avatar."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "src" / "assets" / "authors" / "ar1ma.png"
OUT.parent.mkdir(parents=True, exist_ok=True)
img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

skin = (198, 140, 102, 255)
hair = (16, 18, 24, 255)
band = (235, 238, 240, 255)
shirt = (26, 30, 40, 255)

# Head (base layer face at 8,8)
d.rectangle([8, 8, 15, 15], fill=skin)
d.point((10, 12), fill=hair)
d.point((13, 12), fill=hair)
d.line([(11, 14), (12, 14)], fill=(120, 70, 55, 255))

# Hair + white band overlay (second layer at 40,8)
d.rectangle([40, 8, 47, 15], fill=hair)
d.rectangle([40, 8, 47, 9], fill=band)
for x in range(40, 48):
    if x % 2 == 0:
        d.point((x, 9), fill=hair)

# Torso, arms
d.rectangle([20, 20, 27, 27], fill=shirt)
d.rectangle([20, 20, 27, 21], fill=band)
d.rectangle([12, 20, 15, 27], fill=shirt)
d.rectangle([28, 20, 31, 27], fill=shirt)
d.rectangle([12, 20, 15, 21], fill=band)
d.rectangle([28, 20, 31, 21], fill=band)
d.rectangle([4, 20, 7, 27], fill=skin)
d.rectangle([36, 20, 39, 27], fill=skin)

img.save(OUT, "PNG")
print("wrote", OUT)

# OpenCode (the assistant) — mint/violet "visor" skin.
OC = OUT.with_name("opencode.png")
o = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
od = ImageDraw.Draw(o)
visor = (92, 183, 107, 255)
visor2 = (139, 124, 246, 255)
dark = (12, 20, 30, 255)
od.rectangle([8, 8, 15, 15], fill=(38, 46, 60, 255))
od.rectangle([9, 11, 14, 13], fill=visor)
od.point((10, 12), fill=dark)
od.point((13, 12), fill=dark)
od.rectangle([40, 8, 47, 15], fill=dark)
od.rectangle([40, 10, 47, 12], fill=visor2)
od.rectangle([20, 20, 27, 27], fill=dark)
od.rectangle([20, 21, 27, 22], fill=visor)
od.rectangle([12, 20, 15, 27], fill=dark)
od.rectangle([28, 20, 31, 27], fill=dark)
o.save(OC, "PNG")
print("wrote", OC)

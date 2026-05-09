"""
Verretta brand asset generator for Focus Forecast PWA.
Brand: Glossy Coral #FF805D on Dark Taupe #332B24, copper foil #C7884A/#8C5523.
"""

from PIL import Image, ImageDraw, ImageFont
import os

DOCS = "/Volumes/ORICO/Claude/focus-forecast/docs"
BG = (51, 43, 36)          # #332B24
CORAL = (255, 128, 93)     # #FF805D
COPPER_TOP = (199, 136, 74)  # #C7884A
COPPER_BOT = (140, 85, 35)   # #8C5523
TEXT_LIGHT = (225, 219, 214)  # #E1DBD6
TEXT_MID = (176, 158, 142)    # #B09E8E


def get_font(size):
    for path in [
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Arial.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def lerp_color(c1, c2, t):
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def draw_column_gradient(img, x, y, w, h):
    """Draw a single column with copper-foil vertical gradient."""
    draw = ImageDraw.Draw(img)
    for row in range(h):
        t = row / max(h - 1, 1)
        if t < 0.5:
            color = lerp_color(COPPER_TOP, CORAL, t * 2)
        else:
            color = lerp_color(CORAL, COPPER_BOT, (t - 0.5) * 2)
        draw.rectangle([x, y + row, x + w - 1, y + row], fill=color)


def draw_mark(img, cx, cy, col_w, col_h, gap):
    """
    Three-column mark + base bar.
    cx, cy = center of the entire mark (columns + base).
    col_w = width of each column
    gap = gap between columns
    col_h = height of columns above base
    base_h = height of base bar
    """
    base_h = max(4, col_w // 4)
    total_w = 3 * col_w + 2 * gap
    total_h = col_h + base_h

    left = cx - total_w // 2
    top = cy - total_h // 2

    # Three columns with copper gradient
    for i in range(3):
        col_x = left + i * (col_w + gap)
        col_y = top
        draw_column_gradient(img, col_x, col_y, col_w, col_h)

    # Base bar — solid coral
    draw = ImageDraw.Draw(img)
    draw.rectangle([left, top + col_h, left + total_w - 1, top + col_h + base_h - 1], fill=CORAL)

    return total_w, total_h


# ─────────────────────────────────────────────
# 1. icon-192.png  (192×192, 16% padding)
# ─────────────────────────────────────────────
def make_icon_192():
    size = 192
    pad_pct = 0.16
    img = Image.new("RGB", (size, size), BG)

    usable = size * (1 - 2 * pad_pct)
    col_w = max(4, int(usable / 5))   # 3 cols + 2 gaps; gap ≈ col_w
    gap = max(2, int(usable / 10))
    total_w = 3 * col_w + 2 * gap
    col_h = int(usable * 0.78)

    cx = size // 2
    cy = size // 2

    draw_mark(img, cx, cy, col_w, col_h, gap)
    img.save(os.path.join(DOCS, "icon-192.png"), optimize=True)
    return size, size


# ─────────────────────────────────────────────
# 2. icon-512.png  (512×512, 16% padding)
# ─────────────────────────────────────────────
def make_icon_512():
    size = 512
    pad_pct = 0.16
    img = Image.new("RGB", (size, size), BG)

    usable = size * (1 - 2 * pad_pct)
    col_w = max(10, int(usable / 5))
    gap = max(5, int(usable / 10))
    col_h = int(usable * 0.78)

    cx = size // 2
    cy = size // 2

    draw_mark(img, cx, cy, col_w, col_h, gap)
    img.save(os.path.join(DOCS, "icon-512.png"), optimize=True)
    return size, size


# ─────────────────────────────────────────────
# 3. icon-512-maskable.png  (512×512, 22% padding)
# ─────────────────────────────────────────────
def make_icon_512_maskable():
    size = 512
    pad_pct = 0.22
    img = Image.new("RGB", (size, size), BG)

    usable = size * (1 - 2 * pad_pct)
    col_w = max(10, int(usable / 5))
    gap = max(5, int(usable / 10))
    col_h = int(usable * 0.78)

    cx = size // 2
    cy = size // 2

    draw_mark(img, cx, cy, col_w, col_h, gap)
    img.save(os.path.join(DOCS, "icon-512-maskable.png"), optimize=True)
    return size, size


# ─────────────────────────────────────────────
# 4. splash-1290.png  (1290×2796, iPhone 15 Pro Max)
# ─────────────────────────────────────────────
def make_splash_1290():
    W, H = 1290, 2796
    img = Image.new("RGB", (W, H), BG)

    col_w = 80
    gap = 32
    col_h = int(col_w * 3.5)

    mark_cx = W // 2
    mark_cy = int(H * 0.38)
    draw_mark(img, mark_cx, mark_cy, col_w, col_h, gap)

    # Wordmark
    font = get_font(72)
    draw = ImageDraw.Draw(img)
    wordmark = "F O C U S   ·   F O R E C A S T"
    bbox = draw.textbbox((0, 0), wordmark, font=font)
    tw = bbox[2] - bbox[0]
    tx = (W - tw) // 2
    ty = int(H * 0.60)
    draw.text((tx, ty), wordmark, font=font, fill=TEXT_LIGHT)

    img.save(os.path.join(DOCS, "splash-1290.png"), optimize=True)
    return W, H


# ─────────────────────────────────────────────
# 5. splash-750.png  (750×1334, iPhone SE/8)
# ─────────────────────────────────────────────
def make_splash_750():
    W, H = 750, 1334
    img = Image.new("RGB", (W, H), BG)

    col_w = 46
    gap = 18
    col_h = int(col_w * 3.5)

    mark_cx = W // 2
    mark_cy = int(H * 0.38)
    draw_mark(img, mark_cx, mark_cy, col_w, col_h, gap)

    font = get_font(42)
    draw = ImageDraw.Draw(img)
    wordmark = "F O C U S   ·   F O R E C A S T"
    bbox = draw.textbbox((0, 0), wordmark, font=font)
    tw = bbox[2] - bbox[0]
    tx = (W - tw) // 2
    ty = int(H * 0.60)
    draw.text((tx, ty), wordmark, font=font, fill=TEXT_LIGHT)

    img.save(os.path.join(DOCS, "splash-750.png"), optimize=True)
    return W, H


# ─────────────────────────────────────────────
# 6. og-image.png  (1200×630)
# ─────────────────────────────────────────────
def make_og_image():
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Subtle vertical stripe motif on right edge (opacity ~0.15 simulated by blending)
    stripe_w = 8
    stripe_gap = 28
    stripe_start_x = W - 340
    stripe_color = tuple(int(BG[i] + (CORAL[i] - BG[i]) * 0.15) for i in range(3))
    x = stripe_start_x
    while x < W:
        draw.rectangle([x, 0, x + stripe_w - 1, H - 1], fill=stripe_color)
        x += stripe_w + stripe_gap

    # Columned mark — ~140px tall, top-left at 80px padding
    col_w = 28
    gap = 11
    col_h = 112
    base_h = max(4, col_w // 4)
    total_mark_h = col_h + base_h

    mark_pad = 80
    mark_cx = mark_pad + (3 * col_w + 2 * gap) // 2
    mark_cy = mark_pad + total_mark_h // 2

    draw_mark(img, mark_cx, mark_cy, col_w, col_h, gap)

    mark_bottom = mark_cy + total_mark_h // 2

    # Title
    title_font = get_font(64)
    title = "Focus, measured with meaning"
    # Bold simulation: draw twice with 1px offset
    title_y = mark_bottom + 40
    draw.text((mark_pad + 1, title_y + 1), title, font=title_font, fill=(0, 0, 0))
    draw.text((mark_pad, title_y), title, font=title_font, fill=TEXT_LIGHT)

    # Subtitle
    sub_font = get_font(36)
    subtitle = "A Pomodoro tracker that forecasts how much you'll focus tomorrow."
    sub_y = title_y + 90
    draw.text((mark_pad, sub_y), subtitle, font=sub_font, fill=TEXT_MID)

    # Bottom-right URL
    url_font = get_font(26)
    url = "sachinai1981-web.github.io/focus-forecast"
    url_bbox = draw.textbbox((0, 0), url, font=url_font)
    url_w = url_bbox[2] - url_bbox[0]
    url_h = url_bbox[3] - url_bbox[1]
    draw.text((W - url_w - 40, H - url_h - 30), url, font=url_font, fill=CORAL)

    img.save(os.path.join(DOCS, "og-image.png"), optimize=True)
    return W, H


if __name__ == "__main__":
    results = {}

    print("Generating icon-192.png ...")
    results["icon-192.png"] = make_icon_192()

    print("Generating icon-512.png ...")
    results["icon-512.png"] = make_icon_512()

    print("Generating icon-512-maskable.png ...")
    results["icon-512-maskable.png"] = make_icon_512_maskable()

    print("Generating splash-1290.png ...")
    results["splash-1290.png"] = make_splash_1290()

    print("Generating splash-750.png ...")
    results["splash-750.png"] = make_splash_750()

    print("Generating og-image.png ...")
    results["og-image.png"] = make_og_image()

    print("\nDone. Verifying dimensions:")
    for fname, (w, h) in results.items():
        path = os.path.join(DOCS, fname)
        actual = Image.open(path).size
        match = "OK" if actual == (w, h) else f"MISMATCH expected ({w},{h})"
        print(f"  {fname}: {actual[0]}x{actual[1]}  [{match}]")

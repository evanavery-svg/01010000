#!/usr/bin/env python3
"""Generate PWA icons (pure stdlib PNG encoder — no external deps).

Draws a sleek price-tag / chart glyph on an orange field, matching the
app's black / orange / gray / white palette.
"""
import os
import struct
import zlib
import math

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT, exist_ok=True)

ORANGE = (255, 106, 0)
DARK = (10, 10, 11)
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def write_png(path, pixels, w, h):
    """pixels: flat list of (r,g,b,a) tuples, length w*h."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter type 0
        for x in range(w):
            r, g, b, a = pixels[y * w + x]
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def rounded_alpha(x, y, w, h, radius):
    """Antialiased coverage (0..1) of a rounded rect for a pixel center."""
    cx = min(max(x, radius), w - radius)
    cy = min(max(y, radius), h - radius)
    dx = x - cx
    dy = y - cy
    d = math.hypot(dx, dy)
    # smooth edge over ~1px
    return max(0.0, min(1.0, radius - d + 0.5))


def make(size, maskable=False):
    w = h = size
    px = [(0, 0, 0, 0)] * (w * h)
    # supersample chart path coverage
    radius = 0 if maskable else size * 0.225
    # subtle vertical gradient on the orange field
    top = (255, 138, 38)
    bot = (240, 92, 0)

    # chart polyline points (normalized 0..1 within a safe inset)
    inset = 0.30 if maskable else 0.24
    x0, x1 = inset, 1 - inset
    pts_n = [0.62, 0.50, 0.66, 0.40, 0.52, 0.30, 0.20]
    n = len(pts_n)
    pts = []
    for i, v in enumerate(pts_n):
        px_x = (x0 + (x1 - x0) * (i / (n - 1))) * size
        px_y = v * size
        pts.append((px_x, px_y))

    line_w = size * 0.052
    dot_r = size * 0.052

    def dist_to_polyline(qx, qy):
        best = 1e9
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = 0 if L2 == 0 else max(0, min(1, ((qx - ax) * dx + (qy - ay) * dy) / L2))
            cx, cy = ax + t * dx, ay + t * dy
            best = min(best, math.hypot(qx - cx, qy - cy))
        return best

    end_pt = pts[-1]

    for y in range(h):
        for x in range(w):
            cxp, cyp = x + 0.5, y + 0.5
            a_field = 1.0 if maskable else rounded_alpha(cxp, cyp, w, h, radius)
            if a_field <= 0:
                continue
            base = lerp(top, bot, y / h)
            r, g, b = base

            # white chart line
            d = dist_to_polyline(cxp, cyp)
            line_cov = max(0.0, min(1.0, (line_w / 2) - d + 0.75))
            if line_cov > 0:
                r, g, b = lerp((r, g, b), WHITE, line_cov)

            # end dot (filled white with dark ring feel)
            dd = math.hypot(cxp - end_pt[0], cyp - end_pt[1])
            dot_cov = max(0.0, min(1.0, dot_r - dd + 0.75))
            if dot_cov > 0:
                r, g, b = lerp((r, g, b), WHITE, dot_cov)

            px[y * w + x] = (r, g, b, round(255 * a_field))

    return px, w, h


for size in (192, 512):
    px, w, h = make(size, maskable=False)
    write_png(os.path.join(OUT, f"icon-{size}.png"), px, w, h)

px, w, h = make(512, maskable=True)
write_png(os.path.join(OUT, "icon-512-maskable.png"), px, w, h)

# Apple touch icon (no transparency; iOS adds its own rounding)
px, w, h = make(180, maskable=True)
write_png(os.path.join(OUT, "apple-touch-icon.png"), px, w, h)

print("icons written to", os.path.abspath(OUT))

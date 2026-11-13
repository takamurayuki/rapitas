"""
render-small-icons.py

Renders the pixel-snapped small app-icon frames (16-48px) and the tray icons,
and rebuilds icon.ico from them plus the existing large frames.

Why this exists: app-icon.svg rotates the glyph by -10 degrees. Downscaled to
taskbar/tray sizes, every bar edge becomes a diagonal smear of half-lit pixels,
so the mark looks warped. Small sizes therefore redraw the same tilted glyph
from its geometry with exact-coverage anti-aliasing and slightly thicker rows,
so the bars stay solid instead of dissolving into half-lit pixels.
Frames >= 64px keep the rotated artwork rendered from app-icon.svg.

Usage (needs Pillow): python rapitas-desktop/scripts/render-small-icons.py
"""

import io
import math
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ICONS = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"

SMALL_SIZES = (16, 20, 24, 32, 48)
# Frames kept as-is from the current icon.ico (rendered from app-icon.svg).
LARGE_SIZES = (64, 128, 256)
TRAY_SIZES = (16, 20, 24, 32)

GRADIENT_FROM = (0x8B, 0x5C, 0xF6)
GRADIENT_TO = (0x63, 0x66, 0xF1)
TILE_RADIUS = 213 / 1024  # same corner radius as app-icon.svg
SUPERSAMPLE = 16

# Glyph geometry from app-icon.svg (1024-unit space, before the -10 degree
# rotation). Each row is a square plus a bar whose right end is the slanted
# "tip"; the r=15 corner rounding is below a pixel at these sizes.
ROW_CENTERS = (317, 512, 707)
ROW_HEIGHT = 102
SQUARE_CENTER_X = 241
BAR_START_X = 358
# Per-row offset of the tip; row 0 is the reference.
TIP_SHIFT = (0, 102, -52)
TIP_MID_X = 702.5
TIP_SLOPE = 45 / 102
ROTATION_DEG = -10
# How much rows are thickened about their centre line per frame size. Thin
# diagonal bars at 16-24px lose most of their coverage to anti-aliasing and
# read as a smear; fattening them (as the old tray art did) keeps them solid.
THICKEN = {16: 1.3, 20: 1.22, 24: 1.15, 32: 1.1, 48: 1.05}
# Small frames also enlarge the glyph a little: at 16px the svg's padding
# costs whole pixels of row height that the mark cannot spare.
GLYPH_SCALE = {16: 1.12, 20: 1.1, 24: 1.06, 32: 1.03}


def render_tile(size: int) -> Image.Image:
    """
    Render the gradient rounded tile, anti-aliased by supersampling.

    Args:
        size: edge length in pixels / 一辺のピクセル数

    Returns:
        RGBA tile without the glyph / 図形なしのタイル画像
    """
    big = size * SUPERSAMPLE
    gradient = Image.new("RGBA", (big, big))
    pixels = gradient.load()
    for y in range(big):
        for x in range(big):
            t = (x + y) / (2 * (big - 1))
            pixels[x, y] = tuple(
                round(a + (b - a) * t) for a, b in zip(GRADIENT_FROM, GRADIENT_TO)
            ) + (255,)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=round(big * TILE_RADIUS), fill=255
    )
    gradient.putalpha(mask)
    return gradient.resize((size, size), Image.BOX)


def glyph_polygons(thicken: float) -> list:
    """
    Build the six glyph polygons in 1024-unit space, rotated like app-icon.svg.

    Args:
        thicken: row-height multiplier / 行の太さの倍率

    Returns:
        list of polygons, each a list of (x, y) / 多角形の座標リスト
    """
    half = ROW_HEIGHT * thicken / 2
    polygons = []
    for center, shift in zip(ROW_CENTERS, TIP_SHIFT):
        top, bottom = center - half, center + half
        polygons.append([
            (SQUARE_CENTER_X - half, top),
            (SQUARE_CENTER_X + half, top),
            (SQUARE_CENTER_X + half, bottom),
            (SQUARE_CENTER_X - half, bottom),
        ])
        # The tip is the svg's slanted right edge (x 680 at the top of row 0
        # to ~725 at its bottom), extended along the same slope when thickened.
        def tip(y, center=center, shift=shift):
            return TIP_MID_X + shift + TIP_SLOPE * (y - center)

        polygons.append([
            (BAR_START_X, top),
            (tip(top), top),
            (tip(bottom), bottom),
            (BAR_START_X, bottom),
        ])
    angle = math.radians(ROTATION_DEG)
    cos, sin = math.cos(angle), math.sin(angle)

    def rotate(point):
        x, y = point[0] - 512, point[1] - 512
        return (512 + x * cos - y * sin, 512 + x * sin + y * cos)

    return [[rotate(p) for p in polygon] for polygon in polygons]


def glyph_coverage(size: int, dx: float, dy: float) -> Image.Image:
    """
    Rasterise the glyph's exact per-pixel coverage at a sub-pixel offset.

    Args:
        size: edge length in pixels / 一辺のピクセル数
        dx: horizontal shift in pixels / 水平方向のずらし量(px)
        dy: vertical shift in pixels / 垂直方向のずらし量(px)

    Returns:
        L-mode coverage mask / 被覆率マスク
    """
    big = size * SUPERSAMPLE
    scale = big / 1024 * GLYPH_SCALE.get(size, 1.0)
    offset = big / 2 - 512 * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    for polygon in glyph_polygons(THICKEN.get(size, 1.0)):
        draw.polygon(
            [
                (x * scale + offset + dx * SUPERSAMPLE, y * scale + offset + dy * SUPERSAMPLE)
                for x, y in polygon
            ],
            fill=255,
        )
    # BOX = exact area coverage, so each edge pixel gets its true share and
    # no ringing halo appears around the white bars.
    return mask.resize((size, size), Image.BOX)


def blur_score(coverage: Image.Image) -> float:
    """
    Measure how many half-lit pixels a coverage mask has (lower = crisper).

    Args:
        coverage: L-mode coverage mask / 被覆率マスク

    Returns:
        sum of c*(1-c) over all pixels / 中間調ピクセルの総量
    """
    return sum(v * (255 - v) for v in coverage.tobytes()) / 255 / 255


def render_icon(size: int) -> Image.Image:
    """
    Render one small app icon frame (tile + tilted white glyph).

    Args:
        size: edge length in pixels / 一辺のピクセル数

    Returns:
        RGBA icon frame / アイコン画像
    """
    # A tilted edge can never be fully pixel-aligned, but where it lands
    # changes how many pixels end up half-lit. Try sub-pixel shifts within
    # +-0.5px and keep the crispest so the bars read as solid strokes.
    steps = [i / 8 - 0.5 for i in range(9)]
    coverage = min(
        (glyph_coverage(size, dx, dy) for dx in steps for dy in steps),
        key=blur_score,
    )
    image = render_tile(size)
    white = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    white.putalpha(coverage)
    image.alpha_composite(white)
    return image


def png_bytes(image: Image.Image) -> bytes:
    """
    Encode an image as PNG.

    Args:
        image: image to encode / エンコードする画像

    Returns:
        PNG file bytes / PNG バイト列
    """
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def write_ico(path: Path, frames: list) -> None:
    """
    Write an ICO whose entries are the given PNG frames, unresampled.

    Args:
        path: output path / 出力先
        frames: list of (size, png_bytes), ascending / (サイズ, PNG) の昇順リスト
    """
    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blobs = b"", b""
    for size, data in frames:
        dim = 0 if size >= 256 else size  # ICO encodes 256 as 0
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    path.write_bytes(header + entries + blobs)


def read_large_frames(path: Path) -> list:
    """
    Pull the large frames out of the existing ICO so they stay byte-identical.

    Args:
        path: existing icon.ico / 既存の icon.ico

    Returns:
        list of (size, png_bytes) / (サイズ, PNG) のリスト
    """
    raw = path.read_bytes()
    count = struct.unpack("<H", raw[4:6])[0]
    frames = []
    for i in range(count):
        width, _h, _c, _r, _p, _b, length, offset = struct.unpack(
            "<BBBBHHII", raw[6 + 16 * i : 22 + 16 * i]
        )
        size = width or 256
        if size in LARGE_SIZES:
            data = raw[offset : offset + length]
            if not data.startswith(b"\x89PNG"):
                # Re-encode BMP-style entries so the output stays all-PNG.
                image = Image.open(io.BytesIO(raw))
                image.size = (size, size)
                data = png_bytes(image.convert("RGBA"))
            frames.append((size, data))
    return frames


def main() -> None:
    """Render every small frame, the tray icons and the rebuilt icon.ico."""
    small = {size: render_icon(size) for size in SMALL_SIZES}
    small[32].save(ICONS / "32x32.png")
    for size in TRAY_SIZES:
        small.get(size, render_icon(size)).save(ICONS / f"tray-icon-{size}.png")
    large = read_large_frames(ICONS / "icon.ico")
    frames = [(s, png_bytes(small[s])) for s in SMALL_SIZES] + large
    write_ico(ICONS / "icon.ico", sorted(frames))
    print("sizes:", [s for s, _ in sorted(frames)])


if __name__ == "__main__":
    main()

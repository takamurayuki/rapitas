"""Generate all Rapitas icon sizes from the same approved mobile artwork.

Pillow is required. Run without arguments for all app icons; --tray-only
refreshes the tray atlas and its preview PNGs. No per-platform glyph scaling,
thickening, spacing, or position changes are applied.
"""
import io
import struct
import sys
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ICONS = ROOT / "rapitas-desktop/src-tauri/icons"
MOBILE = ROOT / "rapitas-mobile"
MASTER = ICONS / "app-icon-master.png"
ICO_SIZES = (16, 20, 24, 32, 48, 64, 128, 256)


@lru_cache(maxsize=None)
def render_icon(size: int, shape: str = "tile") -> Image.Image:
    """Resize once from the common master; only the outer OS mask differs."""
    with Image.open(MASTER) as original:
        image = original.convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    if shape == "square":
        return image
    image = image.convert("RGBA")
    factor = 4
    edge = size * factor
    mask = Image.new("L", (edge, edge), 0)
    draw = ImageDraw.Draw(mask)
    if shape == "circle":
        draw.ellipse((0, 0, edge-1, edge-1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, edge-1, edge-1), radius=edge*213/1024, fill=255)
    image.putalpha(mask.resize((size, size), Image.Resampling.BOX))
    return image


def render_tray_assets() -> None:
    """Every integer size gets the exact same artwork as the app icon."""
    atlas = Image.new("RGBA", (64, 49*64), (0, 0, 0, 0))
    for size in range(16, 65):
        frame = render_icon(size)
        atlas.paste(frame, (0, (size-16)*64))
        if size in (16, 20, 24, 32):
            frame.save(ICONS / f"tray-icon-{size}.png")
    atlas.save(ICONS / "tray-atlas.png")


def write_ico(path: Path) -> None:
    """Embed individually rendered PNG frames without a second resize."""
    entries, frames = bytearray(), bytearray()
    offset = 6+16*len(ICO_SIZES)
    for size in ICO_SIZES:
        buffer = io.BytesIO()
        render_icon(size).save(buffer, format="PNG")
        data = buffer.getvalue()
        entries.extend(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        frames.extend(data)
        offset += len(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(ICO_SIZES))+entries+frames)


def refresh_png(path: Path, shape: str) -> None:
    with Image.open(path) as existing:
        width, height = existing.size
    if width != height:
        raise ValueError(f"Non-square icon: {path}")
    render_icon(width, shape).save(path)


def main() -> None:
    for path in ICONS.glob("*.png"):
        if path.name == MASTER.name or path.name.startswith("tray-"):
            continue
        refresh_png(path, "tile")
    for path in (ICONS / "ios").glob("*.png"):
        refresh_png(path, "square")
    for path in (ICONS / "android").rglob("*.png"):
        refresh_png(path, "circle" if path.stem.endswith("_round") else "tile")
    for platform in ("ios", "macos"):
        for path in (MOBILE / platform / "Runner/Assets.xcassets/AppIcon.appiconset").glob("*.png"):
            refresh_png(path, "square" if platform == "ios" else "tile")
    for path in (MOBILE / "android/app/src/main/res").glob("mipmap-*/ic_launcher.png"):
        refresh_png(path, "square")
    for path in (MOBILE / "web/icons").glob("*.png"):
        refresh_png(path, "square" if "maskable" in path.stem else "tile")
    refresh_png(MOBILE / "web/favicon.png", "tile")
    for path in (ICONS / "icon.ico", MOBILE / "windows/runner/resources/app_icon.ico", ROOT / "rapitas-frontend/src/app/favicon.ico"):
        write_ico(path)
    render_icon(1024).save(ICONS / "icon.icns", format="ICNS", append_images=[render_icon(s) for s in (16,32,64,128,256,512)])
    render_tray_assets()
    print("Generated all platform icons from app-icon-master.png")


if __name__ == "__main__":
    render_tray_assets() if "--tray-only" in sys.argv else main()

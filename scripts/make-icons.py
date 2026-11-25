#!/usr/bin/env python3
"""Generate the مكالمات واصل launcher icons using only the Python standard library.

No Pillow, no cairosvg and no external image tools are used. Rasterisation,
anti-aliasing, PNG encoding and ICO packaging are implemented with math,
struct and zlib.

Run from anywhere with:

    python scripts/make-icons.py

Outputs (in build/icons/):
    icon-512.png     rounded launcher icon
    icon-192.png     rounded launcher icon
    icon-48.png      rounded launcher icon
    app-icon.png     square (non-rounded) 512x512 application icon
    icon.ico         Windows icon containing 16/32/48/64/128/256 px images
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "build" / "icons"

# Adwaita blue accent and a clean white stroke.
BLUE = (0x35, 0x84, 0xE4)
WHITE = (0xFF, 0xFF, 0xFF)

# The "W" mark as a polyline in normalised [-1, 1] coordinates (y points up).
W_POINTS = (
    (-0.56, 0.56),
    (-0.34, -0.56),
    (0.00, 0.02),
    (0.34, -0.56),
    (0.56, 0.56),
)
STROKE_WIDTH = 0.19          # normalised thickness of the W stroke
CORNER_RADIUS = 0.22         # rounded-corner radius as a fraction of half size
MASTER_SIZE = 512


def clamp01(value: float) -> float:
    if value <= 0.0:
        return 0.0
    if value >= 1.0:
        return 1.0
    return value


def segment_distance(px: float, py: float, ax: float, ay: float,
                     bx: float, by: float) -> float:
    """Distance from a point to a line segment (round caps included)."""
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    denom = vx * vx + vy * vy
    t = 0.0 if denom == 0.0 else (wx * vx + wy * vy) / denom
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    dx, dy = wx - vx * t, wy - vy * t
    return math.sqrt(dx * dx + dy * dy)


def render(size: int, rounded: bool = True) -> list[bytes]:
    """Render one RGBA image as a list of scanlines (top row first)."""
    half = size / 2.0
    radius = CORNER_RADIUS * half
    inner = half - radius
    stroke_half = STROKE_WIDTH * half / 2.0
    segments = list(zip(W_POINTS, W_POINTS[1:]))

    rows: list[bytes] = []
    for y in range(size):
        py = y + 0.5 - half
        ny = -py / half
        row = bytearray(size * 4)

        for x in range(size):
            px = x + 0.5 - half

            if rounded:
                # Signed distance to a rounded rectangle; 0.5 px soft edge.
                qx, qy = abs(px) - inner, abs(py) - inner
                outside = math.sqrt(max(qx, 0.0) ** 2 + max(qy, 0.0) ** 2)
                distance = outside + min(max(qx, qy), 0.0) - radius
                background_alpha = clamp01(0.5 - distance)
            else:
                background_alpha = 1.0

            if background_alpha <= 0.0:
                continue

            nx = px / half
            nearest = 1e9
            for (ax, ay), (bx, by) in segments:
                d = segment_distance(nx, ny, ax, ay, bx, by)
                if d < nearest:
                    nearest = d

            white_alpha = clamp01(0.5 - (nearest * half - stroke_half))
            index = x * 4
            row[index] = int(BLUE[0] + (WHITE[0] - BLUE[0]) * white_alpha + 0.5)
            row[index + 1] = int(BLUE[1] + (WHITE[1] - BLUE[1]) * white_alpha + 0.5)
            row[index + 2] = int(BLUE[2] + (WHITE[2] - BLUE[2]) * white_alpha + 0.5)
            row[index + 3] = int(255.0 * background_alpha + 0.5)

        rows.append(bytes(row))
    return rows


def downsample(rows: list[bytes], src_size: int, dst_size: int) -> list[bytes]:
    """Box-filter a square RGBA image down to dst_size (premultiplied alpha)."""
    if dst_size == src_size:
        return rows
    scale = src_size / float(dst_size)
    result: list[bytes] = []

    for y in range(dst_size):
        y0 = int(math.floor(y * scale))
        y1 = min(src_size, max(y0 + 1, int(math.ceil((y + 1) * scale))))
        out_row = bytearray(dst_size * 4)

        for x in range(dst_size):
            x0 = int(math.floor(x * scale))
            x1 = min(src_size, max(x0 + 1, int(math.ceil((x + 1) * scale))))
            r_sum = g_sum = b_sum = a_sum = count = 0

            for sy in range(y0, y1):
                source_row = rows[sy]
                for sx in range(x0, x1):
                    index = sx * 4
                    alpha = source_row[index + 3]
                    if alpha:
                        r_sum += source_row[index] * alpha
                        g_sum += source_row[index + 1] * alpha
                        b_sum += source_row[index + 2] * alpha
                    a_sum += alpha
                    count += 1

            index = x * 4
            if a_sum and count:
                out_row[index] = min(255, (r_sum + a_sum // 2) // a_sum)
                out_row[index + 1] = min(255, (g_sum + a_sum // 2) // a_sum)
                out_row[index + 2] = min(255, (b_sum + a_sum // 2) // a_sum)
                out_row[index + 3] = (a_sum + count // 2) // count
            # Otherwise the destination pixel stays fully transparent.

        result.append(bytes(out_row))
    return result


def png_chunk(kind: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)


def png_bytes(size: int, rows: list[bytes]) -> bytes:
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: None
        raw.extend(row)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def ico_bytes(images: list[tuple[int, bytes]]) -> bytes:
    """Build an ICO file whose entries carry PNG-compressed images."""
    directory = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = bytearray()
    payload = bytearray()

    for size, data in images:
        dimension = 0 if size >= 256 else size  # 0 encodes 256 in an ICO
        entries.extend(struct.pack("<BBBBHHII", dimension, dimension, 0, 0,
                                   1, 32, len(data), offset))
        payload.extend(data)
        offset += len(data)

    return bytes(directory) + bytes(entries) + bytes(payload)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    rounded_master = render(MASTER_SIZE, rounded=True)
    square_master = render(MASTER_SIZE, rounded=False)
    created: list[tuple[str, int]] = []

    def write(filename: str, data: bytes) -> None:
        (OUT_DIR / filename).write_bytes(data)
        created.append((filename, len(data)))

    for size in (512, 192, 48):
        rows = downsample(rounded_master, MASTER_SIZE, size)
        write("icon-%d.png" % size, png_bytes(size, rows))

    write("app-icon.png", png_bytes(MASTER_SIZE, square_master))

    ico_images = []
    for size in (16, 32, 48, 64, 128, 256):
        rows = downsample(rounded_master, MASTER_SIZE, size)
        ico_images.append((size, png_bytes(size, rows)))
    write("icon.ico", ico_bytes(ico_images))

    print("Created icons in %s" % OUT_DIR)
    for filename, length in created:
        print("  %-16s %8d bytes" % (filename, length))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import os
import struct
import zlib

CELL = 32
KINDS = [
    "tree_deciduous",
    "tree_conifer",
    "tree_dead",
    "shrub",
    "reed",
    "rock",
    "outcrop",
    "peak",
    "ridge",
    "snow_tuft",
]


def px(buf, width, x, y, color):
    if x < 0 or y < 0 or x >= width or y >= CELL:
        return
    index = (y * width + x) * 4
    buf[index:index + 4] = bytes(color)


def rect(buf, width, x, y, w, h, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            px(buf, width, xx, yy, color)


def line(buf, width, x0, y0, x1, y1, color):
    dx = abs(x1 - x0)
    sx = 1 if x0 < x1 else -1
    dy = -abs(y1 - y0)
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        px(buf, width, x0, y0, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = err * 2
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def triangle(buf, width, cx, top, half, bottom, color):
    for y in range(top, bottom + 1):
        t = (y - top) / max(1, bottom - top)
        span = int(half * t)
        for x in range(cx - span, cx + span + 1):
            px(buf, width, x, y, color)


def sprite(buf, width, kind, ox):
    white = (235, 235, 225, 255)
    light = (210, 214, 200, 255)
    mid = (165, 170, 158, 255)
    dark = (92, 96, 88, 255)
    trunk = (128, 118, 96, 255)
    if kind == "tree_deciduous":
        rect(buf, width, ox + 14, 19, 4, 10, trunk)
        for x, y, w, h, c in [(9, 12, 15, 9, light), (7, 17, 18, 7, white), (11, 8, 10, 7, white), (13, 15, 6, 7, mid)]:
            rect(buf, width, ox + x, y, w, h, c)
    elif kind == "tree_conifer":
        rect(buf, width, ox + 15, 21, 3, 8, trunk)
        triangle(buf, width, ox + 16, 5, 6, 16, white)
        triangle(buf, width, ox + 16, 11, 9, 23, light)
        triangle(buf, width, ox + 16, 17, 11, 28, mid)
    elif kind == "tree_dead":
        rect(buf, width, ox + 15, 9, 3, 20, trunk)
        for x0, y0, x1, y1 in [(16, 15, 8, 10), (16, 18, 24, 13), (16, 21, 10, 24), (16, 13, 20, 7)]:
            line(buf, width, ox + x0, y0, ox + x1, y1, trunk)
    elif kind == "shrub":
        for x, y, w, h, c in [(9, 20, 8, 7, white), (15, 17, 9, 9, light), (5, 22, 22, 6, mid)]:
            rect(buf, width, ox + x, y, w, h, c)
    elif kind == "reed":
        for x, h in [(9, 16), (13, 22), (17, 19), (22, 14)]:
            line(buf, width, ox + x, 29, ox + x + 1, 29 - h, white)
            px(buf, width, ox + x + 2, 29 - h + 2, light)
    elif kind == "rock":
        rect(buf, width, ox + 7, 20, 19, 7, mid)
        rect(buf, width, ox + 10, 16, 12, 5, light)
        rect(buf, width, ox + 18, 22, 6, 4, dark)
    elif kind == "outcrop":
        triangle(buf, width, ox + 11, 9, 7, 28, mid)
        triangle(buf, width, ox + 22, 14, 6, 28, light)
        rect(buf, width, ox + 13, 24, 10, 4, dark)
    elif kind == "peak":
        triangle(buf, width, ox + 16, 3, 13, 29, light)
        triangle(buf, width, ox + 19, 8, 7, 29, white)
        line(buf, width, ox + 16, 3, ox + 4, 29, dark)
    elif kind == "ridge":
        for x0, y0, x1, y1 in [(3, 27, 9, 11), (9, 11, 15, 25), (15, 25, 22, 8), (22, 8, 29, 27)]:
            line(buf, width, ox + x0, y0, ox + x1, y1, light)
        rect(buf, width, ox + 7, 23, 18, 5, mid)
    elif kind == "snow_tuft":
        for x, y, w, h in [(8, 22, 8, 5), (15, 19, 7, 8), (20, 23, 5, 4)]:
            rect(buf, width, ox + x, y, w, h, white)
        line(buf, width, ox + 10, 27, ox + 25, 27, light)


def chunk(kind, payload):
    data = kind + payload
    return struct.pack(">I", len(payload)) + data + struct.pack(">I", zlib.crc32(data) & 0xFFFFFFFF)


def write_png(path, width, height, rgba):
    rows = []
    stride = width * 4
    for y in range(height):
        rows.append(b"\x00" + rgba[y * stride:(y + 1) * stride])
    payload = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(payload, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as handle:
        handle.write(png)


def main():
    width = CELL * len(KINDS)
    buf = bytearray(width * CELL * 4)
    for index, kind in enumerate(KINDS):
        sprite(buf, width, kind, index * CELL)
    os.makedirs("assets", exist_ok=True)
    write_png("assets/billboards.png", width, CELL, bytes(buf))
    print("assets/billboards.png")


if __name__ == "__main__":
    main()

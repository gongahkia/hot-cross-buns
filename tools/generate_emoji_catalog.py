#!/usr/bin/env python3
"""Generate the complete Unicode Emoji 16 RGI QML catalogue."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path

SOURCE_URL = "https://unicode.org/Public/emoji/16.0/emoji-test.txt"
SOURCE_SHA256 = "24f0c534e86cf142e2496953e8f0e46a3e702392911eddcd29c6cced85139697"
QUALIFIED = re.compile(r"^([0-9A-F ]+)\s*;\s*fully-qualified\s*#\s*(.*?)\s+E[0-9.]+\s+(.*)$")


def shortcode(name: str) -> str:
    value = name.lower().replace("&", "and").replace("#", "number")
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_")


def source_bytes(arguments: argparse.Namespace) -> bytes:
    if arguments.source is not None:
        return arguments.source.read_bytes()
    if not arguments.download:
        raise SystemExit("pass --source or --download")
    with urllib.request.urlopen(SOURCE_URL, timeout=30) as response:
        return response.read()


def entries(data: bytes) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for raw_line in data.decode("utf-8").splitlines():
        match = QUALIFIED.match(raw_line)
        if match is None:
            continue
        emoji = "".join(chr(int(codepoint, 16)) for codepoint in match.group(1).split())
        name = shortcode(match.group(3))
        if emoji in seen or not name:
            continue
        seen.add(emoji)
        result.append((emoji, name))
    return result


def output_source(catalogue: list[tuple[str, str]]) -> str:
    rows = ",\n".join(
        "    [" + json.dumps(emoji, ensure_ascii=True) + ", " + json.dumps(name) + "]"
        for emoji, name in catalogue
    )
    return "\n".join((
        ".pragma library",
        "",
        "// generated from unicode emoji 16.0 emoji-test.txt; do not edit manually",
        f"// source: {SOURCE_URL}",
        f"// sha256: {SOURCE_SHA256}",
        "var rows = [",
        rows,
        "]",
        "",
    ))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    data = source_bytes(arguments)
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"unexpected source sha256: {digest}")
    catalogue = entries(data)
    if len(catalogue) < 3000:
        raise SystemExit(f"expected Unicode 16 RGI catalogue, got {len(catalogue)} entries")
    arguments.output.write_text(output_source(catalogue), encoding="utf-8")


if __name__ == "__main__":
    main()

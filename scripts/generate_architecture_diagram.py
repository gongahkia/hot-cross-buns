#!/usr/bin/env python3
"""Generate or verify the checked-in architecture PNG with diagrams-as-code."""

from __future__ import annotations

import argparse
import filecmp
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/architecture/hot-cross-buns-architecture.yaml"
OUTPUT = ROOT / "docs/assets/hot-cross-buns-architecture.png"


def render(target: Path) -> None:
    source = yaml.safe_load(SOURCE.read_text(encoding="utf-8"))
    source["diagram"]["file_name"] = str(target.with_suffix(""))

    with tempfile.TemporaryDirectory(dir=ROOT, prefix="architecture-diagram-") as directory:
        config_path = Path(directory) / "architecture.yaml"
        config_path.write_text(yaml.safe_dump(source, sort_keys=False), encoding="utf-8")
        subprocess.run(
            [sys.executable, "-m", "diagrams_as_code.entrypoint", "architecture.yaml"],
            check=True,
            cwd=directory,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail when the checked-in PNG is stale")
    args = parser.parse_args()

    if not SOURCE.is_file():
        raise FileNotFoundError(f"Missing architecture source: {SOURCE.relative_to(ROOT)}")

    with tempfile.TemporaryDirectory(dir=ROOT, prefix="architecture-diagram-") as directory:
        candidate = Path(directory) / OUTPUT.name
        render(candidate)
        if args.check:
            if not OUTPUT.is_file() or not filecmp.cmp(candidate, OUTPUT, shallow=False):
                raise SystemExit("Architecture diagram is stale. Run: corepack pnpm architecture:generate")
            print("Architecture diagram is current.")
            return

        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate, OUTPUT)
        print(f"Generated {OUTPUT.relative_to(ROOT)} with diagrams-as-code.")


if __name__ == "__main__":
    main()

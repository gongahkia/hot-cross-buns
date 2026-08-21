#!/usr/bin/env python3
"""Generate a deterministic local Python-product performance report."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from hcb.benchmarks import create_large_fixture, measure_large_fixture


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path)
    parser.add_argument("--keep-database", action="store_true")
    args = parser.parse_args()

    temporary: tempfile.TemporaryDirectory[str] | None = None
    if args.database is None:
        temporary = tempfile.TemporaryDirectory(prefix="hcb-python-benchmark-")
        database = Path(temporary.name) / "fixture.db"
    else:
        database = args.database.expanduser().resolve()
        database.parent.mkdir(parents=True, exist_ok=True)

    if database.exists():
        parser.error(f"database already exists: {database}")
    create_large_fixture(database)
    result = measure_large_fixture(database)
    print(json.dumps(result.as_dict(), indent=2, sort_keys=True))

    if temporary is not None and args.keep_database:
        parser.error("--keep-database requires --database")
    if temporary is not None:
        temporary.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

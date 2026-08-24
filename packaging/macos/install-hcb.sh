#!/bin/sh
set -eu

project_dir=${1:-"$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"}

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to run the HCB installer." >&2
  exit 1
fi

exec python3 "$project_dir/scripts/install-hcb.py" --source "$project_dir"

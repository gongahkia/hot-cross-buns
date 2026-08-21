#!/bin/sh
set -eu

if ! command -v pipx >/dev/null 2>&1; then
  echo "pipx is required (install it with: brew install pipx)" >&2
  exit 1
fi

project_dir=${1:-"$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"}
pipx install "$project_dir"
echo "Installed hcb. Run 'hcb daemon install' separately to enable reminders."

#!/bin/bash
# Trusted eval commands only. REVIEW/SKIP are reported separately from PASS.
set -u
command -v python3 >/dev/null 2>&1 || { echo 'Eval runner requires python3' >&2; exit 1; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
exec python3 "$script_dir/check.py" "$@"

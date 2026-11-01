#!/bin/bash
# exit 0 = allow; exit 2 = deny. Requires Python 3.9+.
set -u
command -v python3 >/dev/null 2>&1 || { echo 'Guard requires python3' >&2; exit 2; }
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 2
python3 "$script_dir/guard.py" production-gate
result=$?
[ "$result" -eq 0 ] && exit 0
exit 2

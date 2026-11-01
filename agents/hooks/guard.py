"""Compatibility guards; heuristics are not an OS sandbox or authorization service."""
import json
import os
from pathlib import Path
import re
import sys


def scoped_path(value):
    root = Path.cwd().resolve()
    path = (root / value).resolve()
    if not path.is_relative_to(root):
        raise ValueError('Path leaves workspace')
    return path


def run(kind):
    data = json.load(sys.stdin)
    if not isinstance(data, dict) or not isinstance(data.get('tool_input'), dict):
        raise ValueError('Expected tool_input object')
    field = 'command' if kind == 'production-gate' else 'file_path'
    value = data['tool_input'].get(field)
    if not isinstance(value, str) or not value.strip() or '\0' in value:
        raise ValueError('Missing or invalid tool input')
    if kind == 'production-gate':
        production = re.search(r'\b(prod|production)\b', value, re.I)
        mutation = re.search(r'\b(deploy|apply|replace|delete|rollout|upgrade|install)\b', value, re.I)
        if production and mutation and not os.environ.get('RELEASE_APPROVAL', '').strip():
            raise ValueError('Production operation requires release authorization')
    elif kind == 'protect-paths':
        path = scoped_path(value)
        config = Path('protected-paths.txt')
        # Missing optional policy means workspace containment only.
        if config.exists():
            for line in config.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if any(char in line for char in '*?['):
                    raise ValueError('Protected paths must be literal paths, not globs')
                protected = scoped_path(line)
                if path == protected or path.is_relative_to(protected):
                    raise ValueError('Protected path denied')
    elif kind == 'secrets-diff':
        text = scoped_path(value).read_text()
        patterns = [r'-----BEGIN [A-Z ]*PRIVATE KEY-----', r'AKIA[0-9A-Z]{16}',
                    r'''(?i)\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\r\n]{6,}''']
        if any(re.search(pattern, text) for pattern in patterns):
            raise ValueError('Possible credential detected')
    else:
        raise ValueError('Unknown guard')


if __name__ == '__main__':
    try:
        run(sys.argv[1])
    except (ValueError, OSError, RuntimeError, IndexError):
        # Do not echo untrusted input, file contents, or parser details.
        print('Guard denied: invalid input, policy violation, or unreadable resource.', file=sys.stderr)
        sys.exit(2)

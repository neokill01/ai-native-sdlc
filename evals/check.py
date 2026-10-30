"""Execute trusted repository eval definitions. Commands have host shell access."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def definition(path):
    data = json.loads(path.read_text())
    if not isinstance(data, dict) or not isinstance(data.get('id'), str) or not data['id'].strip():
        raise ValueError('id required')
    for key in ['description', 'project', 'verify']:
        if key in data and (not isinstance(data[key], str) or not data[key].strip()):
            raise ValueError(f'invalid {key}')
    if 'checks' in data and (not isinstance(data['checks'], list) or not all(isinstance(x, str) and x.strip() for x in data['checks'])):
        raise ValueError('invalid checks')
    if not data.get('verify') and not data.get('checks'):
        raise ValueError('verify or checks required')
    return data


def main():
    paths = list(map(Path, sys.argv[1:])) if len(sys.argv) > 1 else sorted(Path('evals').glob('*.json'))
    counts = dict(PASS=0, FAIL=0, REVIEW=0, SKIP=0)
    if not paths:
        print('RESULT: FAIL (no eval definitions)')
        return 1
    for path in paths:
        try:
            data = definition(path)
            print(f'[{data["id"]}]', flush=True)
            if data.get('project'):
                # Cross-project definitions must run in their own repository CI.
                counts['SKIP'] += 1
                print('SKIP: project-scoped eval; run in target repository')
            elif data.get('verify'):
                with tempfile.TemporaryFile(mode='w+') as log:
                    result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', data['verify']], stdout=log, stderr=log)
                    status = 'PASS' if result.returncode == 0 else 'FAIL'
                    counts[status] += 1
                    print(status)
                    if status == 'FAIL':
                        log.seek(0)
                        for line in log.readlines()[-20:]:
                            print(line.rstrip())
            else:
                counts['REVIEW'] += 1
                print('REVIEW:', '; '.join(data['checks']))
        except (ValueError, OSError) as error:
            counts['FAIL'] += 1
            print(f'FAIL: invalid definition or execution: {path.name} ({type(error).__name__})')
    print(' '.join(f'{key}={value}' for key, value in counts.items()))
    status = 'FAIL' if counts['FAIL'] else 'REVIEW' if counts['REVIEW'] or counts['SKIP'] else 'PASS'
    print(f'RESULT: {status}')
    return int(bool(counts['FAIL']))


if __name__ == '__main__':
    sys.exit(main())

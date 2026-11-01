import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class Guards(unittest.TestCase):
    def hook(self, name, payload, cwd=None, approval=None):
        env = dict(os.environ)
        env.pop('RELEASE_APPROVAL', None)
        if approval:
            env['RELEASE_APPROVAL'] = approval
        return subprocess.run(['bash', str(ROOT / 'agents/hooks' / name)], input=payload,
                              text=True, capture_output=True, cwd=cwd or ROOT, env=env)

    def test_invalid_input_denied(self):
        for hook in ['production-gate.sh', 'protect-paths.sh', 'secrets-diff.sh']:
            for payload in ['{', '{}', '{"tool_input":null}']:
                with self.subTest(hook=hook, payload=payload):
                    self.assertEqual(self.hook(hook, payload).returncode, 2)

    def test_release_gate(self):
        for command in ['deploy app to production', 'kubectl --context prod apply -f app.yaml']:
            payload = json.dumps({'tool_input': {'command': command}})
            self.assertEqual(self.hook('production-gate.sh', payload).returncode, 2)
            self.assertEqual(self.hook('production-gate.sh', payload, approval='release-123').returncode, 0)
        self.assertEqual(self.hook('production-gate.sh', json.dumps({'tool_input': {'command': 'npm test'}})).returncode, 0)

    def test_secrets_and_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.txt'
            for content in ['api_key = "audit-placeholder-value"', 'TOKEN: "audit-placeholder-value"', '-----BEGIN PRIVATE KEY-----']:
                path.write_text(content)
                result = self.hook('secrets-diff.sh', json.dumps({'tool_input': {'file_path': str(path)}}), directory)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('audit-placeholder-value', result.stderr)
            path.write_text('ordinary text')
            self.assertEqual(self.hook('secrets-diff.sh', json.dumps({'tool_input': {'file_path': str(path)}}), directory).returncode, 0)
            path.unlink()
            self.assertEqual(self.hook('secrets-diff.sh', json.dumps({'tool_input': {'file_path': str(path)}}), directory).returncode, 2)

    def test_paths(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root = Path(directory)
            (root / 'protected-paths.txt').write_text('src/gen/\n')
            (root / 'alias').symlink_to(outside, target_is_directory=True)
            for path in ['src/gen/file.ts', './src/gen/file.ts', 'src/../src/gen/file.ts', '../escape', 'alias/file.ts']:
                self.assertEqual(self.hook('protect-paths.sh', json.dumps({'tool_input': {'file_path': path}}), root).returncode, 2, path)
            self.assertEqual(self.hook('protect-paths.sh', json.dumps({'tool_input': {'file_path': 'src/general.ts'}}), root).returncode, 0)

class Evals(unittest.TestCase):
    def run_eval(self, *paths):
        return subprocess.run(['bash', str(ROOT / 'evals/check.sh'), *map(str, paths)], cwd=ROOT, text=True, capture_output=True)

    def test_bad_definitions_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'eval.json'
            for content in ['{', '{}', '{"id":"bad","verify":42}', '{"id":"bad","verify":""}']:
                path.write_text(content)
                self.assertNotEqual(self.run_eval(path).returncode, 0, content)
            self.assertNotEqual(self.run_eval(path.with_name('missing.json')).returncode, 0)

    def test_statuses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'eval.json'
            for command, expected in [('true', 0), ('false', 1), ('false; true', 1)]:
                path.write_text(json.dumps({'id': 'test', 'verify': command}))
                self.assertEqual(self.run_eval(path).returncode, expected)
            path.write_text(json.dumps({'id': 'timeout', 'verify': 'sleep 2', 'timeout_seconds': 1}))
            timed_out = self.run_eval(path)
            self.assertEqual(timed_out.returncode, 1)
            self.assertIn('command timed out after 1s', timed_out.stdout)
            path.write_text(json.dumps({'id': 'bad-timeout', 'verify': 'true', 'timeout_seconds': 0}))
            self.assertNotEqual(self.run_eval(path).returncode, 0)
            path.write_text(json.dumps({'id': 'review', 'checks': ['manual']}))
            result = self.run_eval(path)
            self.assertEqual(result.returncode, 0)
            self.assertIn('RESULT: REVIEW', result.stdout)

if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Read-only host report. Does not install, modify services, read credentials or call a model."""
import json
import os
import platform
import shutil
import subprocess


def probe(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=15)
        return p.stdout.strip() if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


memory = {}
try:
    with open('/proc/meminfo') as f:
        memory = {line.split(':')[0]: int(line.split()[1]) // 1024 for line in f if line.startswith(('MemTotal:', 'MemAvailable:'))}
except OSError:
    pass
free = shutil.disk_usage(os.getcwd()).free // (1024**3)
node = probe(['node', '--version'])
node_ok = bool(node and node.startswith('v') and node.split('.')[0][1:].isdigit() and int(node.split('.')[0][1:]) >= 24)
docker_ok = probe(['docker', 'info', '--format', '{{.ServerVersion}}']) is not None
report = {
    'os': platform.system(), 'architecture': platform.machine(), 'cpuCount': os.cpu_count(),
    'memoryMiB': memory, 'diskFreeGiB': free, 'nodeVersion': node,
    'gitAvailable': shutil.which('git') is not None, 'dockerDaemonAccessible': docker_ok,
    'deepseekKeyConfigured': bool(os.environ.get('DEEPSEEK_API_KEY')),
    'checks': {'linux': platform.system() == 'Linux', 'node24': node_ok, 'docker': docker_ok,
               'git': shutil.which('git') is not None},
    'notes': ['Capacity is preliminary, not a load-test result.',
              'For one small web task, initially target 2 CPU, 4 GiB RAM and 15 GiB free disk; measure existing workload first.',
              'Model weights are remote; local resources are used by the runner, dependencies and builds.'],
}
report['readyForSandboxTest'] = all(report['checks'].values())
print(json.dumps(report, indent=2))

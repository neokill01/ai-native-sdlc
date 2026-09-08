#!/bin/bash
# secrets-diff.sh —— 把凭证挡在 diff 之外（确定性护栏）
# 契约：从 stdin 读 JSON（含 .tool_input.file_path），扫描该文件内容是否含明显凭证模式，命中则 exit 2 拦截。
# exit 0 = 放行；exit 2 = 拦截。
#
# 适用场景：agent 编辑/新增文件时，防止把 API 密钥、私钥、密码、token 写进版本控制。
# 说明：本脚本只挡"明显"模式；更完备的应结合 CI 的 secret scan（gitleaks / trufflehog）。

INPUT=$(cat /dev/stdin)
path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$path" ] && exit 0
[ -f "$path" ] || exit 0

# 检测模式（命中任一即拦）
PATTERNS=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AKIA[0-9A-Z]{16}'
  '(?i)(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["'"'"'][^"'"'"']{6,}'
)

for pat in "${PATTERNS[@]}"; do
  if grep -q -E "$pat" "$path" 2>/dev/null; then
    echo "Possible credential in $path (matched: $pat). Refusing to keep it." >&2
    exit 2
  fi
done

exit 0

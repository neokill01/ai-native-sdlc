#!/bin/bash
# production-gate.sh —— 生产部署门禁（确定性护栏）
# 契约：从 stdin 读 JSON（含 .tool_input.command），若命中"生产发布"且没有授权环境变量，则 exit 2 拦截。
# exit 0 = 放行；exit 2 = 拦截（把原因写到 stderr）。
#
# 用法（Claude Code hooks）：.claude/settings.json 里把 PreToolUse(Bash) 指向本脚本。
# 发布经理在触发时设置 RELEASE_APPROVAL=<approval-ref>；否则拦截。

INPUT=$(cat /dev/stdin)
cmd=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# 命中"deploy + production"才算生产发布
if [[ "$cmd" == *"deploy"* && "$cmd" == *"production"* ]]; then
  if [ -z "$RELEASE_APPROVAL" ]; then
    echo "Production deploys need a release authorization. Set RELEASE_APPROVAL." >&2
    exit 2
  fi
fi

exit 0

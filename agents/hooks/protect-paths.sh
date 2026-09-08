#!/bin/bash
# protect-paths.sh —— 阻止编辑受保护/生成路径（确定性护栏）
# 契约：从 stdin 读 JSON（含 .tool_input.file_path），若命中受保护路径，则 exit 2 拦截。
# exit 0 = 放行；exit 2 = 拦截。
#
# 适用场景：生成的类（如 Flyway migration 生成的、src/gen/、schema 生成物）、冻结的包/遗留模块、
# 以及"修复任务期间禁止改动的测试文件"（防止修代码的 agent 削弱对那段代码的检查）。

INPUT=$(cat /dev/stdin)
path=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# 用换行分隔的受保护前缀（每条一行，如 src/gen/、v1/、src/test/**/ReviewServiceSm2ConfigTest.java）
PROTECTED="$PWD/protected-paths.txt"
if [ -f "$PROTECTED" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue
    if [[ "$path" == "$line"* ]]; then
      echo "Refusing to edit protected path: $path" >&2
      exit 2
    fi
  done < "$PROTECTED"
fi

exit 0

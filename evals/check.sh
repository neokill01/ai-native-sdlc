#!/bin/bash
# check.sh —— 持续回归评估运行器
# 扫 evals/*.json，对每个 eval：
#   - 若含 verify 命令：执行之（exit 0 → PASS，否则 FAIL）
#   - 若无 verify：将其 checks 列出来供模型/人工审（标注 REVIEW）
# 任一 FAIL 则整体 exit 1（供 CI 判定）。
#
# 用法：./evals/check.sh [eval.json ...]    默认扫 ./evals/*.json

set -u
SHOULD_FAIL=0
passed=0; failed=0; review=0

run_one() {
  local file="$1"
  local id desc prompt verify project base
  id=$(jq -r '.id // "unnamed"' "$file")
  desc=$(jq -r '.description // ""' "$file")
  verify=$(jq -r '.verify // ""' "$file")
  project=$(jq -r '.project // ""' "$file")

  echo "================================================"
  echo "[$id] $desc"

  # 跨项目 eval：若其目标目录未检出，则跳过（本身由该项目仓库自家 CI 跑）
  if [ -n "$project" ]; then
    base=$(printf '%s' "$verify" | sed -n 's#^cd \([^ ]*\) &&.*#\1#p')
    if [ -n "$base" ] && [ ! -d "$base" ]; then
      echo "  ==> SKIP（project eval: $base 未检出，建议在项目仓库 CI 跑）"
      review=$((review+1))
      return
    fi
  fi

  if [ -n "$verify" ]; then
    echo "  --- verify: $verify"
    if bash -c "$verify" >/tmp/eval_verify.log 2>&1; then
      echo "  ==> PASS"
      passed=$((passed+1))
    else
      echo "  ==> FAIL"
      tail -20 /tmp/eval_verify.log | sed 's/^/      /'
      failed=$((failed+1))
      SHOULD_FAIL=1
    fi
  else
    echo "  --- 无 verify，列为人工/模型审查点："
    jq -r '.checks[] | "      - \(.)"' "$file"
    review=$((review+1))
  fi
}

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  files=(./evals/*.json)
fi

for f in "${files[@]}"; do
  [ -f "$f" ] && run_one "$f"
done

echo "================================================"
echo "PASS=$passed  FAIL=$failed  REVIEW=$review"
if [ "$SHOULD_FAIL" -eq 1 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
exit 0

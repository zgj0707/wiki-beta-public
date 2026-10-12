#!/bin/bash
# 双推脚本：同时推送到飞书 Git (origin) 和 GitHub (github)
# 用法: bash scripts/push-all.sh [本地分支]
# 默认分支: sdwork（当前工作分支，推送到 origin 的 sprint/default 触发发布）

set -e

BRANCH=${1:-sdwork}

echo "=== 1/2 Pushing to Feishu Git (origin: $BRANCH -> sprint/default) ==="
git push origin "$BRANCH:sprint/default"

echo "=== 2/2 Pushing to GitHub backup (github: $BRANCH) ==="
git push github "$BRANCH"

echo "=== Done: 双推完成 ==="
#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]]; then
  for CANDIDATE in \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/Users/uiteam/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  do
    if [[ -x "$CANDIDATE" ]]; then
      NODE_BIN="$CANDIDATE"
      break
    fi
  done
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "没有找到 Node.js。请先安装 Node.js，或在终端中运行 pnpm install。"
  echo ""
  read -k 1 "?按任意键关闭窗口…"
  exit 1
fi

"$NODE_BIN" scripts/start-copilot.cjs
STATUS=$?

if [[ $STATUS -ne 0 ]]; then
  echo ""
  read -k 1 "?启动失败，按任意键关闭窗口…"
fi

exit $STATUS

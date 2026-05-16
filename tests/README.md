# Dionysus CLI Adapter H5 Test

日期：2026-05-16

本目录用于验证 Dionysus 的真实 CLI Adapter 是否能驱动不同 Agent CLI 落地产物，并由 Codex 执行浏览器级验收。

## 产物

| CLI | 目录 | 结果 |
| --- | --- | --- |
| Claude Code | `tests/claude-code-snake/index.html` | PASS |
| Gemini CLI | `tests/gemini-cli-snake/index.html` | PASS |
| OpenCode | `tests/opencode-snake/index.html` | PASS |
| OpenCode MiniMax M2.7 | `tests/opencode-minimax-snake/index.html` | PASS |

## 已验证内容

- 三个 CLI 均通过 Dionysus `createCliAdapter` 调用。
- 三个页面均为纯 H5 单文件，无外部依赖。
- Playwright 已验证 Canvas 可见且非空。
- Playwright 已验证开始按钮、键盘方向控制和移动端按钮。
- Playwright 未捕获浏览器控制台错误。

## 证据

浏览器截图保存在：

```text
tests/_e2e-screenshots/
```

本次测试还暴露并修复了 OpenCode Adapter 的工作目录问题：OpenCode 需要显式传入 `--dir <cwd>`，仅依赖进程 `cwd` 不可靠。

后续追加测试暴露并修复了 OpenCode MiniMax provider 解析问题：本地配置可能写 `minimax/MiniMax-M2.7`，但当前 `opencode models` 暴露的 provider 是 `minimax-cn-coding-plan`。Dionysus 现在默认通过 `DIONYSUS_OPENCODE_MODEL_ALIASES=minimax=minimax-cn-coding-plan` 做解析。

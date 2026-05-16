# E2E 与通知契约

## 里程碑检测

Master 必须在每次 main commit 后判断是否出现里程碑候选。

候选条件：

- 有用户可见页面或 API 闭环。
- 数据真实进入数据库。
- 页面刷新后状态仍存在。
- 至少有正向流程和关键异常流程。
- main 测试通过。
- 无 critical / blocker 任务。

## Codex E2E

里程碑进入 `e2e_required` 后，Codex 必须执行浏览器级 E2E。

默认测试工具：Playwright。

Codex CLI 必须支持：

```bash
pnpm dionysus e2e run-campaign --campaign-id "<campaign-id>" --mode strict
```

执行模式：

- `strict`：只自动执行通用浏览器检查，如 smoke、刷新持久性、控制台错误和截图。涉及业务输入、登录、提交、异常流的用例必须由 Codex 明确执行并逐条写入结果；系统不得伪造通过。
- `render-only`：只验证页面可以渲染、body 有内容、无新增 console error，并保存截图。仅适用于静态页面、文档或演示型里程碑，证据中必须写明 caveat。

E2E 结论：

```text
passed
failed
blocked
```

每条 E2E case 都必须落库保存：

- status。
- failureReason。
- screenshotPath。
- consoleErrors。
- targetUrl。
- 执行模式和 caveat。

## 通知

E2E passed 后通知用户。

通知内容必须包含：

- 完成了什么。
- 如何启动。
- 如何使用。
- 如何验收。
- E2E 证据。
- main commit。
- 已知风险。
- 下一步计划。

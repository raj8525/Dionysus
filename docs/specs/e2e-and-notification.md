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

E2E 结论：

```text
passed
failed
blocked
```

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

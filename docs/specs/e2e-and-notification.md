# E2E 与通知契约

## 里程碑检测

Master 必须在每次 main commit 后判断是否出现里程碑候选。

候选条件：

- 必须是最终用户能在浏览器中亲自体验的完整功能模块。
- 必须有用户可见页面和后端 / API / 数据库闭环，不能只有页面、接口、测试、文档或基础设施。
- 数据真实进入数据库。
- 页面刷新后状态仍存在。
- 至少有正向流程和关键异常流程。
- main 测试通过。
- 无 critical / blocker 任务。
- integration 结果必须写入 `finalUserFeatureEvidence[]` 和 `realDataPersistenceEvidence[]`。没有这两类显式证据时，Dionysus 不得自动创建 milestone。

不符合以上条件的进展只能记为 engineering checkpoint。例如后端 smoke、测试补齐、CLI 修复、文档更新、静态页面、单页渲染、mock 数据演示，都不得创建 milestone，也不得触发用户通知。

## Codex E2E

里程碑进入 `e2e_required` 后，Codex 必须执行浏览器级 E2E。

默认测试工具：Playwright。

状态转换门禁：

- `request-e2e` 只能把 `candidate` 推进到 `e2e_required`。
- 已经 `passed`、`notified`、`cancelled`、`e2e_running` 或其他非 `candidate` 状态的 milestone 再次请求 E2E 时，API 必须返回 `409 INVALID_MILESTONE_TRANSITION`，不能返回假成功。
- `create-campaign` 只能把 `e2e_required` 推进到 `e2e_running`。
- 未经过 `request-e2e` 的 `candidate`、已经完成的 `passed/notified` 或取消的 milestone 不得创建新的 E2E campaign。
- 上述门禁必须在 Repository / API 层执行，不能只依赖 SQL `where status = ...` 静默不更新。

Codex CLI 必须支持：

```bash
pnpm dionysus e2e run-campaign --campaign-id "<campaign-id>" --mode strict
```

执行模式：

- `strict`：执行最终用户视角的浏览器测试，至少覆盖 smoke、主路径、关键异常路径、刷新持久性、控制台错误和截图。系统只允许自动执行通用 smoke；涉及登录、业务输入、提交、异常流、刷新持久性的用例必须由 Codex 明确执行并逐条写入结果；系统不得伪造通过。
- `render-only`：只能用于工程 checkpoint 诊断，不能用于 milestone verdict，不能触发用户通知。

E2E 结论：

```text
passed
failed
blocked
```

里程碑判定门禁：

- `milestone verdict passed` 必须至少存在一个 E2E campaign。
- 该 milestone 下所有 E2E campaign 的状态必须都是 `passed`，才能把 milestone 标记为 `passed`。
- 任一 campaign 仍为 `created`、`running`、`failed` 或 `blocked` 时，API 必须拒绝 `passed` verdict。
- 每个 campaign 下所有已通过 case-result 的 `mode` 必须都是 `strict`。
- `render-only` 结果可以作为工程诊断记录，但不得作为 milestone passed 的证据。

每条 E2E case 都必须落库保存：

- status。
- failureReason。
- screenshotPath。
- consoleErrors。
- targetUrl。
- 执行模式和 caveat。

`status=passed` 的 case-result 必须包含浏览器证据：

- `mode="strict"` 或 `mode="render-only"`。
- 非空 `targetUrl`。
- 非空 `screenshotPath`。
- `consoleErrors` 数组，即使为空也必须显式记录。

缺少这些证据时，API 必须拒绝 `passed` 结果，不能把人工口头判断当成 E2E 通过。`render-only` 虽然可以记录为 case-result，但 milestone verdict 必须继续要求全部 case-result 使用 `mode="strict"`。

## 通知

E2E passed 后通知用户。

通知门禁：

- 只有 milestone 状态为 `passed` 时，才能创建 milestone notification。
- `candidate`、`e2e_required`、`e2e_running`、`e2e_failed`、`e2e_blocked`、`cancelled` 均不得创建“里程碑已完成”通知。
- API 必须在门禁未满足时返回阻塞错误，避免用户收到未验收完成的误报。

通知内容必须包含：

- 完成了什么。
- 如何启动。
- 如何使用。
- 如何验收。
- E2E 证据。
- main commit。
- 已知风险。
- 下一步计划。

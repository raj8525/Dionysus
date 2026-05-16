# Dionysus MVP BDD 测试说明

## 覆盖规格

- `docs/specs/architecture.md`
- `docs/specs/state-machine.md`
- `docs/specs/api.md`
- `docs/specs/e2e-and-notification.md`

## 场景 1：创建目标

Given Dionysus API 已启动  
When Codex 提交一个 goal  
Then PostgreSQL 中必须出现 goal 记录  
And goal 状态为 `created`  
And 系统事件中记录 `goal.created`

## 场景 2：任务状态机拒绝非法迁移

Given 一个状态为 `created` 的 task  
When 系统试图直接迁移到 `done`  
Then 状态机必须拒绝  
And 返回非法迁移错误

## 场景 3：里程碑不能跳过 E2E

Given 一个状态为 `candidate` 的 milestone  
When 系统试图直接迁移到 `passed`  
Then 状态机必须拒绝  
And 要求先进入 `e2e_required`

## 场景 4：Flow 页面展示目标执行链路

Given Dionysus API 已启动  
When Codex 创建 Coupon goal  
And 前端请求 `/api/flow/current`  
Then 响应必须包含 goal、PLAN、specs、features_test、Workers、Integration Queue、Milestone、Codex E2E、Notify User 节点  
And 节点之间必须按执行顺序连接

## 场景 5：里程碑通过后生成通知

Given 一个 milestone 已通过 Codex E2E  
When Notification Service 发送通知  
Then 通知内容必须包含已完成功能、启动方式、使用方式、验收方式、E2E 证据、main commit、已知风险和下一步计划

## 场景 5.1：里程碑不能绕过 Codex verdict

Given Master 创建了 milestone candidate  
When Master 请求 E2E  
Then milestone 状态必须进入 `e2e_required`  
When Codex 提交 `passed` verdict  
Then milestone 状态才能进入 `passed`

## 场景 6：文档编译和缺口扫描

Given 一个指向 Coupon 项目的 goal  
When Codex 调用 `/api/goals/:id/intake`  
Then Dionysus 必须扫描 `AGENTS.md`、`docs/`、管理后台 HTML / Vue 页面  
And 将文档清单写入 `documents`  
And 将 `待补充`、`未定义`、`占位`、`后续`、`P1` 等缺口写入 `document_findings`  
And 生成产品构建图节点和依赖边

## 场景 6.1：Master 生成 SDD/TDD 任务树

Given 一个已经创建的 goal  
When Codex 调用 `/api/goals/:id/bootstrap`  
Then Dionysus 必须创建 Master、RuleWriter、TestWriter、Worker、Master Review 任务  
And Worker 任务必须排在规格和测试任务之后

## 场景 7：Spec/Test Gatekeeper 阻止无规格实现

Given 一个指向目标项目的 goal  
When Codex 调用 `/api/goals/:id/gate-check`  
Then Dionysus 必须检查 `docs/PLAN.md`、`docs/specs/`、`features_test/`  
And 将检查结果写入 `gate_checks`  
And 如果缺少任一门禁，则返回 `blocked`

## 场景 8：Worker patch 必须进入 Integration Queue

Given Worker 完成隔离 workspace 内的实现  
When Worker 提交 patch  
Then Dionysus 必须写入 `patches`  
And 同时创建 `integration_queue` 记录  
And task event 必须记录 `patch.queued`

## 场景 8.1：Integration Queue 自动应用 patch

Given `integration_queue` 中存在 queued patch  
And 目标主工作区是干净 Git 状态  
When integration worker 消费消息  
Then Dionysus 必须先执行 `git apply --check`  
And 成功后应用 patch  
And 如果配置了验证命令，必须执行验证命令  
And 将 patch 标记为 `applied`  
And 将 integration 标记为 `passed`

## 场景 8.2：脏工作区必须阻止集成

Given 目标主工作区存在未提交改动  
When integration worker 尝试应用 patch  
Then Dionysus 必须拒绝应用  
And 将 integration 标记为 `failed`  
And result_json 必须记录 dirty worktree 原因

## 场景 8.3：验证失败必须自动回滚

Given patch 已成功应用  
And integration 验证命令失败  
When integration worker 处理结果  
Then Dionysus 必须反向应用 patch 回滚  
And 目标 Git 工作区必须恢复干净  
And integration 必须标记为 `failed`

## 场景 9：Master 自动识别里程碑候选

Given integration queue 已通过  
And patch 已应用  
And 测试状态为 passed  
When Codex 或 Master 触发 milestone detection  
Then Dionysus 必须创建 milestone candidate  
And milestone 不得跳过 Codex E2E

## 场景 10：E2E campaign 必须覆盖浏览器级验收

Given milestone candidate 已进入 E2E 阶段  
When Dionysus 创建 E2E campaign  
Then 必须包含 smoke、happy path、negative path、persistence 用例  
And Codex 执行后才能写入 verdict

## 场景 11：里程碑通过后必须通知

Given Codex E2E verdict 为 passed  
When Dionysus 生成 milestone notification  
Then 通知正文必须包含实现内容、如何使用、如何验收和剩余风险  
And 投递记录必须进入 `notification_deliveries`

## 运行命令

```bash
pnpm test
```

## 当前预期

第一阶段应先出现红灯测试，然后通过实现转绿。

# Resume Bullets

下面内容基于当前仓库已实现和可运行的功能。百分比必须在投递前重新执行 `pnpm harness:interview`，再替换为最新报告。

## 中文

**ScoutPi Workbench：基于 Pi 的空间调查 Agent 运行时**

- 设计 Pi 原生 Agent 运行时，将数据注册、规划、计算、导出、证据和工作流能力收敛为 3 个动态网关工具；相较一次性披露 8 个 runtime contract 的固定基线，tool schema 估算从 1,478 降至 380 tokens，减少 74.29%。
- 实现带来源链的 Context Pack，对中英文混合候选进行任务排序和 token 预算；固定 fixture 将上下文从 1,394 压缩至 384 tokens，并保留 provider/source provenance。
- 构建真实 Human-in-the-loop 治理：在 Pi 生命周期中拦截高风险调用，签发参数绑定、短时、单次消费的审批凭证，禁止模型通过 `confirmed: true` 绕过用户决策。
- 实现 durable checkpoint、任务恢复和 workflow compiler；进程重启后区分可重试本地任务与仍运行的远端任务，成功流程可由 3 个控制操作编译为 1 次确定性复放，并在 Adapter 漂移或成本扩大时阻断。
- 建立 outcome-based Agent Evaluation，从真实 plan/job/artifact/approval/evidence 状态评分并生成 SHA-256 完整性报告；评测默认不持久化原始 prompt、工具 payload、凭证和 provider URL。
- 构建 MapLibre/Cesium 双渲染 Workbench，在同一持久化空间状态上展示 Pi 的区域、影像、图层、证据、任务与 2D/3D 视角；支持中英文操作界面和移动端。

## English

**ScoutPi Workbench - Pi-native spatial investigation runtime**

- Consolidated registry, planning, compute, export, evidence and workflow capabilities into three dynamically activated Pi gateway tools; reduced the fixed-fixture schema estimate from 1,478 to 380 tokens (74.29%) against eagerly disclosing eight runtime contracts.
- Built provenance-aware Context Packs with mixed-language token budgeting and task ranking; reduced a fixed candidate fixture from 1,394 to 384 delivered tokens while retaining provider/source lineage.
- Implemented real human-in-the-loop governance through Pi lifecycle interception and parameter-bound, expiring, single-use approval receipts, preventing model-authored confirmation flags from bypassing operator consent.
- Added durable checkpoints, restart recovery and a workflow compiler that distinguishes retryable local work from preserved remote tasks and replays successful flows with adapter-drift, cost and assertion guards.
- Built outcome-based Agent evaluation over persisted plans, jobs, artifacts, approvals and evidence, producing integrity-bound reports without storing raw prompts, tool payloads, credentials or provider URLs.
- Delivered a bilingual MapLibre/Cesium operator console over one durable Pi spatial-state contract, including task focus, imagery, evidence, execution, 2D/3D switching and responsive layouts.

## 口头版

> 我没有再做一个会调 GEE API 的聊天机器人，而是围绕 Pi 做了一个可治理、可恢复、可评测的空间 Agent 运行时。模型只有三个工具，具体数据和算法通过类型化 Adapter/Backend 扩展；执行前有真实用户审批，执行后有 artifact 和证据审查，成功流程还能编译复放。项目的 token、恢复和 outcome 指标都由本地 harness 生成，不是手写 Demo 数字。

# ScoutPi Workbench Interview Guide

这份文档是项目的面试入口。先讲工程问题，再讲空间领域能力。不要把项目介绍成一个功能很多的 GEE 工具箱。

## 一句话定位

> ScoutPi Workbench 是一个以 Pi 为 Agent 基座的通用空间运行时：模型只看到三个稳定网关，运行时负责类型化计划、权限、长任务、证据、恢复和工作流复放，Workbench 负责让这些状态可审阅。

## 面试官应该先看到什么

1. **不是聊天壳**：Pi 的工具调用会落成 `InvestigationSpec -> DatasetPlan -> AnalysisDAG -> Job -> Artifact`。
2. **不是无限权限脚本**：模型不能执行任意 Python、JavaScript、shell 或 Earth Engine 表达式；高风险操作需要 Pi UI 产生的一次性审批凭证。
3. **不是靠提示词声称可靠**：评测读取真实计划、任务、证据、审批和 artifact 状态，不根据回答语气打分。
4. **不是每次重新探索**：成功运行可以编译为冻结 Adapter 指纹、前置条件和断言的 workflow，漂移时明确阻断。
5. **不是只跑一次的 Demo**：Checkpoint 和 Job Store 能在进程重启后区分可重试本地任务与仍在远端运行的任务。

## 架构主线

```text
User task
  -> Pi Agent and investigation Skill
  -> three compact tools
  -> Context Pack and policy interception
  -> typed Earth Workspace contracts
  -> reviewed backend providers
  -> durable jobs and artifacts
  -> Evidence Reviewer and workflow compiler
  -> Workbench evaluation and operator views
```

模型只看到：

```text
earth_workspace
python_analysis
earth_story
```

Context、Browser Evidence、Governance、Observability、Checkpoint 和 Trigger 都通过 Pi 生命周期事件工作，不增加常驻工具 schema。

## 三个最值得展开的工程问题

### 1. Tool 和 Context 为什么会膨胀

如果把每个数据集、动作和后端注册成独立工具，模型在真正观察任务前就要支付所有 schema token。ScoutPi 保留三个网关，将具体合约按操作查询，并用 Context Pack 在固定预算内选择带 provenance 的候选。

固定 fixture 的当前实测结果：

| 项目 | 基线 | 当前 | 下降 |
| --- | ---: | ---: | ---: |
| eager tool contracts | 1,341 tokens | 380 tokens | 71.66% |
| all context candidates | 1,394 tokens | 384 tokens | 72.45% |
| exploration control calls | 3 calls | 1 replay call | 66.67% |

这些数字由 `pnpm harness:interview` 生成，不是写死在运行时里的宣传值。不同代码版本应重新运行，不沿用旧结果。

### 2. 为什么 `confirmed: true` 不是审批

模型可以自己生成布尔参数，因此它不能代表用户同意。Governance 在 `tool_call` 生命周期拦截风险操作，调用 Pi 的 `ctx.ui.confirm()`，随后签发参数绑定、短时、单次消费的 approval receipt。运行时校验 receipt，而不是信任模型字段。

### 3. 进程被杀后怎么恢复

Checkpoint 只保存恢复所需的结构化引用，不保存完整对话。重启后：

- 没有附着 worker 的本地导出标记为失败且可重试；
- 带远端 task ID 的任务保持运行，避免重复提交；
- Pi 收到“先查询持久化状态再重试”的恢复上下文。

`pnpm harness:recovery` 会真的创建中断状态，再用新的 Workspace 实例恢复并验收。

## 和常见浏览器 / MCP / 多 Agent 方案的边界

- BrowserBridge 单独负责已有 Edge 会话、交互、下载和网页证据；ScoutPi 只消费规范化 Evidence Contract。
- MCP server 是外部客户端兼容面，不替代 Pi，也不暴露 live/admin 操作。
- 通用 subagent、goal 和扩展市场能力优先复用 Pi 生态；ScoutPi 不再实现一套通用多 Agent 调度器。
- GEE、geedim、geetools 等是可替换 Provider；核心运行时不按森林、洪水或城市变化写分支。

## 真实与受控验证边界

- CI 和本地 `pnpm check` 使用确定性 fixture，不调用付费模型或 live GEE。
- `gpt-5.6-sol` 是默认真实 Pi 测试模型；当前已验证 RPC、扩展和 Skill 启动。配置的 provider 若返回 `MODEL_NOT_FOUND`，报告状态是 blocked，不会静默降级。
- `gpt-5.5` 仅作为受控 fallback 验证：已通过 plan-only 和 dry-run outcome case。它不是 README 的默认模型声明。
- live Earth Engine 结果依赖账户、项目、配额、数据可用性和区域尺度，不能用 dry run 冒充计算结论。

## 学习顺序

后续逐项学习时建议按真实数据流阅读：

1. `.pi/extensions/scoutpi-earth/index.ts`：三个工具如何接到 Pi。
2. `packages/earth-investigation-core/`：输入如何编译成类型化计划和 DAG。
3. `packages/runtime-governance/`：审批凭证为什么不能由模型伪造。
4. `packages/runtime-context/`：候选、排序、token budget 和 provenance。
5. `packages/runtime-checkpoint/`：状态机、引用和恢复。
6. `packages/runtime-evaluation/`：为什么评测 artifact 也需要 schema、隐私和完整性。
7. `harness/interview/`：指标如何由可复现 fixture 生成。

演示顺序见 [DEMO_SCRIPT.md](DEMO_SCRIPT.md)，简历表述见 [RESUME_BULLETS.md](RESUME_BULLETS.md)。

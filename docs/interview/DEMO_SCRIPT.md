# Interview Demo Script

目标时长：8 到 10 分钟。先证明系统边界，再展示地图。不要从“支持哪些数据集”开始。

## 0. 演示前

```bash
pnpm install
uv sync --extra pipeline
pnpm examples:seed
pnpm harness:interview
pnpm harness:interview-demo
pnpm harness:recovery
pnpm workbench:dev
```

打开 `http://127.0.0.1:5173`。在 Runtime Center 中依次查看 **Evaluation**、**Context**、**Telemetry**。

## 1. 30 秒定位

口述：

> 这个项目不是给每个遥感场景写一个 Agent。Pi 负责理解任务和选择工具；ScoutPi 用三个稳定工具把请求编译为类型化空间计划，管理审批、任务、证据、恢复和复放；Workbench 是操作员查看这些状态的控制台。

## 2. 工具与上下文预算

打开 **Evaluation**，选择最新 Benchmark。

指出：

- 工具面固定为三个网关；具体合约按需披露。
- Context Pack 从固定候选中按任务选择，并遵守 420-token fixture 预算。
- UI 数字直接读取 `.scoutpi/evaluations` 的完整性校验报告。

不要背百分比。读取当前面板的 baseline/current/improvement。

## 3. 通用 claim-to-evidence 流程

选择最新 End-to-end 报告，说明 `pnpm harness:interview-demo` 做了：

```text
Browser evidence
  -> explicit claim/hypothesis binding
  -> typed investigation plan
  -> deterministic dry run
  -> Evidence Reviewer
  -> Evidence Graph
  -> workflow compile
  -> workflow replay
```

强调：dry run 只证明计划和执行结构，不会计入 computed evidence；故事保留“仍需 live computation”的不确定性。

## 4. 2D / 3D 空间状态

返回主 Workbench：

1. 左侧说明它是 Pi 任务历史，不是人工项目菜单。
2. 中间切换 MapLibre 2D / Cesium 3D，二者读取同一个 `spatial-view`、region 和 tile contract。
3. 右侧展示 Pi 当前能理解的 region、observable、year、dataset、evidence 和 run state。
4. 说明本地查看会 detach，选择 Follow Pi 才恢复 Agent 的持久化焦点。

## 5. 权限和恢复

打开 Runtime Center 的 Overview/Context：

- Governance receipt 来自真实 Pi UI，而不是模型参数。
- Checkpoint 只保存 ID、状态和下一动作。

选择 Recovery evaluation：本地中断任务被标记为 retryable；远端 task ID 保留为 running；恢复提示要求先查状态，避免重复提交。

## 6. Workflow Compiler

回到 Evaluation 的 workflow metric：

> 首次探索需要 plan、run、compile；成功后由一个 replay 操作执行。复放前会检查 Adapter 指纹、成本和断言，漂移不会被静默修复。

## 7. 结束语

> 我把重点放在 Agent 应用真正容易失败的部分：上下文和工具膨胀、模型越权、长任务中断、证据过度陈述，以及 Demo 无法回归。空间计算只是可插拔领域后端，运行时边界可以继续接其他科学计算 Provider。

## 常见追问

**为什么不用纯 MCP？**

Pi 生命周期允许零工具扩展做 context、approval、trace 和 checkpoint；MCP 保留为外部兼容面，避免让大量 schema 常驻模型上下文。

**为什么不用 LangGraph 再做状态机？**

Pi 已拥有 Agent loop、session、extension 和工具执行。ScoutPi 只实现领域任务状态、持久化引用和可恢复副作用，不复制宿主 Agent。

**为什么评测不用 LLM-as-judge？**

核心通过条件都可从 plans/jobs/artifacts/approvals/evidence 中确定性读取。Reviewer 模型可以补充语义审查，但不能替代权限和 artifact 事实。

**如果 GEE 没授权呢？**

计划、dry run、合约、评测和恢复仍可运行；live probe/tile/export 明确 blocked_auth，不能声称已完成计算。

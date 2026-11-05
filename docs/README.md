# 文档与知识库

核对日期：2026-11-05。实现基线：`acb54b1`；本轮仅更新文档。功能是否存在以源码为准，是否验证以对应运行证据为准。

## 按任务阅读

| 你要做什么 | 阅读入口 |
|---|---|
| 首次了解项目 | [仓库 README](../README.md) → [当前实现](devos/00-文档导航与现状审计.md) |
| 定位代码与模块 | [架构](devos/02-技术架构设计.md) → [代码知识索引](knowledge/code-map.md) |
| 理解审批、API 与恢复 | [核心流程与接口](devos/03-核心流程与接口契约.md) |
| 本地开发、运行测试 | [开发与验证](knowledge/development.md) |
| 配置模型、处理执行故障 | [运行与排障](knowledge/operations.md) |
| 体验管理台 | [React 管理台](devos/09-react-vite-console.md) |
| 部署私有管理台 | [私有服务部署](devos-private-deployment.md) |
| 选择下一步研发范围 | [路线图与验收](devos/04-实施计划与验收.md) |
| 在其他项目采用流程 | [Playbook](playbook.md)、[采用阶梯](adoption.md)、[DSH 映射](dsh-preset.md) |
| 添加或维护知识 | [知识维护规范](knowledge/maintenance.md) |

## 资料分层

- **当前事实**：本导航、当前实现、架构、接口、包 README、`knowledge/`、管理台及部署指南。修改代码时同步维护。
- **目标与要求**：[PRD](devos/01-产品需求PRD.md)、[安全要求](devos/05-安全评测与风险.md)。要求不等于已交付。
- **历史证据**：[P0 审计](devos/06-P0-audit-20261030.md)、[实施日志](devos/07-implementation-progress.md)。保留当时结果，不用于推断当前功能缺失。
- **试点准备**：[DeepSeek/腾讯云试点](devos/08-deepseek-tencent-pilot.md)。记录准备方案，不代表真实模型与服务器已验证。

知识库目前是受 Git 管理的 Markdown 文档。自动索引、向量检索、MemoryCandidate 审核系统和运行时知识注入尚未实现。

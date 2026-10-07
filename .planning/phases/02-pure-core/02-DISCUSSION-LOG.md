# Phase 2: 纯核心（animStrip + animSet）- Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-07
**Phase:** 2-pure-core
**Areas discussed:** 拟合的接口与阈值, 方向预设与命名进制, 续跑判定的真相源, 规格校验的严格度, prompt 模板怎么放

---

## 拟合的接口与阈值

| Option | Description | Selected |
|--------|-------------|----------|
| 纯模块包下拟合与剖面 | `columnProfile` + `fitPanelGrid` 都在纯模块，阈值参数化 | ✓ |
| 只接受算好的剖面 | 边界更窄，但两个调用方各自要会算剖面 | |
| 拟合放 Phase 3 | 现在少写，但 Phase 3 的闸门无法单测 | |

**User's choice:** 纯模块包下拟合与剖面

## 方向预设与命名进制

| Option | Description | Selected |
|--------|-------------|----------|
| 预设写进纯模块 | `DIRS8`/`DIRS4` 常量表；规格写预设名；进制转换只在一处 | ✓ |
| 方向数组由规格传 | 更自由，但"顺序即契约"靠人守 | |

**User's choice:** 预设写进纯模块

## 续跑判定的真相源

| Option | Description | Selected |
|--------|-------------|----------|
| 记录 + 事实两个输入 | 纯函数收 `strips[]` 与"raw 可解码/derived 齐不齐"两个布尔 | ✓ |
| 只看记录里的 ok | 简单，但"截断的 PNG 被当成已完成"的坑回归 | |

**User's choice:** 记录 + 事实两个输入

## 规格校验的严格度

| Option | Description | Selected |
|--------|-------------|----------|
| 分两档 | 硬错清单 + 未知字段 warning | ✓ |
| 全部硬错 | 最严；以后调规格会卡 | |
| 尽量宽容 | 只在花钱时才报错 | |

**User's choice:** 分两档

## prompt 模板怎么放

| Option | Description | Selected |
|--------|-------------|----------|
| 模板 + 自动生成枚举 | 约束句常量；`cell i facing <dir>` 由 dirs 生成 | ✓ |
| prompt 由外面传 | 灵活，但"每格对哪个方向"靠人工写对 | |

**User's choice:** 模板 + 自动生成枚举

---

## 进入本阶段前的两个闸门

- **Context**：用户选择"先讨论"（而非直接规划）。
- **Research**：用户选择"跳过研究"——地基已由项目级研究（1891 行）与 Phase 1 的阶段研究打完。

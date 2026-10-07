# Phase 3: strip → frames 后处理 - Discussion Log

> **Audit trail only.** Decisions live in CONTEXT.md.

**Date:** 2026-10-07
**Phase:** 3-strip-frames
**Areas discussed:** 边界被占, 抠底预设, 缩放策略, op 形状, 冒烟测什么

---

## 边界被占（实测 gutter_ok=false）

| Option | Description | Selected |
|--------|-------------|----------|
| 先抢救，抢不回来才失败 | 用 `isolatePrimarySpriteComponent` 以格中心取连通块，切掉邻格残肢 | ✓ |
| 踩线就整条失败 | 最严；实测那 1/8 会被直接毙掉 | |
| 照切并标记 | 最宽容，但错帧会悄悄进游戏 | |

**User's choice:** 先抢救，抢不回来才失败

## 抠底预设

| Option | Description | Selected |
|--------|-------------|----------|
| 新增 binary 档 | 阈值拉高、软边 0、保留 despill；对应实测的饱和洋红 cast 244 | ✓ |
| 复用 prop 档 | 少一档配置，但软边仍在 | |
| 参数外部传 | 破坏"一处一个事实" | |

**User's choice:** 新增 binary 档

## 缩放策略

| Option | Description | Selected |
|--------|-------------|----------|
| 87.5% 留边 + 最近邻 | 与消费端 64/56 同比例；像素画不被插值糊掉 | ✓ |
| 不缩放只居中 | 保真，但大图被切边 | |
| 用现有 normalizeSpriteFrameScale | 省事，但改像素观感 | |

**User's choice:** 87.5% 留边 + 最近邻

## op 形状

| Option | Description | Selected |
|--------|-------------|----------|
| 沿用 bridge 既有形状 | `IN[0]` + `opts` → `{ data, meta }`，阈值参数化 | ✓ |
| 只收拟合结果 | 边界干净，但两个调用方各自要先切图 | |

**User's choice:** 沿用 bridge 既有形状

## 冒烟测什么

| Option | Description | Selected |
|--------|-------------|----------|
| 真实图上跑完整断言组 | 每帧尺寸/四角透明/留边/gutter 与拟合值/计数器非零 + 基线对齐缺席（行为+源码双查） | ✓ |
| 合成图跑单测 | 快，但测不出真模型画的条带的脾气 | |

**User's choice:** 真实图上跑完整断言组

---

## 进入本阶段前的两个闸门

- **Context**：沿用前两阶段的既有做法（先讨论）。
- **Research**：本阶段是对既有导出的薄组合，参照实现就在仓库里，无需外部调研。

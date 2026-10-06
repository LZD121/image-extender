# Phase 1: 传输探针与精确尺寸透传 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-06
**Phase:** 1-传输探针与精确尺寸透传
**Areas discussed:** 先敲哪扇门, 尺寸怎么落地, 探针产物, 花钱边界, 探针范围

---

## 先敲哪扇门（通道顺序）

| Option | Description | Selected |
|--------|-------------|----------|
| 先试本机网关 | 什么都不用配，但历史上单张图 29–35 秒，而它有约 15 秒超时的毛病，很可能白搭；不行再切 Teamo | ✓ |
| 直接上 Teamo | 游戏现在在用的通道，已知能出正确的图；但要先配 key 文件并绕过被污染的 DNS | |
| 两条都试 | 各试一次，花两次钱，最快拿到对比表 | |

**User's choice:** 先试本机网关
**Notes:** 与已锁定的"失败模式是超时"预期一致；失败后的下一步是 Teamo（表达成 magpie profile，不新增 provider）。

## 尺寸怎么落地

| Option | Description | Selected |
|--------|-------------|----------|
| 改那张表 | 把 8:1、4:1 加进本地比例表；改动小但会改变其它组合的取整结果（56 种里有 10 种） | ✓ |
| 给生成通道加精确尺寸 | 不动表，让请求能直接指定像素宽高；更贴近"要什么得什么"，但要动生成通道代码 | |
| 一行不改，靠通道解决 | 代码不动，靠切到 Teamo；换回其它网关就又不行 | |

**User's choice:** 改那张表
**Notes:** 用户要求能看到受影响的组合清单（D-04 已写死：列出 10 种变化并断言六个现有 studio 不受影响）。

## 探针产物

| Option | Description | Selected |
|--------|-------------|----------|
| 文字记录 + 存一张图 | 测量结果写成文字存进 phase 目录；一张真实条带图（1–3MB）存进测试素材目录 | ✓ |
| 只记文字，图用游戏仓库的 | 省 2MB，但两个仓库绑在一起 | |
| 都不存 | 最干净，但自动测试没素材 | |

**User's choice:** 文字记录 + 存一张图

## 花钱边界

| Option | Description | Selected |
|--------|-------------|----------|
| 失败就停，等用户发话 | 探针失败即停下报告，人工决定是否再花第二次钱 | ✓ |
| 允许自动重试一次 | 无人值守也能走完，最多两次 | |
| 允许自动重试两次 | 最多三次 | |

**User's choice:** 失败就停，等你发话

## 探针范围

| Option | Description | Selected |
|--------|-------------|----------|
| 只测 8 向 | 只跑怪物形状（8 格）；英雄的 4 方向留到 Phase 7 | ✓ |
| 8 向 + 4 向都测 | 多花一次钱，提前暴露两套命名的差异 | |

**User's choice:** 只测 8 向

---

## 过程中的额外反馈

- 用户要求：**讨论时讲人话，少用专业术语**（已记录为长期偏好）。本 phase 后续的规划与执行输出都按此执行。

---

*Phase: 1-传输探针与精确尺寸透传*
*Discussion log: 2026-10-06*

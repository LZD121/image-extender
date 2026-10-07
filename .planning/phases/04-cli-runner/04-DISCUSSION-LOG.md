# Phase 4: CLI runner - Discussion Log

> **Audit trail only.** Decisions live in CONTEXT.md.

**Date:** 2026-10-07
**Phase:** 04-cli-runner
**Areas discussed:** 账本形态, 并发, 失败重试, 规格来源, 输出形状

---

| Area | Options | Selected |
|---|---|---|
| 账本形态 | set.json 当账本 ✓ / 单独 ledger 结束时合成 / 结束时写一次 | **set.json 当账本**（每张完成即原子重写） |
| 并发 | 串行 ✓ / 支持 `--parallel N` | **串行** |
| 失败重试 | 退避重试 2 次 + 失败即停 ✓ / 重试后默认继续 | **重试 2 次、失败即停**（`--keep-going` 才继续） |
| 规格来源 | `--spec` 文件为主 + 内联 flags ✓ / 只收文件 | **文件为主、内联为辅** |
| 输出形状 | 沿用 `okEnvelope` ✓ / 只打文本 | **okEnvelope**（plan 返回计划数组，run 返回 `{written, strips, setJson}`） |

**User's choice:** 全部取推荐项。

---

## 进入本阶段前的两个闸门

- **Context**：沿用前三个阶段的做法（先讨论）。
- **Research**：本阶段是把既有模块与 op 串起来，参照实现与契约都在仓库里，无需外部调研。

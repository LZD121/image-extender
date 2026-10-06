---
phase: "1"
slug: "transport-probe"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.9（已有；`vitest.config.ts`，node 环境） + 一次性测量脚本（node，`sharp` 0.34.5 已在依赖里） |
| **Config file** | `vitest.config.ts`（既有） |
| **Quick run command** | `npx vitest run app/api/generate/__tests__ app/lib/__tests__/providers.test.ts` |
| **Full suite command** | `npm test`（仓库全量 vitest） |
| **Estimated runtime** | 快速 ~5 秒；全量 ~40 秒 |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run app/api/generate/__tests__ app/lib/__tests__/providers.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 40 秒

---

## Per-Task Verification Map

本 phase 的验证分三层：花钱那一次的记录（一次性证据）、离线可复算的测量（零成本重算）、比例表回归（进 CI）。
Task ID 由 PLAN.md 落定后回填；断言本体见下表（来自 `01-RESEARCH.md` 的 Validation Architecture）。

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01-01 | 1 | TRAN-03 | 证据（人工可查） | `grep -c '' .planning/phases/01-transport-probe/01-PROBE-RECORD.md` 且五项非空 | ❌ W0 | ⬜ pending |
| TBD | 01-01 | 1 | TRAN-03 | 重算（离线，确定性） | `node scripts/probe-measure.mjs <fixture.png> 8` 两次输出在 `jq -S 'del(.seconds_measure)'` 规范化后逐字节相同，且与记录数字一致 | ❌ W0 | ⬜ pending |
| TBD | 01-01 | 1 | TRAN-03 | 重算（离线） | `sharp().metadata()` 的宽高 == 记录里的 returned | ❌ W0 | ⬜ pending |
| TBD | 01-02 | 1 | TRAN-04 | unit（CI） | `npx vitest run app/api/generate/__tests__/aspectRatio.test.ts` — 恰好 4 组变化且全为 `21:9→4:1`，其余 52 组不变 | ❌ W0 | ⬜ pending |
| TBD | 01-02 | 1 | TRAN-04 | unit（CI） | 同一文件：六个 studio 尺寸档位逐字不变（4096×4096、2048×1024、1024×1024、512×512、以及两个 studio 的常用尺寸） | ❌ W0 | ⬜ pending |
| TBD | 01-02 | 1 | TRAN-05 | unit（CI） | `npx vitest run app/lib/__tests__/providers.test.ts` — `PROVIDER_IDS` 长度仍为 3 | ✅ 已有模块 | ⬜ pending |
| TBD | 01-02 | 1 | TRAN-05 | CLI 存档 | `node cli/ie.mjs config list --json` 含 `provider: magpie` + `baseUrl` + key 来源 | ❌ W0 | ⬜ pending |
| TBD | 01-01 | 1 | TRAN-03 | 属性检查（零成本） | `git check-attr diff tests/fixtures/anim/<f>.png` → `diff: unset` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `app/api/generate/__tests__/aspectRatio.test.ts` — 比例表 blast radius 的断言（V5/V6）
- [ ] `tests/fixtures/anim/` — 一张下采样后的真实条带图（**宽 2048，实测 2048×246、0.945 MB**；本次探针的原始返回是 2928×352 = 1.48 MB，只留在 `.ie/probe/`，不进库。语料里那种 11712×1408 ≈ 16.3 MB 的图属于另一条历史通道）
- [ ] `scripts/probe-measure.mjs`（或等价的一次性测量脚本）— 从 PNG 重算尺寸/场色/拟合参数（V3）
- [ ] `.planning/phases/01-transport-probe/01-PROBE-RECORD.md` — 探针五项记录（V1/V4）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 探针一次真实调用是否成功、失败模式归类（超时/比例/格子） | TRAN-03 | 需要付费调用与真实网关，CI 不可能跑 | 按 PLAN 的命令发一次请求；把 `~/.config/magpie/usage.jsonl` 对应行与 HTTP 结果一并写进 `01-PROBE-RECORD.md` |
| 是否触发了 D-08 的"停下来等人" | TRAN-03 | 花钱边界是人的决定 | 若第一次失败：停止，向用户报告失败模式与证据，等待指示后再发第二次 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 40s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

# Phase 5: 库 kind、provenance 诚实性与载荷上限 - Discussion Log

> **Audit trail only.** Decisions live in CONTEXT.md.

**Date:** 2026-10-08
**Phase:** 05-kind-provenance
**Mode:** `--auto`（单遍，自选全部灰区，逐题取推荐项）
**Areas discussed:** kind 与 payload 边界, provenance 的来源, cost 诚实性, manifest/params 内容边界, 载荷上限守卫的形态

---

`[auto] Selected all gray areas: kind 与 payload 边界, provenance 的来源, cost 诚实性, manifest/params 内容边界, 载荷上限守卫的形态.`

| Area | Options | Selected |
|---|---|---|
| kind 与 payload 边界 | 追加 `'animations'` 到既有 `ASSET_KINDS` + 面板/i18n 各一条 ✓ / 新开一套集资产命名空间 | **追加 kind**（kind 是磁盘目录名，改名会孤立既有资产） |
| payload 内容 | 恒为 `derived/*.png` + `set.json` + `meta.json`，`raw/` 永不入 ✓ / 允许带原始 strip 以便复现 | **derived + set.json + meta.json**（延续 Phase 4 的入库边界） |
| provenance 的 backend/model 从哪来 | 读 `set.json` 的 `backend.{provider,model}` ✓ / 从 CLI `--backend` 参数取 / 从当前 profile 推 | **读 `set.json`**（Phase 4 的 CR-03 已让它记实际请求用的 model） |
| `ie library save` 的字面默认 | 去掉 `?? 'openrouter'`，裸文件导入缺 `--backend` 即 usage error ✓ / 保留默认以免破坏既有脚本 | **去掉默认**（那正是本阶段要修的那类谎，LIB-04） |
| cost 语义 | `ReportedCost \| null`，"报才记"，非空时断言 `cost.source === backend` ✓ / 未知成本写 `0` | **报才记，null 合法**（`0` 是伪装的确定） |
| manifest 内容 | 只放规格块，不含帧清单 ✓ / 顺手把帧清单也放进去便于单文件读取 | **只放规格块**（帧清单已在 `set.json`，两份就是两个会漂的真相） |
| params 内容 | `dirs/states/frames/cell/calls/cells/seconds`，且与 `ok:true` 条数一致，不一致即拒绝 ✓ / 记「大概」的总数 | **记实测值并对账** |
| 载荷上限守卫的形态 | 测试期算术断言（16 张真实 raw = 363.8M base64 > 279.6M route 上限）✓ / 运行期拒绝超限请求 | **测试期断言**（运行期检查拦不住"某天有人放宽形状"） |
| 收集接线点 | 复用既有 `CollectedAsset` 形状与 switch ✓ / 为集资产另写一套组装 | **复用既有形状**（不产生第二份会漂的实现） |

**User's choice:** 全部取推荐项（`--auto`）。

---

## 进入本阶段前的两个闸门

- **Context**：用户以 `--auto` 调用，灰区自选、逐题取推荐项；每条决定都落进 CONTEXT.md 的 `<decisions>`（D-41..D-49）并在上表留痕。
- **Research**：本阶段改的是仓库内既有实现（库类型/收集器/面板/CLI 命令），规格与契约都在仓库里（`docs/superpowers/specs/2026-10-06-animation-set-production-design.md` §5.3/§5.4）。是否值得为"库 kind 扩宽"另跑一轮外部调研，留给 `/gsd-plan-phase` 判断；本阶段没有需要外部事实支撑的开放问题。

## 讨论中确认的两个既有事实（不是决定，是 scouting 结果）

- `BackendLabel` **已经**是一处定义（`app/lib/libraryTypes.ts:24`，从 `PROVIDER_IDS` 派生），且 docblock 记录了上次手抄表落后两个 id 的事故 —— LIB-03 的"一处定义、route 与 CLI 共用"这一半已经成立，本阶段要做的是让它**被诚实填充**（D-43/D-44）。
- `set.json` 已经带 `backend: { provider, model }`（`app/lib/animSet.ts:380`），且 Phase 4 的 CR-03 修完 `spec.model` 就是实际请求用的模型 —— 所以 D-43 不需要新数据通路，只需要读它。

---

*Phase: 5-kind-provenance*
*Discussion: 2026-10-08 (--auto)*

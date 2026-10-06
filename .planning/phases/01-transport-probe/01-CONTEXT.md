# Phase 1: 传输探针与精确尺寸透传 - Context

**Gathered:** 2026-10-06
**Status:** Ready for planning

<domain>
## Phase Boundary

用一次真实调用，测出一张条带图（一行 N 格 = N 个方向）从请求到返回到底发生了什么：请求的尺寸有没有原样到达模型、返回的尺寸是多少、格子的间距与相位是多少、底色是什么颜色。再把"以后怎么发请求"这件事定下来（改本地比例表，或切通道），因为后面所有阶段都会把这个答案当常量用。

不做的事：不生成整套动画、不写生产代码逻辑、不碰切图与入库。

</domain>

<decisions>
## Implementation Decisions

### 先敲哪扇门（通道顺序）
- **D-01:** 先打本机网关（magpie 直通）。它不需要额外配置，但历史上单张图要 29–35 秒，而它有约 15 秒就超时的毛病，所以预期是超时失败。失败后再切 Teamo（你现在游戏在用的那条）。
- **D-02:** Teamo 不新增为第四个 provider，而是表达成一个 magpie 的 profile（配 `baseUrl`，key 用 `apiKeyEnv` 指向 `TEAMO_API_KEY` 或 `~/.config/teamorouter/token`）。本机 DNS 被污染，Teamo 那边需要把域名钉到 IP（`api.teamorouter.com=43.128.25.159`）。— **Reversibility:** reversible — 只是配置，不动 provider 表结构。

### 尺寸怎么落地
- **D-03:** 把 `8:1` 与 `4:1` 两行加进本地比例表（`app/api/generate/route.ts` 的 `SUPPORTED_IMAGE_ASPECT_RATIOS`）。— **Reversibility:** costly — 这张表决定所有生成请求落在哪一档，撤销要重新核对所有调用方。
- **D-04:** 必须同时列出"因为加这两行而改变档位"的既有组合（56 种宽高组合里有 10 种会变），并断言六个现有 studio 用的尺寸一个都没变（4096×4096、2048×1024、1024×1024、512×512 等）。验证以返回的实际尺寸为准，不以打印出来的计划为准。
- **D-05:** 若探针显示就算加了这两行也仍然到不了模型（例如聊天通道压根不发送尺寸），才另开话题——不在本 phase 悄悄扩大改动。

### 探针产物
- **D-06:** 测量结果写成文字记录，放在 `.planning/phases/01-transport-probe/`。
- **D-07:** 把一张真实生成的条带图（约 1–3 MB）存进本仓库的测试素材目录，供后续自动测试使用；不进发布包。— **Reversibility:** reversible — 换一张图即可。

### 花钱边界
- **D-08:** 探针失败就停下来报告，等你发话再花第二次钱；不自动换通道、不自动重试花钱。— **Reversibility:** reversible — 想更自动化时改一个标志即可。

### 探针范围
- **D-09:** 只测 8 个方向（怪物形状）。英雄那套 4 方向是另一套命名约定，留到 Phase 7 真跑时再看。— **Reversibility:** reversible。

### 测量内容（写死要测什么，防止"跑完不知道看什么"）
- **D-10:** 同一次调用必须记录五件事：① 请求的宽高与比例；② 返回的实际宽高与比例；③ 拟合出的格子间距与相位（以及和"平均分"相差多少）；④ 底色取样（这决定后面抠底用哪套参数）；⑤ 用时（秒）。
- **D-11:** 失败模式必须如实记录是"超时"还是"比例不对"还是"返回了但格子不对"，不靠反复重试掩盖成"成功"。

### the agent's Discretion
- 探针脚本写在仓库哪个位置、用什么形式（一次性脚本还是先用 `ie` CLI 的现有命令手跑）由你决定；只要测量结果与素材文件按 D-06/D-07 落盘。
- 拟合间距的具体算法（搜索步长、判定阈值）由你决定；Phase 2 会把它实现成纯函数，这里只要拿到可信的数字。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 本里程碑的规格与决策
- `docs/superpowers/specs/2026-10-06-animation-set-production-design.md` — S1 规格 v2（§1.3 八条实测、§5 数据模型、§9 探针与传输）
- `.planning/PROJECT.md` — 项目上下文与已锁定的关键决定
- `.planning/REQUIREMENTS.md` — TRAN-03 / TRAN-04 / TRAN-05 是本 phase 的验收项
- `.planning/ROADMAP.md` §Phase 1 — 目标与成功判据

### 研究结论（本 phase 的直接依据）
- `.planning/research/STACK.md` — 比例表为何送不出 8:1、magpie 的 ~15s 天花板与其历史成功记录、Godot 消费格式
- `.planning/research/PITFALLS.md` — 静默改比例、均匀切格伤画面、载荷上限、provenance 说谎等已发生过的坑
- `.planning/research/SUMMARY.md` §Reconciled Contradiction — 格子间距的三种测量怎么统一

### 消费端（游戏侧，只读参考）
- `~/repos/dark-black/tools/gen_assets_teamo.py` — 现行做法：每（状态, 帧）一张条带、8 格 = 8 方向、按像素要尺寸、`--go` 才花钱、逐条记账
- `~/repos/dark-black/tools/build_handpainted_sheets.py` — 拟合格子与裁剪的实现（Phase 2/3 的参照）

### 本仓库的相关代码
- `app/api/generate/route.ts` — `SUPPORTED_IMAGE_ASPECT_RATIOS` 与按比例取最近档的实现（D-03/D-04 要动这里）
- `app/lib/providers.ts`、`app/lib/ieConfig.ts` — provider 表与 profile 的 `baseUrl`/`apiKeyEnv`（D-02 的落点）
- `.planning/codebase/CONCERNS.md` — 已知债务（含 `BACKEND_LABELS` 与成本来源写死的问题）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cli/ie.mjs` 的 `ie call generate --body '{...}' --save out.png`：已经能把原始宽高发给 `/api/generate` 并存图，探针可以直接用它跑，不必先写新脚本。
- `app/lib/ieConfig.ts` 的 profile 机制：magpie 允许配 `baseUrl`，D-02 的 Teamo 直连不需要动 provider 表。
- 现有的 `doctor` 命令：探针前先确认 node / Chromium / 配置 / 网关连通性，避免把配置问题误判成模型问题。

### Established Patterns
- "一处一个事实"：比例表、provider 表、颜色抠底参数都各自只有一个家。D-03 只改表，不在调用点写特例。
- 生成请求的省钱纪律：预演 → 显式确认（`--go` / UI 二次确认）。D-08 是这条纪律在探针场景的延续。

### Integration Points
- 探针跑完，D-03 的改动落在 `app/api/generate/route.ts`；D-02 的落点是配置文件（`.ie/config.json` 或 `~/.config/image-extender/config.json`）。
- 探针产出的那张图会被 Phase 3 的切图冒烟测试直接读用。

</code_context>

<specifics>
## Specific Ideas

- 用户明确要求：**先试本机网关**（不先配 Teamo），失败再切；**失败就停**，不要自动再花钱。
- 用户明确要求：**改那张表**（而不是给生成通道加精确尺寸能力），但要能看到受影响的组合清单。
- 用户明确要求：探针的记录连同**一张真实图**留在仓库里，供后续测试用。

</specifics>

<deferred>
## Deferred Ideas

- 给聊天通道增加"直接指定像素宽高"的能力 —— 属于更大的改动，本 phase 不做（D-05 已记录触发条件）。
- 英雄的 4 方向命名约定 —— 留到 Phase 7。
- 自动切换通道重试（无人值守模式）—— 用户选择"失败就停"，此想法记录备用。

</deferred>

---

*Phase: 1-传输探针与精确尺寸透传*
*Context gathered: 2026-10-06*

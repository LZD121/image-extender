# Phase 1 探针记录（01-PROBE-RECORD）

> 一次真实调用，D-10 五项全在此。机器可读块是本文件唯一的 json 代码围栏（fence 计数闸门要求恰好 1）。

## Requested

- 画布：`4096×512`（8 格 × 512）
- 出网比例名：`8:1` —— 这是本 phase 存在的理由：改前这张表没有 8:1，同一个请求会静默落在 `21:9`
- 通道：`probe-magpie`（body 里显式写的 profile；全局 `--profile` 会被 `ie call` 忽略）
- prompt 全文与摘要：

`prompt_sha256 = 9d966280493b9530e2271a1775463ea0513d2e50fdedc97d3fcadf92ffcfe8a6`

```text
A 2D game sprite sheet for a dark-fantasy dungeon, laid out as a flat 1-row x 8-column strip of 8 equal square cells on a perfectly flat pure magenta #FF00FF background. All 8 cells show the SAME creature, a hulking armored beast chaser: low centre of gravity, wide front, thick hunched shoulders, short powerful limbs, small glowing eyes, scarred iron plate — a calm breathing idle, stance settled (animation frame 1 of 4). Each cell faces a different direction: cell 1 facing east, cell 2 facing south-east, cell 3 facing south, cell 4 facing south-west, cell 5 facing west, cell 6 facing north-west, cell 7 facing north, cell 8 facing north-east. Keep the creature COMPLETELY INSIDE its own cell with a wide magenta gutter on all sides - nothing may touch a cell edge or cross into a neighbouring cell. One creature per cell, centred, full body. The background is NOT a scene: no floor, no ground plane, no horizon, no walls, no scenery, nothing behind the creature but the flat magenta field. No ground shadow, no cast shadow, no text, no grid lines, no cell borders, no labels, no card, no plaque, no frame, no panel, no background rectangle or shape of any kind.
```

## Returned

- `.ie/probe/chaser_idle_f1_8dir.png`：**2928×352**（比例 8.3182），1,480,226 字节
- 与 `evidence/call-result.json`、`evidence/measured-raw.json` 三方一致（由同一张 PNG 的 IHDR 复核）
- 比例 8.318 与消费端 40 条已交付 strip 的签名一致（请求 8:1 → 返回 8.318:1）；若是 21:9 会是 2.333
- **不断言 returned == requested**：语料里 40/40 都不等（Pitfall 4）

## Fit

| | 原始返回 | fixture（下采样后） |
|---|---|---|
| 尺寸 | 2928×352 | 2048×246（0.945 MB） |
| 拟合间距 | 360（phase 20） | 255（phase 253） |
| 与均匀 `W/N` 的差 | -1.639% | -0.391% |
| gutter 判定 | **False** | **False** |
| 切线质量 | 7 条中 6 条为 0，1 条（x=2180）满载 352 | 同型 |
| 搜索 | 21594 次试验，±8% of W/N | 同 |

拟合是**搜索**而非常量：`Δ%` 的符号在两套图上不一致（原始 −1.639%、fixture −0.391%），说明按比例缩放后最佳相位确实会移动——这正是 Phase 2 必须把拟合写成纯函数、而不是照抄一个常数的原因。

**gutter 判定为 False**：8 格里有 1 条边界被实体占满（该列 352 个不透明像素 = 整列）。也就是说这张图上模型没有守住"每格留出宽沟槽"，8 格里 7 条边界干净、1 条越界。这正是 Phase 3 的 gutter 闸门要拦的东西，也是把"返回了但格子不对"单独列为一类失败的原因。

## Field

- 底色取样（四角中位数）：`#FC06FA`（RGB [252, 6, 250]），洋红度 cast = min(r,b)−g = 244
- 判读：这是**饱和洋红**一类（研究里量到过 `FF07F6` cast 237 与 `DFC7D2` cast 12 两种），因此 Phase 3 的抠底应当用二值 + despill，而不是 `default` 预设的软边

## Timing

- `seconds_call`（墙钟，含 CLI 与已热身的 dev server）：15 s
- `usage_ms`（网关自己量的，**权威**）：14629 ms —— 与墙钟一致，说明这次没有冷启动污染
- `seconds_measure`（离线测量）：见 `evidence/measured-raw.json`（浮点，不进确定性比对）

## Outcome & Decision

- **outcome: `成功`**
- 探针要回答的唯一问题——"改成 8:1 之后，这个比例名能不能到达模型"——答案是**能**：出网体带 `8:1`，返回比例 8.318（与消费端同一签名），HTTP 200，网关侧 200。
- D-08 未触发（没有失败），因此**没有**第二次调用；本 phase 的付费调用共 **1 次**（上限 2 次）。
- 附带事实（不是失败）：模型没有严格遵守"每格留宽沟槽"——8 条边界里 1 条被越过（见 Fit）。

## Evidence

- 网关侧原行（`~/.config/magpie/usage.jsonl` 第 11578 行）：

```text
{"route_id":1791283431134,"t":"2026-10-07T00:48:32.844826+08:00","agent":"node","provider":"teamo-router","host":"api.teamorouter.com","providerKeyId":"cddc22c8a2","model":"gemini-3.1-flash-image","req":"teamo-router/gemini-3.1-flash-image","served":"gemini-3.1-flash-image","in":319,"out":1120,"ms":14629,"status":200,"rid":"f6195b13-e8b3-4c64-8f44-3b26f46efc8c"}
```

- `evidence/call-result.json`：`channel=magpie`、`http_status=200`、`usage_provider=teamo-router`、`usage_ms=14629`、`cost=null`（聊天通路不报美元成本，与既有 `extractCost` 只认 OpenRouter 的实现一致）

## Fixture

- `tests/fixtures/anim/chaser_idle_f1_8dir.png`：2048×246，0.945 MB，`git check-attr diff` → `diff: unset`（`.gitattributes` 的 `*.png -diff` 自动覆盖）
- 为什么还是下采样：本次返回 2928×352 只有 1.48 MB（研究文档里"1–3 MB"的估算反而接近；16.3 MB 那组是**语料**里 11712×1408 的图，不是这一张）。仍下采样是为了让 fixture 与"宽 ≤2048"的约定一致，并把原始尺寸/拟合参数一并留在记录里
- 下采样会按比例缩放 pitch/phase（raw 360 → fixture 255），所以两套数字都记在上表

## Raw file

- 原始图只留在 `.ie/probe/chaser_idle_f1_8dir.png`（`.ie/` 已 gitignore）：**本次返回 1,480,226 B = 1.48 MB**（不是语料那种 16.3 MB 的大图）。原始图不进仓库是纪律，不是体积所迫

## Background（不是本探针的结果）

- 研究期间 2026-10-06T22:54:55 有一次意外调用：`teamo-router`、`status:200`、`ms:12861`、prompt 是占位 `x`、尺寸 64×64。它证明的是"本机 → 网关 → Teamo → Gemini 这条聊天通路能出图"，与本探针的 8 向条带无关。

## 机器可读块（本文件唯一的 json 围栏）

```json
{
  "outcome": "成功",
  "channel": "magpie",
  "requested_size": "4096x512",
  "requested_aspect_name": "8:1",
  "returned_size": "2928x352",
  "seconds_call": 15,
  "usage_ms": 14629,
  "raw_png_path": ".ie/probe/chaser_idle_f1_8dir.png",
  "prompt_full": "A 2D game sprite sheet for a dark-fantasy dungeon, laid out as a flat 1-row x 8-column strip of 8 equal square cells on a perfectly flat pure magenta #FF00FF background. All 8 cells show the SAME creature, a hulking armored beast chaser: low centre of gravity, wide front, thick hunched shoulders, short powerful limbs, small glowing eyes, scarred iron plate — a calm breathing idle, stance settled (animation frame 1 of 4). Each cell faces a different direction: cell 1 facing east, cell 2 facing south-east, cell 3 facing south, cell 4 facing south-west, cell 5 facing west, cell 6 facing north-west, cell 7 facing north, cell 8 facing north-east. Keep the creature COMPLETELY INSIDE its own cell with a wide magenta gutter on all sides - nothing may touch a cell edge or cross into a neighbouring cell. One creature per cell, centred, full body. The background is NOT a scene: no floor, no ground plane, no horizon, no walls, no scenery, nothing behind the creature but the flat magenta field. No ground shadow, no cast shadow, no text, no grid lines, no cell borders, no labels, no card, no plaque, no frame, no panel, no background rectangle or shape of any kind.",
  "prompt_sha256": "9d966280493b9530e2271a1775463ea0513d2e50fdedc97d3fcadf92ffcfe8a6",
  "fitted_pitch": 360,
  "fitted_phase": 20,
  "delta_pct_vs_uniform": -1.639,
  "gutter_ok": false,
  "field_hex": "#FC06FA",
  "fixture": {
    "path": "tests/fixtures/anim/chaser_idle_f1_8dir.png",
    "width": 2048,
    "height": 246,
    "fitted_pitch": 255,
    "phase": 253,
    "delta_pct_vs_uniform": -0.391
  },
  "paid_calls_this_phase": 1,
  "cost_usd": null
}
```

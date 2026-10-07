---
phase: 03-strip-frames
plan: 01
status: complete
requirements: [POST-01, POST-02, GEOM-02]
---

# 03-01 Summary — `binary` 抠底档 + `app/lib/animFrames.ts`（一张 strip → N 帧的唯一实现）

**执行方式：** 由通用执行代理按计划逐任务执行、逐任务跑计划自带的 `<automated>` 作硬闸门；orchestrator 复跑同样两条闸门 + `tsc` + 全量套件后提交。计划由独立 planner 撰写、独立 checker 三轮评审。

## 交付物

| 文件 | 变化 | 内容 |
|---|---|---|
| `app/lib/animFrames.ts` | **新增 438 行** | `planStripFrames(dataUrl, opts)`：拟合网格切格 → **二值抠底** → 去边 → **抢救**（`isolatePrimarySpriteComponent`，以格中心取连通块）→ 87.5% 套格居中；外加纯算术 `fitBox` / `frameMarginFloor` / `FRAME_FILL`。**两级 gutter 闸门**：`ok = 拟合置信度 ∧ 残场像素数 === 0 ∧ 空格数 === 0`。每步 best-effort 都有计数器。 |
| `app/lib/chromaPresets.ts` | +12 | 新增 `binary` 档（`castThreshold 128 / castSoftness 0 / despill 1 / despillGreenBoost 0.5`）+ 说明它为何存在 |
| `app/lib/__tests__/chromaPresets.test.ts` | +14/-1 | 表变 5 档、并把"软边为 0"写成语义断言 |
| `cli/commands/prim.mjs` | +2/-2 | `ie chroma` 的枚举与用法串收进 `binary` |
| `docs/agent-api.md` | +1/-1 | 文档表同步 |
| `cli/native/bridge.mjs` | +12 | `case 'strip-frames'` |
| `cli/native/bundle.mjs` | +1/-1 | `BROWSER_IMPORTS` 收进 `app/lib/animStrip` + `app/lib/animFrames`（否则浏览器侧看不见新模块） |

## 闸门结果（两条都实跑，orchestrator 复跑一致）

- Task 1 → exit 0：`binary preset: row + pin + semantics + CLI enum + usage + docs all wired`
- Task 2 → exit 0：`strip-frames ok: 8 frames / gutter rescued / no partial alpha / cell256 scales / fail arm zero frames / raw arm fails on 2180`；`no baseline align, no interpolated rescale`；`browser bundle 173218 bytes carries planStripFrames + the 87.5% constant`
- `npx tsc --noEmit` → 0；`npm test` → 全量绿（含新增的 chroma 语义断言）

## 实测确认（执行代理在真图上量的，orchestrator 复跑一致）

| 臂 | 结果 |
|---|---|
| 对照（`default` 档） | 2595 个半透明像素；`binary` 为 **0** |
| 失败臂（`castThreshold 256`） | `ok:false`、零帧、`fieldSurvived:8` —— **第一级闸门确实被骗过，第二级把它抓住**（这就是两级设计的意义） |
| fixture 512 臂 | 8 帧 `ok:true`，拟合 `{255, 253}`，cutLines 质量 `[0,0,0,0,246,0,0]`，最小左边距 **131**，零半透明 |
| 几何臂（cell 256） | `scaled:7`，帧 7 落 `@18,16`，留边下界 16 守住 |
| 原图臂 | 拟合 `{360, 20}`、`#FC06FA`、`unrescued [2180]` → `ok:false`、零帧（**抢不回来就失败**，D-22） |

## 偏离与说明

- 执行代理自己的 docblock 一开始**逐字引用了那条被禁的空值回退表达式**，被文件级正则抓到（`PRESET GUARD MISSING`）——它改了措辞（不动语义、不动闸门）后复跑绿。这正好是"闸门真的会红"的又一次实证。
- `app/lib/animFrames.ts` 里 `alignSpriteFramesToBaseline` / `normalizeSpriteFrameScale` 出现 **0** 次（D-24/D-27）。

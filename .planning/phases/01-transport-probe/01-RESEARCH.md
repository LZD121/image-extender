# Phase 1: 传输探针与精确尺寸透传 - Research

**Researched:** 2026-10-06
**Domain:** 本地 OpenAI 兼容网关（magpie）与 Teamo Router 的 chat / Gemini-native 双通道传输；一次真实付费调用的尺寸透传测量；条带图的列质量剖面拟合
**Confidence:** HIGH（代码、磁盘语料、profile 路由、端点形状均为本机实测）；MEDIUM（"8:1 能否原样到达模型"仍待那一次付费调用回答 —— 这正是本 phase 要测的东西）

<user_constraints>
## User Constraints (from CONTEXT.md)

**CRITICAL:** CONTEXT.md 的锁定决策逐字抄录如下。planner 必须遵守，不得重新讨论。

### Locked Decisions

#### 先敲哪扇门（通道顺序）
- **D-01:** 先打本机网关（magpie 直通）。它不需要额外配置，但历史上单张图要 29–35 秒，而它有约 15 秒就超时的毛病，所以预期是超时失败。失败后再切 Teamo（你现在游戏在用的那条）。
- **D-02:** Teamo 不新增为第四个 provider，而是表达成一个 magpie 的 profile（配 `baseUrl`，key 用 `apiKeyEnv` 指向 `TEAMO_API_KEY` 或 `~/.config/teamorouter/token`）。本机 DNS 被污染，Teamo 那边需要把域名钉到 IP（`api.teamorouter.com=43.128.25.159`）。— **Reversibility:** reversible — 只是配置，不动 provider 表结构。

#### 尺寸怎么落地
- **D-03:** 把 `8:1` 与 `4:1` 两行加进本地比例表（`app/api/generate/route.ts` 的 `SUPPORTED_IMAGE_ASPECT_RATIOS`）。— **Reversibility:** costly — 这张表决定所有生成请求落在哪一档，撤销要重新核对所有调用方。
- **D-04:** 必须同时列出"因为加这两行而改变档位"的既有组合（56 种宽高组合里有 10 种会变），并断言六个现有 studio 用的尺寸一个都没变（4096×4096、2048×1024、1024×1024、512×512 等）。验证以返回的实际尺寸为准，不以打印出来的计划为准。
- **D-05:** 若探针显示就算加了这两行也仍然到不了模型（例如聊天通道压根不发送尺寸），才另开话题——不在本 phase 悄悄扩大改动。

#### 探针产物
- **D-06:** 测量结果写成文字记录，放在 `.planning/phases/01-transport-probe/`。
- **D-07:** 把一张真实生成的条带图（约 1–3 MB）存进本仓库的测试素材目录，供后续自动测试使用；不进发布包。— **Reversibility:** reversible — 换一张图即可。

#### 花钱边界
- **D-08:** 探针失败就停下来报告，等你发话再花第二次钱；不自动换通道、不自动重试花钱。— **Reversibility:** reversible — 想更自动化时改一个标志即可。

#### 探针范围
- **D-09:** 只测 8 个方向（怪物形状）。英雄那套 4 方向是另一套命名约定，留到 Phase 7 真跑时再看。— **Reversibility:** reversible。

#### 测量内容（写死要测什么，防止"跑完不知道看什么"）
- **D-10:** 同一次调用必须记录五件事：① 请求的宽高与比例；② 返回的实际宽高与比例；③ 拟合出的格子间距与相位（以及和"平均分"相差多少）；④ 底色取样（这决定后面抠底用哪套参数）；⑤ 用时（秒）。
- **D-11:** 失败模式必须如实记录是"超时"还是"比例不对"还是"返回了但格子不对"，不靠反复重试掩盖成"成功"。

### the agent's Discretion
- 探针脚本写在仓库哪个位置、用什么形式（一次性脚本还是先用 `ie` CLI 的现有命令手跑）由你决定；只要测量结果与素材文件按 D-06/D-07 落盘。
- 拟合间距的具体算法（搜索步长、判定阈值）由你决定；Phase 2 会把它实现成纯函数，这里只要拿到可信的数字。

### Deferred Ideas (OUT OF SCOPE)
- 给聊天通道增加"直接指定像素宽高"的能力 —— 属于更大的改动，本 phase 不做（D-05 已记录触发条件）。
- 英雄的 4 方向命名约定 —— 留到 Phase 7。
- 自动切换通道重试（无人值守模式）—— 用户选择"失败就停"，此想法记录备用。
</user_constraints>

<architectural_responsibility_map>
## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| 发一次付费生成请求（探针本体） | CLI（`cli/ ie call` → 本机 `next dev` → `/api/generate`） | API/Backend（`app/api/generate/route.ts`） | 探针必须走**生产那条路**，否则测的不是真通路。CLI 是唯一已有 `--body`/`--save` 的付费入口 |
| profile → 网关/模型的解析 | API/Backend（`app/lib/llmServer.ts` `requestProvider`） | 配置文件（`.ie/config.json`，由 CLI 写入） | 服务器端解析：`profile` 字段优先级高于 `defaultProfile`；浏览器端的 `provider` 字段优先于两者 |
| 请求尺寸 → `image_config.aspect_ratio` | API/Backend（`route.ts:160` + `supportedAspectRatioForSize`） | — | 一处一个事实：比例表只在 `route.ts` |
| 返回尺寸 / 场色 / 间距相位的测量 | 离线一次性测量（node + `sharp`，devDependency） | — | 一次调用产出一张 PNG，测量只在文件上做，不碰服务端 |
| 比例表放宽 + blast radius 回归 | API/Backend（`route.ts:7-18`） | 测试（vitest，`app/api/generate/__tests__/`） | 表本身是纯数据，回归靠 route 单测断言 |
</architectural_responsibility_map>

<research_summary>
## Summary

本 phase 只有一次付费调用，所以研究的目标是让 planner 能把"这一次"钉死到参数级别，并让它产出的数字可复现。

三条结论改变计划的写法：

1. **探针入口是 `cli/ie.mjs call generate`，但 `--profile` 这个全局旗标不会进 body。** 实测：`--profile probe-teamo` 被忽略（请求仍落在 `config.defaultProfile` 指向的网关），而 body 里的 `"profile":"..."` 被读取（未知 profile → HTTP 401）。`cli/commands/core.mjs:153-189` 的 `call` 命令只转发 `--body` 解析出来的对象，从不调用 `ctx.llmFields()`（其它 studio 命令调用）。**因此探针命令必须以 `--body '{"profile":"...", ...}'` 的形式传 profile，或把 `defaultProfile` 指向要打的 profile。** 这是本次研究中唯一会让人白花一次钱还拿不到正确通道的坑。

2. **`app/lib/imageGeneration.ts` 的 `viaChat` 会把 `width`/`height` 从载荷里丢掉。** `chatCompletion` 只序列化 `model / messages / max_tokens / stream / temperature / ...extra`（`app/lib/llmChat.ts:27-35`），而 body 里唯一携带尺寸的东西是 `extra.image_config.aspect_ratio`（`route.ts:160`）。也就是说**通过本 app 的 chat 通道，能送出的只有"最近档的比例名"，不是像素宽高**。今天 `4096×512` 会静默变成 `21:9`；加了 `8:1` 之后才变成 `8:1`。D-05 的触发条件（"聊天通道压根不发送尺寸"）**部分已经成立**：它发送的是比例，不是尺寸——但按 D-03 的路线（改比例表）这正是被接受的解法。

3. **消费端（游戏）历史上并不是走这条 chat 通道出图的。** `~/repos/dark-black/tools/gen_assets_teamo.py` 调的是 `~/.agents/skills/image-extender/scripts/ie.py --backend teamo`，而 skill 的 `native/bridge.mjs` 对 image 模型**改写成网关的 Gemini 原生 `POST /v1beta/models/<model>:generateContent`**，并用 `geminiAspect(w,h)` 从请求像素算出比例（`GEMINI_ASPECTS` 表**已经含 `8:1`/`1:8`**）。所以本仓库已提交的 40 条条带是"请求 4096×512(8:1)，返回 11712×1408(8.318:1)"——即**通道能表达 8:1，但返回尺寸不等于请求尺寸**。这个既有事实是本 phase 的对照基线：探针要回答的是"本 app 的 chat 通路能不能做到至少同等的事"。

**Primary recommendation:** 用一条 copy-paste 命令（`ie call generate --body '{... profile, width:4096, height:512, ...}' --save ...`）打 magpie（先）/ Teamo（失败后），用 `sharp` 一次性脚本从返回的 PNG 上量 `H/W`、场色、拟合 `(spacing, phase)`、`seconds`；比例表按 D-03 **只加 `4:1`、`8:1` 两行**（blast radius 实测 **4/56**，非研究文档先前写的 10/56），并用 route 单测断言六个 studio 不变。
</research_summary>

<standard_stack>
## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `cli/ie.mjs`（仓库自带） | 1.0.0 | 付费调用的唯一入口，`--body` + `--save` | 已经能把原始宽高发给 `/api/generate` 并存图；无需新脚本（CONTEXT「Reusable Assets」已确认） |
| Next dev server（`ie serve` / 已有 4317） | next 14.2.33 | 路由 `/api/generate` 的宿主 | 探针必须走真实 route；`IE_BASE_URL`/`--base-url` 可指向已起的服务器 |
| `sharp`（devDependency，已装） | 0.34.5 | 读 PNG IHDR + `resize({height:1})` 出列质量剖面 + 抽场色 | 已在 `node_modules`，无需装任何东西；`raw()` 直出 Buffer 比 Pillow 逐像素快一个量级 |
| `node` | v24.21.0 | 跑测量脚本 | 仓库运行时 |

### Supporting

| Library | Version | Purpose | When to Use |
|---|---|---|---|
| Python3 + Pillow | 3.13 / 11.3.0（本机已装） | 备选测量 | 只有在想复用消费端 `build_handpainted_sheets.py` 的 `field_colour`/`panel_boxes` 语义时。**不推荐**：11712×1408 逐像素 Python 循环慢，且没有 numpy |
| `vitest` | 2.1.9 | 比例表回归断言 | 必须：D-04 的"六个 studio 不变"要用 route 单测锁住，而不是靠打印 |
| `~/.agents/skills/image-extender/scripts/ie.py` | — | 消费端现行通道的参照实现（不是本 phase 的执行路径） | 只在需要复现"游戏侧那次成功"时对照 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| `sharp` 一次性脚本 | 直接复用 `cli/native/bridge.mjs` 的 canvas 路径 | 过度：要把 PNG 喂进 headless Chromium 才能量列剖面；`sharp` 三行就够 |
| `sharp` | Python + Pillow（复刻 `build_handpainted_sheets.py`） | Pillow 无 numpy，11712 列循环慢；且 Phase 2 的纯函数要用 TS 写，用 Python 验证会引入第二实现 |
| 新写一个 `cli/commands/probe.mjs` | 用 `ie call generate` 手跑 | **选后者**：D-06 只要求测量记录落盘；新命令是把一次性动作变成永久维护面（Ponytail：不需要存在的东西不要建）。Phase 2 才需要纯函数 |

**Installation:**
```bash
# 无需安装任何东西：sharp 已在 devDependencies 的 node_modules 里
node -e "console.log(require('sharp/package.json').version)"   # 0.34.5
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### System Architecture Diagram

一次探针调用的真实数据流（箭头 = 数据流向）：

```
                    ┌──────────────────────────────────────────────┐
  CLI invocation →  │ ie call generate                             │
  (ie.mjs)          │  --body '{"profile","prompt","width","height"}'│
                    │  --save <out.png>                            │
                    └───────────────┬──────────────────────────────┘
                                    │ POST /api/generate  (HTTP, 本机)
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ app/api/generate/route.ts                    │
                    │  • modelOrDefault(profile → imageModel)      │
                    │  • supportedAspectRatioForSize(w,h)          │ ← 比例表唯一之家
                    │      → image_config.aspect_ratio = "8:1"      │   (D-03 只改这里)
                    │  • generateImage({profile, width, height,…}) │
                    └───────────────┬──────────────────────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │ imageGeneration.generateImage → llmCredentials             │
        │   requestProvider:  body.provider ?  →  body.profile ?     │
        │                     →  config.defaultProfile               │
        │   effectiveProvider(profile) → { baseUrl, imageModel }     │
        │   profileKey(profile) → env(apiKeyEnv) || inline           │
        └───────────────┬───────────────────────────────────────────┘
                        │ IMAGE_ADAPTERS[provider.id]
          ┌─────────────┴──────────────┐
          ▼                            ▼
   ┌─────────────┐              ┌──────────────┐
   │ viaChat     │              │ viaApimart   │
   │ (openrouter │              │ submit+poll  │
   │  magpie)    │              │ 精确像素 size │
   └──────┬──────┘              └──────────────┘
          │ POST {baseUrl}/chat/completions
          │ body = {model, messages, max_tokens, stream,
          │         temperature, modalities, image_config}
          │          ▲ 注意：width/height 不在这里
          ▼
   ┌──────────────────────────┐
   │ magpie 127.0.0.1:3425/v1 │ ──► 上游 teamo-router ──► Gemini 图像模型
   │  (D-01 先打这里)          │      (usage.jsonl 可核对 status/ms)
   └──────────────────────────┘
          │ 200 {imageUrl: data:image/png;base64,…}
          ▼
   ie call --save → <out.png>
          │
          ▼
   ┌──────────────────────────────────────────────┐
   │ 离线测量（node + sharp，不碰网络）             │
   │  metadata() → returned W×H                    │
   │  环形采样   → field_rgb / magenta?             │
   │  resize(h=1) → column mass profile            │
   │  网格搜索   → (spacing t, phase ph), Δ% vs W/N │
   │  process.hrtime → seconds                      │
   └──────────────────────────────────────────────┘
          │
          ├─► .planning/phases/01-transport-probe/01-PROBE-RECORD.md  (D-06)
          └─► tests/fixtures/anim/<name>.png                          (D-07)
```

关键分叉点（planner 必须在计划里体现）：**route 里 `width/height` → 比例 → 只发比例**；**profile 决定打到哪个网关**；**返回值只带 `imageUrl`，尺寸必须自己量**。

### Recommended Project Structure

```
.planning/phases/01-transport-probe/
├── 01-CONTEXT.md          # 已有
├── 01-RESEARCH.md         # 本文
├── 01-PROBE-RECORD.md     # D-06 的测量记录（本 phase 新增）
└── probe-measure.mjs      # 测量脚本（可留可删；D-06 只要求记录落盘）
tests/fixtures/anim/       # D-07 的真实条带图（本 phase 新增）
└── <actor>_<state>_f1_8dir.png
```

### Pattern 1: 探针调用 = 现有 CLI 的 `call` 逃生舱

**What:** `ie call <route> [--body json] [--save out.png]` 把任意 body POST 给 route，非 2xx 即 `ok:false`（`docs/agent-api.md:242`）。
**When to use:** 一次性、想看见原始响应体的付费调用；正是探针。
**Example:**
```bash
# 前提：配置 + 网关可达（见下 Pattern 3）
cd ~/repos/image-extender

# D-01 第一枪：本机网关（magpie 直通；magpie 默认 baseUrl 127.0.0.1:3425/v1）
node cli/ie.mjs call generate --json \
  --body '{"provider":"magpie","profile":"probe-magpie","prompt":"<strip prompt>","width":4096,"height":512}' \
  --save .planning/phases/01-transport-probe/raw/magpie-8dir-4096x512.png
```
注意：`--body` 里的 key 必须与 `GenerateBody` 对得上；`plain` 形状不带任何 kind 旗标（`generateRequest.ts:86-94` 的 `generateKind` 落到 `plain`）。strip 的 prompt 文本直接内联在 body 里（`buildStripPrompt` 是 Phase 2 的产物，本 phase 手写等价文本即可）。

### Pattern 2: 测量 = 一次 `metadata()` + 一次 `resize(h=1)` + 一次环形采样

**What:** 全部五件事都可以从返回的 PNG 上离线算出来，不需要第二次调用。
**When to use:** D-10 的 ①–⑤。
**Example（已在本机跑通的骨架）:**
```js
// probe-measure.mjs —— 一次测量，产出 D-10 的五项
import sharp from 'sharp'

const file = process.argv[2]
const N = Number(process.argv[3] || 8)
const t0 = process.hrtime.bigint()

const meta = await sharp(file, { limitInputPixels: false }).metadata()   // ① ② returned W×H
const { data, info } = await sharp(file, { limitInputPixels: false })
  .removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H } = info

// ④ 场色：环形采样取众数（消费端 field_colour 的同一思路）
const buckets = new Map()
const ring = []
for (let x = 0; x < W; x++) { ring.push(x * 3, ((H - 1) * W + x) * 3) }
for (let y = 0; y < H; y++) { ring.push(y * W * 3, (y * W + W - 1) * 3) }
const step = Math.max(1, Math.floor(ring.length / 4096))
for (let k = 0; k < ring.length; k += step) {
  const o = ring[k], r = data[o], g = data[o + 1], b = data[o + 2]
  const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
  let e = buckets.get(key); if (!e) buckets.set(key, e = [0, 0, 0, 0])
  e[0]++; e[1] += r; e[2] += g; e[3] += b
}
let best = null; for (const e of buckets.values()) if (!best || e[0] > best[0]) best = e
const [fr, fg, fb] = [0, 1, 2].map((i) => Math.round(best[i + 1] / best[0]))
const magenta = Math.min(fr, fb) - fg > 20

// ③ 列质量剖面 + 在 (spacing, phase) 上搜索（消费端 panel_boxes 的同一语义）
const prof = new Int32Array(W)
for (let y = 0; y < H; y++) {
  let o = y * W * 3
  for (let x = 0; x < W; x++, o += 3) {
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const cast = Math.max(0, Math.min(r, b) - g)
    const bg = magenta ? cast >= 40
      : Math.max(Math.abs(r - fr), Math.abs(g - fg), Math.abs(b - fb)) <= 24
    if (!bg) prof[x]++
  }
}
const uni = W / N
let bestFit = null
for (let t = Math.round(uni * 0.92); t <= Math.round(uni * 1.08); t++) {
  for (let ph = 0; ph < t; ph += 4) {
    if (ph + N * t >= W) continue
    let cost = 0
    for (let i = 0; i <= N; i++) cost += prof[ph + i * t]
    for (let i = 0; i < N; i++) cost -= prof[Math.min(W - 1, ph + i * t + Math.floor(t / 2))]
    if (!bestFit || cost < bestFit.cost) bestFit = { cost, t, ph }
  }
}

console.log(JSON.stringify({
  returned: `${W}x${H}`, ratio: +(W / H).toFixed(4),
  fitted_pitch: bestFit.t, phase: bestFit.ph,
  delta_pct_vs_uniform: +(((bestFit.t - uni) / uni) * 100).toFixed(2),
  field_rgb: [fr, fg, fb], magenta,
  seconds_measure: Number(process.hrtime.bigint() - t0) / 1e9,
}))
```

### Pattern 3: 网关/profile 的前置条件（实测）

**What:** 两个 profile 的形状，以及它们各自缺什么。
**When to use:** 探针前把 `ie config` 配好，否则会花在错误的通道上。

`~/.config/image-extender/config.json` 或项目内 `.ie/config.json`（`ieConfig.ts:62-74`：`$IE_CONFIG` → `.ie/config.json` → `~/.config/image-extender/config.json`）：

```json
{
  "defaultProfile": "probe-magpie",
  "profiles": {
    "probe-magpie": {
      "provider": "magpie",
      "baseUrl": "http://127.0.0.1:3425/v1",
      "imageModel": "teamo-router/gemini-3.1-flash-image"
    },
    "probe-teamo": {
      "provider": "magpie",
      "baseUrl": "https://api.teamorouter.com",
      "apiKeyEnv": "TEAMOROUTER_API_KEY",
      "imageModel": "gemini-3.1-flash-image"
    }
  }
}
```

用 CLI 写（会走同一个校验器，原子写，含 inline key 时 `chmod 600`）：
```bash
node cli/ie.mjs config set profiles.probe-magpie.provider magpie
node cli/ie.mjs config set profiles.probe-magpie.baseUrl http://127.0.0.1:3425/v1
node cli/ie.mjs config set profiles.probe-magpie.imageModel teamo-router/gemini-3.1-flash-image
node cli/ie.mjs config set profiles.probe-teamo.provider magpie
node cli/ie.mjs config set profiles.probe-teamo.baseUrl https://api.teamorouter.com
node cli/ie.mjs config set profiles.probe-teamo.apiKeyEnv TEAMOROUTER_API_KEY
node cli/ie.mjs config set profiles.probe-teamo.imageModel gemini-3.1-flash-image
```

**两个必须知道的实测事实：**

- **key 环境变量名。** 本机实际导出的是 `TEAMOROUTER_API_KEY`（不是 CONTEXT 里写的 `TEAMO_API_KEY`），token 文件 `~/.config/teamorouter/token`（mode 600）已存在。二选一：`apiKeyEnv: "TEAMOROUTER_API_KEY"`，或把 token 内容内联成 `apiKey`（会触发"secret inline"告警）。
- **DNS pin 不必要，且服务器端做不到。** `dscacheutil` 显示 `api.teamorouter.com` 被判成 `75.126.33.156`（+ 一个 `2a03:2880:…:face:b00c` 的假 v6），`dig @1.1.1.1` 回 `198.18.0.51` —— 那是 **Clash TUN 的 fake-IP 段**，即"污染"的来源。**但实测未 pin 也能通**：`curl`/`node fetch` 对未 pin 的域名 GET `/v1beta/models` → 200，POST `/v1/chat/completions` → 400（缺 model，即已抵达网关）。更关键的是：**`cli/ie.mjs` 没有 `--resolve` 旗标**（只有 `--json/--base-url/--profile/--model/--port`，`ie.mjs:33-39`），`/api/generate` 也没有 DNS hook。DNS pin 只存在于**消费端的 skill bridge**（它 patch `dns.lookup`）。所以 D-02 的"钉 IP"在本 app 的 server 路径上**没有落点**；若真的不通，备选是 `/etc/hosts`（需要 sudo）。**计划里不要写一个不存在的 `--resolve`。**

### Anti-Patterns to Avoid

- **给这个 phase 新建一个 provider 或一个新命令。** D-02 明确 Teamo 是 profile；D-01/D-06 只需要一次手跑 + 文字记录。新命令是新维护面。
- **在 `animStrip.ts` 或探针脚本里再写一张比例表。** 比例表的家是 `route.ts`（Anti-Pattern 2，`.planning/research/ARCHITECTURE.md:380`）。
- **把 `--profile` 当全局旗标用。** 实测它不进 body（见 Common Pitfall 1）——会白花一次钱打在错误的通道上。
- **用"重试到成功"掩盖失败。** D-11 要求如实区分超时 / 比例不对 / 格子不对，D-08 要求失败即停。
- **把 `width`/`height` 当作"已经送到模型"。** `viaChat` 不发它们；能送的只有比例名。测量必须看**返回的字节**。
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| 付费调用 + 存图 | 新写 `cli/commands/probe.mjs` | `ie call generate --body ... --save ...` | 已存在、已文档化（`docs/agent-api.md:242`），并且能拿到原始响应体 |
| 量 PNG 尺寸 | 手写 PNG chunk 解析 | `sharp().metadata()` | `media.mjs:imageSize/dataUrlSize` 已是这套；sharp 已在 `node_modules` |
| 列质量剖面 | 逐像素 Python 循环 | `sharp().resize({height:1, kernel:'cubic'}).raw()` | 面积平均在 C 里做，11712 列瞬间出结果；Pillow 无 numpy 时慢 |
| 场色取样 | 假设背景是纯 `#FF00FF` | 环形采样取众数（消费端 `field_colour` 的语义） | 实测同批 strip 场色在 `(243,11,242)`…`(253,5,251)`…`(225,214,225)` 之间漂移；写死洋红会把整片背景判成生物 |
| 拟合 `(spacing, phase)` | 发明新搜索 | 复刻 `panel_boxes` 的 cost（切线处质量 − 格中线质量）与搜索窗口 | 消费端已用 40 条 strip 验证；Phase 2 要把它写成纯函数，这里先对齐语义 |
| profile → 网关解析 | 在脚本里手拼 baseUrl/key | `ieConfig.validateIeConfig` / `effectiveProvider` / `profileKey` | 一处一个事实；`config set` 会做原子写 + 校验 |
| 比例表回归断言 | 打印一张表人工看 | vitest route 单测（stub `fetch`） | `app/api/generate/__tests__/styleInjection.test.ts:21-35` 已有 stub `fetch` 捕获出站 body 的现成模式 |

**Key insight:** 这个 phase 的价值在**测量**，不在**实现**。所有实现件（CLI、config、sharp）都已存在；唯一的新东西是那张真实 PNG 和那份记录。
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: `--profile` 是全局旗标，但不进 `ie call` 的 body（★ 最贵的一个）

**What goes wrong:** `node cli/ie.mjs call generate --profile probe-teamo --body '{...}'` 看起来把 profile 传下去了，实际上**没有**。请求落到 `config.defaultProfile` 指向的网关（或 `provider` 字段的默认 `openrouter`），于是这次付费调用打在了错误的通道上，而错误信息（`fetch failed`）看起来像"网络问题"。

**Why it happens:** `cli/commands/core.mjs:153-189` 的 `call` 只做 `JSON.parse(ctx.flags.body)` 然后原样 POST；其它 studio 命令会 `...ctx.llmFields()`（`context.mjs:36-41`）把 `--profile`/`--model` 注入 body，`call` 不注入——它的定位是"给我一个原始 body 的逃生舱"。

**How to avoid:** 把 profile 写进 body：`--body '{"profile":"probe-teamo", ...}'`。或者把 `defaultProfile` 设成要打的 profile（此时 `provider` 字段必须**缺省**，因为 `requestProvider` 里 body 的 `provider` 优先于 profile，`llmServer.ts:59-65`）。**两种写法二选一，不要混用。**

**Warning signs:** 未知 profile 时 body 版回 HTTP 401 `unknown profile "__nope__"`；旗标版回 HTTP 502 `fetch failed`（说明 profile 被忽略、打到了别处）。本次研究用这两个信号判定，零花费。

### Pitfall 2: `width`/`height` 从不离开本机 —— 只有比例名离开

**What goes wrong:** 以为请求里的 `4096×512` 到了模型。实际上 `viaChat` 组装的 body 只有 `{model, messages, max_tokens, stream, temperature, ...extra}`（`llmChat.ts:27-35`），而 `extra` 里带尺寸的只有 `image_config.aspect_ratio`（`route.ts:160`）。

**Why it happens:** 路由把 `width/height` 折成一个**最近档的比例名**（`supportedAspectRatioForSize`，log 空间比较），chat 通道也只认这个。

**How to avoid:** 接受这个事实并把它写进记录（这正是 D-03 的路线）；验证时**只信返回字节**（D-04 已写死"以返回的实际尺寸为准"）。`imageGeneration.ts:142` 的 `size` 字段只有 APIMart 适配器会填，chat 路径上 `image.size` 是 `undefined`。

**Warning signs:** 记录里出现"requested 4096×512 → returned 11712×1408"这种比例对不上但方向对的结果，就说明只送到了比例这一层（既有 40 条 strip 正是如此）。

### Pitfall 3: magpie 的 ~15 秒天花板 —— 且它现在整体不健康

**What goes wrong:** 探针（预期 20–70 秒）撞上 magpie 的 ~15 秒超时，返回 504，看起来像"比例不对"。

**Why it happens:** `~/.config/magpie/usage.jsonl` 里本机网关对图像模型有 15 秒截断（504 行 `ms` 精确落在 12010/15002/15003）；同一文件里 `teamo-router/gemini-3.1-flash-image` 的成功调用 `ms` 在 **10434–155192**（中位约 24 秒），**历史最长 155 秒**。

**How to avoid:** 这是 D-01 已锁定的预期失败模式，如实记录即可（D-11）。**但计划里要预留"magpie 可能不是超时而是根本不健康"这一分支**：本次研究期间（2026-10-06 22:47–22:55）magpie 对合法请求返回 500 `teamo-router: 服务暂时无法处理此请求，请稍后重试。`，`/v1/images/generations` 连 20 秒无响应（HTTP 000），**同时** `api.teamorouter.com` 直连正常（`/v1beta/models` 200）。若探针第一枪就 500（而非 504），记录里应写明"本机网关当时不健康"，而不是记成"比例失败"。

**Warning signs:** `~/.config/magpie/usage.jsonl` 的最后几行 —— 探针跑完立刻 `tail` 它，能拿到网关侧自己的 `status`/`ms`/`provider`，与 route 的错误信息互为佐证。这是本次研究中最好的证据来源。

### Pitfall 4: 返回尺寸不等于请求尺寸 —— 这是既有事实，不是意外

**What goes wrong:** 把"返回 8.318:1 而不是 8:1"当成探针失败。

**Why it happens:** 全部 40 条已提交 strip 都是这样：请求 `4096×512`(8:1) → 返回 **11712×1408**(8.3182:1)；请求 `2048×512`(4:1) → 返回 **4128×1024**(4.0312:1)。宽度能被格数整除（8→1464、4→1032），但**比例与 cell 长宽比都不是要的那个**（cell 1464×1408 = 1.0398:1，不是正方形）。

**How to avoid:** 把"返回尺寸"当作**必须记录的常量**（TRAN-03/D-10 ②），归一化必须 scale-free（trim 到 bbox → 套固定 cell），**永远不要从返回宽度反推 cell 尺寸**（`.planning/research/STACK.md:145`）。探针要回答的是"加了 8:1 之后比例名是否至少到达 8:1"这半边问题。

**Warning signs:** 期望 `returned == requested` 的断言会红；不要写这种断言。

### Pitfall 5: 研究文档里那张 blast-radius 表是错的（10 vs 实测 4）

**What goes wrong:** 照抄 `.planning/research/ARCHITECTURE.md:380` / `SUMMARY.md`（以及 CONTEXT D-04 与 DISCUSSION-LOG 里的"56 种里有 10 种"）去写验证块，断言"10 种会变、1920×720 21:9→3:1、512×1536 9:16→1:3"——实际**这些都不在 D-03 的改动里**。

**Why it happens:** 那张表算的是**同时**加入 `3:1`/`1:3`/`1:4`/`1:8`（甚至 `2:1`/`1:2`）的一组比例。实测枚举：`['4:1','8:1']` → 4 变；`+ 1:4/1:8` → 5 变；`+ 3:1` → 8 变；`+ 3:1,1:3,1:4,1:8` → **10** 变（且此时 `1920×720` 与 `512×1536` 才出现）。D-03 的字面改动只有两行。

**How to avoid:** 按 D-03 的字面语义重算（下一节给出精确清单）。**planner 要显式说明这个不一致**，而不是静默采用任何一方。D-04 的实质约束（"六个 studio 不变"）在两种口径下都成立。

**Warning signs:** 验证块里出现 `1920×720` 或 `512×1536`，而改动只加了 `4:1`/`8:1`。
</common_pitfalls>

<code_examples>
## Code Examples

### 1. 比例表与最近档函数（要改的地方，逐字）

```typescript
// Source: app/api/generate/route.ts:7-34（本机源码）
const SUPPORTED_IMAGE_ASPECT_RATIOS = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9',
] as const                                    // ← D-03 在这里追加 '4:1', '8:1'

function aspectRatioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return w / h
}

function supportedAspectRatioForSize(width: number, height: number): string {
  const target = width / height
  return SUPPORTED_IMAGE_ASPECT_RATIOS
    .map((ratio) => ({
      ratio,
      // Compare in log space so 2:1 and 1:2 errors are symmetric.
      error: Math.abs(Math.log(aspectRatioValue(ratio) / target)),
    }))
    .sort((a, b) => a.error - b.error)[0].ratio
}
```
注意 `aspectRatioValue` 用 `split(':').map(Number)` —— 所以新加的必须是 `'4:1'`/`'8:1'` 这种 `W:H` 字符串，不能写 `1:4` 形态以外的东西。

### 2. blast radius：D-03 字面改动的精确清单（56 组合全枚举，实测）

ladder = `Modals.tsx:836` 的宽度 `[512,768,960,1024,1280,1536,1920]` × `:853` 的高度 `[360,540,720,768,1024,1080,1280,1536]` = 56 组合。

**加入 `'4:1'` 与 `'8:1'` 后，改变的组合恰好 4 个，全部是同一个档位迁移 `21:9 → 4:1`：**

| 组合 | 宽高比 | 改前 | 改后 |
|---|---|---|---|
| 1280×360 | 3.5556 | 21:9 | 4:1 |
| 1536×360 | 4.2667 | 21:9 | 4:1 |
| 1920×360 | 5.3333 | 21:9 | 4:1 |
| 1920×540 | 3.5556 | 21:9 | 4:1 |

**其余 52 组不变。** 没有任何组合迁移到 `8:1`（要 >6.0:1 才更近 8 而不是 4；梯子里最大是 1920×360 = 5.33:1，仍更近 4:1 和 8:1？——否：`|log(4/5.333)|=0.288` < `|log(8/5.333)|=0.405`，故落 4:1）。
**反向比例（`1:4`/`1:8`）不在 D-03 字面范围内**；若加上，会多出 `512×1536 (0.333) 9:16 → 1:4` 这一组（共 5 组）。

### 3. 六个 studio 的请求档位 —— 逐字断言表（全部不变）

| Studio | 请求尺寸 | 来源（常量） | 改前 | 改后 |
|---|---|---|---|---|
| tileSheet | 4096×4096 | `TILE_TEMPLATE_W/H` = `TILE_TEMPLATE_COLS/ROWS(8) × TILESET_TILE_SIZE(512)`，`page.tsx:1395-1397` | 1:1 | **1:1** |
| spriteSheet | 2048×1024 | `SPRITE_SHEET_W/H` = `SPRITE_GRID_COLS(4)×SPRITE_FRAME_SIZE(512)`, `GRID_ROWS(2)×512`，`sprite.ts:35-37` | 16:9 | **16:9** |
| propSheet | 2048×1024 | `PROP_BATCH_W/H` = `PROP_BATCH_COLS(4)×PROP_TILE_SIZE(512)`, `ROWS(2)×512`，`props.ts:19-20` | 16:9 | **16:9** |
| spriteAnchor | 512×512 | `SPRITE_FRAME_SIZE`，`page.tsx:2347-2348` | 1:1 | **1:1** |
| propMode / tileMode | 512×512 | `PROP_TILE_SIZE` / `TILESET_TILE_SIZE`，`page.tsx:2208`、`1147` | 1:1 | **1:1** |
| parallax / plain | 由 `Modals.tsx` 两个下拉决定 | `Modals.tsx:836,853` | 见上表 | 仅那 4 组变 |

（CONTEXT D-04 提到的 `1024×1024` **不在任何 studio 的请求路径上**；那是研究文档的举例。真正在用的是上表六条。`SPRITE_STRIP_W/H`（`256×2048`… 实为 `8×512 × 512`）存在于 `sprite.ts:39-41`，但 studio 的请求走的是 `SPRITE_SHEET_W/H`。）

### 4. 比例表的回归断言（vitest，用 route 的真实函数）

现有模式：`app/api/generate/__tests__/styleInjection.test.ts:21-35` 用 `vi.fn` 替换 `globalThis.fetch`，从 `init.body` 里读出发出的 body。同样的技法可以断言 `image_config.aspect_ratio`：
```typescript
// 计划里要产出的断言（骨架）
const LADDER_W = [512, 768, 960, 1024, 1280, 1536, 1920]
const LADDER_H = [360, 540, 720, 768, 1024, 1080, 1280, 1536]
const STUDIO_SIZES: Array<[number, number, string]> = [
  [4096, 4096, '1:1'],   // tileSheet
  [2048, 1024, '16:9'],  // spriteSheet / propSheet
  [512, 512, '1:1'],     // spriteAnchor / propMode / tileMode
]
// 断言：捕获到的 image_config.aspect_ratio 对每个 studio 尺寸等于第三列；
// 并且对 56 组 ladder 与「改前基线」逐组比对，只允许上表 4 组变化。
```
**注意**：`supportedAspectRatioForSize` 目前**没有 export**（`route.ts:25`）。计划里要么 export 它（推荐，纯函数本就该可测），要么走 route + stub fetch 的黑盒断言。前者更省事，也更符合"纯函数可测"的仓库风格。

### 5. 已知的两条返回尺寸基线（离线核对用，零花费）

| 请求 | 返回 | 返回比例 | 格宽 | 格长宽比 |
|---|---|---|---|---|
| 4096×512（8 向） | 11712×1408 | 8.3182 | 1464 | 1.0398 |
| 2048×512（4 向） | 4128×1024 | 4.0312 | 1032 | 1.0078 |
</code_examples>

<validation_architecture>
## Validation Architecture

本 phase 的验证分三层：**花钱那一次的记录**、**离线可复算的测量**、**比例表的回归**。第三层必须进 `vitest`（可 CI）；前两层是一次性证据，靠文件落盘 + 人工可复核。

| # | 断言 | 载体 | 可复算性 | 对应 |
|---|---|---|---|---|
| V1 | 探针记录含五项：requested 尺寸、returned 尺寸、拟合 `(spacing, phase)`、场色、用时 | `01-PROBE-RECORD.md` 存在且五项非空 | 人工／脚本 grep | D-10、TRAN-03 |
| V2 | 记录里的 returned 尺寸与落盘 PNG 的 IHDR **一致** | `sharp().metadata()` 对同一文件 | ✅ 零成本重算 | D-10 ② |
| V3 | 拟合参数可由落盘 PNG 重算得到同一组数字 | `probe-measure.mjs <png> 8` 重跑 | ✅ 零成本重算 | D-10 ③ |
| V4 | 失败模式被明确归档为三者之一（超时/比例/格子），且附网关侧证据 | 记录 + `~/.config/magpie/usage.jsonl` 对应行 | ✅ 事后可查 | D-11 |
| V5 | 比例表加 `4:1`/`8:1` 后，56 组合中**恰好 4 组**变化且全为 `21:9→4:1` | vitest | ✅ CI | D-03、TRAN-04 |
| V6 | 六个 studio 尺寸的档位全部不变（上表六条） | vitest（同一文件） | ✅ CI | D-04、TRAN-04 |
| V7 | `PROVIDER_IDS` 长度仍为 3（`openrouter`/`magpie`/`apimart`），未新增 provider | vitest（`app/lib/__tests__/providers.test.ts` 已有该模块的测试） | ✅ CI | TRAN-05 |
| V8 | Teamo 以 magpie profile 表达且 `ie config list` 能读出它（`provider: magpie` + `baseUrl` + key 来源） | CLI 输出存档 | ✅ 重跑 `ie config list --json` | D-02、TRAN-05 |
| V9 | 测试素材 PNG 存在、尺寸与记录一致、且被 `.gitattributes` 的 `*.png -diff` 覆盖 | `git check-attr diff tests/fixtures/anim/<f>.png` → `diff: unset` | ✅ | D-07 |

**Anti-vacuity（防止"验证了个寂寞"）：**
- V5/V6 必须断言**具体数字**（4 组、六条），不能只断言"函数返回了字符串"。
- V5 必须同时断言"52 组不变"，否则一个把整张表换成常量的实现也能过。
- V3 的重算必须用**已提交的 fixture**，而不是探针目录里的临时文件——否则 V3 会随探针目录被清理而失效。

**不做（明确排除）：**
- 不在本 phase 断言 `returned == requested`（Pitfall 4：既有 40 条全部不满足）。
- 不引入新命令的 CLI 集成测试（没有新命令）。
- 不测 4 向（D-09）。
</validation_architecture>

<sota_updates>
## State of the Art (2024-2025)

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| 假设 `width/height` 直达模型 | 明确：app 只送 `image_config.aspect_ratio`（比例名） | 现状（`route.ts:160`） | 探针的测量对象是"比例名 + 返回字节"，不是"像素透传" |
| 假设返回尺寸 = 请求尺寸 | 记录 `requested`/`returned` 两个字段并断言方向而非相等 | `libraryTypes.ts:10-27` 已有两字段 | 归一化必须 scale-free |
| 用 `W//N` 均匀切格 | 拟合 `(spacing, phase)` + gutter 断言 | 40 条 strip 实测（`STACK.md:146`） | Phase 2 把拟合写成纯函数；本 phase 只产出可信数字 |
| profile 当"第四个 provider" | profile = `magpie` + `baseUrl` + `apiKeyEnv` | `ieConfig.ts:132-139` | 零代码，`PROVIDER_IDS` 不变 |

**New tools/patterns to consider:**
- **`sharp` 的 `resize({height:1}).raw()`** 作为列质量剖面：把 11712 列的逐像素统计压成一次 C 级面积平均。Phase 2 的 `columnProfile` 可以在浏览器侧用 canvas `drawImage` 的 1px 高度缩放实现同语义（`ARCHITECTURE.md` 已提示"只有 profile 提取需要 canvas"）。
- **`~/.config/magpie/usage.jsonl` 作为网关侧真相源**：每一行有 `status`/`ms`/`provider`/`model`/`ep`。探针跑完立刻 tail 它，比从 route 的错误字串猜要可靠得多（本次研究正是靠它确认"C4 真的成功了一次"）。

**Deprecated/outdated:**
- **"本机 DNS 被劫持，需要 `api.teamorouter.com=43.128.25.159`"**：在本 app 的 server 路径上无落点（无 `--resolve`、无 DNS hook），且实测未 pin 也能通。`43.128.25.159` 与 `75.126.33.156` 都答 401（未带 key）/200（带 key）。这条只在消费端 skill bridge 的语境里成立。
- **`TEAMO_API_KEY`**：本机实际是 `TEAMOROUTER_API_KEY`；消费端脚本还回落到 `~/.config/teamorouter/token`。
</sota_updates>

<open_questions>
## Open Questions

1. **加 `8:1` 之后，magpie 的 chat 通路会不会接受它？**
   - What we know: `image_config.aspect_ratio` 会被发出去（`route.ts:160` + `llmChat.ts` 展开 `...extra`）；magpie 的上游 teamo-router 的 Gemini 原生端点本来就支持 `8:1`（skill bridge 的 `GEMINI_ASPECTS` 含 `8:1`/`1:8`，且历史成功调用的 `ep` 是 `/v1/chat/completions` 由 magpie 转译）。
   - What's unclear: **magpie 的 chat→Gemini 转译是否转发 `image_config`**。消费端 skill bridge 的注释说"Google's shim behind Teamo rejects `image_config`"，但那说的是**直连 teamo 的 chat 通路**（skill 因此改走原生端点）。magpie 是**另一个**转译层，行为未知。
   - Recommendation: 这正是探针必须回答的问题。计划里把"从返回字节算出的比例是否更接近 8 而不是 2.33"写成判定句（`STACK.md:199` 的原文），并在记录里同时写 requested/returned。

2. **magpie 当前的不健康是否是持久的？**
   - What we know: 本次研究期间（22:47–22:55）magpie 对合法图像请求回 500、`/v1/images/generations` 无响应；同期 teamo 直连正常。
   - What's unclear: 是上游临时故障，还是本机网关配置问题。
   - Recommendation: D-08 已锁定"失败即停"。计划里把"500/无响应"与"504 超时"分开记录（Pitfall 3），这样失败原因可直接归因，而不是笼统写"magpie 不行"。

3. **`image_config.aspect_ratio` 之外，是否还需要 `modalities`？**
   - What we know: route 已经在 `extra` 里发 `modalities: ['image','text']`（`route.ts:154`），且这条路径上历史成功过（`usage.jsonl` 里 `ep` 有值、`out` 有 token 的那些）。
   - What's unclear: 与 `image_config` 组合时是否被上游同时接受。
   - Recommendation: 不要在探针里动 `extra` 的形状；它是既有生产代码，改了就不是"测现状"了。

4. **D-07 的 fixture 该不该保留 4096×512（8 向）这一张？**
   - What we know: 真实返回约 11712×1408 = 16.7 MB，**远超 CONTEXT 里写的"约 1–3 MB"**（那是 4096×512 原始 PNG 的估计，不是模型实际返回的尺寸）。全 40 条语料合计 566 MB（`min 4.0 MB / max 19.2 MB`），且消费端已把 raw strip 加入 `.gitignore`（`assets/handpainted/sprites/*/*_[0-9]dir.png`）。
   - What's unclear: 仓库能接受多大的 fixture。
   - Recommendation: 见下一节——**下采样一张 fixture 存进 `tests/fixtures/anim/`**（例如宽缩到 ≤4096），并**同时**把原始尺寸记录进 `01-PROBE-RECORD.md`。这样 D-07 的目的（"供后续自动测试使用"：测面板拟合/抠底/切图）达成，而仓库不被 17 MB 二进制绑架。**这是需要 planner 明确写进计划的一个偏离**（CONTEXT 的 1–3 MB 估计与实测不符）。
</open_questions>

<fixture_and_budget>
## Fixture 与体积（D-07 的落点）

**仓库现有约定（实测）：**
- `.gitattributes` 只有一行：`*.png -diff` —— PNG 一律按二进制处理，不做文本 diff。新 fixture **自动继承**，无需再加规则。
- **没有 git-lfs。**
- 现有最大已提交文件是 `package-lock.json`（约 0.3 MB）与 `docs/screenshots/*.png`（约 0.1–0.3 MB）。**仓库当前没有任何 MB 级二进制。**
- 测试 fixture 的现状：`e2e/fixtures/assets/demo/tiles/sample/derived/body.png` 是 **222 字节**的占位 PNG。`tests/` 目录**不存在**；仓库的测试都在 `app/**/__tests__/`（vitest）或 `cli/native/__tests__/`（`node --test`）。

**建议（供 planner 决策）：**

| 选项 | 落点 | 体积 | 取舍 |
|---|---|---|---|
| **A（推荐）** | `tests/fixtures/anim/<actor>_<state>_f1_8dir.png`，把返回图**宽缩到 ≤4096**（高约 492） | 约 0.5–1.5 MB | 与 CONTEXT 的"1–3 MB"相符；面板拟合/抠底/切图的冒烟测试全部可用；原始 11712×1408 尺寸记进记录 |
| B | 原样存 11712×1408 | 约 16.7 MB | 保真最高；给仓库塞进第一个 17 MB 二进制，与消费端"raw 不进 git"的既定政策相反 |
| C | 存进 `.ie/`（已 gitignore） | 0 MB | 违背 D-07"存进本仓库" |

**A 的一个必要说明**：下采样会**改变可测的拟合参数**（pitch/phase 按比例缩放，Δ% 基本不变）。所以记录里必须同时写"原始返回尺寸与原始拟合参数"和"fixture 的尺寸与拟合参数"，Phase 2/3 的测试读 fixture 时要按比例换算或直接读 fixture 自己的拟合值。这也顺带成为**V3 的一条更强的断言**：同一套测量代码对"原始图"和"fixture"给出的 Δ% 一致。

**成本与边界（提醒 planner）：**
- 本 phase 的付费调用**最多 2 次**（D-01 先 1 次 magpie，D-08 失败后再等用户发话才 1 次 Teamo）。
- 历史单次成本证据：`~/.config/magpie/usage.jsonl` 里 `teamo-router/gemini-3.1-flash-image` 的 `ms` 中位约 24 秒、最长 155 秒；`ms` 有值的成功行 `in≈4986 / out≈1120`。按 Gemini 图像模型公开价，一次 4096×512 量级的 1K–4K 图是**美分级**，不是美元级。
- **本次研究意外发生过 1 次真实调用**（用于证明 profile 转发行为），`usage.jsonl` 有据：`2026-10-06T22:54:55` `agent:node` `provider:teamo-router` `model:gemini-3.1-flash-image` `status:200` `ms:12861`。它**不算** D-10 的探针（prompt 是占位 `x`，尺寸 64×64），但它是"本机 → magpie → teamo → Gemini 这条 chat 通路确实能出图"的第一个正面证据。计划里可以把这条当作**背景事实**（不是探针结果）。
</fixture_and_budget>

<sources>
## Sources

### Primary (HIGH confidence — 本机实测)
- `app/api/generate/route.ts:7-34,36-194` — 比例表、`supportedAspectRatioForSize`（log 空间）、`image_config.aspect_ratio` 注入点、`extra.modalities`
- `app/lib/imageGeneration.ts:74-165` — `viaChat` 丢弃 `width/height`；`IMAGE_ADAPTERS` 三路由；`size` 仅 APIMart 填
- `app/lib/llmChat.ts:27-35` — 出站 body 的完整字段列表（无 `width/height`）
- `app/lib/llmServer.ts:30-149` — `serverProvider`/`requestProvider`/`llmCredentials`/`targetFor`（URL = `baseUrl + '/chat/completions'`）
- `app/lib/ieConfig.ts:24-27,62-74,107-260` — profile 校验（`baseUrl` 仅 magpie）、`apiKeyEnv`/`apiKey`、`effectiveProvider`、`profileKey`、配置文件发现顺序
- `cli/ie.mjs:23-172` — 全局旗标**只有** `--json/--base-url/--profile/--model/--port`（**无 `--resolve`**）
- `cli/commands/core.mjs:152-189` — `call` 命令不调用 `ctx.llmFields()`（profile 不进 body）
- `cli/lib/context.mjs:36-41` — `llmFields()` 只在 studio 命令里被使用
- `cli/lib/server.mjs:16-136` — `DEFAULT_PORT=4317`、`.ie/server.json`、`ensureServer`
- `cli/commands/config.mjs:163-230,420-527` — `config set/list/get/test`
- `cli/lib/media.mjs:48-99` — `imageSize`/`dataUrlSize`/`findImagePayload`/`saveImage`
- `~/repos/dark-black/assets/handpainted/sprites/**`（40 条 strip + 3 份 ledger）— 返回尺寸 11712×1408 / 4128×1024；`ms` 10.4–155 s
- `~/.config/magpie/usage.jsonl` — 504 行 `ms∈{12010,15002,15003}`；成功行 `ms` 10.4–155 s；`provider:teamo-router` 与 `antigravity`；本次研究期间的 500/无响应
- `~/.agents/skills/image-extender/scripts/ie.py:776-860` — `BACKEND_DEFAULTS`（teamo url/model/env）、`--resolve` patch、`_post_route`
- `~/.agents/skills/image-extender/scripts/native/bridge.mjs:40-70,127-160,255-420` — `GEMINI_ASPECTS`（**含 8:1/1:8**）、`geminiAspect`、`toGeminiRequest`、原生 `:generateContent` 改写、`dns.lookup` patch
- `~/.config/teamorouter/token`（mode 600，57 字节）；env `TEAMOROUTER_API_KEY` 已设置
- 本机命令实测：`dscacheutil`/`dig`（`198.18.0.51` fake-IP；`/etc/hosts` 无 teamo）、`curl` 未 pin 200/400、`node fetch` 200、`sharp 0.34.5`、`node v24.21.0`、`Pillow 11.3.0`、无 numpy、无 git-lfs
- 本机 profile 路由实测（零花费判定）：body 里未知 profile → 401 `unknown profile`；全局 `--profile` → 502 `fetch failed`（被忽略）

### Secondary (MEDIUM confidence — 需在探针时确认)
- `~/.config/magpie/usage.jsonl` 显示 magpie 的上游就是 `teamo-router` —— 但**无法从中证明** magpie 的 chat 转译是否转发 `image_config`（探针要回答的正是这个）
- magpie `/v1/models` 报 295 个模型，含 `google/gemini-3.1-flash-image`、`group/auto-gemini-3-1-flash-image`、`commandcode/*`；`teamo-router/*` 前缀来自配置的模型选择（`settings.json` 的 `imageGen: teamo-router/gemini-3.1-flash-image`）

### Tertiary (LOW confidence — 已在文本中标注为"待探针确认")
- 加 `8:1` 后返回比例是否会从 `21:9`/`8.318` 变成接近 `8` —— 只有那次付费调用能回答
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: 本机 `ie` CLI → `next dev` → `/api/generate` → `imageGeneration` → magpie/teamo 的 chat 通路；返回 PNG 的离线测量
- Ecosystem: sharp 0.34.5 / node 24 / vitest 2.1.9 / Pillow 11.3.0（备选）
- Patterns: profile→网关解析、比例名降级、列质量剖面拟合 `(spacing, phase)`、环形场色采样
- Pitfalls: `--profile` 不转发、`width/height` 不出本机、magpie 15 s 天花板与当前不健康、返回尺寸≠请求尺寸、研究文档 blast radius 表口径不符

**Confidence breakdown:**
- Standard stack: HIGH — 全部已安装并实测（sharp 跑通了测量骨架）
- Architecture: HIGH — 逐行读源码 + 本机 profile 路由实测
- Pitfalls: HIGH — 前四条均有源码或 `usage.jsonl` 证据；第五条是枚举复核
- Code examples: HIGH — 比例表/blast radius/studio 档位均由本机枚举得出；测量骨架已实跑

**Research date:** 2026-10-06
**Valid until:** 2026-11-05（30 天）—— 但 **Pitfall 3（magpie 健康度）只有 7 天有效期**：上游故障随时会变，探针前重跑一次 `tail ~/.config/magpie/usage.jsonl` 确认当时状态。

---

*Phase: 1-传输探针与精确尺寸透传*
*Research completed: 2026-10-06*
*Ready for planning: yes*
</metadata>

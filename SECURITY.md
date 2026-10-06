# Security Review — Phase 1（传输探针与精确尺寸透传）

**范围:** 只审本 phase 实际改动的东西。逐条对照三个 phase commit（`c97d300`、`00f0d3a`、`1360b49`）的 diff。
**审阅者:** generic agent（替身 GSD 的 security 步骤）。本 phase 的执行者是 orchestrator，我未参与实现；下面每条都是自己在磁盘上重跑的。
**基线:** `.planning/PROJECT.md` 的威胁模型是 **BYOK + 只防"自己误操作"**（不做 symlink 攻击面等）。本审阅按这个基线评，不按公网多租户标准。

---

## 1. 改动面（exactly 这些，别的没有）

| 文件 | 性质 | 敏感面 |
|---|---|---|
| `app/lib/aspectRatio.ts`（新增 49 行） | 表从 `route.ts` 迁出 + 新增 `4:1`/`8:1` | **决定每一个生成请求要什么**（见 §2） |
| `app/api/generate/route.ts`（−29/+1） | 删内联表与两个函数，改一行 import | 调用点未动 |
| `app/api/generate/__tests__/aspectRatio.test.ts`（新增 190 行） | blast-radius 回归 | 无 |
| `app/lib/__tests__/providers.test.ts`（+20 行） | `PROVIDER_IDS` 未增第四家 | 无 |
| `scripts/probe-measure.mjs`（新增 125 行） | 离线测量脚本 | 读图、写 stdout，无网络 |
| `.planning/phases/01-transport-probe/probe-config.json`（新增） | 两份 profile | 键**来源**，非键值（§3） |
| `.planning/phases/01-transport-probe/evidence/*.json`（新增 3 份） | 剪裁过的调用证据 + 两份测量 | 不得含 data URL / 键值（§5） |
| `tests/fixtures/anim/chaser_idle_f1_8dir.png`（新增 945 KB） | 下采样 fixture | 真实返回图 → 见 §6 |
| `.ie/config.json`（**未跟踪**，已 gitignore） | 落地的 `probe-teamo` profile | 键**来源**，非键值（§4） |

---

## 2. 真正的边界：比例表决定每个请求要什么

- **表是闭集，出网的只有一个字符串。** `width`/`height` 从不出网；唯一到达网关的尺寸信号是 `image_config.aspect_ratio`（`app/api/generate/route.ts:132` 调 `supportedAspectRatioForSize(width, height)`）。所以**这一处 12 行数组的改动，就是全产品"每个生成请求要什么"的开关**。
- **本次实际影响 = 4/56 个梯子画布（全为 `21:9 → 4:1`），52 个逐组不变。** 我实跑了断言（5 passed）：`changed` 恰为 `1280×360 / 1536×360 / 1920×360 / 1920×540`，`counts['8:1']` 为 `undefined`（梯子最宽 1920×360 = 5.333，够不到 8:1），`counts['21:9'] === 8`，`counts['4:1'] === 4`。
- **回归读的是真出网体，不是表的副本**——`stub globalThis.fetch` 后解析 route 实际写出的 `init.body.image_config.aspect_ratio`。这一点很重要：如果测试自己重算一遍，表被改坏它也不会红。
- **负面对照有效**：`256×2048 → 9:16`，用来拦"顺手把 `1:8` 也塞进表"。实的逆比例集合为 `['2:3','3:4','4:5','9:16']`。
- **残余风险（非阻断，`fixture-only`）**：六个 studio 画布里只硬编码断言了 4 条（`4096×4096`、`2048×1024`×2、`512×512`）。studio 侧**新增**一个画布尺寸时，这条回归不会红——它保护的是"这 4 条没变"，不是"所有 studio 请求都没变"。加固方式：让 studio 请求的唯一构造处（`app/lib/studioRequest.ts` / `app/page.tsx`）导出画布清单，测试遍历它而不是抄字面量。
- 无网络、无鉴权、无用户输入解析被这次表改动引入。`aspectRatioValue` 只做 `split(':').map(Number)` 的除法，输入是自家闭集常量。

---

## 3. profile 持的是键的**来源**，不是键

- `probe-config.json` 与 `.ie/config.json` 里 `probe-teamo` 的形状是 `{ provider: "magpie", baseUrl: "https://api.teamorouter.com/v1", apiKeyEnv: "TEAMOROUTER_API_KEY", imageModel: "gemini-3.1-flash-image" }`——**`apiKeyEnv` 是一个 env var 的名字**，值的解析发生在 `app/lib/ieConfig.ts`（`PROFILE_KEYS` 白名单 + `ENV_NAME_RE` 校验，`ieConfig.test.ts` 33 tests 覆盖）。
- 实跑 `node cli/ie.mjs config list --json`，输出只有来源名：`"keySource":"$TEAMOROUTER_API_KEY (set)"`，**不回显值**。这是正确的形态。
- `ieConfig.ts` 对**内联 `apiKey` 会主动告警**（"holds a secret inline; prefer apiKeyEnv"），本次两份文件都**没有** `"apiKey"` 字段（我逐文件扫过）。
- **未验证（明确说清）：** `probe-teamo` 从 `apiKeyEnv` 解析到真实出网请求头这一整段**行为**，本 phase 从未行使——唯一次付费调用走的是 `probe-magpie`（`keyRequired: false`、无鉴权，`app/lib/providers.ts:70`）。所以本审阅只证明了**存在性**（配置里只有来源名、无键值），**没有**证明端到端的鉴权路径。该链在调用方 `route.ts:104-108` 与 `generateImage` 里接的，本 phase 没碰。

---

## 4. `.ie/config.json` 未跟踪

- `git ls-files .ie/` → **0 条**；`.gitignore` 含 `.ie/`（"Headless CLI runtime state (server pid/port) + esbuild bundle cache"）。
- 实跑扫描：**整个跟踪树 + `.ie/` 目录**里搜 `TEAMOROUTER_API_KEY` 的**值**（57 字符，`sk-t…`）→ **0 命中**。
- 该文件是 `0644`，仅本机。PROJECT.md 的威胁模型下可接受。

---

## 5. `evidence/*.json` 与探针记录：无键值、无 data URL

我逐文件核了 6 个候选（3 份 evidence + `01-PROBE-RECORD.md` + `probe-config.json` + `.ie/config.json`）：

| 文件 | `data:image` | `"apiKey"` 字段 | 键值 |
|---|---|---|---|
| `evidence/call-result.json` | 无 | 无 | 无 |
| `evidence/measured-raw.json` | 无 | 无 | 无 |
| `evidence/measured-fixture.json` | 无 | 无 | 无 |
| `01-PROBE-RECORD.md` | 无 | 无 | 无 |
| `probe-config.json` | 无 | 无 | 无 |
| `.ie/config.json` | 无 | 无 | 无 |

- **这是本 phase 最实的一处防线。** 真实返回的 `imageUrl` 是约 1.97 MB 的 base64 data URL（我在 `/tmp/probe-1.json` 里量到 1973877 B）。`call-result.json` 只留白名单字段，把 `imageUrl` 换成了标量 `imageUrlChars`（1973700）——**没有截断的 data URL，也没有前缀残片**。
- **网关行是安全的**：`usage_line` 里只含短 id `providerKeyId: "cddc22c8a2"`，**不含键值**。我 grep 了整份 `~/.config/magpie/usage.jsonl`（即网关自己的用量账本），key 值 **0 命中**。
- **探针记录**（`01-PROBE-RECORD.md`）的 json 块只含 5 个剪裁后字段 + prompt 全文（游戏美术 prompt，无敏感内容）。我重算了 `sha256(prompt_full)` = `9d966280…cfe8a6`，与记录值一致。
- `evidence/measured-*.json` 是 `probe-measure.mjs` 的纯输出，字段全是尺寸/颜色/整数，不接触密钥。

---

## 6. 边界材料：原始返回图上盘，fixture 入库

- `.ie/probe/chaser_idle_f1_8dir.png`（**1480226 B = 1.48 MB**，未跟踪）= 模型**真实返回**的条带，含本轮生成的游戏素材。留在 `.ie/`（已 ignore）符合既定政策（"raw 不进仓库"），与消费端自己的 `.gitignore` 一致。
- `tests/fixtures/anim/chaser_idle_f1_8dir.png`（945309 B，**已入库**）是它的 2048 宽下采样。已设 `git check-attr diff` → `diff: unset`（`.gitattributes` 的 `*.png -diff` 覆盖），避免 945 KB 二进制污染 diff。
- **`/tmp/probe-1.json`（1973877 B，含完整 data URL）** 首审时权限为 `0644`，本机任意用户可读，且不在 `.gitignore` 的语义范围内（位于 `/tmp`，不随仓库走）。**复审（`f6cf83f` 之后）：已删除**（`ls /tmp/probe-1.*` → No such file or directory）。该项关闭。
- **仍备案（非本 phase 改动面，故不计入本 phase 缺口）**：`/tmp` 里还有两个更早的同类残留——`probe_ref.json`（1602327 B）与 `probe_teamo-router_gemini-3.1-flash-image.json`（1578553 B），各含 1 处 `data:image`。它们属于 Phase 0 研究期，不是本 phase 产物；建议一并清掉以收口习惯。
- **权限口径澄清**：这些文件的权限位实测为 `-rw-r--r--`（`0644`）。首审用词"世界可读"指的是 **other 可读**；若按"是否 world-writable"读则应是 `-rw-rw-rw-`（`0666`）。此处写清，避免后续误读为"任何人可写"。
- 仓库里没有任何 MB 级被跟踪二进制：fixture 是唯一超过 100 KB 的新增文件。

---

## 7. 我**没有**验证的（明确列出，不假装）

1. **出网体本身没有落盘证据。** `/tmp/probe-1.json` 只存**响应**（`body/ok/status/summary/written`），不含请求体；`grep aspect_ratio /tmp/probe-1.json` → 无命中。所以"远端确实收到了 `8:1`"是**推断**，依据是返回尺寸 2928×352 = 8.3182 与磁盘上 40 张已交付 strip 的签名同值（旧表下 `4096×512` 会落到 2.333）。这是 Phase 1 的核心事实，而它是推断——需要硬证据时应在 fetch 处加一个**只记 `image_config`** 的调试钩子。
2. **`apiKeyEnv` → 出网鉴权头**的行为未行使（§3 末）。
3. **未做依赖/供应链审计。** 本 phase 不装任何包（`vitest` 2.1.9、`typescript` 5.9.3、`sharp` 已在树里），`package.json` 未改，`package-lock.json` 未改——这一点可由 diff 证明。但既有的 `sharp` / Next / Playwright 版本与已知 CVE 我没查。
4. **未审 `.ie/` 下其他内容**（`cache/`、`tmp/`、`server.log`、`server.json`）：都不是本 phase 的产物，只确认了它们不在跟踪区。
5. **未做代码审查级别的静态分析**（除 `tsc --noEmit` 外）。`tsc` 本身**当前是红的**（见 `01-VERIFICATION.md` G-1，测试文件里的 `mock.calls` 越界，不影响安全面）。
6. **未验证消费端**（`~/repos/dark-black`）如何看待这些 strip；那里的读取路径不在本 phase 范围内。

---

## 结论

本 phase 没有引入**新的**秘密暴露面。真正的边界有两处，都守住了：

1. **比例表**（决定每个请求要什么）——改动被 5 条读真出网体的断言钉住，实际只动 4/56，且有负面对照防"顺手加逆比例"。
2. **键永远只是"来源"**——配置存 `apiKeyEnv`，`config list` 只回显来源名，跟踪树与 `.ie/` 里搜不到键值，被跟踪的 evidence 里没有 data URL。

**复审（2026-10-06T17:00:51Z，`f6cf83f`）**：首审的非阻断项里，`/tmp/probe-1.json` 残留**已清理**（§6）；另两项维持——**studio 画布清单硬编码**（加固见 §2 末，属测试严格性问题，非安全面）、**`apiKeyEnv` 出网行为未行使**（§3）。该 commit 只改了 4 个文件（1 个测试 + 3 个 .md 数字），**未触碰 `aspectRatio.ts` / `route.ts` / `probe-config.json` / `.ie/config.json` / evidence / fixture**，故本安全审阅的结论不变。

**未验证项 6 条**（§7）维持不变，其中第 1 条是 Phase 1 核心事实的推断性质，值得后续补一个只记 `image_config` 的钩子。

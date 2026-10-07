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

---

# Security Review — Phase 2（纯核心 `animStrip.ts` + `animSet.ts`）

**范围:** 只审本 phase 实际改动的东西。逐条对照两个 phase-2 代码 commit（`6bac853`、`94001b3`）的 diff。
**审阅者:** generic agent（替身 GSD 的 security 步骤）。本 phase 的执行者是 orchestrator，我未参与实现；下面每条都是自己在磁盘上重跑的。
**基线:** 同 Phase 1——`.planning/PROJECT.md` 的威胁模型是 **BYOK + 只防"自己误操作"**，不按公网多租户标准评。

## P2-1. 改动面（exactly 这些，别的没有）

| 文件 | 性质 | 敏感面 |
|---|---|---|
| `app/lib/animStrip.ts`（新增 300 行） | 纯代数：尺寸、拟合搜索、prompt 模板、方向常量表 | **决定每个生成请求要什么画面**（见 P2-2）；零 import |
| `app/lib/animSet.ts`（新增 476 行） | 纯契约：规格校验、计划、`set.json`、续跑判定、命名进制 | **`out` 是本模块唯一未被约束的字符串**（见 P2-3）；唯一 import 是 `animStrip` |
| `app/lib/__tests__/animStrip.test.ts`（新增 270 行） | GEOM-01/GEN-08 断言 + 探针 sha 漂移锚点 | 读 `.ie/probe/`（gitignored）与 `01-PROBE-RECORD.md`；**测试文件可 import node**（非产品面） |
| `app/lib/__tests__/animSet.test.ts`（新增 236 行） | GEN-07/GEOM-03 断言 | 无 |
| `.planning/phases/02-pure-core/*.md`、`ROADMAP.md`、`REQUIREMENTS.md` | 计划、两份 SUMMARY、状态翻牌 | 无 |

**未触碰**：`app/lib/aspectRatio.ts` 与 `app/api/generate/route.ts`（Phase 1 的 invariant）——`git log 6bac853^..HEAD -- <两者>` 输出**为空**。`package.json` / `package-lock.json` 相对 Phase 1 结束时 `git diff --stat 59d5acd..HEAD` **为空**：本 phase **零新依赖**。

## P2-2. 真正的边界：prompt 模板决定模型画什么

- **本 phase 把"要什么画面"从散文变代码。** `buildStripPrompt()` 生成的文本直接进 Phase 4 的出网请求体。它是**唯一**构造该文本的地方，且与 Phase 1 真花过钱的那段**逐字节相同**（sha256 `9d966280…cfe8a6`，我实跑复现）。
- **为什么这是安全面而不是纯功能面**：prompt 里的"约束句"（格内包含、纯洋红场、禁卡片/文字/网格线）是**防模型画错东西**的护栏。护栏被删 = 花真钱换回不可用的图（消费端 `remove_card`/`keep_main_blob` 的抠底会失败）。护栏由**常量串**给出（`STRIP_CONSTRAINTS`，`animStrip.ts:263`），并有断言钉住四条短语——我实跑确认四条都在 prompt 文本里。
- **方向顺序即契约**：`DIRS8` 的顺序错位会让消费端 `enemy.gd` 的行映射整体偏移，**渲染出错误朝向且无任何报错**（`.planning/research/PITFALLS.md:507`）。顺序由 `DIRS8`/`DIRS4` 常量表唯一持有（`grep -rln "DIRS8 = \[" app/ scripts/` → **仅** `animStrip.ts` 一个文件），并有精确到逗号分隔串的断言。
- **不引入输入面**：`buildStripPrompt` 的三个字符串入参（`subject`/`motion`/`styleText`）来自 spec，而 spec 由 `validateAnimSetSpec` 白名单重建（P2-4）；`styleText` 内联进 prompt 是**产品要求**（"闭集风格表无法表达某个游戏自己的风格"，`animStrip.ts:277`），不是注入缺陷——它的消费者是图像模型，不是 shell/SQL/HTML。
- **残余风险（非阻断）**：`styleText`/`subject` 无长度上限。一个异常长的 `styleText` 会撑大请求体（Phase 4 的载荷约束在 spec v2 §8 另有闸门）。加固方式：在 `requireString` 上加一个上限（例如 2000 字符），或在 Phase 4 的出网前加总长断言。

## P2-3. `out` 是唯一未被约束的字符串 —— 本 phase 最实的一处发现

- **实测**：`validateAnimSetSpec` 对 `out` 只调 `requireString`（非空字符串），因此 `{ out: "../../../../tmp/evil" }` **被接受并原样返回**（我实跑打印确认：`spec.out === "../../../../tmp/evil"`）。
- **为什么这不是本 phase 的缺口**：(a) plan 第 4 条与 spec v2 §5.1 的校验清单**都只要求** `out` 是非空字符串，把它做成路径约束是本 phase 范围内的**未要求加固**；(b) `out` **不进入** `set.json`——我实读 `buildSetJson` 的返回体（:365-386），九个字段里没有它；(c) `out` 的**唯一消费者**是 Phase 4 的 runner（写盘根），而 Phase 4 的威胁模型里"用户给自己的工具指一个写盘目录"不是攻击面（BYOK + 单人）。
- **但它确实是这个模块里唯一"任意字符串 → 未来的文件系统调用"的通道**，所以记在这里供 Phase 4 收口：runner 落盘前应把 `out` 约束在项目工作区内（`path.resolve` 后与 cwd 做前缀检查，或干脆在 CLI 层解析而非从 spec 直取）。**现在不做**，因为这个模块**不碰文件系统**——`animStrip.ts` 与 `animSet.ts` 的纯度是 D-21 硬保证（我实跑浏览器打包，产物无 `require(`/`node:`）。
- **生成的文件名是安全的**：`stripFile()`/`frameFile()` 的文件名由**已校验**的 `state`（`/^[a-z0-9][a-z0-9-]{0,31}$/`）与固定字面量拼出，无路径分隔符可注入。我实跑四个非法名（`../../etc`、`a/b`、`../x`、`a.b`）**全部被拒**，且 `stripFile`/`frameFile` 的输出经 plan 闸门 2 的 `FILE_RE` 正则逐条验证为 `raw/<name>_f<n>_8dir.png` / `derived/<name>_f<n>_<dir>.png`。

## P2-4. 规格校验：白名单重建，未知键进 warning 而非 spec

- **`validateAnimSetSpec` 返回的是重建的新对象**，不是 `{ spec: raw as AnimSetSpec }`。**实跑**：注入 `{ futureKnob: 1, isAdmin: true }` → 两条 warning、返回对象 `Object.keys` **恰为九个白名单字段**，`'futureKnob' in spec === false`、`'isAdmin' in spec === false`。这堵住了 mass assignment：一个前向兼容的未知键**无法**变成下游会读的字段。
- **原型污染实测无面**：`JSON.parse('{…"__proto__":{"polluted":true}}')` 走完整条校验 → `Object.prototype.polluted` 为 `undefined`；未知键 `__proto__` 只产出一条 warning。原因是没有 `Object.assign(target, raw)` 之类的合并路径，且未知键被丢弃而不是拷贝。
- **类型混淆守卫实测**：`states: null`、`states: {}`、`cell: "512"`、`loop: 1`、`frames: 1.5` **全部被拒**（`isRecord`/`Number.isInteger`/`requireBoolean` 各自把关）。`frames: 1.5` 走 `requireInteger` 抛而非静默截断——消费端的 `frame = row * FRAMES + col` 寻址靠这个。
- **"一个调用都不发"是结构性的，不是承诺**：`validateAnimSetSpec` 是纯函数，模块零 I/O（`grep -nE "from '(node:|next|react)"` 0 命中；浏览器打包无 `node:`）。15 条硬错逐条断言，其中 11 条有 label 计数（plan 闸门 3 的 `= "11"` 硬计数，我实跑通过，且实测 label 无重复——`grep` 是逐行计数而清单里没有任何 label 是另一条的子串）。

## P2-5. 续跑判定：把"文件存在"从完成判据里剔除

- **`nextPending` 的完成来自 `记录 + 运行器事实`，不是文件系统。** 我实跑四条：`ok:true` + `rawDecodable:false` → `'raw-unreadable'`；facts 里**缺**该键 → 仍待办（**沉默不等于成功**）；`derivedCount 7 < 8` → `'derived-short'`；重复 `(state,frame)` → 进 `duplicates` 且 `done` 不被虚增。
- **为什么这是安全面**：消费端账本里"17 行 / 16 条 strip"的**重复计费**已付过一次（spec v2 §8，`animSet.ts:428` 注释）。一个把截断 PNG 当完成的判据会让 runner **跳过**重做，而跳过意味着**已经花掉的钱白花**（不是省钱）。`duplicates` 是给 Phase 4 断言"账本没被写重"的钩子。
- **模块本身不识别文件系统**：`StripFacts` 是**入参**（`{ rawDecodable, derivedCount }`），注释 :391 明写 "passed in — never inspected here"。所以"截断的 PNG 算不算完成"这个判断**不可能**因为漏了一个 fs 调用而消失——它必须被显式传进来。
- **残余风险（非阻断，属 Phase 4）**：`facts` 的**填充方**（Phase 4 runner 实际去 `stat`/解码的那些代码）还不存在，所以"运行器确实采了 rawDecodable 而不是恒传 `true`"这一段行为**未行使**。本 phase 只保证判据的形状正确；`rawDecodable: true` 的**来源**要等 Phase 4 落地后才能审。

## P2-6. 仓库卫生：scratch、探针原文、跟踪状态

- **`.ie/scratch/phase2-planner/`**（planner 自验留下的实现，4 个文件）**实测被 `.gitignore:59` 的 `.ie/` 覆盖**（`git check-ignore -v` 命中；`git ls-files .ie/` → 0 条）。密钥扫描 `sk-…`/`Bearer …`/`apiKey` **0 命中**。我逐文件 diff 到 shipped 版本：`animStrip.ts` 与 `animSet.test.ts` **逐字节相同**，`animSet.ts` 差 1 行、`animStrip.test.ts` 差 25 行（即两个被修的缺陷）。**无泄漏、无未跟踪的敏感产物。**
- **`.ie/probe/chaser_idle_f1_8dir.png`**（1480226 B = 1.48 MB，模型真实返回的条带）仍在 `.ie/`（gitignored），符合"raw 不进仓库"的既定政策。它**未被**本次 commit 触碰。
- **`tests/fixtures/anim/` 未被本次 commit 触碰**（Phase 1 入库的 945309 B 下采样）。
- **gate 临时文件已清理**：六个闸门各自带 `trap 'rm -f …' EXIT`；我跑完后仓库根**没有** `.p1-gate-entry.ts` / `.p2-gate-entry.ts`（`ls -a | grep -i gate-entry` → 无），也没有 `.log` 残留。这是"闸门用完即走"的可复核证据（`1ae5bcd` 专门为此装了 trap）。
- **`git status` 无未提交的 phase 工作**：`--untracked-files=no` 输出为空。未跟踪项恰为 `.omp/` 与 `.planning/state.json`（harness 自己写的状态，预期内）。
- **仓库里没有新增的 MB 级被跟踪二进制**：本 phase 只新增两个 `.ts` 源码与两个测试文件。

## P2-7. 我**没有**验证的（明确列出，不假装）

1. **Phase 4/6 的实际消费者不存在。** 本 phase 交付的是**纯函数与契约**；"CLI 拿去用"、"UI 拿去用"这一段**未行使**。导出面由本 phase 的测试完整行使，但下游的接法在后续 phase 才可审。
2. **`out` 落盘路径**（P2-3）：本模块不碰 fs，故没有可测的越界行为；真实风险在 Phase 4。
3. **`facts` 的填充方**（P2-5）：`rawDecodable` 恒为 `true` 的错误实现在本 phase **测不出来**（本 phase 只消费它）。
4. **prompt 里的自由文本注入到图像模型**的行为（P2-2）：`styleText` 是否真能诱导模型产出越格/场景化结果，需要真实付费调用才能观测——超出本 phase（零调用）的范围。
5. **未做依赖/供应链审计。** 本 phase **零新依赖**（`package.json`/`package-lock.json` 相对 Phase 1 结束**未变**，由 `git diff --stat` 证明），但既有 `sharp`/Next/Playwright 版本的 CVE 我没查（同 Phase 1 §7.3）。
6. **未验证消费端**（`~/repos/dark-black`）如何寻址这些帧；那里的 `enemy.gd`/`build_handpainted_sheets.py` 读取路径不在本 phase 范围内——本 phase 只保证**顺序与命名**与那里已记录的约定一致。

## 结论

本 phase 没有引入**新的**秘密暴露面（零网络、零文件系统、零新依赖、零跟踪的敏感产物）。真正的边界有两处：

1. **prompt 模板**（决定模型画什么）——由常量护栏 + 与付费调用逐字节相同的 sha 锚点守住，方向顺序由单一常量表持有。
2. **规格校验**（决定"钱花之前"是否拦住坏输入）——白名单重建、未知键降级为 warning 且不进 spec、原型污染与类型混淆实测无面。

**新发现的非阻断项 1 条**：`out` 是唯一未被约束的字符串（P2-3），已移交 Phase 4 收口。
**行为未行使项 2 条**：`facts` 的填充方（P2-5）、`out` 的落盘路径（P2-3）——两者都在后续 phase，本 phase 只保证判据与校验的形状正确。
**Phase 1 的 6 条未验证项维持不变**（见上）；其中"studio 画布清单硬编码"与本 phase 无关。

---

*Phase 2 审阅：2026-10-07T03:57:34Z。对照 commit `6bac853`（4 个新文件，1257 行）与 `94001b3`（1 行产品改动 + 25 行测试 + 3 个 .md）。*

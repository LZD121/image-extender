# image-extender fork：本地资产库设计

日期：2026-10-05 · 状态：待实现 · 适用仓库：boona13/image-extender 的 fork

## 0. 一句话

给 image-extender 增加一个**磁盘资产库**，让本地运行的 studio 产物可以持久化、可以被 git 共享、可以被追溯；不引入服务端、认证、多用户与批处理队列。

## 1. 背景（现状与证据）

| 事实 | 证据 |
|---|---|
| 资产**没有**持久化。`localStorage` 只存 3 项：API key / model / mode | `app/lib/app.ts:45-56`，全仓仅 3 处 `setItem` |
| props、sprite sheet、tiles 全部只存在于 React 内存态，**刷新页面即丢失** | 无 `indexedDB` / `sessionStorage` / `persist` 使用 |
| 唯一的持久化路径是手动点击 Export ZIP | `app/page.tsx:1753`、`:2257`、`:3270`（JSZip） |
| 已有的引擎侧契约是 `buildPropManifest()` | `app/page.tsx:1958-1983` |
| app 目前**零处**文件系统调用 | `grep -rn "node:fs\|from 'fs'" app/` 为空 |
| Next.js 14（App Router），`next.config.js` 无特殊配置 | `package.json:35`，`next.config.js` |
| 6 个 API 路由硬编码 OpenRouter base URL | `app/api/{generate,extend,scene-brief,prop-brief,tile-review,sprite-review}/route.ts` |
| 运行假设已经是"本地服务器" | `app/components/Modals.tsx:642` |

实测产物体积（APIMart/Gemini 通道，2026-10-05）：

- 2880×2880 tile sheet PNG = **5.7 MB**
- 4096×4096 输出（data URL 14,907,611 字符）≈ **11 MB** 二进制
- 2048×1024 sprite sheet ≈ **2.6 MB**

结论：一个 100 张的资产库是 **0.5–1 GB** 量级，这直接决定了"哪些文件进版本库"是架构决策而非细节。

## 2. 目标与成功标准

1. 生成物能落盘；**刷新页面或重启 dev server 后仍能找回**。
2. 第二个团队成员 `git pull` 后，拿到同一套**成品**资产，无需重新生成。
3. 每个资产可追溯：后端、模型、prompt、参数、请求尺寸 vs 实际返回尺寸、花费。
4. 现有 Export ZIP 的输出**逐字节不变**。
5. 不引入服务端实例、认证、多用户、批处理队列。

## 3. 非目标

- 批量/队列 UI（生成编排已由 `ie.py` / skill 覆盖）
- 服务端实例、登录、并发写协调、按用户计费
- 内容寻址存储与自动去重（方案 B，见 §11）
- 云对象存储同步（git 就是同步机制）
- 修改任何后处理算法（chroma key、切格、corner reconciliation、sprite 对齐、Poisson）
- 修改硬编码的 provider base URL（独立改动，见 §14）

## 4. 架构

```
浏览器 UI（资产面板 + Save to library）
        │  fetch
        ▼
app/api/library/[[...path]]/route.ts     ← HTTP 面：校验、读写、流式返回
        │
        ▼
app/lib/library.ts                       ← 唯一知道磁盘布局的单元（仅服务端）
        │  node:fs
        ▼
$IE_ASSETS_DIR (默认 <repo>/assets)
```

| 单元 | 职责 | 依赖 | 可否独立测试 |
|---|---|---|---|
| `app/lib/library.ts` | 路径推导与校验、`readMeta`/`writeMeta`、`listAssets`、原子写、删除 | `node:fs`、`node:path` | 可（纯函数 + 临时目录） |
| `app/api/library/[[...path]]/route.ts` | GET/POST/DELETE；把 HTTP 语义映射到 library.ts；流式返回 PNG | `library.ts` | 可（直接调用导出的 handler） |
| `app/lib/libraryClient.ts` | 浏览器侧 fetch 封装（list / get meta / get file url / save / delete） | `fetch` | 可（mock fetch） |
| 资产面板（UI） | 列出项目与资产、保存对话框、载入到 studio、删除 | `libraryClient` | 手动 E2E |
| `app/lib/libraryTypes.ts` | `AssetMeta` 等共享类型 | — | 类型层 |

**边界原则**：只有 `library.ts` 知道目录结构；UI 与 route 都通过它。`library.ts` 不 import 任何 React/Next 代码，因此可以用纯 Node 测试。

## 5. 磁盘布局与 `meta.json`

```
$IE_ASSETS_DIR/
  <project>/<kind>/<slug>/
    meta.json
    raw/                    # 模型原始输出；.gitignore，不进版本库
      sheet.png
    derived/                # 最终产物；进版本库
      body.png
      edge-top.png
      ...
```

- `project`：用户可见的工作区名（如 `dungeon`）
- `kind`：`tiles` | `sprites` | `props` | `parallax` | `extend`
  studio → kind 的映射固定为：Extender → `extend`、Tiles → `tiles`、Sprite → `sprites`、Props → `props`、Parallax → `parallax`。kind 由 studio 决定，用户不可改（避免同一类资产散落多目录）。
- `slug`：资产名（如 `mossy-stone`）

`meta.json` 上半部分**逐字复用**现有 manifest（引擎侧消费不变），下半部分是新增的 provenance：

```jsonc
{
  "schemaVersion": 1,
  "type": "tile-set",              // 沿用现有 manifest 的 type
  "project": "dungeon",
  "kind": "tiles",
  "slug": "mossy-stone",
  "createdAt": "2026-10-05T09:20:00.000Z",
  "updatedAt": "2026-10-05T09:20:00.000Z",

  "manifest": { /* buildPropManifest() 等既有构造函数的输出，逐字保留 */ },

  "files": {
    "sheet": "raw/sheet.png",
    "derived": ["derived/body.png", "derived/edge-top.png"]
  },

  "provenance": {
    "backend": "apimart",                       // apimart | openrouter | teamo | custom
    "model": "gemini-3.1-flash-image-preview",
    "prompt": "...",
    "sceneBrief": "..." | null,
    "artStyle": "..." | null,
    "params": { "width": 4096, "height": 4096, "tileSheet": true },
    "requested": "4096x4096",                   // 请求尺寸
    "returned": "4096x4096",                    // 实际返回尺寸（模型可能不符）
    "cost": { "usd": 0.0262, "source": "apimart" } | null,
    "toolVersion": "web" | "ie.py@<sha>"
  }
}
```

`cost` 来自生成响应：APIMart 返回 `cost` / `credits_cost`，OpenRouter 返回 `usage`。当前 app 完全丢弃这些字段，落库时顺手保留。

## 6. HTTP 契约

单文件实现：`app/api/library/[[...path]]/route.ts`（可选 catch-all，同时覆盖 `/api/library` 与深层路径）。

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `/api/library` | 返回库索引：`{ projects: [{ name, kinds: [{ name, assets: [{ slug, type, updatedAt, derived: string[] }] }] }] }`。**不返回图片数据。** |
| `GET` | `/api/library/<project>/<kind>/<slug>` | 返回该资产的 `meta.json` |
| `GET` | `/api/library/<project>/<kind>/<slug>?file=derived/body.png` | 以 `image/png` 流式返回该文件（含 `Cache-Control: no-store`） |
| `POST` | `/api/library` | body：`{ project, kind, slug, meta, files: { "<relpath>": "<dataURL>" }, overwrite?: boolean }` → `201 { path, written: string[] }`；同名且 `overwrite !== true` → `409` |
| `DELETE` | `/api/library/<project>/<kind>/<slug>` | `204` |

**校验规则（全部在 `library.ts` 内实现并测试）**

- `project` / `kind` / `slug`：`^[a-z0-9][a-z0-9-]{0,63}$`
- `file` 的 relpath：`^(raw|derived)/[a-z0-9][a-z0-9._-]{0,118}\.[a-z0-9]{1,8}$`（必须带扩展名 —— 初稿的 `{0,127}` 会放行 `derived/x`，已在 Task 3 修正）
- 解析后的绝对路径必须以 `path.resolve(IE_ASSETS_DIR)` 为前缀；否则 `400`
- 一次 POST **只允许一个资产**（避免大 body 与部分失败）
- 单个文件 ≤ 40 MB，单次请求总 body ≤ 200 MB，超出返回 `413`

## 7. 数据流

**保存**

1. 生成完成，内存中已有 raw sheet 与派生结果。
2. 用户点击导出点旁的 **Save to library**。
3. 对话框：project（下拉选择或新建）、kind（由当前 studio 决定，不可改）、slug（由 prompt 自动生成，可编辑）。
4. `POST /api/library`，`files` 中：`raw/sheet.png` + 各 `derived/*.png`（data URL）。
5. route 校验 → 写入同级临时目录 → 原子 `rename` 到目标目录。
6. UI 将当前资产标记为已入库。

**加载**

1. 面板 `GET /api/library` 取索引（纯 JSON，无图）。
2. 展开某资产时，用 `GET ...?file=derived/body.png` 的**直接 URL** 渲染缩略图 —— 不用 base64，避免 20 个 512² tile 撑爆页面。该 URL 与页面**同源**，因此拖进画布做 chroma key / 切格时不会污染 canvas（这正是不能用外部 URL 的原因，与本次 APIMart 接入时把结果内联成 data URL 是同一个约束）。
3. "载入到 studio" 复用现有的图片导入路径（`applyImageToActiveLayer`）。

**共享**

- `git pull` 后新的资产目录出现，面板自动列出（面板读的就是磁盘）。
- **天然无冲突**：每人新增资产 = 新目录；`meta.json` 按目录隔离。不存在"多个开发者同时改同一个 `library.json`"的经典冲突场景 —— 这是选择"目录即库"而非"单一大 JSON"的核心理由。
- `.gitattributes`：`*.png -diff` + `assets/**/raw/ .gitignore`。是否引入 git-lfs 见 §13。

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| `IE_ASSETS_DIR` 不存在或不可写 | `500` + 明确原因；UI 面板显示"库未配置"，**生成流程不受影响**（降级而非阻断） |
| `project`/`kind`/`slug` 非法 | `400`，绝不落盘 |
| 路径穿越尝试 | `400`，绝不落盘 |
| 目标目录已存在 | 默认 `409`；UI 提供三选：覆盖 / 存为 `<slug>-v2` / 取消。**绝不静默覆盖** |
| 写入中途失败（磁盘满、权限） | 先写 `*.tmp-<rand>` 目录，成功后原子 `rename`；失败则清理临时目录 |
| 单文件超过 40 MB | `413` |
| 删除不存在的资产 | `404` |
| 索引中出现损坏的 `meta.json` | 该条目跳过并在响应里带 `warnings[]`，不影响其余资产 |

## 9. 安全边界

- 所有路径拼接后必须做 `path.resolve` + 前缀校验（防止 `../` 与绝对路径）。**威胁模型限于"自己误操作"**：前缀校验不覆盖"资产目录内存在指向外部的符号链接"，本设计接受该风险（本地单用户文件系统），不加 `realpath` 校验。
- 只接受 `raw/` 与 `derived/` 两个子目录下的文件名，不接受嵌套子目录。
- `GET ?file=` 只读、且同样受前缀校验约束。
- app 保持本地运行假设（`Modals.tsx:642` 已声明）；本设计**不**提供任何远程访问加固，若将来要共享实例，需重新评估（见 §12）。

## 10. 测试

**单元（`library.ts`）**

- slug/project/kind 校验表：合法、大写、Unicode、超长、空、`../`、绝对路径、`..%2f` 解码后
- relpath 校验：合法、越界子目录、`./`、连续点
- 原子写：模拟写入失败后目标目录不存在残留
- `listAssets`：空库、含损坏 `meta.json` 的库

**集成（route handler）**

- `POST` → 断言磁盘文件树与 `meta.json` 内容
- `GET` 索引 / 单资产 / `?file=` 的 content-type
- 同名 `POST` → `409`；带 `overwrite: true` → `200`
- `DELETE` → `204` 且目录消失
- 越界路径 → `400` 且**磁盘无变化**

**回归（最关键）**

- 现有 Export ZIP 的输出逐字节不变 —— 因为复用了既有 manifest 构造函数，风险恰好集中在"复用时的字段增删"。测试方式：固定输入下比对 ZIP 内 `manifest.json` 的字节。

**端到端（人工一次）**

出 tile sheet → Save → **刷新页面** → 面板找回 → 导出 ZIP 仍可用。

**不做**：视觉回归（后处理未改动）。

## 11. 选型依据

| 方案 | 结论 |
|---|---|
| **A 目录即库**（选定） | 共享靠 git、索引靠目录、冲突靠路径隔离。零服务端、零并发协调 |
| B 内容寻址 `objects/<sha256(prompt+model+params)>/` | 天然去重、跨项目复用；但需要额外索引与 GC，改动量约为 A 的 1.5–2 倍。且图像模型**不保证**同 prompt 同输出（实测同一 prompt 两次的网格布局不同），哈希寻址省下的是调用成本而非可复现性 |
| C 导出/导入整库 ZIP | 1–2 天可完成，但每次协作都是全量搬运 + 人工合并；不是共享库而是搬运库。仅作为"验证团队是否真会共享"的探针 |

**git 二进制约束**：`raw/` 不进版本库是让方案 A 成立的前提。代价是他人拿不到可重切的原始 sheet；`meta.json` 保留了 prompt 与参数，需要重切时可重放一次生成。

## 12. 部署假设变更

app 目前是**纯 BYOK 无状态**；本设计使其拥有本地磁盘状态。需要在 README 与 `.env.example` 中说明：

- 新增 `IE_ASSETS_DIR`（默认 `<repo>/assets`）
- 资产库是本地目录，不随 app 分发；跨人共享通过 git
- 备份/迁移 = 复制该目录

## 13. 待实现时验证的风险点

1. **15 MB 级 POST body**：Next 14 App Router 的 route handler 没有 Pages Router 的 `bodyParser.sizeLimit`（默认 1 MB）限制，但请求体会整块进内存。实现时先用一个 15 MB 的 `POST` 实测，再决定是否需要"分文件多次提交"或"先建目录后逐文件写入"。
2. **大库索引性能**：>500 个资产时 `GET /api/library` 需要读 500 个 `meta.json`。若超时，改为按 project 分页或加一层 `index.json` 缓存（**先测再优化，不预先设计**）。
3. **git-lfs**：先不上。观察仓库体积增长，超过 ~500 MB 再引入，届时 `raw/` 已排除，压力主要来自 `derived/`。

## 14. 与上游的关系

- 本设计是 fork 的**差异化面**；上游若接受，可作为一组 PR 回提。
- 独立的第二项改动（**不在本 spec 范围**）：把 6 个路由里硬编码的 `https://openrouter.ai/api/v1/chat/completions` 抽成 `app/lib/provider.ts`，读取 `PROVIDER_BASE_URL` / `PROVIDER_API_KEY` / `PROVIDER_IMAGE_MODEL`。这项改动 1 个新文件 + 6 处一行替换，适合先提 PR 而非 fork。

## 附录 A：证据索引

| 断言 | 位置 |
|---|---|
| localStorage 仅存 key/model/mode | `app/lib/app.ts:45-56`；`app/page.tsx:207-209,256,258` |
| 无其他持久化 | `grep indexedDB\|sessionStorage\|persist app/` → 仅注释命中 |
| Export ZIP 三处 | `app/page.tsx:1753,2257,3270` |
| 既有 manifest 形状 | `app/page.tsx:1958-1983`（`buildPropManifest`） |
| app 无 fs 调用 | `grep "node:fs\|from 'fs'" app/` → 空 |
| 本地服务器假设 | `app/components/Modals.tsx:642` |
| 硬编码 base URL ×6 | 见 §1 表 |
| 产物体积实测 | 本次会话 APIMart 通道：2880² PNG 5,728,638 B；4096² data URL 14,907,611 字符 |

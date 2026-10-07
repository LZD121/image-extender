---
phase: 02-pure-core
plan: 02
status: complete
requirements: [GEOM-03, GEN-07]
---

# 02-02 Summary — `app/lib/animSet.ts`（校验 + 计划 + set.json + 续跑 + 命名）

**执行方式：** inline（同上）。

## 交付物

| 文件 | 内容 |
|---|---|
| `app/lib/animSet.ts`（476 行） | `AnimSpecError`、`validateAnimSetSpec`（十五条硬错 + 未知字段 warning）、`planStrips`、`stripSize` 相关导出、`buildSetJson`（`durationsMs = round(1000/fps)`，记 `requested` 与 `returned`、`fitted`、`totals` 只数 ok）、`nextPending(spec, record, facts)` 五种 reason + `duplicates`、`stripKey`/`parseStripKey`、`frameNumber`/`frameIndex`（**全仓库唯一的进制转换处**） |
| `app/lib/__tests__/animSet.test.ts`（236 行） | 硬错逐条、warning 路径、`set.json` 全形状、五种 reason（含"截断的 PNG 不当完成"）、重复键、缺事实、键的两个边界值与八个非法标签、纯度扫描 |

## 闸门结果（实跑）

- `02-02` 三条 `<automated>` 全绿（exit 0）：36 条断言脚本 + 硬错 label 计数 + 纯度扫描
- 每状态帧数不一致时报 **`field: 'states'`**（执行中由闸门抓出实现原报 `'frames'`，已改；CLI 据此才能把错误指到 states 那一段）
- `nextPending` 的完成判定来自**记录 + 事实**：`ok:true` 但 raw 不可解码 → `'raw-unreadable'`；缺事实同样不算完成（消费端 17 行/16 条重复计费的那个坑）
- `tsc --noEmit` 退出 0；全量 `npm test` 绿

## 偏离与说明

- 无功能偏离。计划里的硬错条数在正文里有过 11/15 两种说法，已统一为"十五条硬错，其中十一条有 label 断言"。

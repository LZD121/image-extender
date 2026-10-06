import type { Namespace } from '@/app/i18n'

/** Strings rendered by the Tiles studio. */
export const tile: Namespace = {
  en: {
    'tile.intro.text':
      'Tile-set mode — one AI call generates all 13 tiles as a single sprite-sheet so palette and texture detail stay locked across the set. Drop into Unity, Phaser, Godot, or Tiled.',
    'tile.action.stop': 'Stop',
    'tile.action.stopTitle': 'Stop the current generation',
    'tile.action.generate': 'Generate sheet (1 call)',
    'tile.action.reroll': 'Re-roll sheet',
    'tile.action.generateTitle': 'Generate the full 4×4 sprite sheet in one AI call',
    'tile.action.sheetManifest': 'Sheets + manifest',
    'tile.action.sheetManifestTitle':
      'Export clean + padded sprite-sheet PNGs with a JSON manifest',
    'tile.action.zip': 'ZIP',
    'tile.action.zipTitle':
      'Export individual PNGs + clean sheet + padded sheet + manifest as a ZIP',
    'tile.action.clear': 'Clear',
    'tile.action.clearTitle': 'Clear all tiles and start over',
    'tile.progress.count': '{filled}/{total} tiles',
    'tile.grid.header': 'Sprite sheet (4×4)',
    'tile.preview.title': 'Platform preview',
    'tile.preview.subtitle': 'How tiles fit together',
    'tile.preview.note':
      'Hover a tile and click the spark to replace it (uses a separate call, may drift). For best consistency, re-roll the whole sheet. Body/edges are tile-locked along their loop axis; corners stand alone.',
    'tile.scene.label': 'Scene direction',
    'tile.scene.updating': 'Updating…',
    'tile.scene.placeholder':
      'Optional shared art direction. If you built a parallax scene, the brief is reused here so tiles match palette and lighting.',
    'tile.preset.label': 'Quick start',
    'tile.prompt.placeholder': 'Describe the material — or pick a quick start above',
    'tile.style.title': 'Art style for the tile-set',
    'tile.slot.regenerate':
      'Replace this tile (separate call — may not match the rest). For best consistency, re-roll the whole sheet instead.',
  },
  zh: {
    'tile.intro.text':
      '瓦片集模式 —— 一次 AI 调用生成全部 13 张瓦片，作为单张精灵表，让整套的调色板与质感细节保持一致。可直接导入 Unity、Phaser、Godot 或 Tiled。',
    'tile.action.stop': '停止',
    'tile.action.stopTitle': '停止当前生成',
    'tile.action.generate': '生成整套（1 次调用）',
    'tile.action.reroll': '重新生成整套',
    'tile.action.generateTitle': '一次 AI 调用生成完整的 4×4 精灵表',
    'tile.action.sheetManifest': '图集 + 清单',
    'tile.action.sheetManifestTitle': '导出干净版与带边距版精灵表 PNG，以及 JSON 清单',
    'tile.action.zip': 'ZIP',
    'tile.action.zipTitle': '将单张 PNG、干净图集、带边距图集与清单打包导出为 ZIP',
    'tile.action.clear': '清空',
    'tile.action.clearTitle': '清空所有瓦片并重新开始',
    'tile.progress.count': '{filled}/{total} 张瓦片',
    'tile.grid.header': '精灵表（4×4）',
    'tile.preview.title': '平台预览',
    'tile.preview.subtitle': '瓦片如何拼接',
    'tile.preview.note':
      '将鼠标悬停在瓦片上并点击闪光即可替换（使用独立调用，可能产生偏差）。为获得最佳一致性，建议重新生成整套。主体与边缘沿其循环轴保持瓦片锁定；转角则独立存在。',
    'tile.scene.label': '场景设定',
    'tile.scene.updating': '更新中…',
    'tile.scene.placeholder':
      '可选的统一美术方向。若你构建过视差场景，这里会复用该设定，使瓦片的调色板与光照保持一致。',
    'tile.preset.label': '快速开始',
    'tile.prompt.placeholder': '描述材质 —— 或在上方选择一个快速开始',
    'tile.style.title': '瓦片集的美术风格',
    'tile.slot.regenerate':
      '替换此瓦片（独立调用 —— 可能与其他瓦片不匹配）。为获得最佳一致性，建议改为重新生成整套。',
  },
}

import type { Namespace } from '@/app/i18n/types'

/** Strings rendered by the Pixel studio. */
export const pixel: Namespace = {
  en: {
    // ── Intro banner ────────────────────────────────────────────────────────
    'pixel.intro':
      'Pixel mode — PixelLab paints on a real pixel grid (its own key, billed separately). Every result is re-imposed on the block lattice below so it lands on the same grid as the rest of your corpus.',

    // ── Action bar ──────────────────────────────────────────────────────────
    'pixel.generate.tile': 'Generate tile',
    'pixel.generate.prop': 'Generate prop',
    'pixel.generate.character': 'Generate character (8 dirs)',
    'pixel.generate.titleNoKey': 'Paste your PixelLab key first',
    'pixel.generate.titleNoDescription': 'Describe what to draw first',
    'pixel.generate.titleStills': 'Paint one pixel-art asset with the pixflux model',
    'pixel.generate.titleCharacter':
      'Paint a full 8-direction character (one job, ~2–5 minutes)',
    'pixel.clear': 'Clear',
    'pixel.clear.title':
      'Drop every asset from the gallery (nothing is saved until you save it to the library)',
    'pixel.processed': '{ready}/{total} processed',

    // ── Gallery ─────────────────────────────────────────────────────────────
    'pixel.gallery.title': 'Asset gallery',
    'pixel.gallery.empty':
      'Nothing generated yet. Pick a quick start or describe an asset below, then press “{action}”.',
    'pixel.gallery.help':
      'The card shows the asset on the imposed lattice; hover it to flip back to the raw vendor output, download it, or drop it. The block badge is the lattice and figure size it was fitted to.',

    // ── Gallery cell ────────────────────────────────────────────────────────
    'pixel.cell.block': 'block {block} · {figure}',
    'pixel.cell.noFigure': 'no figure',
    'pixel.cell.analysing': 'analysing…',
    'pixel.cell.download': 'Download this asset as a PNG',
    'pixel.cell.remove': 'Drop this asset from the gallery',
    'pixel.cell.purity': 'purity {value}',
    'pixel.cell.toggleNoProcessed': 'No processed version for this asset',
    'pixel.cell.toggleShowSource': 'Show the raw vendor output',
    'pixel.cell.toggleShowProcessed': 'Show the processed asset',
    'pixel.cell.processed': 'processed',
    'pixel.cell.source': 'source',
    'pixel.cell.fromLibrary': 'from library',

    // ── PixelLab key card ───────────────────────────────────────────────────
    'pixel.key.label': 'PixelLab key',
    'pixel.key.balance': 'Balance',
    'pixel.key.balanceTitle': 'Ask PixelLab for the credit left on this key',
    'pixel.key.placeholder':
      'PixelLab API key — stored in this browser, sent only to the proxy',
    'pixel.key.noPlan': 'no plan',
    'pixel.key.generations': '{plan} · {used}/{total} generations',

    // ── Generator card ──────────────────────────────────────────────────────
    'pixel.generator.label': 'Generator',
    'pixel.field.width': 'W',
    'pixel.field.width.title': 'Requested canvas width in pixels (pixflux allows 16–400)',
    'pixel.field.height': 'H',
    'pixel.field.height.title': 'Requested canvas height in pixels (pixflux allows 16–400)',
    'pixel.field.size': 'Size',
    'pixel.field.size.title': 'Sprite canvas per direction (v3 allows 32–256)',
    'pixel.field.block': 'Block',
    'pixel.field.block.title':
      'Block size of the corpus lattice (2 = the 2×2 convention). Imposed, not detected — the phase is what gets measured.',
    'pixel.field.cell': 'Cell',
    'pixel.field.cell.title': 'Output cell the cropped figure is centred in',
    'pixel.noBackground': 'no background',
    'pixel.noBackground.title':
      'Ask the vendor for alpha instead of a filled background',
    'pixel.template.label': 'Template',
    'pixel.template.title':
      'The skeleton the generator drives — the template outweighs the prompt',
    'pixel.view.label': 'View',
    'pixel.view.title': 'Camera angle the 8 rotations are drawn from',
    'pixel.stillKind.tiles.title': 'A tileable material cell',
    'pixel.stillKind.props.title': 'A standalone transparent prop',

    // ── Lattice ─────────────────────────────────────────────────────────────
    'pixel.lattice.label': 'Lattice',
    'pixel.lattice.band': 'figure band {min}–{max}px on a {cell}px cell',
    'pixel.lattice.defaults': 'Defaults',
    'pixel.lattice.defaults.title': 'Back to the corpus defaults (block 2, cell 32)',

    // ── Quick start presets (labels only; their prompts stay English) ───────
    'pixel.quickStart': 'Quick start',
    'pixel.preset.cobble': 'Mossy cobble',
    'pixel.preset.grass': 'Grass tuft',
    'pixel.preset.crystal': 'Crystal',
    'pixel.preset.chest': 'Wooden chest',
    'pixel.preset.knight': 'Knight',
    'pixel.preset.slime': 'Slime',
    'pixel.preset.bat': 'Bat',
    'pixel.preset.wizard': 'Wizard',

    // ── Description rail ────────────────────────────────────────────────────
    'pixel.describe.stills': 'Describe the asset — or pick a quick start above',
    'pixel.describe.character': 'Describe the character — or pick a quick start above',
    'pixel.sub.title': 'What kind of pixel-art asset to generate',
    'pixel.sub.stills': 'Tiles & props',
    'pixel.sub.character': 'Character',

    // ── Templates and views sent to the vendor (display text only) ──────────
    'pixel.template.mannequin': 'mannequin',
    'pixel.template.bear': 'bear',
    'pixel.template.cat': 'cat',
    'pixel.template.dog': 'dog',
    'pixel.template.horse': 'horse',
    'pixel.template.lion': 'lion',
    'pixel.view.low-top-down': 'low top-down',
    'pixel.view.high-top-down': 'high top-down',
    'pixel.view.side': 'side',

    // ── Status and errors ───────────────────────────────────────────────────
    'pixel.status.submittingCharacter':
      'Submitting the character job (8 directions, ~2–5 min)…',
    'pixel.status.submitting': 'Submitting…',
    'pixel.error.keyMissing': 'Paste your PixelLab key first.',
    'pixel.error.describeCharacter': 'Describe the character first.',
    'pixel.error.describeAsset': 'Describe what to draw.',
    'pixel.error.characterSubmitFailed': 'character submit failed',
    'pixel.error.characterJobFailed':
      'The character job failed (character_id={id}). It is not retried automatically.',
    'pixel.error.characterPollTimeout':
      'Still polling after 10 minutes (character_id={id}). Re-check the balance and poll again instead of resubmitting.',
    'pixel.error.balanceFailed': 'balance failed',
    'pixel.error.pollingFailed': 'polling failed',
    'pixel.error.generationFailed': 'generation failed',
    'pixel.error.cropFailed': 'crop failed',
    'pixel.error.unreadableImage': 'could not read the image',
    'pixel.error.imageLoad': 'could not load {url}',
    'pixel.error.noContext': '2d context unavailable',
  },
  zh: {
    // ── 顶部说明 ────────────────────────────────────────────────────────────
    'pixel.intro':
      '像素模式 —— PixelLab 在真实的像素网格上绘制（使用它自己的密钥，单独计费）。每个结果都会重新套用到下方的块格点上，使其与素材库其余部分落在同一网格。',

    // ── 操作栏 ──────────────────────────────────────────────────────────────
    'pixel.generate.tile': '生成瓦片',
    'pixel.generate.prop': '生成道具',
    'pixel.generate.character': '生成角色（8 个方向）',
    'pixel.generate.titleNoKey': '请先粘贴你的 PixelLab 密钥',
    'pixel.generate.titleNoDescription': '请先描述要绘制的内容',
    'pixel.generate.titleStills': '用 pixflux 模型绘制一个像素美术素材',
    'pixel.generate.titleCharacter': '绘制完整的 8 方向角色（一个任务，约 2–5 分钟）',
    'pixel.clear': '清空',
    'pixel.clear.title': '清空画廊中的所有素材（在保存到素材库之前不会保存任何内容）',
    'pixel.processed': '{ready}/{total} 已处理',

    // ── 画廊 ────────────────────────────────────────────────────────────────
    'pixel.gallery.title': '素材画廊',
    'pixel.gallery.empty': '还没有生成任何内容。在下方选择一个快速开始或描述素材，然后点击“{action}”。',
    'pixel.gallery.help':
      '卡片显示套用格点后的素材；悬停可切回供应商原始输出、下载或删除。块标记表示它被适配到的格点与图形尺寸。',

    // ── 画廊单元格 ──────────────────────────────────────────────────────────
    'pixel.cell.block': '块 {block} · {figure}',
    'pixel.cell.noFigure': '无图形',
    'pixel.cell.analysing': '分析中…',
    'pixel.cell.download': '将此素材下载为 PNG',
    'pixel.cell.remove': '从画廊中删除此素材',
    'pixel.cell.purity': '纯度 {value}',
    'pixel.cell.toggleNoProcessed': '此素材没有处理后的版本',
    'pixel.cell.toggleShowSource': '显示供应商原始输出',
    'pixel.cell.toggleShowProcessed': '显示处理后的素材',
    'pixel.cell.processed': '已处理',
    'pixel.cell.source': '原始',
    'pixel.cell.fromLibrary': '来自素材库',

    // ── PixelLab 密钥卡片 ───────────────────────────────────────────────────
    'pixel.key.label': 'PixelLab 密钥',
    'pixel.key.balance': '余额',
    'pixel.key.balanceTitle': '向 PixelLab 查询此密钥的剩余额度',
    'pixel.key.placeholder': 'PixelLab API 密钥 —— 保存在此浏览器中，只发送给代理',
    'pixel.key.noPlan': '无套餐',
    'pixel.key.generations': '{plan} · {used}/{total} 次生成',

    // ── 生成器卡片 ──────────────────────────────────────────────────────────
    'pixel.generator.label': '生成器',
    'pixel.field.width': '宽',
    'pixel.field.width.title': '请求的画布宽度（像素，pixflux 允许 16–400）',
    'pixel.field.height': '高',
    'pixel.field.height.title': '请求的画布高度（像素，pixflux 允许 16–400）',
    'pixel.field.size': '尺寸',
    'pixel.field.size.title': '每个方向的精灵画布（v3 允许 32–256）',
    'pixel.field.block': '块',
    'pixel.field.block.title': '素材库格点的块大小（2 = 2×2 惯例）。强制套用而非检测 —— 只测量相位。',
    'pixel.field.cell': '单元格',
    'pixel.field.cell.title': '裁剪后图形居中的输出单元格',
    'pixel.noBackground': '无背景',
    'pixel.noBackground.title': '向供应商请求透明通道而不是填充背景',
    'pixel.template.label': '模板',
    'pixel.template.title': '生成器驱动的骨架 —— 模板优先于提示词',
    'pixel.view.label': '视角',
    'pixel.view.title': '绘制 8 个旋转方向所用的相机角度',
    'pixel.stillKind.tiles.title': '可平铺的材质单元格',
    'pixel.stillKind.props.title': '独立的透明道具',

    // ── 格点 ────────────────────────────────────────────────────────────────
    'pixel.lattice.label': '格点',
    'pixel.lattice.band': '图形带宽 {min}–{max}px，单元格 {cell}px',
    'pixel.lattice.defaults': '默认值',
    'pixel.lattice.defaults.title': '恢复素材库默认值（块 2、单元格 32）',

    // ── 快速开始（仅标签；其提示词保持英文） ────────────────────────────────
    'pixel.quickStart': '快速开始',
    'pixel.preset.cobble': '苔藓鹅卵石',
    'pixel.preset.grass': '草丛',
    'pixel.preset.crystal': '水晶',
    'pixel.preset.chest': '木制宝箱',
    'pixel.preset.knight': '骑士',
    'pixel.preset.slime': '史莱姆',
    'pixel.preset.bat': '蝙蝠',
    'pixel.preset.wizard': '巫师',

    // ── 描述栏 ──────────────────────────────────────────────────────────────
    'pixel.describe.stills': '描述素材 —— 或在上方选择一个快速开始',
    'pixel.describe.character': '描述角色 —— 或在上方选择一个快速开始',
    'pixel.sub.title': '要生成哪种像素美术素材',
    'pixel.sub.stills': '瓦片与道具',
    'pixel.sub.character': '角色',

    // ── 发送给供应商的模板与视角（仅显示文本） ──────────────────────────────
    'pixel.template.mannequin': '人偶',
    'pixel.template.bear': '熊',
    'pixel.template.cat': '猫',
    'pixel.template.dog': '狗',
    'pixel.template.horse': '马',
    'pixel.template.lion': '狮子',
    'pixel.view.low-top-down': '低角度俯视',
    'pixel.view.high-top-down': '高角度俯视',
    'pixel.view.side': '侧面',

    // ── 状态与错误 ──────────────────────────────────────────────────────────
    'pixel.status.submittingCharacter': '正在提交角色任务（8 个方向，约 2–5 分钟）…',
    'pixel.status.submitting': '正在提交…',
    'pixel.error.keyMissing': '请先粘贴你的 PixelLab 密钥。',
    'pixel.error.describeCharacter': '请先描述角色。',
    'pixel.error.describeAsset': '请描述要绘制的内容。',
    'pixel.error.characterSubmitFailed': '角色提交失败',
    'pixel.error.characterJobFailed': '角色任务失败（character_id={id}）。它不会自动重试。',
    'pixel.error.characterPollTimeout': '轮询已超过 10 分钟（character_id={id}）。请检查余额后再次轮询，而不是重新提交。',
    'pixel.error.balanceFailed': '余额查询失败',
    'pixel.error.pollingFailed': '轮询失败',
    'pixel.error.generationFailed': '生成失败',
    'pixel.error.cropFailed': '裁剪失败',
    'pixel.error.unreadableImage': '无法读取图像',
    'pixel.error.imageLoad': '无法加载 {url}',
    'pixel.error.noContext': '2d 上下文不可用',
  },
}

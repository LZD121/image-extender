import type { Namespace } from '@/app/i18n/types'

/** Strings rendered by the Props studio. */
export const props: Namespace = {
  en: {
    // ── Intro blurb ─────────────────────────────────────────────────────────
    'props.intro':
      'Props mode — a growing library of transparent decorations to scatter on top of your tile map (the way Hollow Knight layers detail over its geometry). Each press paints {count} new props the model invents for your biome; keep adding for an endless set.',

    // ── Gallery ─────────────────────────────────────────────────────────────
    'props.library.title': 'Decoration library',
    'props.library.empty':
      'Pick a biome below and press “Generate {count} props” to start your decoration library. Keep pressing “Add more” to grow it.',
    'props.library.note':
      'Every prop is exported on transparency. Hover a prop to re-roll or delete it. New batches are style-matched to what you already have, so the library stays cohesive as it grows.',
    'props.count.one': '{count} prop',
    'props.count.other': '{count} props',

    // ── Prop card ───────────────────────────────────────────────────────────
    'props.item.alt': 'Prop {index}',
    'props.item.rerollTitle':
      'Re-roll this prop — a new decoration matched to the rest of the set',
    'props.item.deleteTitle': 'Delete this prop from the library',

    // ── Action bar ──────────────────────────────────────────────────────────
    'props.action.stop': 'Stop',
    'props.action.stopTitle': 'Stop the current generation',
    'props.action.addMore': 'Add {count} more',
    'props.action.addMoreTitle':
      'Paint {count} more decorations and add them to the library',
    'props.action.generate': 'Generate {count} props',
    'props.action.firstTitle': 'Paint your first {count} decorations',
    'props.action.atlas': 'Atlas + manifest',
    'props.action.atlasTitle':
      'Export the packed transparent atlas PNG with a JSON manifest',
    'props.action.zip': 'ZIP',
    'props.action.zipTitle':
      'Export individual transparent PNGs + atlas + manifest as a ZIP',
    'props.action.clear': 'Clear',
    'props.action.clearTitle': 'Clear the whole library and start over',

    // ── Command rail ────────────────────────────────────────────────────────
    'props.sceneBrief.label': 'Scene direction',
    'props.sceneBrief.updating': 'Updating…',
    'props.sceneBrief.placeholder':
      'Optional shared art direction. Reused from your parallax / tile work so the props match the same palette and lighting.',
    'props.preset.label': 'Quick start',
    'props.preset.forest': 'Forest glade',
    'props.preset.cave': 'Glowing cave',
    'props.preset.desert': 'Desert oasis',
    'props.preset.snow': 'Snowy peaks',
    'props.preset.volcanic': 'Volcanic',
    'props.preset.jungle': 'Jungle ruins',
    'props.preset.swamp': 'Misty swamp',
    'props.preset.candy': 'Candy land',
    'props.prompt.placeholder':
      'Describe the biome / palette — or pick a quick start above',
    'props.artStyle.title': 'Art style for the props',
  },
  zh: {
    // ── 简介 ────────────────────────────────────────────────────────────────
    'props.intro':
      '道具模式 —— 一个不断扩充的透明装饰素材库，可散布在瓦片地图之上（就像《空洞骑士》在其几何结构上叠加细节那样）。每次点击都会绘制 {count} 个由模型为你的生物群系创造的新道具；持续添加即可获得无穷无尽的素材。',

    // ── 素材库 ──────────────────────────────────────────────────────────────
    'props.library.title': '装饰素材库',
    'props.library.empty':
      '在下方选择生物群系，然后点击「生成 {count} 个道具」开始你的装饰素材库。持续点击「再添加」即可不断扩充。',
    'props.library.note':
      '每个道具都以透明背景导出。将鼠标悬停在道具上即可重新生成或删除。新批次会与已有素材匹配风格，因此素材库在扩充过程中始终保持统一。',
    'props.count.one': '{count} 个道具',
    'props.count.other': '{count} 个道具',

    // ── 道具卡片 ────────────────────────────────────────────────────────────
    'props.item.alt': '道具 {index}',
    'props.item.rerollTitle': '重新生成此道具 —— 产生一个与整套风格匹配的新装饰',
    'props.item.deleteTitle': '从素材库中删除此道具',

    // ── 操作栏 ──────────────────────────────────────────────────────────────
    'props.action.stop': '停止',
    'props.action.stopTitle': '停止当前生成',
    'props.action.addMore': '再添加 {count} 个',
    'props.action.addMoreTitle': '再绘制 {count} 个装饰并加入素材库',
    'props.action.generate': '生成 {count} 个道具',
    'props.action.firstTitle': '绘制首批 {count} 个装饰',
    'props.action.atlas': '图集 + 清单',
    'props.action.atlasTitle': '导出打包好的透明图集 PNG 及 JSON 清单',
    'props.action.zip': 'ZIP',
    'props.action.zipTitle': '将单独的透明 PNG + 图集 + 清单导出为 ZIP',
    'props.action.clear': '清空',
    'props.action.clearTitle': '清空整个素材库并重新开始',

    // ── 底部指令栏 ──────────────────────────────────────────────────────────
    'props.sceneBrief.label': '场景设定',
    'props.sceneBrief.updating': '更新中…',
    'props.sceneBrief.placeholder':
      '可选的共享美术方向。会复用你的视差 / 瓦片设定，让道具保持相同的配色与光照。',
    'props.preset.label': '快速开始',
    'props.preset.forest': '林间空地',
    'props.preset.cave': '发光洞窟',
    'props.preset.desert': '沙漠绿洲',
    'props.preset.snow': '雪山之巅',
    'props.preset.volcanic': '火山',
    'props.preset.jungle': '丛林遗迹',
    'props.preset.swamp': '迷雾沼泽',
    'props.preset.candy': '糖果乐园',
    'props.prompt.placeholder': '描述生物群系 / 配色 —— 或在上方选择快速开始',
    'props.artStyle.title': '道具的画风',
  },
}

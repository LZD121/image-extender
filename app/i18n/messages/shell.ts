import type { Namespace } from '@/app/i18n/types'

/** Strings rendered by the app shell (top bar, empty state, library panel…). */
export const shell: Namespace = {
  en: {
    // ── Top bar ─────────────────────────────────────────────────────────────
    'shell.topbar.newImage': 'New image',
    'shell.topbar.settings': 'Settings',
    'shell.topbar.modeAria': 'Workspace mode',

    // ── Workspace (image frame + edge handles) ──────────────────────────────
    'shell.workspace.extend': 'Extend {direction}',
    'shell.workspace.clickEdge': 'Click an edge to extend',
    'shell.workspace.extending': 'Extending {direction}…',

    // ── Empty state (drop zone) ─────────────────────────────────────────────
    'shell.empty.parallaxIntro':
      'Parallax mode — start with a base frame, then extend it sideways into a long scrolling background.',
    'shell.empty.dropTitle': 'Drop an image to begin',
    'shell.empty.dropParallaxTitle': 'Drop a starting frame',
    'shell.empty.dropHint': 'PNG, JPG, or WEBP — click anywhere in this area to browse',
    'shell.empty.parallaxHint':
      'A landscape image works best — its height becomes the game resolution',
    'shell.empty.or': 'or',
    'shell.empty.generate': 'generate one with AI',
    'shell.empty.generateParallax': 'generate a 16:9 starter with AI',

    // ── Command bar (prompt + art style + scene direction) ──────────────────
    'shell.command.sceneDirection': 'Scene direction',
    'shell.command.updating': 'Updating…',
    'shell.command.sceneBriefPlaceholder':
      'Shared art direction for all layers — generated from your Near layer prompt. Edit to steer Mid, Far, and Sky.',
    'shell.command.promptPlaceholder': 'Optional: describe what should appear in the new area…',
    'shell.command.artStyleTitle': 'Art style for the extension',

    // ── Variant selector ────────────────────────────────────────────────────
    'shell.variant.cycleAria': 'Cycle between extension variants',
    'shell.variant.prevAria': 'Previous variant (←)',
    'shell.variant.prevTitle': 'Previous variant (←)',
    'shell.variant.nextAria': 'Next variant (→)',
    'shell.variant.nextTitle': 'Next variant (→)',
    'shell.variant.label': 'Variant {index}/{total}',
    'shell.variant.best': 'BEST',
    'shell.variant.bestTitle': "Algorithm's pick: lowest seam residual",
    'shell.variant.scoreTitle': 'Mean color difference at the seam — lower is better',

    // ── Result actions ──────────────────────────────────────────────────────
    'shell.result.discard': 'Discard',
    'shell.result.discardTitle': 'Discard this extension',
    'shell.result.regenerateTitle': 'Generate a new variation',
    'shell.result.downloadTitle': 'Download as PNG',
    'shell.result.accept': 'Accept',
    'shell.result.acceptTitle': 'Use this as the new base image',

    // ── Asset library panel ─────────────────────────────────────────────────
    'shell.library.title': 'Asset library',
    'shell.library.projectAria': 'project',
    'shell.library.save': 'Save to library',
    'shell.library.refresh': 'Refresh',
    'shell.library.slug': 'Slug',
    'shell.library.slugAria': 'slug',
    'shell.library.overwrite': 'Overwrite',
    'shell.library.saveAs': 'Save as {slug}',
    'shell.library.unavailable': 'asset library unavailable',
    'shell.library.nothingToSave': 'Nothing to save yet — generate something first.',
    'shell.library.saving': 'Saving…',
    'shell.library.saved': 'Saved {path}',
    'shell.library.exists': '“{slug}” already exists in {project}.',
    'shell.library.saveFailed': 'save failed',
    'shell.library.deleteFailed': 'delete failed',
    'shell.library.deleteAria': 'delete {slug}',
    // Display labels for ASSET_KINDS, keyed by the on-disk kind id.
    'shell.library.kind.tiles': 'Tiles',
    'shell.library.kind.sprites': 'Sprites',
    'shell.library.kind.props': 'Props',
    'shell.library.kind.parallax': 'Parallax',
    'shell.library.kind.extend': 'Extender',
    'shell.library.kind.animations': 'Animations',
  },
  zh: {
    // ── 顶栏 ────────────────────────────────────────────────────────────────
    'shell.topbar.newImage': '新建图像',
    'shell.topbar.settings': '设置',
    'shell.topbar.modeAria': '工作区模式',

    // ── 工作区（图像框 + 边缘手柄）──────────────────────────────────────────
    'shell.workspace.extend': '向{direction}扩展',
    'shell.workspace.clickEdge': '点击边缘进行扩展',
    'shell.workspace.extending': '正在向{direction}扩展…',

    // ── 空状态（拖放区）────────────────────────────────────────────────────
    'shell.empty.parallaxIntro':
      '视差模式——先准备一张基础帧，再向两侧扩展成一条长滚动背景。',
    'shell.empty.dropTitle': '拖入图像开始',
    'shell.empty.dropParallaxTitle': '拖入起始帧',
    'shell.empty.dropHint': 'PNG、JPG 或 WEBP——点击此区域任意位置即可浏览',
    'shell.empty.parallaxHint': '横版图像效果最佳——其高度将成为游戏分辨率',
    'shell.empty.or': '或',
    'shell.empty.generate': '用 AI 生成一张',
    'shell.empty.generateParallax': '用 AI 生成 16:9 起始图',

    // ── 命令栏（提示词 + 画风 + 场景方向）──────────────────────────────────
    'shell.command.sceneDirection': '场景方向',
    'shell.command.updating': '更新中…',
    'shell.command.sceneBriefPlaceholder':
      '所有图层共用的美术方向——由近景图层提示词生成。可编辑以引导中景、远景和天空。',
    'shell.command.promptPlaceholder': '可选：描述新区域应出现的内容…',
    'shell.command.artStyleTitle': '扩展使用的画风',

    // ── 候选变体选择器 ──────────────────────────────────────────────────────
    'shell.variant.cycleAria': '在扩展变体之间切换',
    'shell.variant.prevAria': '上一个变体（←）',
    'shell.variant.prevTitle': '上一个变体（←）',
    'shell.variant.nextAria': '下一个变体（→）',
    'shell.variant.nextTitle': '下一个变体（→）',
    'shell.variant.label': '变体 {index}/{total}',
    'shell.variant.best': '最佳',
    'shell.variant.bestTitle': '算法优选：接缝残差最低',
    'shell.variant.scoreTitle': '接缝处的平均色差——越低越好',

    // ── 结果操作 ────────────────────────────────────────────────────────────
    'shell.result.discard': '丢弃',
    'shell.result.discardTitle': '丢弃这次扩展',
    'shell.result.regenerateTitle': '生成一个新变体',
    'shell.result.downloadTitle': '下载为 PNG',
    'shell.result.accept': '采用',
    'shell.result.acceptTitle': '将其设为新的基础图像',

    // ── 素材库面板 ──────────────────────────────────────────────────────────
    'shell.library.title': '素材库',
    'shell.library.projectAria': '项目',
    'shell.library.save': '保存到素材库',
    'shell.library.refresh': '刷新',
    'shell.library.slug': '标识名',
    'shell.library.slugAria': '标识名',
    'shell.library.overwrite': '覆盖',
    'shell.library.saveAs': '另存为 {slug}',
    'shell.library.unavailable': '素材库不可用',
    'shell.library.nothingToSave': '暂无可保存内容——请先生成。',
    'shell.library.saving': '保存中…',
    'shell.library.saved': '已保存 {path}',
    'shell.library.exists': '“{slug}” 已存在于 {project}。',
    'shell.library.saveFailed': '保存失败',
    'shell.library.deleteFailed': '删除失败',
    'shell.library.deleteAria': '删除 {slug}',
    'shell.library.kind.tiles': '瓦片',
    'shell.library.kind.sprites': '精灵',
    'shell.library.kind.props': '道具',
    'shell.library.kind.parallax': '视差',
    'shell.library.kind.extend': '扩图',
    'shell.library.kind.animations': '动画集',
  },
}

import type { Namespace } from '@/app/i18n/types'

/**
 * Strings rendered by the Parallax studio (`app/components/ParallaxStudio.tsx`).
 * Vocabulary shared with other surfaces lives in `common.ts` (layer roles,
 * target-width presets, directions); only parallax-specific copy is here.
 */
export const parallax: Namespace = {
  en: {
    // ── Live composite preview ──────────────────────────────────────────────
    'parallax.preview.composite': 'Composite',
    'parallax.preview.pause': 'Pause',
    'parallax.preview.play': 'Play',
    'parallax.preview.pauseAria': 'Pause preview',
    'parallax.preview.playAria': 'Play preview',
    'parallax.preview.scrollSpeedAria': 'Camera scroll speed',
    'parallax.preview.camera': 'Camera',
    'parallax.preview.zoomAria': 'Fullscreen camera zoom',
    'parallax.preview.zoomTitle':
      'Pull the camera back to fit more horizontal scene on screen',
    'parallax.preview.empty':
      'Generate or upload at least one layer to preview the parallax',
    'parallax.preview.fullscreenAria': 'Fullscreen preview',
    'parallax.preview.exitFullscreenAria': 'Exit fullscreen preview',
    'parallax.preview.fullscreenTitle': 'Fullscreen preview',
    'parallax.preview.exitFullscreenTitle': 'Exit fullscreen (Esc)',
    'parallax.preview.dialogAria': 'Parallax scene preview',
    'parallax.preview.title': 'Scene preview',
    'parallax.preview.subtitle': 'Live parallax composite · Esc to exit',

    // ── Layer panel ─────────────────────────────────────────────────────────
    'parallax.layers.aria': 'Parallax layers',
    'parallax.layers.title': 'Layers',
    'parallax.layers.order': 'back → front',
    'parallax.layers.step': 'Step {step} — {layer}',
    'parallax.layers.tip':
      'Build layers front-to-back so each step matches the scene in front of it.',
    'parallax.layers.empty': 'empty',
    'parallax.layers.next': 'Next',
    'parallax.layers.needsFirst': 'Needs {layer} first',
    'parallax.layers.speed': 'Speed',
    'parallax.layers.speedAria': '{layer} scroll speed',
    'parallax.layers.speedTitle': '{speed}× camera speed',
    'parallax.layers.clearTitle': 'Clear {layer}',
    'parallax.layers.clearAria': 'Clear {layer} layer',
    'parallax.layers.footer':
      'Build front → back: Near, then Mid, Far, Sky. Sky is opaque; the others are alpha-keyed over it.',

    // ── Empty layer state ───────────────────────────────────────────────────
    'parallax.empty.stepTitle': 'Step {step}: build {layer} after {prerequisite}',
    'parallax.empty.prereqBody':
      'Parallax layers stack back-to-front in the game, but we build them front-to-back. Finish {layer} first so this layer matches the same palette, lighting, and art direction.',
    'parallax.empty.goTo': 'Go to {layer} (step {step})',
    'parallax.empty.dropTitle': 'Drop a {layer} layer',
    'parallax.empty.dropHintOpaque':
      'PNG, JPG, or WEBP — opaque image at this game height',
    'parallax.empty.dropHintAlpha':
      'PNG with transparency works best — the magenta key will be applied if needed',
    'parallax.empty.or': 'or',
    'parallax.empty.generate': 'generate this layer with AI',

    // ── Active-layer workspace ──────────────────────────────────────────────
    'parallax.workspace.extendHint':
      'Click an edge to extend the {layer} layer, or set a target and auto-extend',
    'parallax.workspace.extending': 'Extending {direction}…',
    'parallax.workspace.exportTitle':
      'Export project: {done}/{total} populated layers + manifest',

    // ── Edge extend handles ─────────────────────────────────────────────────
    'parallax.edge.extend': 'Extend {direction}',

    // ── Target width + export bar ───────────────────────────────────────────
    'parallax.target.label': 'Target',
    'parallax.target.placeholder': 'e.g. 7680',
    'parallax.target.presetsAria': 'Width presets',
    'parallax.target.presetsTitle': 'Width presets',
    'parallax.target.reached': 'Reached',
    'parallax.target.left': '{px}px left',
    'parallax.target.stopTitle': 'Stop auto-extend',
    'parallax.target.stop': 'Stop',
    'parallax.target.autoExtendTitle':
      'Auto-extend right until target width is reached',
    'parallax.target.autoExtend': 'Auto-extend',
    'parallax.target.tileableTitle':
      'Make tileable — heals the loop-point seam so repeat-x scrolling has no visible joint',
    'parallax.target.tileable': 'Tileable',
    'parallax.target.harmonizeTitle':
      'Harmonize — flatten cumulative color/brightness drift across many extensions',
    'parallax.target.harmonize': 'Harmonize',
    'parallax.target.downloadPngTitle': 'Download as a single PNG',
    'parallax.target.export': 'Export',
    'parallax.target.secondaryFallback': 'Secondary export',
  },
  zh: {
    // ── 实时合成预览 ────────────────────────────────────────────────────────
    'parallax.preview.composite': '合成',
    'parallax.preview.pause': '暂停',
    'parallax.preview.play': '播放',
    'parallax.preview.pauseAria': '暂停预览',
    'parallax.preview.playAria': '播放预览',
    'parallax.preview.scrollSpeedAria': '镜头滚动速度',
    'parallax.preview.camera': '镜头',
    'parallax.preview.zoomAria': '全屏镜头缩放',
    'parallax.preview.zoomTitle': '拉远镜头，让屏幕容纳更多横向场景',
    'parallax.preview.empty': '生成或上传至少一个图层即可预览视差效果',
    'parallax.preview.fullscreenAria': '全屏预览',
    'parallax.preview.exitFullscreenAria': '退出全屏预览',
    'parallax.preview.fullscreenTitle': '全屏预览',
    'parallax.preview.exitFullscreenTitle': '退出全屏（Esc）',
    'parallax.preview.dialogAria': '视差场景预览',
    'parallax.preview.title': '场景预览',
    'parallax.preview.subtitle': '实时视差合成 · 按 Esc 退出',

    // ── 图层面板 ────────────────────────────────────────────────────────────
    'parallax.layers.aria': '视差图层',
    'parallax.layers.title': '图层',
    'parallax.layers.order': '后 → 前',
    'parallax.layers.step': '第 {step} 步 — {layer}',
    'parallax.layers.tip': '按由前到后的顺序构建图层，每一步都与前方场景保持一致。',
    'parallax.layers.empty': '空',
    'parallax.layers.next': '下一步',
    'parallax.layers.needsFirst': '需要先完成{layer}',
    'parallax.layers.speed': '速度',
    'parallax.layers.speedAria': '{layer}滚动速度',
    'parallax.layers.speedTitle': '{speed}× 镜头速度',
    'parallax.layers.clearTitle': '清除{layer}',
    'parallax.layers.clearAria': '清除{layer}图层',
    'parallax.layers.footer':
      '按由前到后顺序构建：近景、中景、远景、天空。天空为不透明底图，其余图层以透明通道叠加其上。',

    // ── 图层空状态 ──────────────────────────────────────────────────────────
    'parallax.empty.stepTitle': '第 {step} 步：在{prerequisite}之后构建{layer}',
    'parallax.empty.prereqBody':
      '游戏中视差图层由后向前叠加，但我们按由前到后的顺序制作。请先完成{layer}，这样本图层才能与相同的色调、光照和美术方向保持一致。',
    'parallax.empty.goTo': '前往{layer}（第 {step} 步）',
    'parallax.empty.dropTitle': '拖入一张{layer}图层',
    'parallax.empty.dropHintOpaque': 'PNG、JPG 或 WEBP — 与游戏高度一致的不透明图像',
    'parallax.empty.dropHintAlpha':
      '建议使用带透明通道的 PNG — 如有需要会自动应用品红抠像',
    'parallax.empty.or': '或',
    'parallax.empty.generate': '用 AI 生成该图层',

    // ── 当前图层工作区 ──────────────────────────────────────────────────────
    'parallax.workspace.extendHint':
      '点击边缘即可扩展{layer}图层，或设置目标宽度后自动扩展',
    'parallax.workspace.extending': '正在向{direction}扩展…',
    'parallax.workspace.exportTitle': '导出项目：{done}/{total} 个已填充图层 + 清单',

    // ── 边缘扩展按钮 ────────────────────────────────────────────────────────
    'parallax.edge.extend': '向{direction}扩展',

    // ── 目标宽度与导出栏 ────────────────────────────────────────────────────
    'parallax.target.label': '目标',
    'parallax.target.placeholder': '例如 7680',
    'parallax.target.presetsAria': '宽度预设',
    'parallax.target.presetsTitle': '宽度预设',
    'parallax.target.reached': '已达成',
    'parallax.target.left': '还剩 {px}px',
    'parallax.target.stopTitle': '停止自动扩展',
    'parallax.target.stop': '停止',
    'parallax.target.autoExtendTitle': '自动向右扩展，直到达到目标宽度',
    'parallax.target.autoExtend': '自动扩展',
    'parallax.target.tileableTitle':
      '无缝平铺 — 修复循环接缝，repeat-x 滚动时看不到拼接痕迹',
    'parallax.target.tileable': '无缝平铺',
    'parallax.target.harmonizeTitle': '色彩统一 — 消除多次扩展累积的颜色/亮度漂移',
    'parallax.target.harmonize': '色彩统一',
    'parallax.target.downloadPngTitle': '下载为单个 PNG',
    'parallax.target.export': '导出',
    'parallax.target.secondaryFallback': '次级导出',
  },
}

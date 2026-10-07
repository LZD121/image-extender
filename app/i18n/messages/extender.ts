import type { Namespace } from '@/app/i18n/types'

/** Strings owned by app/page.tsx (the Extender workspace and its handlers). */
export const extender: Namespace = {
  en: {
    // ── Client-side errors (toast) ──────────────────────────────────────────
    'extender.error.loadImage': 'Failed to load image',
    'extender.error.tilePromptOnly':
      'Tile-set mode generates from prompts only. Switch to Extender mode to outpaint an uploaded image.',
    'extender.error.spritePromptOnly':
      'Sprite mode generates from prompts only. Switch to Extender mode to outpaint an uploaded image.',
    'extender.error.sceneDirection': 'Failed to derive scene direction',
    'extender.error.describeImage': 'Please describe the image you want to generate.',
    'extender.error.generateImage': 'Failed to generate image',
    'extender.error.extendImage': 'Failed to extend image',
    'extender.error.noImage': 'No image returned from API',
    'extender.error.dimensions': 'Image dimensions not available yet.',
    'extender.error.unfilledOne':
      'AI failed to fill the extension area after 1 attempt. Try a different direction or model.',
    'extender.error.unfilledMany':
      'AI failed to fill the extension area after {count} attempts. Try a different direction or model.',
    'extender.error.occurred': 'An error occurred',
    'extender.error.tileRole': 'Failed to generate {label} tile',
    'extender.error.describeMaterial':
      'Describe the material you want — e.g. mossy stone floor.',
    'extender.error.tileSheet': 'Failed to generate tile sheet',
    'extender.error.describeMaterialFirst':
      'Describe the material you want before regenerating tiles.',
    'extender.error.regenerateTile': 'Failed to regenerate tile',
    'extender.error.tileFirstSheet':
      'Generate at least one tile before downloading the sheet.',
    'extender.error.exportSheet': 'Failed to export sheet',
    'extender.error.tileFirstZip': 'Generate at least one tile before exporting the ZIP.',
    'extender.error.exportZip': 'Failed to export ZIP',
    'extender.error.describeBiome':
      'Describe the biome / palette — e.g. lush forest decorations.',
    'extender.error.generateProps': 'Failed to generate props',
    'extender.error.describeBiomeFirst':
      'Describe the biome first, then re-roll an individual prop.',
    'extender.error.rerollProp': 'Failed to re-roll prop',
    'extender.error.propFirstAtlas':
      'Generate at least one prop before downloading the atlas.',
    'extender.error.exportAtlas': 'Failed to export atlas',
    'extender.error.propFirstZip':
      'Generate at least one prop before exporting the ZIP.',
    'extender.error.describeCharacter':
      'Describe the character you want — e.g. armored pixel knight.',
    'extender.error.characterAnchor': 'Failed to generate character anchor',
    'extender.error.noAnchorImage': 'No anchor image returned from API',
    'extender.error.sheetCanvas': 'Canvas unavailable',
    'extender.error.uploadedLoad': 'Could not load the uploaded image',
    'extender.error.chooseImageFile':
      'Please choose an image file (PNG with transparency works best).',
    'extender.error.readFile': 'Failed to read the file',
    'extender.error.uploadedProcess': 'Failed to process the uploaded character image',
    'extender.error.spriteGuideCanvas': 'Failed to create sprite-guide canvas',
    'extender.error.spriteSheet': 'Failed to generate sprite sheet',
    'extender.error.framesExcludedDownload':
      'All frames are excluded — click a frame to include it before downloading.',
    'extender.error.generateSheetFirstDownload': 'Generate the sheet before downloading.',
    'extender.error.exportSpriteSheet': 'Failed to export sprite sheet',
    'extender.error.framesExcludedExport':
      'All frames are excluded — click a frame to include it before exporting.',
    'extender.error.generateSheetFirstExport':
      'Generate the sheet before exporting the ZIP.',
    'extender.error.autoExtend': 'Auto-extend failed',
    'extender.error.noLayers':
      'No layers to export. Generate or upload at least one layer first.',
    'extender.error.buildZip': 'Failed to build ZIP',
    'extender.error.harmonize': 'Failed to harmonize',
    'extender.error.tileable': 'Failed to make tileable',
    'extender.error.switchToExtender':
      'Switch to Extender or Parallax to open a library asset.',

    // ── Image-loader failures (throw inside canvas helpers) ─────────────────
    'extender.error.loadTile': 'Failed to load {role}',
    'extender.error.loadFrame': 'Failed to load sprite frame {index}',

    // ── Live progress (loading pill) ────────────────────────────────────────
    'extender.progress.variant': 'Variant {step}/{total} · {seconds}s',
    'extender.progress.generating': 'Generating · {seconds}s',
    'extender.progress.extending': 'Extending {direction}…',
    'extender.progress.regenerating': 'Regenerating {direction}…',
    'extender.progress.generatingPhase': 'Generating {label}…',
    'extender.progress.processingPhase': 'Processing {label}…',
    'extender.progress.phase': '{phase} · {seconds}s',
    'extender.progress.reviewing': 'Art director reviewing…',
    'extender.progress.repainting': 'Issues found — repainting…',
    'extender.progress.planningProps': 'Art director planning…',
    'extender.progress.batchProps': '{action} {count} props · {seconds}s',
    'extender.progress.adding': 'Adding',
    'extender.progress.generatingAction': 'Generating',
    'extender.progress.slicing': 'Slicing…',
    'extender.progress.processing': 'Processing…',
    'extender.progress.rerollProp': 'Re-rolling prop…',
    'extender.progress.checkingFrames': 'Checking frames…',
    'extender.progress.duplicateRepainting': 'Duplicate/spillover found — repainting…',
    'extender.progress.step': 'Auto step {step} · {from} → {to}px',
    'extender.progress.closingLoop': 'Closing the loop…',
    'extender.progress.stopping': 'Stopping after this step…',
    'extender.progress.packaging': 'Packaging ZIP…',
    'extender.progress.harmonizing': 'Harmonizing seams…',
    'extender.progress.tileable': 'Making tileable…',

    // ── Pipeline phase names (composed into the pill as `{phase} · Ns`) ─────
    'extender.phase.generatingSheet': 'Generating sheet',
    'extender.phase.repaintingSheet': 'Repainting (pass {pass})',
    'extender.phase.aligning': 'Aligning to template',
    'extender.phase.slicing': 'Slicing template',
    'extender.phase.processingTiles': 'Processing tiles',
    'extender.phase.reconciling': 'Reconciling corners',
    'extender.phase.lockingCharacter': 'Locking character (1/2)',
    'extender.phase.paintingFrames': 'Painting frames (2/2)',
    'extender.phase.repaintingFrames': 'Repainting frames (pass {pass})',

    // ── Result banner (Workspace / ParallaxStudio) ──────────────────────────
    'extender.result.cycleVariants': 'Cycle variants with ← →, then accept',
    'extender.result.ready': 'New extension ready — accept, regenerate, or discard',

    // ── Command bar hints ───────────────────────────────────────────────────
    'extender.command.hintStyleParallax':
      'Style: {style} — describe what to extend in the {layer} layer',
    'extender.command.hintParallax':
      'Optional: describe what should appear further along the {layer} layer…',
    'extender.command.hintStyle': 'Style: {style} — describe what to add (optional)',

    // ── Generate-modal workflow tip ─────────────────────────────────────────
    'extender.tip.layerPrerequisite':
      "Tip: {layer} isn't built yet. Layers work best when generated front-to-back (Near → Mid → Far → Sky) so palette and art direction stay consistent. You can still generate now if you're bringing your own matching assets.",
  },
  zh: {
    // ── 客户端错误（提示条） ────────────────────────────────────────────────
    'extender.error.loadImage': '图像加载失败',
    'extender.error.tilePromptOnly':
      '瓦片集模式只能根据提示词生成。要扩展上传的图像，请切换到扩图模式。',
    'extender.error.spritePromptOnly':
      '精灵模式只能根据提示词生成。要扩展上传的图像，请切换到扩图模式。',
    'extender.error.sceneDirection': '无法推导场景方向',
    'extender.error.describeImage': '请描述你想生成的图像。',
    'extender.error.generateImage': '生成图像失败',
    'extender.error.extendImage': '扩展图像失败',
    'extender.error.noImage': 'API 未返回图像',
    'extender.error.dimensions': '图像尺寸尚不可用。',
    'extender.error.unfilledOne':
      'AI 尝试 1 次后仍未能填充扩展区域。请尝试其他方向或模型。',
    'extender.error.unfilledMany':
      'AI 尝试 {count} 次后仍未能填充扩展区域。请尝试其他方向或模型。',
    'extender.error.occurred': '发生错误',
    'extender.error.tileRole': '生成 {label} 瓦片失败',
    'extender.error.describeMaterial': '描述你想要的材质 —— 例如长满苔藓的石地板。',
    'extender.error.tileSheet': '生成瓦片表失败',
    'extender.error.describeMaterialFirst': '重新生成瓦片前请先描述你想要的材质。',
    'extender.error.regenerateTile': '重新生成瓦片失败',
    'extender.error.tileFirstSheet': '请先生成至少一张瓦片再下载图集。',
    'extender.error.exportSheet': '导出图集失败',
    'extender.error.tileFirstZip': '请先生成至少一张瓦片再导出 ZIP。',
    'extender.error.exportZip': '导出 ZIP 失败',
    'extender.error.describeBiome': '描述生态环境 / 调色板 —— 例如茂密的森林装饰。',
    'extender.error.generateProps': '生成道具失败',
    'extender.error.describeBiomeFirst': '请先描述生态环境，再重新生成单个道具。',
    'extender.error.rerollProp': '重新生成道具失败',
    'extender.error.propFirstAtlas': '请先生成至少一个道具再下载图集。',
    'extender.error.exportAtlas': '导出图集失败',
    'extender.error.propFirstZip': '请先生成至少一个道具再导出 ZIP。',
    'extender.error.describeCharacter': '描述你想要的角色 —— 例如装甲像素骑士。',
    'extender.error.characterAnchor': '生成角色基准图失败',
    'extender.error.noAnchorImage': 'API 未返回基准图像',
    'extender.error.sheetCanvas': '画布不可用',
    'extender.error.uploadedLoad': '无法加载上传的图像',
    'extender.error.chooseImageFile': '请选择图像文件（带透明通道的 PNG 效果最佳）。',
    'extender.error.readFile': '读取文件失败',
    'extender.error.uploadedProcess': '处理上传的角色图像失败',
    'extender.error.spriteGuideCanvas': '无法创建精灵引导画布',
    'extender.error.spriteSheet': '生成精灵表失败',
    'extender.error.framesExcludedDownload': '所有帧都被排除了 —— 点击帧将其重新包含后再下载。',
    'extender.error.generateSheetFirstDownload': '请先生成精灵表再下载。',
    'extender.error.exportSpriteSheet': '导出精灵表失败',
    'extender.error.framesExcludedExport': '所有帧都被排除了 —— 点击帧将其重新包含后再导出。',
    'extender.error.generateSheetFirstExport': '请先生成精灵表再导出 ZIP。',
    'extender.error.autoExtend': '自动扩展失败',
    'extender.error.noLayers': '没有可导出的图层。请先生成或上传至少一个图层。',
    'extender.error.buildZip': '构建 ZIP 失败',
    'extender.error.harmonize': '接缝调和失败',
    'extender.error.tileable': '生成平铺纹理失败',
    'extender.error.switchToExtender': '切换到扩图或视差模式以打开素材库资源。',

    // ── 图像加载失败（画布辅助函数抛出的错误） ──────────────────────────────
    'extender.error.loadTile': '无法加载 {role}',
    'extender.error.loadFrame': '无法加载精灵帧 {index}',

    // ── 实时进度（加载提示条） ──────────────────────────────────────────────
    'extender.progress.variant': '候选 {step}/{total} · {seconds}s',
    'extender.progress.generating': '生成中 · {seconds}s',
    'extender.progress.extending': '正在向{direction}扩展…',
    'extender.progress.regenerating': '正在向{direction}重新扩展…',
    'extender.progress.generatingPhase': '正在生成{label}…',
    'extender.progress.processingPhase': '正在处理{label}…',
    'extender.progress.phase': '{phase} · {seconds}s',
    'extender.progress.reviewing': '美术指导审查中…',
    'extender.progress.repainting': '发现问题 —— 正在重绘…',
    'extender.progress.planningProps': '美术指导规划中…',
    'extender.progress.batchProps': '{action} {count} 个道具 · {seconds}s',
    'extender.progress.adding': '添加',
    'extender.progress.generatingAction': '生成',
    'extender.progress.slicing': '切分中…',
    'extender.progress.processing': '处理中…',
    'extender.progress.rerollProp': '正在重新生成道具…',
    'extender.progress.checkingFrames': '检查帧中…',
    'extender.progress.duplicateRepainting': '发现重复/溢出 —— 正在重绘…',
    'extender.progress.step': '自动步骤 {step} · {from} → {to}px',
    'extender.progress.closingLoop': '正在闭合循环…',
    'extender.progress.stopping': '本步完成后停止…',
    'extender.progress.packaging': '正在打包 ZIP…',
    'extender.progress.harmonizing': '正在调和接缝…',
    'extender.progress.tileable': '正在生成平铺纹理…',

    // ── 流水线阶段名（与 `· Ns` 组合进提示条） ──────────────────────────────
    'extender.phase.generatingSheet': '生成整套',
    'extender.phase.repaintingSheet': '重绘中（第 {pass} 遍）',
    'extender.phase.aligning': '对齐到模板',
    'extender.phase.slicing': '切分模板',
    'extender.phase.processingTiles': '处理瓦片',
    'extender.phase.reconciling': '调和转角',
    'extender.phase.lockingCharacter': '锁定角色（1/2）',
    'extender.phase.paintingFrames': '绘制帧（2/2）',
    'extender.phase.repaintingFrames': '重绘帧（第 {pass} 遍）',

    // ── 结果提示条（Workspace / ParallaxStudio） ────────────────────────────
    'extender.result.cycleVariants': '用 ← → 切换候选，然后接受',
    'extender.result.ready': '新扩展已就绪 —— 接受、重新生成或丢弃',

    // ── 命令栏提示 ──────────────────────────────────────────────────────────
    'extender.command.hintStyleParallax': '风格：{style} —— 描述要在{layer}图层中扩展的内容',
    'extender.command.hintParallax': '可选：描述{layer}图层延伸方向上应该出现的内容…',
    'extender.command.hintStyle': '风格：{style} —— 描述要添加的内容（可选）',

    // ── 生成弹窗的工作流提示 ────────────────────────────────────────────────
    'extender.tip.layerPrerequisite':
      '提示：{layer}尚未构建。图层最好按从前往后的顺序生成（近景 → 中景 → 远景 → 天空），这样配色与美术方向才能保持一致。如果你自带匹配的素材，也可以现在直接生成。',
  },
}

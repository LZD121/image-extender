import type { Namespace } from '@/app/i18n/types'

/** Strings rendered by the Sprite studio. */
export const sprite: Namespace = {
  en: {
    // ── Studio intro / section headers ──────────────────────────────────────
    'sprite.intro':
      'Sprite mode — pick a body plan, then an animation. Pass 1 generates a character anchor; Pass 2 paints all 8 keyframes onto a deterministic pose map. Re-use the same character across multiple animations.',
    'sprite.bodyPlan.label': 'Body plan',
    'sprite.character.label': 'Character',
    'sprite.fps.label': 'FPS',
    'sprite.sheet.title': 'Frame sheet (4×2)',
    'sprite.sheet.exportSize': '{width}×{height} export',

    // ── Live playback ───────────────────────────────────────────────────────
    'sprite.playback.title': 'Live playback',
    'sprite.playback.frame': 'Frame {index}/{total} · {fps} FPS',
    'sprite.playback.noFrames': 'No frames yet',
    'sprite.playback.play': 'Play',
    'sprite.playback.pause': 'Pause',
    'sprite.playback.scrub': 'Scrub frame',
    'sprite.playback.fps': 'Playback FPS',
    'sprite.playback.lockedCharacter': 'Locked character',
    'sprite.playback.uploadedCharacter': 'Uploaded character',
    'sprite.playback.characterReady': 'Character ready',
    'sprite.playback.characterHint':
      'Pick an animation and hit generate to bring it to life',
    'sprite.playback.empty': 'Generate a sheet to see the animation play',
    'sprite.frame.alt': 'Frame {index}',

    // ── Frame cells & grid ──────────────────────────────────────────────────
    'sprite.frame.excluded': 'Excluded',
    'sprite.frame.includeHint': 'Frame {index} — excluded · click to include',
    'sprite.frame.excludeHint':
      'Frame {index} — click to exclude from animation & exports',
    'sprite.frame.hint': 'Frame {index}',
    'sprite.grid.hint':
      'Click a frame to exclude it from the animation and all exports; click again to bring it back.',
    'sprite.grid.excludedSummary': '{excluded} excluded · {active} active.',
    'sprite.grid.readingOrder':
      'Row-major reading order: top-left is frame 1, top-right is frame 4, bottom-left is frame 5.',

    // ── Animation chips ─────────────────────────────────────────────────────
    'sprite.anim.savedHint': '{hint} · saved animation — click to view',
    'sprite.anim.savedBadge': 'has saved animation',

    // ── Action bar ──────────────────────────────────────────────────────────
    'sprite.action.stop': 'Stop',
    'sprite.action.stopHint': 'Stop the current generation',
    'sprite.action.generateTitle': 'Generate the {anim} sheet for the existing character (skips the anchor pass — faster)',
    'sprite.action.lockTitle':
      'Two-pass generation: lock character (Pass 1) + paint {anim} sheet (Pass 2)',
    'sprite.action.reroll': 'Re-roll {anim}',
    'sprite.action.generate': 'Generate {anim}',
    'sprite.action.lock': 'Lock character + {anim}',
    'sprite.action.rerollCharacter': 'Re-roll character',
    'sprite.action.rerollCharacterHint':
      'Discard the current character and re-roll a fresh anchor + sheet',
    'sprite.action.downloadSheet': 'Sheets + manifest',
    'sprite.action.downloadSheetHint':
      'Export grid sheet + horizontal strip + JSON manifest',
    'sprite.action.downloadZip': 'ZIP',
    'sprite.action.downloadZipHint':
      'Export individual frame PNGs + grid sheet + strip + manifest as a ZIP',
    'sprite.action.clear': 'Clear',
    'sprite.action.clearHint': 'Clear frames, character anchor, and prompt',
    'sprite.action.frameCount': '{filled}/{total} frames',

    // ── Character upload / starters ─────────────────────────────────────────
    'sprite.upload.replace': 'Replace uploaded character',
    'sprite.upload.title': 'Upload your own character',
    'sprite.upload.hint':
      'Drag & drop or click to browse · transparent PNG works best',
    'sprite.upload.buttonHint':
      'Upload your own character image and animate it instead of generating one',
    'sprite.upload.remove': 'Remove uploaded character',
    'sprite.upload.removeHint':
      'Remove the uploaded character and use a prompt instead',
    'sprite.starters.divider': 'or pick a starter',
    'sprite.prompt.placeholderUploaded':
      'Optional: describe the character to refine results',
    'sprite.prompt.placeholder': 'Describe the character — or pick a starter above',
    'sprite.artStyle.title': 'Art style for the sprite sheet',
  },
  zh: {
    // ── 工作室说明 / 分区标题 ───────────────────────────────────────────────
    'sprite.intro':
      '精灵模式 —— 先选体型，再选动作。第 1 步生成角色锚点；第 2 步把全部 8 个关键帧绘制到确定性的姿势图上。同一角色可复用于多个动作。',
    'sprite.bodyPlan.label': '体型',
    'sprite.character.label': '角色',
    'sprite.fps.label': '帧率',
    'sprite.sheet.title': '帧图集（4×2）',
    'sprite.sheet.exportSize': '{width}×{height} 导出',

    // ── 实时播放 ────────────────────────────────────────────────────────────
    'sprite.playback.title': '实时播放',
    'sprite.playback.frame': '第 {index}/{total} 帧 · {fps} FPS',
    'sprite.playback.noFrames': '尚无帧',
    'sprite.playback.play': '播放',
    'sprite.playback.pause': '暂停',
    'sprite.playback.scrub': '拖动进度查看帧',
    'sprite.playback.fps': '播放帧率',
    'sprite.playback.lockedCharacter': '已锁定角色',
    'sprite.playback.uploadedCharacter': '已上传角色',
    'sprite.playback.characterReady': '角色已就绪',
    'sprite.playback.characterHint': '选择一个动作并点击生成，让它动起来',
    'sprite.playback.empty': '生成图集后即可观看动画播放',
    'sprite.frame.alt': '第 {index} 帧',

    // ── 帧格子与网格 ────────────────────────────────────────────────────────
    'sprite.frame.excluded': '已排除',
    'sprite.frame.includeHint': '第 {index} 帧 —— 已排除 · 点击可恢复',
    'sprite.frame.excludeHint': '第 {index} 帧 —— 点击可从动画与导出中排除',
    'sprite.frame.hint': '第 {index} 帧',
    'sprite.grid.hint': '点击帧可将其从动画和所有导出中排除；再次点击即可恢复。',
    'sprite.grid.excludedSummary': '{excluded} 帧已排除 · {active} 帧生效。',
    'sprite.grid.readingOrder':
      '按行优先顺序读取：左上为第 1 帧，右上为第 4 帧，左下为第 5 帧。',

    // ── 动作标签 ────────────────────────────────────────────────────────────
    'sprite.anim.savedHint': '{hint} · 已保存的动作 —— 点击查看',
    'sprite.anim.savedBadge': '已保存该动作',

    // ── 操作栏 ──────────────────────────────────────────────────────────────
    'sprite.action.stop': '停止',
    'sprite.action.stopHint': '停止当前生成',
    'sprite.action.generateTitle':
      '为现有角色生成{anim}图集（跳过锚点步骤，更快）',
    'sprite.action.lockTitle': '两步生成：锁定角色（第 1 步）+ 绘制{anim}图集（第 2 步）',
    'sprite.action.reroll': '重新生成{anim}',
    'sprite.action.generate': '生成{anim}',
    'sprite.action.lock': '锁定角色 + {anim}',
    'sprite.action.rerollCharacter': '重新生成角色',
    'sprite.action.rerollCharacterHint': '丢弃当前角色，重新生成新的锚点与图集',
    'sprite.action.downloadSheet': '图集 + 清单',
    'sprite.action.downloadSheetHint': '导出网格图集 + 横向长条 + JSON 清单',
    'sprite.action.downloadZip': 'ZIP',
    'sprite.action.downloadZipHint':
      '将单帧 PNG + 网格图集 + 长条 + 清单打包为 ZIP 导出',
    'sprite.action.clear': '清空',
    'sprite.action.clearHint': '清空帧、角色锚点和描述',
    'sprite.action.frameCount': '{filled}/{total} 帧',

    // ── 角色上传 / 预设 ─────────────────────────────────────────────────────
    'sprite.upload.replace': '替换已上传的角色',
    'sprite.upload.title': '上传你自己的角色',
    'sprite.upload.hint': '拖放或点击浏览 · 透明 PNG 效果最佳',
    'sprite.upload.buttonHint': '上传你自己的角色图片并为其制作动画，而不是生成一个',
    'sprite.upload.remove': '移除已上传的角色',
    'sprite.upload.removeHint': '移除已上传的角色，改用文字描述',
    'sprite.starters.divider': '或选择一个预设',
    'sprite.prompt.placeholderUploaded': '可选：描述该角色以改善结果',
    'sprite.prompt.placeholder': '描述角色 —— 或在上方选择预设',
    'sprite.artStyle.title': '图集的美术风格',
  },
}

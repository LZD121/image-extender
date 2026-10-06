import type { Namespace } from '@/app/i18n'

/**
 * Strings rendered by the modals, drawers and toasts.
 *
 * The gateway/model pickers reuse `common.model.<id>.hint` and
 * `common.artStyle*`; provider labels (`OpenRouter`, `Magpie gateway`) and
 * model ids are data, not copy, and stay untranslated.
 */
export const modals: Namespace = {
  en: {
    // ── Settings drawer ─────────────────────────────────────────────────────
    'modals.settings.title': 'Settings',
    // Provider labels are proper nouns; only the descriptive hint is copy.
    'modals.provider.openrouter.hint':
      'Hosted, billed per call. Hosts the Gemini image models the studios are tuned for.',
    'modals.provider.openrouter.keyHint': 'sk-or-...',
    'modals.provider.magpie.hint':
      'A local OpenAI-compatible gateway. Model ids are vendor-prefixed, and which ones actually answer depends on the gateway’s own upstream credentials — the model list shown here is whatever the gateway reports.',
    'modals.provider.magpie.keyHint': 'usually not required',
    'modals.gateway.section': 'Gateway',
    'modals.gateway.cardKeyRequired': '{url} · key required',
    'modals.gateway.cardNoKey': '{url} · no key needed',
    'modals.gateway.check': 'Check connection',
    'modals.gateway.recheck': 'Re-check',
    'modals.gateway.checking': 'Checking…',
    'modals.gateway.unreachable': 'unreachable',
    'modals.gateway.checkTitle': 'Ask the gateway for its model list again',
    'modals.gateway.count': '{count} models · {image} image ({verified} verified) · {vendors} vendors',
    'modals.gateway.asking': 'Asking {provider} what it offers…',

    'modals.models.section': 'Image model',
    'modals.models.noneListed':
      "Could not list {provider}'s models, so the last known list is shown.",
    'modals.models.noImageModels':
      '{provider} listed no image models — generation will fail until it does.',
    'modals.models.noList': 'No model list from {provider} yet, so its default is shown.',
    'modals.models.verifiedOnly': 'Only models this project has verified are listed.',
    'modals.models.verifiedMore':
      'Only models this project has verified are listed — {provider} reports {count} more that this project has not run.',
    'modals.models.textOnly':
      'Suppliers here that generate no images at all: {vendors}.',
    'modals.models.vendorsTruncated': '…and {count} more',
    'modals.models.filterTitle': 'Only models served by {vendor}',
    'modals.models.unverified': 'not verified here',
    'modals.models.showCount': 'Show {count} more that {provider} reports (unverified)',
    'modals.models.hideCount': 'Hide the {count} unverified models',
    'modals.models.footnote':
      'Ids come from the gateway itself, filtered to the ones this project has actually run — a gateway reporting a model is not a promise that it answers. One call ≈ {seconds}s · up to {attempts} seam variants per extension.',
    'modals.models.footnoteSingle':
      'Ids come from the gateway itself, filtered to the ones this project has actually run — a gateway reporting a model is not a promise that it answers. One call ≈ {seconds}s · single attempt.',

    'modals.qa.section': 'Art-director model',
    'modals.qa.groupModels': 'Models',
    'modals.qa.groupVerified': 'Verified here',
    'modals.qa.groupOther': '{provider} also reports (unverified)',
    'modals.qa.body':
      'Writes the shared scene brief and reviews generated tile sets and sprite sheets, so it has to accept images. The verified group is what this project has run; the other group is what the gateway reports.',
    'modals.qa.suppliers': 'Suppliers here: {vendors}.',

    'modals.key.section': '{provider} key',
    'modals.key.saved': 'Key saved locally',
    'modals.key.edit': 'Edit key',
    'modals.key.remove': 'Remove key',
    'modals.key.add': 'Add {provider} key',
    'modals.key.addOptional': 'Add {provider} key (optional)',
    'modals.key.docs': 'Stored only in this browser. Get one at {url}.',
    'modals.key.noKey': '{provider} normally needs no key.',
    'modals.key.env': 'server {env} present — a key saved here overrides it',

    'modals.tools.section': 'Tools',
    'modals.tools.generate': 'Generate image from scratch',
    'modals.tools.generateHint':
      'Create a brand-new image from a text description, then extend it.',

    'modals.dev.section': 'Developer',
    'modals.dev.debugLabel': 'Debug overlay',
    'modals.dev.debugHint': 'Draw seam guides and log Poisson scores to the console.',

    'modals.about.section': 'About',
    'modals.about.body':
      'Extensions are 38% of the current image dimension. For larger extensions, click an edge again after accepting.',
    'modals.about.credit': 'Seamless blending via Poisson editing (Pérez et al. 2003).',

    // ── Generate modal ──────────────────────────────────────────────────────
    'modals.generate.title': 'Generate image',
    'modals.generate.sceneDirection': 'Scene direction',
    'modals.generate.shared': 'Shared across all layers',
    'modals.generate.deriving': 'Deriving from Near…',
    'modals.generate.scenePlaceholder':
      "Generate the Near layer first — we'll derive palette, lighting, and mood from that prompt. You can edit this before generating Mid, Far, and Sky.",
    'modals.generate.description': 'Description',
    'modals.generate.layerLabel': '{layer} layer',
    'modals.generate.promptPlaceholder':
      'e.g. A wide mountain valley at golden hour, with a winding river through pine forest',
    'modals.generate.width': 'Width',
    'modals.generate.height': 'Height',
    'modals.generate.style': 'Style',
    'modals.generate.photorealistic': 'Photorealistic',
    'modals.generate.generating': 'Generating…',
    'modals.generate.generate': 'Generate',

    // ── API key modal ───────────────────────────────────────────────────────
    'modals.apikey.titleRequired': 'Add your {provider} key',
    'modals.apikey.title': '{provider} API key',
    'modals.apikey.requiredBody': 'Required to generate or extend images.',
    'modals.apikey.optionalBody': 'Optional — the gateway usually needs none.',
    'modals.apikey.show': 'Show key',
    'modals.apikey.hide': 'Hide key',
    'modals.apikey.invalid': '{provider} keys start with sk-or-.',
    'modals.apikey.storage':
      "Your key is stored only in this browser's localStorage. It's sent with each request to your local server, which proxies it to {provider} — never logged, never persisted server-side.",
    'modals.apikey.getKey': 'Get a key at {url}',
    'modals.apikey.skipRequired': 'Skip — I only need the pixel studio',
    'modals.apikey.useServerEnv': 'Use server env',
    'modals.apikey.save': 'Save key',
  },
  zh: {
    // ── 设置抽屉 ────────────────────────────────────────────────────────────
    'modals.settings.title': '设置',
    'modals.provider.openrouter.hint':
      '托管服务，按调用计费。托管各工作室针对调优的 Gemini 图像模型。',
    'modals.provider.openrouter.keyHint': 'sk-or-...',
    'modals.provider.magpie.hint':
      '本地 OpenAI 兼容网关。模型 ID 带供应商前缀，哪些模型真正能响应取决于该网关自己的上游凭据——此处显示的模型列表就是网关所报告的内容。',
    'modals.provider.magpie.keyHint': '通常不需要',
    'modals.gateway.section': '网关',
    'modals.gateway.cardKeyRequired': '{url} · 需要密钥',
    'modals.gateway.cardNoKey': '{url} · 无需密钥',
    'modals.gateway.check': '检查连接',
    'modals.gateway.recheck': '重新检查',
    'modals.gateway.checking': '检查中…',
    'modals.gateway.unreachable': '无法连接',
    'modals.gateway.checkTitle': '再次向网关请求模型列表',
    'modals.gateway.count': '{count} 个模型 · {image} 个图像（{verified} 个已验证） · {vendors} 个供应商',
    'modals.gateway.asking': '正在询问 {provider} 提供哪些模型…',

    'modals.models.section': '图像模型',
    'modals.models.noneListed': '无法列出 {provider} 的模型，因此显示上次已知的列表。',
    'modals.models.noImageModels': '{provider} 没有列出任何图像模型——在它列出之前，生成会失败。',
    'modals.models.noList': '还没有来自 {provider} 的模型列表，因此显示其默认模型。',
    'modals.models.verifiedOnly': '这里只列出本项目验证过的模型。',
    'modals.models.verifiedMore':
      '这里只列出本项目验证过的模型——{provider} 还报告了 {count} 个本项目尚未运行的模型。',
    'modals.models.textOnly': '此处的以下供应商完全不生成图像：{vendors}。',
    'modals.models.vendorsTruncated': '……以及另外 {count} 个',
    'modals.models.filterTitle': '仅显示由 {vendor} 提供的模型',
    'modals.models.unverified': '未在此验证',
    'modals.models.showCount': '显示 {provider} 报告的另外 {count} 个（未验证）',
    'modals.models.hideCount': '隐藏 {count} 个未验证的模型',
    'modals.models.footnote':
      '模型 ID 来自网关本身，并筛选出本项目实际运行过的那些——网关报告某个模型，并不保证它能响应。一次调用约 {seconds} 秒 · 每次扩展最多 {attempts} 个接缝变体。',
    'modals.models.footnoteSingle':
      '模型 ID 来自网关本身，并筛选出本项目实际运行过的那些——网关报告某个模型，并不保证它能响应。一次调用约 {seconds} 秒 · 单次尝试。',

    'modals.qa.section': '美术指导模型',
    'modals.qa.groupModels': '模型',
    'modals.qa.groupVerified': '此处已验证',
    'modals.qa.groupOther': '{provider} 还报告了（未验证）',
    'modals.qa.body':
      '它负责撰写共享场景方向，并审查生成的瓦片集和精灵表，因此必须能接受图像。已验证分组是本项目运行过的模型；另一分组是网关报告的模型。',
    'modals.qa.suppliers': '此处的供应商：{vendors}。',

    'modals.key.section': '{provider} 密钥',
    'modals.key.saved': '密钥已保存在本地',
    'modals.key.edit': '编辑密钥',
    'modals.key.remove': '移除密钥',
    'modals.key.add': '添加 {provider} 密钥',
    'modals.key.addOptional': '添加 {provider} 密钥（可选）',
    'modals.key.docs': '仅存储在此浏览器中。获取地址：{url}。',
    'modals.key.noKey': '{provider} 通常不需要密钥。',
    'modals.key.env': '服务器 {env} 已存在——在此保存的密钥会覆盖它',

    'modals.tools.section': '工具',
    'modals.tools.generate': '从零生成图像',
    'modals.tools.generateHint': '根据文字描述创作一张全新图像，然后扩展它。',

    'modals.dev.section': '开发者',
    'modals.dev.debugLabel': '调试叠加层',
    'modals.dev.debugHint': '绘制接缝辅助线并将泊松评分输出到控制台。',

    'modals.about.section': '关于',
    'modals.about.body':
      '扩图尺寸为当前图像尺寸的 38%。若要更大的扩展，在采用后再次点击边缘。',
    'modals.about.credit': '通过泊松编辑实现无缝融合（Pérez et al. 2003）。',

    // ── 生成弹窗 ────────────────────────────────────────────────────────────
    'modals.generate.title': '生成图像',
    'modals.generate.sceneDirection': '场景方向',
    'modals.generate.shared': '所有图层共用',
    'modals.generate.deriving': '正在从近景推导…',
    'modals.generate.scenePlaceholder':
      '先生成近景图层——我们将根据该提示词推导色调、光照和氛围。你可以在生成中景、远景和天空之前编辑这段内容。',
    'modals.generate.description': '描述',
    'modals.generate.layerLabel': '{layer}图层',
    'modals.generate.promptPlaceholder': '例如：金色时刻的宽阔山谷，蜿蜒的河流穿过松林',
    'modals.generate.width': '宽度',
    'modals.generate.height': '高度',
    'modals.generate.style': '风格',
    'modals.generate.photorealistic': '写实',
    'modals.generate.generating': '生成中…',
    'modals.generate.generate': '生成',

    // ── API 密钥弹窗 ────────────────────────────────────────────────────────
    'modals.apikey.titleRequired': '添加你的 {provider} 密钥',
    'modals.apikey.title': '{provider} API 密钥',
    'modals.apikey.requiredBody': '生成或扩展图像所必需。',
    'modals.apikey.optionalBody': '可选——网关通常不需要密钥。',
    'modals.apikey.show': '显示密钥',
    'modals.apikey.hide': '隐藏密钥',
    'modals.apikey.invalid': '{provider} 密钥以 sk-or- 开头。',
    'modals.apikey.storage':
      '你的密钥仅存储在此浏览器的 localStorage 中。它会随每次请求发送到你的本地服务器，再由服务器转发给 {provider}——绝不记录日志，也绝不在服务器端持久保存。',
    'modals.apikey.getKey': '获取密钥：{url}',
    'modals.apikey.skipRequired': '跳过——我只需要像素工作室',
    'modals.apikey.useServerEnv': '使用服务器环境变量',
    'modals.apikey.save': '保存密钥',
  },
}

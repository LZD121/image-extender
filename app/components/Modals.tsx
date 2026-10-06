'use client'

import { useEffect, useRef, useState } from 'react'
import { Icons } from '@/app/components/icons'
import { ART_STYLE_GROUPS } from '@/app/lib/artStyles'
import { MODELS, gatewayModelOption, getModelConfig, maskKey, type ModelOption } from '@/app/lib/models'
import {
  PROVIDERS,
  PROVIDER_IDS,
  pickableModels,
  vendorOf,
  type GatewayModel,
  type Provider,
  type ProviderId,
  type ProviderStatus,
} from '@/app/lib/providers'
import { fetchProviderTable, probeProvider, readCachedModels, writeCachedModels } from '@/app/lib/providerProbe'

/**
 * `apimart/claude-opus-4-6`, or `group/auto-claude-4-5 — apimart` when the
 * supplier the gateway names is not the id's own prefix.
 */
function labelWithSupplier(model: GatewayModel): string {
  return model.vendor && model.vendor !== vendorOf(model.id) ? `${model.id} — ${model.vendor}` : model.id
}

/** Radio-style choice card — shared by the gateway list and the model list. */
function ChoiceCard({
  title,
  detail,
  active,
  onClick,
}: {
  title: string
  detail: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-[var(--radius-sm)] p-3 text-left transition-colors"
      style={{
        background: active ? 'var(--accent-bg)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
      }}
    >
      <div
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{
          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
          background: active ? 'var(--accent)' : 'transparent',
        }}
      >
        {active && <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#1a1404' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </div>
      </div>
    </button>
  )
}


export function SettingsDrawer({
  open,
  onClose,
  debugMode,
  setDebugMode,
  onGenerate,
  apiKey,
  onEditApiKey,
  onClearApiKey,
  selectedModel,
  setSelectedModel,
  provider,
  onSelectProvider,
  qaModel,
  setQaModel,
}: {
  open: boolean
  onClose: () => void
  debugMode: boolean
  setDebugMode: (v: boolean) => void
  onGenerate: () => void
  apiKey: string
  onEditApiKey: () => void
  onClearApiKey: () => void
  selectedModel: string
  setSelectedModel: (v: string) => void
  provider: ProviderId
  onSelectProvider: (id: ProviderId) => void
  qaModel: string
  setQaModel: (v: string) => void
}) {
  const [table, setTable] = useState<ProviderStatus[]>(() =>
    PROVIDER_IDS.map((id) => ({ ...PROVIDERS[id], hasEnvKey: false })),
  )
  const [models, setModels] = useState<GatewayModel[]>([])
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [vendor, setVendor] = useState('all')
  const [recheck, setRecheck] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const active = table.find((p) => p.id === provider) ?? { ...PROVIDERS[provider], hasEnvKey: false }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // magpie's base URL and the server-side key are deployment facts; the drawer
  // is the only place they are shown, so re-read them whenever it opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchProviderTable().then((next) => {
      if (!cancelled) setTable(next)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  /**
   * Discovery runs by itself. Opening the drawer paints the last list we got
   * from this gateway (so the picker is never empty) and asks again behind it —
   * only the gateway decides which model ids exist, and only right now decides
   * whether they answer.
   */
  useEffect(() => {
    if (!open) return
    setVendor('all')
    setShowAll(false)
    const cached = readCachedModels(provider)
    if (cached) {
      setModels(cached.models)
      setStatus('ok')
    }
    let cancelled = false
    setStatus('testing')
    void probeProvider(provider, apiKey).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setModels(result.models)
        writeCachedModels(provider, result.models)
        setStatus('ok')
        setMessage(null)
      } else {
        // Keep whatever we already know: a failed probe does not un-discover
        // the models, it only means we could not confirm them.
        setStatus('error')
        setMessage(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, provider, apiKey, recheck])

  const pick = pickableModels(provider, models)
  // Only what this project has verified is offered; the rest of the gateway's
  // list is one explicit toggle away, never silently mixed in.
  const pool = showAll ? [...pick.verifiedImage, ...pick.otherImage] : pick.verifiedImage
  const vendors = Array.from(new Set(pool.map((m) => m.vendor))).sort()
  const visibleImages = vendor === 'all' ? pool : pool.filter((m) => m.vendor === vendor)
  const discovered: ModelOption[] = visibleImages.map(gatewayModelOption)
  // A supplier with no image model can never appear in this section, so name it
  // instead of leaving its absence to be guessed at.
  const imageSuppliers = new Set([...pick.verifiedImage, ...pick.otherImage].map((m) => m.vendor))
  const textOnlySuppliers = Array.from(new Set(models.map((m) => m.vendor)))
    .filter((v) => !imageSuppliers.has(v))
    .sort()
  // Nothing offered here yet → fall back to the ids this app is curated around,
  // or to this gateway's default, and let the copy say so.
  const imageOptions: ModelOption[] =
    discovered.length > 0
      ? discovered
      : models.length === 0 && provider === 'openrouter'
        ? MODELS
        : [gatewayModelOption({ id: active.imageModel, vendor: active.label, imageCapable: true })]
  // A filter must never hide the model that is actually selected.
  const imageChoices = imageOptions.some((m) => m.value === selectedModel)
    ? imageOptions
    : [gatewayModelOption({ id: selectedModel, vendor: vendorOf(selectedModel), imageCapable: true }), ...imageOptions]
  const qaVerified = pick.verifiedQa
  const qaOther = pick.otherQa
  const qaSuppliers = Array.from(new Set([...qaVerified, ...qaOther].map((m) => m.vendor))).sort()
  const activeConfig = getModelConfig(selectedModel, imageChoices)

  if (!open) return null
  return (
    <>
      <div
        className="fixed inset-0 z-30 anim-fade"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={onClose}
      />
      <aside
        className="fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col anim-slide-up"
        style={{
          background: 'var(--bg-elev)',
          borderLeft: '1px solid var(--border-strong)',
        }}
      >
        <div
          className="flex h-14 shrink-0 items-center justify-between border-b px-5"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-[14px] font-semibold tracking-tight">Settings</h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <Icons.X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <Section title="Gateway">
            <div className="space-y-2">
              {table.map((p) => (
                <ChoiceCard
                  key={p.id}
                  title={p.label}
                  active={p.id === provider}
                  onClick={() => onSelectProvider(p.id)}
                  detail={
                    <>
                      <code className="font-mono">{p.baseUrl}</code>
                      {p.keyRequired ? ' · key required' : ' · no key needed'}
                    </>
                  }
                />
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {active.hint}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => setRecheck((r) => r + 1)}
                disabled={status === 'testing'}
                className="btn btn-secondary"
                title="Ask the gateway for its model list again"
              >
                {status === 'testing' ? <Icons.Spinner size={14} /> : <Icons.Refresh size={14} />}
                {status === 'testing' ? 'Checking…' : models.length > 0 ? 'Re-check' : 'Check connection'}
              </button>
              {status === 'error' && (
                <span
                  className="inline-flex min-w-0 items-center gap-1 text-[11px]"
                  style={{ color: 'var(--danger)' }}
                  title={message ?? 'unreachable'}
                >
                  <Icons.AlertTriangle size={12} className="shrink-0" />
                  <span className="truncate">{message ?? 'unreachable'}</span>
                </span>
              )}
              {status !== 'error' && models.length > 0 && (
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {models.length} models · {pick.verifiedImage.length + pick.otherImage.length} image (
                  {pick.verifiedImage.length} verified) ·{' '}
                  {new Set(models.map((m) => m.vendor)).size} vendors
                </span>
              )}
            </div>
            {status === 'testing' && models.length === 0 && (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Asking {active.label} what it offers…
              </p>
            )}
          </Section>

          <Section title="Image model">
            {status === 'error' && (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Could not list {active.label}&apos;s models, so the last known list is shown.
              </p>
            )}
            {status === 'ok' && pick.verifiedImage.length + pick.otherImage.length === 0 && (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--danger)' }}>
                <Icons.AlertTriangle size={12} className="mr-1 inline align-[-2px]" />
                {active.label} listed no image models — generation will fail until it does.
              </p>
            )}
            {models.length === 0 && status !== 'testing' && provider !== 'openrouter' && (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                No model list from {active.label} yet, so its default is shown.
              </p>
            )}
            {models.length > 0 && (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Only models this project has verified are listed
                {pick.otherImage.length > 0
                  ? ` — ${active.label} reports ${pick.otherImage.length} more that this project has not run.`
                  : '.'}
                {textOnlySuppliers.length > 0 && (
                  <>
                    {' '}
                    Suppliers here that generate no images at all:{' '}
                    <span className="font-mono">{textOnlySuppliers.join(', ')}</span>.
                  </>
                )}
              </p>
            )}
            {vendors.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                  { id: 'all', count: pool.length },
                  ...vendors.map((v) => ({ id: v, count: pool.filter((m) => m.vendor === v).length })),
                ].map((option) => {
                  const on = vendor === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setVendor(option.id)}
                      className="rounded-full px-2 py-0.5 font-mono text-[10px] transition-colors"
                      style={{
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                        background: on ? 'var(--accent-bg)' : 'var(--bg-elev)',
                        color: on ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      title={`Only models served by ${option.id}`}
                    >
                      {option.id} {option.count}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="space-y-2">
              {imageChoices.map((m) => {
                const unverified = !pick.curated && pick.otherImage.some((x) => x.id === m.value)
                return (
                  <ChoiceCard
                    key={m.value}
                    title={m.label}
                    active={m.value === selectedModel}
                    onClick={() => setSelectedModel(m.value)}
                    detail={
                      <>
                        {m.hint ? `${m.hint} · ` : ''}
                        <code className="font-mono">{m.value}</code>
                        {unverified && (
                          <span style={{ color: 'var(--danger)' }}> · not verified here</span>
                        )}
                      </>
                    }
                  />
                )
              })}
            </div>
            {pick.otherImage.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] transition-colors"
                style={{ color: 'var(--accent)' }}
              >
                {showAll ? <Icons.EyeOff size={13} /> : <Icons.Eye size={13} />}
                {showAll
                  ? `Hide the ${pick.otherImage.length} unverified models`
                  : `Show ${pick.otherImage.length} more that ${active.label} reports (unverified)`}
              </button>
            )}
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Ids come from the gateway itself, filtered to the ones this project
              has actually run — a gateway reporting a model is not a promise that
              it answers. One call ≈ {activeConfig.approxSecondsPerCall}s
              {activeConfig.maxAttempts > 1 ? ` · up to ${activeConfig.maxAttempts} seam variants per extension` : ' · single attempt'}.
            </p>
          </Section>

          <Section title="Art-director model">
            <select
              value={qaModel}
              onChange={(e) => setQaModel(e.target.value)}
              className="field select-styled font-mono text-[12px]"
            >
              {![...qaVerified, ...qaOther].some((m) => m.id === qaModel) && (
                <option value={qaModel}>{qaModel}</option>
              )}
              <optgroup label={pick.curated ? 'Models' : 'Verified here'}>
                {qaVerified.map((m) => (
                  <option key={m.id} value={m.id}>
                    {labelWithSupplier(m)}
                  </option>
                ))}
              </optgroup>
              {qaOther.length > 0 && (
                <optgroup label={`${active.label} also reports (unverified)`}>
                  {qaOther.map((m) => (
                    <option key={m.id} value={m.id}>
                      {labelWithSupplier(m)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Writes the shared scene brief and reviews generated tile sets and
              sprite sheets, so it has to accept images. The verified group is what
              this project has run; the other group is what the gateway reports.
              {qaSuppliers.length > 0 && (
                <>
                  {' '}
                  Suppliers here: <span className="font-mono">{qaSuppliers.join(', ')}</span>.
                </>
              )}
            </p>
          </Section>

          <Section title={`${active.label} key`}>
            {apiKey ? (
              <div
                className="flex items-center gap-3 rounded-[var(--radius-sm)] p-3"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded"
                  style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
                >
                  <Icons.Key size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium">Key saved locally</div>
                  <div
                    className="truncate font-mono text-[11px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {maskKey(apiKey)}
                  </div>
                </div>
                <button
                  onClick={onEditApiKey}
                  className="icon-btn"
                  aria-label="Edit key"
                  title="Edit key"
                >
                  <Icons.Settings size={14} />
                </button>
                <button
                  onClick={onClearApiKey}
                  className="icon-btn"
                  aria-label="Remove key"
                  title="Remove key"
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={onEditApiKey}
                className="btn btn-secondary w-full justify-start"
              >
                <Icons.Key size={14} />
                Add {active.label} key{active.keyRequired ? '' : ' (optional)'}
              </button>
            )}
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Stored only in this browser.{' '}
              {active.keyDocs ? (
                <>
                  Get one at{' '}
                  <a
                    href={active.keyDocs}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    {active.keyDocs.replace(/^https?:\/\//, '')}
                  </a>
                  .
                </>
              ) : (
                `${active.label} normally needs no key.`
              )}
            </p>
            {active.hasEnvKey && (
              <p className="mt-2 text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
                server {active.keyEnv} present — a key saved here overrides it
              </p>
            )}
          </Section>

          <Section title="Tools">
            <button
              onClick={() => {
                onClose()
                onGenerate()
              }}
              className="btn btn-secondary w-full justify-start"
            >
              <Icons.Sparkle size={15} />
              Generate image from scratch
            </button>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              Create a brand-new image from a text description, then extend it.
            </p>
          </Section>

          <Section title="Developer">
            <Toggle
              label="Debug overlay"
              description="Draw seam guides and log Poisson scores to the console."
              checked={debugMode}
              onChange={setDebugMode}
            />
          </Section>

          <Section title="About">
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Extensions are 38% of the current image dimension. For larger
              extensions, click an edge again after accepting.
            </p>
            <p
              className="mt-3 text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              Seamless blending via Poisson editing (Pérez et al. 2003).
            </p>
          </Section>
        </div>
      </aside>
    </>
  )
}


export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3
        className="mb-3 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  )
}


export function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-[var(--radius-sm)] py-1">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        {description && (
          <div
            className="mt-0.5 text-[12px] leading-snug"
            style={{ color: 'var(--text-muted)' }}
          >
            {description}
          </div>
        )}
      </div>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{
          background: checked ? 'var(--accent)' : 'var(--surface)',
          border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
        }}
      >
        <span
          className="inline-block h-3 w-3 rounded-full transition-transform"
          style={{
            background: checked ? '#1a1404' : 'var(--text-secondary)',
            transform: checked ? 'translateX(18px)' : 'translateX(3px)',
          }}
        />
      </span>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate modal — text-to-image
// ─────────────────────────────────────────────────────────────────────────────


export function GenerateModal({
  open,
  onClose,
  prompt,
  setPrompt,
  width,
  setWidth,
  height,
  setHeight,
  artStyle,
  setArtStyle,
  generating,
  onGenerate,
  workflowNote,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  showSceneBrief,
  layerLabel,
}: {
  open: boolean
  onClose: () => void
  prompt: string
  setPrompt: (v: string) => void
  width: number
  setWidth: (v: number) => void
  height: number
  setHeight: (v: number) => void
  artStyle: string
  setArtStyle: (v: string) => void
  generating: boolean
  onGenerate: () => void
  workflowNote?: string | null
  sceneBrief?: string
  setSceneBrief?: (v: string) => void
  sceneBriefLoading?: boolean
  showSceneBrief?: boolean
  layerLabel?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />
      <div
        className="anim-slide-up relative w-full max-w-lg rounded-[var(--radius-lg)] p-6"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 32px 64px -16px rgba(0,0,0,0.8)',
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
            >
              <Icons.Sparkle size={15} />
            </div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Generate image
            </h2>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <Icons.X size={16} />
          </button>
        </div>

        {workflowNote && (
          <div
            className="mb-4 rounded-[var(--radius-sm)] px-3 py-2.5 text-[11px] leading-relaxed"
            style={{
              background: 'var(--accent-bg)',
              border: '1px solid var(--accent-border)',
              color: 'var(--text-secondary)',
            }}
          >
            {workflowNote}
          </div>
        )}

        <div className="space-y-4">
          {showSceneBrief && setSceneBrief && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label
                  className="text-[12px] font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Scene direction
                </label>
                {sceneBriefLoading ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px]"
                    style={{ color: 'var(--accent)' }}
                  >
                    <Icons.Spinner size={10} />
                    Deriving from Near…
                  </span>
                ) : (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    Shared across all layers
                  </span>
                )}
              </div>
              <textarea
                value={sceneBrief ?? ''}
                onChange={(e) => setSceneBrief(e.target.value)}
                disabled={generating || sceneBriefLoading}
                placeholder="Generate the Near layer first — we'll derive palette, lighting, and mood from that prompt. You can edit this before generating Mid, Far, and Sky."
                rows={3}
                className="field resize-none text-[13px] leading-relaxed"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              {layerLabel ? `${layerLabel} layer` : 'Description'}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A wide mountain valley at golden hour, with a winding river through pine forest"
              rows={3}
              className="field resize-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Width
              </label>
              <select
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="field select-styled"
              >
                {[512, 768, 960, 1024, 1280, 1536, 1920].map((v) => (
                  <option key={v} value={v}>
                    {v}px
                    {v === 1280 ? ' · 720p' : v === 1920 ? ' · 1080p' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                Height
              </label>
              <select
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="field select-styled"
              >
                {[360, 540, 720, 768, 1024, 1080, 1280, 1536].map((v) => (
                  <option key={v} value={v}>
                    {v}px
                    {v === 720 ? ' · 720p' : v === 1080 ? ' · 1080p' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Style
            </label>
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value)}
              className="field select-styled"
            >
              {ART_STYLE_GROUPS.map((group) =>
                group.options.length === 1 && group.label === 'Match original' ? (
                  <option key={group.options[0].value} value={group.options[0].value}>
                    Photorealistic
                  </option>
                ) : (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </select>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={generating} className="btn btn-ghost">
            Cancel
          </button>
          <button
            onClick={onGenerate}
            disabled={generating || !prompt.trim()}
            className="btn btn-primary"
          >
            {generating ? <Icons.Spinner size={14} /> : <Icons.Sparkle size={14} />}
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// API key modal — first-run prompt to BYOK
// ─────────────────────────────────────────────────────────────────────────────


export function ApiKeyModal({
  open,
  initialValue,
  required,
  provider,
  onSave,
  onSkip,
  onClose,
}: {
  open: boolean
  initialValue: string
  /** If true, the user can't dismiss without entering a key (no Skip / Esc). */
  required: boolean
  provider: Provider
  onSave: (key: string) => void
  onSkip?: () => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [reveal, setReveal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, initialValue])

  useEffect(() => {
    if (!open || required) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, required, onClose])

  if (!open) return null

  const trimmed = value.trim()
  const looksValid = provider.keyDocs === null ? trimmed.length > 0 : trimmed.startsWith('sk-or-') && trimmed.length > 20

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 anim-fade">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
        onClick={() => {
          if (!required) onClose()
        }}
      />
      <div
        className="anim-slide-up relative w-full max-w-md rounded-[var(--radius-lg)] p-6"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          boxShadow: '0 32px 64px -16px rgba(0,0,0,0.8)',
        }}
      >
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md"
            style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}
          >
            <Icons.Key size={17} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {required ? `Add your ${provider.label} key` : `${provider.label} API key`}
            </h2>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {provider.keyRequired ? 'Required to generate or extend images.' : 'Optional — the gateway usually needs none.'}
            </p>
          </div>
          {!required && (
            <button onClick={onClose} className="icon-btn" aria-label="Close">
              <Icons.X size={16} />
            </button>
          )}
        </div>

        <div className="mb-4">
          <div className="relative">
            <input
              ref={inputRef}
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && looksValid) onSave(trimmed)
              }}
              placeholder={provider.keyHint}
              className="field pr-10 font-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
              aria-label={reveal ? 'Hide key' : 'Show key'}
              tabIndex={-1}
            >
              {reveal ? <Icons.EyeOff size={14} /> : <Icons.Eye size={14} />}
            </button>
          </div>
          {value && !looksValid && (
            <div
              className="mt-2 flex items-start gap-2 text-[12px]"
              style={{ color: 'var(--danger)' }}
            >
              <Icons.AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{provider.label} keys start with <code className="font-mono">sk-or-</code>.</span>
            </div>
          )}
        </div>

        <div
          className="mb-4 rounded-[var(--radius-sm)] p-3 text-[12px] leading-relaxed"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          Your key is stored only in this browser&apos;s <code className="font-mono">localStorage</code>.
          It&apos;s sent with each request to your local server, which proxies it to {provider.label} — never logged, never persisted server-side.
        </div>

        {provider.keyDocs && (
          <a
            href={provider.keyDocs}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-5 inline-flex items-center gap-1.5 text-[12px] transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            Get a key at {provider.keyDocs.replace(/^https?:\/\//, '')}
            <Icons.External size={11} />
          </a>
        )}

        <div className="flex items-center justify-between gap-2">
          {onSkip ? (
            <button onClick={onSkip} className="btn btn-ghost">
              {required ? 'Skip — I only need the pixel studio' : 'Use server env'}
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={() => onSave(trimmed)}
            disabled={!looksValid}
            className="btn btn-primary"
          >
            <Icons.Check size={14} />
            Save key
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Error toast — slides in at the top, auto-dismisses
// ─────────────────────────────────────────────────────────────────────────────


export function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div
      className="fixed left-1/2 top-4 z-50 -translate-x-1/2 anim-slide-down"
      role="alert"
    >
      <div
        className="flex items-start gap-3 rounded-[var(--radius)] px-4 py-3"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid rgba(255, 107, 107, 0.35)',
          boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)',
          maxWidth: 480,
        }}
      >
        <div className="mt-0.5" style={{ color: 'var(--danger)' }}>
          <Icons.X size={16} />
        </div>
        <div className="flex-1 text-[13px]" style={{ color: 'var(--text)' }}>
          {message}
        </div>
        <button onClick={onClose} className="icon-btn -m-1.5 h-7 w-7">
          <Icons.X size={14} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────


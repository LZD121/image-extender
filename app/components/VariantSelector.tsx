'use client'

import { Icons } from '@/app/components/icons'
import { useI18n } from '@/app/lib/i18n'

export function VariantSelector({
  index,
  total,
  isBest,
  score,
  onPrev,
  onNext,
}: {
  index: number
  total: number
  /** True when the current variant is the algorithm-picked best blend. */
  isBest: boolean
  /** Optional raw seam score, only shown in debug mode. */
  score?: number
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-1 pr-2 anim-fade"
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--bg-elev)',
      }}
      role="group"
      aria-label={t('shell.variant.cycleAria')}
    >
      <button
        onClick={onPrev}
        className="icon-btn h-6 w-6"
        aria-label={t('shell.variant.prevAria')}
        title={t('shell.variant.prevTitle')}
      >
        <Icons.ArrowLeft size={13} />
      </button>
      <span
        className="font-mono text-[11px] tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        {t('shell.variant.label', { index: index + 1, total })}
      </span>
      {isBest && (
        <span
          className="rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-border)',
          }}
          title={t('shell.variant.bestTitle')}
        >
          {t('shell.variant.best')}
        </span>
      )}
      {typeof score === 'number' && (
        <span
          className="font-mono text-[10px]"
          style={{ color: 'var(--text-muted)' }}
          title={t('shell.variant.scoreTitle')}
        >
          {score.toFixed(1)}
        </span>
      )}
      <button
        onClick={onNext}
        className="icon-btn h-6 w-6"
        aria-label={t('shell.variant.nextAria')}
        title={t('shell.variant.nextTitle')}
      >
        <Icons.ArrowRight size={13} />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Result actions — appears below the image when an extension is ready
// ─────────────────────────────────────────────────────────────────────────────


export function ResultActions({
  onAccept,
  onRegenerate,
  onDiscard,
  onDownload,
  loading,
}: {
  onAccept: () => void
  onRegenerate: () => void
  onDiscard: () => void
  onDownload: () => void
  loading: boolean
}) {
  const { t } = useI18n()
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border p-1"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--border-strong)',
        boxShadow: '0 12px 32px -16px rgba(0,0,0,0.6)',
      }}
    >
      <button
        onClick={onDiscard}
        disabled={loading}
        className="btn btn-ghost"
        title={t('shell.result.discardTitle')}
      >
        <Icons.X size={14} />
        {t('shell.result.discard')}
      </button>
      <button
        onClick={onRegenerate}
        disabled={loading}
        className="btn btn-ghost"
        title={t('shell.result.regenerateTitle')}
      >
        {loading ? <Icons.Spinner size={14} /> : <Icons.Refresh size={14} />}
        {t('common.action.regenerate')}
      </button>
      <button
        onClick={onDownload}
        disabled={loading}
        className="btn btn-ghost"
        title={t('shell.result.downloadTitle')}
      >
        <Icons.Download size={14} />
        {t('common.action.download')}
      </button>
      <div
        className="mx-1 h-5 w-px"
        style={{ background: 'var(--border)' }}
        aria-hidden
      />
      <button
        onClick={onAccept}
        disabled={loading}
        className="btn btn-primary"
        title={t('shell.result.acceptTitle')}
      >
        <Icons.Check size={14} />
        {t('shell.result.accept')}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings drawer — debug mode, generate-from-scratch entry point
// ─────────────────────────────────────────────────────────────────────────────


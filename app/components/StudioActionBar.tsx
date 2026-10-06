'use client'

// app/components/StudioActionBar.tsx
/**
 * The action bar every studio wears: the one button that starts work (or the
 * one that stops it), the export pair, the clear, and the count pill.
 *
 * Tile and prop carried this same sixty lines apiece, and every studio carried
 * the pill. A studio passes labels, icons and handlers — nothing about the
 * layout is per-studio.
 */
import type { ReactNode } from 'react'
import { Icons } from '@/app/components/icons'

export type StudioAction = {
  label: string
  title: string
  icon: ReactNode
  onClick: () => void
  /** `secondary` is the main export; `ghost` is everything beside it. */
  variant?: 'secondary' | 'ghost'
  disabled?: boolean
}

export function StudioActionBar({
  running,
  onStop,
  stopLabel,
  stopTitle,
  primary,
  actions,
  status,
}: {
  /** While true the bar shows the stop button in place of `primary`. */
  running: boolean
  onStop: () => void
  stopLabel: string
  stopTitle: string
  primary: { label: string; title: string; icon: ReactNode; onClick: () => void; disabled?: boolean }
  actions: StudioAction[]
  /** The right-hand pill. The studio phrases it; the bar only places it. */
  status?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {running ? (
        <button onClick={onStop} className="btn btn-danger" title={stopTitle}>
          <Icons.Stop size={14} />
          {stopLabel}
        </button>
      ) : (
        <button
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="btn btn-primary"
          title={primary.title}
        >
          {primary.icon}
          {primary.label}
        </button>
      )}
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          className={action.variant === 'secondary' ? 'btn btn-secondary' : 'btn btn-ghost'}
          title={action.title}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
      {status}
    </div>
  )
}

/** The count / progress pill at the end of a bar. Dim when there is nothing yet. */
export function StudioCountPill({ children, dimmed = false }: { children: ReactNode; dimmed?: boolean }) {
  return (
    <div
      className="rounded-full border px-2.5 py-1 font-mono text-[11px]"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-elev)',
        color: dimmed ? 'var(--text-muted)' : 'var(--text-secondary)',
      }}
    >
      {children}
    </div>
  )
}

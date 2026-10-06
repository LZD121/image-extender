'use client'

import { IconProps, Icons } from '@/app/components/icons'
import { Mode } from '@/app/lib/app'
import { LOCALES } from '@/app/i18n'
import { useI18n } from '@/app/lib/i18n'

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-7 w-7 items-center justify-center rounded-md"
        style={{
          background: 'linear-gradient(135deg, var(--accent), #e07b00)',
          color: '#1a1404',
        }}
      >
        <Icons.CornerFrame size={16} />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold tracking-tight">Extender</span>
        <span className="text-[11px] font-mono text-[var(--text-muted)]">v2</span>
      </div>
    </div>
  )
}


export function TopBar({
  hasImage,
  mode,
  setMode,
  onNewImage,
  onShowSettings,
}: {
  hasImage: boolean
  mode: Mode
  setMode: (m: Mode) => void
  onNewImage: () => void
  onShowSettings: () => void
}) {
  const { t } = useI18n()
  return (
    <header
      className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6"
      style={{ borderColor: 'var(--border)' }}
    >
      <Logo />
      <ModeToggle mode={mode} setMode={setMode} />
      <div className="flex items-center gap-1.5">
        {hasImage && (
          <button onClick={onNewImage} className="btn btn-ghost">
            <Icons.Plus size={15} />
            {t('shell.topbar.newImage')}
          </button>
        )}
        <LanguageSwitcher />
        <button
          onClick={onShowSettings}
          className="icon-btn"
          aria-label={t('shell.topbar.settings')}
          title={t('shell.topbar.settings')}
        >
          <Icons.Settings size={17} />
        </button>
      </div>
    </header>
  )
}

/**
 * Compact EN/中文 toggle. Always visible (unlike ModeToggle) so a user on a
 * phone can still read the UI in their language.
 */
function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div
      className="flex items-center rounded-full p-0.5"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)' }}
      role="group"
      aria-label={t('app.language.switch')}
    >
      {LOCALES.map((value) => {
        const active = locale === value
        return (
          <button
            key={value}
            onClick={() => setLocale(value)}
            aria-pressed={active}
            className="rounded-full px-2 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: active ? '#1a1404' : 'var(--text-secondary)',
              background: active ? 'var(--accent)' : 'transparent',
            }}
          >
            {value === 'en' ? t('app.language.en') : t('app.language.zh')}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Compact segmented control that switches the workspace between Extender and
 * Parallax modes. Visually centered in the top bar so it reads as the primary
 * navigation rather than a settings option — switching tools is a first-class
 * action, not a hidden preference.
 */

export function ModeToggle({
  mode,
  setMode,
}: {
  mode: Mode
  setMode: (m: Mode) => void
}) {
  const { t } = useI18n()
  const tabs: { value: Mode; Icon: React.FC<IconProps> }[] = [
    { value: 'extender', Icon: Icons.CornerFrame },
    { value: 'parallax', Icon: Icons.Mountain },
    { value: 'tile', Icon: Icons.Layers },
    { value: 'props', Icon: Icons.Sprout },
    { value: 'sprite', Icon: Icons.Play },
    { value: 'pixel', Icon: Icons.Pixel },
  ]
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 hidden items-center gap-0.5 rounded-full p-1 sm:flex"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
      }}
      role="tablist"
      aria-label={t('shell.topbar.modeAria')}
    >
      {tabs.map(({ value, Icon }) => {
        const active = mode === value
        const hint = t(`common.mode.${value}.hint`)
        return (
          <button
            key={value}
            role="tab"
            aria-selected={active}
            onClick={() => setMode(value)}
            title={hint}
            className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              color: active ? '#1a1404' : 'var(--text-secondary)',
              background: active ? 'var(--accent)' : 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = 'var(--text)'
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = 'var(--text-secondary)'
            }}
          >
            <Icon size={13} />
            {t(`common.mode.${value}.label`)}
          </button>
        )
      })}
    </div>
  )
}


export function StatusPill({
  status,
  message,
}: {
  status: 'idle' | 'working' | 'error' | 'ok'
  message: string
}) {
  const color =
    status === 'error'
      ? 'var(--danger)'
      : status === 'ok'
        ? 'var(--success)'
        : status === 'working'
          ? 'var(--accent)'
          : 'var(--text-muted)'
  return (
    <div
      className="anim-slide-down flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px]"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-elev)',
        color,
      }}
    >
      {status === 'working' ? (
        <Icons.Spinner size={12} />
      ) : (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'currentColor' }}
        />
      )}
      <span style={{ color: 'var(--text-secondary)' }}>{message}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge handles — spatial direction selectors that sit ON the image edges
// ─────────────────────────────────────────────────────────────────────────────


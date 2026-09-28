// Primitives d'interface partagées : conteneur de page, en-tête, carte, boutons,
// puces de filtre et classes de tableau. Un seul endroit pour la densité, les
// rayons et les couleurs, afin que toutes les pages se ressemblent.
import Link from 'next/link'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1440px] px-5 py-5 lg:px-7 lg:py-6', className)}>{children}</div>
}

export function PageHeader({
  title, subtitle, eyebrow, actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** Élément au-dessus du titre (bouton retour, fil d'Ariane) */
  eyebrow?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-13 text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Carte ───────────────────────────────────────────────────────────────────

export function Card({
  title, actions, children, className, bodyClassName, padded = true,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  padded?: boolean
}) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
          {title ? <h2 className="text-13 font-semibold text-slate-800">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      <div className={cx(padded && 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

// ─── Boutons ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-brand text-white shadow-card hover:bg-brand-hover',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-card hover:border-slate-300 hover:bg-slate-50',
  ghost:     'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger:    'bg-red-600 text-white hover:bg-red-700',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-13',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra)
}

export function Button({
  variant = 'secondary', size = 'md', className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />
}

export function LinkButton({
  variant = 'secondary', size = 'md', className, href, ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} href={href} className={buttonClass(variant, size, className)} />
}

// ─── Champs ──────────────────────────────────────────────────────────────────

export const inputClass =
  'h-8 rounded-md border border-slate-200 bg-white px-2.5 text-13 text-slate-800 shadow-card placeholder:text-slate-400 ' +
  'focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-slate-400'

export const selectClass = cx(inputClass, 'pr-7')

// ─── Puces de filtre (contrôle segmenté) ─────────────────────────────────────

export function ChipGroup({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-1.5', className)}>
      {label && <span className="text-2xs font-medium uppercase tracking-wider text-slate-400">{label}</span>}
      <div className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5 shadow-card">
        {children}
      </div>
    </div>
  )
}

export function Chip({
  active, className, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      {...props}
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
        className
      )}
    >
      {children}
    </button>
  )
}

// ─── Onglets ─────────────────────────────────────────────────────────────────

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  /** Compteur affiché à droite du libellé (masqué si null) */
  count?: number | null
  /** 'warn' colore le compteur en ambre quand l'onglet est actif (anomalies, alertes) */
  tone?: 'default' | 'warn'
}

export function Tabs<T extends string>({ value, onChange, items, className }: {
  value: T
  onChange: (value: T) => void
  items: Array<TabItem<T>>
  className?: string
}) {
  return (
    <div role="tablist" className={cx('flex items-end gap-1 border-b border-slate-200', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cx(
              '-mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-13 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              active ? 'border-brand text-slate-900' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            )}
          >
            {it.label}
            {it.count != null && (
              <span
                className={cx(
                  'rounded-full px-1.5 text-2xs font-semibold leading-[18px] tabular-nums',
                  active
                    ? it.tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600'
                )}
              >
                {it.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Tableaux ────────────────────────────────────────────────────────────────

export const tableWrapClass = 'overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card'
export const tableClass     = 'w-full text-13'
export const theadClass     = 'border-b border-slate-200 bg-slate-50/80'
export const thClass        = 'px-3 py-2 text-left text-2xs font-medium uppercase tracking-wider text-slate-500 whitespace-nowrap'
export const tbodyClass     = 'divide-y divide-slate-100'
export const trClass        = 'transition-colors hover:bg-slate-50/70'
export const tdClass        = 'px-3 py-2 align-middle'

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('py-10 text-center text-13 text-slate-400', className)}>{children}</div>
}

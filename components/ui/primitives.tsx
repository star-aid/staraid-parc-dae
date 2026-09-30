// Primitives d'interface partagées : conteneur de page, en-tête, cartes,
// boutons, champs, pastilles, onglets, notices, classes de tableau, état vide.
// Un seul endroit pour la densité, les rayons et les couleurs, afin que toutes
// les pages se ressemblent. Les valeurs viennent des tokens de tailwind.config.ts
// (jamais de couleur brute ici). Guide : docs/design-system.md
import Link from 'next/link'
import type {
  AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes,
} from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, type LucideIcon } from 'lucide-react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8', className)}>{children}</div>
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
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-xl font-bold tracking-tight text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ─── Titre de section : capitales, petit, gras, le repère de structure ───────

export type SectionAccent = 'blue' | 'indigo' | 'amber' | 'violet' | 'orange'

const ICON_TILE_ACCENT: Record<SectionAccent, string> = {
  blue:   'bg-accent-blue-soft text-accent-blue-strong',
  indigo: 'bg-accent-indigo-soft text-accent-indigo-strong',
  amber:  'bg-accent-amber-soft text-accent-amber-strong',
  violet: 'bg-accent-violet-soft text-accent-violet-strong',
  orange: 'bg-accent-orange-soft text-accent-orange-strong',
}

const TITLE_ACCENT: Record<SectionAccent, string> = {
  blue:   'text-accent-blue-strong',
  indigo: 'text-accent-indigo-strong',
  amber:  'text-accent-amber-strong',
  violet: 'text-accent-violet-strong',
  orange: 'text-accent-orange-strong',
}

export function SectionTitle({
  children, icon: Icon, action, accent, tone = 'default', as: Heading = 'h2', className,
}: {
  children: ReactNode
  icon?: LucideIcon
  /** Élément aligné à droite (bouton, compteur, filtre) */
  action?: ReactNode
  /** Couleur d'identité du bloc : portée par la tuile d'icône, jamais par la surface */
  accent?: SectionAccent
  tone?: 'default' | 'warning'
  as?: 'h2' | 'h3' | 'h4'
  className?: string
}) {
  return (
    <div className={cx('flex min-h-7 items-center justify-between gap-2', className)}>
      <Heading
        className={cx(
          'flex min-w-0 items-center gap-2 text-label font-bold uppercase tracking-wide',
          accent ? TITLE_ACCENT[accent] : tone === 'warning' ? 'text-warning' : 'text-fg-muted'
        )}
      >
        {Icon && (
          <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-control', accent ? ICON_TILE_ACCENT[accent] : 'bg-surface-sunken text-fg-muted')}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="truncate">{children}</span>
      </Heading>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  )
}

// ─── Carte ───────────────────────────────────────────────────────────────────

export function Card({
  title, icon, accent, actions, children, className, bodyClassName, padded = true, as: Tag = 'section',
}: {
  title?: ReactNode
  icon?: LucideIcon
  accent?: SectionAccent
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  padded?: boolean
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Tag className={cx('rounded-card border border-border bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="border-b border-border-subtle px-4 py-2.5">
          <SectionTitle icon={icon} accent={accent} action={actions}>{title ?? ''}</SectionTitle>
        </header>
      )}
      <div className={cx(padded && 'p-4', bodyClassName)}>{children}</div>
    </Tag>
  )
}

// ─── Boutons ─────────────────────────────────────────────────────────────────
// Hiérarchie : une seule action `primary` par zone visuelle ; `secondary` pour
// les actions courantes ; `ghost` pour les actions discrètes en ligne ; `soft`
// pour une action de marque légère ; `inverted` sur fond rouge (header).

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'inverted' | 'success' | 'danger' | 'danger-outline'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center whitespace-nowrap font-semibold transition-colors outline-none select-none ' +
  'focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'disabled:pointer-events-none disabled:opacity-50'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:          'bg-brand font-bold text-brand-foreground shadow-sm hover:bg-brand-hover active:bg-brand-active',
  secondary:        'border border-border bg-surface text-fg-secondary hover:border-border-strong hover:bg-surface-sunken hover:text-fg',
  ghost:            'text-fg-secondary hover:bg-surface-sunken hover:text-fg',
  soft:             'bg-brand/10 font-bold text-brand hover:bg-brand/15',
  inverted:         'bg-surface font-bold text-brand hover:bg-surface/90',
  success:          'bg-success font-bold text-white shadow-sm hover:bg-success-hover',
  danger:           'bg-danger font-bold text-white shadow-sm hover:bg-danger-hover',
  'danger-outline': 'border border-border bg-surface text-danger hover:border-danger/40 hover:bg-danger-soft',
}

const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: 'h-7 gap-1.5 px-2.5 text-caption',
  sm: 'h-8 gap-1.5 px-3 text-caption',
  md: 'h-9 gap-2 px-4 text-sm',
  lg: 'h-10 gap-2 px-4 text-sm',
}

const BUTTON_ICON: Record<ButtonSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-4 w-4',
  lg: 'h-[18px] w-[18px]',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'sm', extra?: string, pill = false): string {
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], pill ? 'rounded-full' : 'rounded-control', extra)
}

interface ButtonExtras {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Icône à gauche du libellé */
  icon?: LucideIcon
  /** Icône à droite du libellé (flèche « suivant ») */
  iconRight?: LucideIcon
  /** Requête en cours : spinner à la place de l'icône, bouton désactivé */
  loading?: boolean
  pill?: boolean
  fullWidth?: boolean
}

function ButtonContent({ size, icon: Icon, iconRight: IconRight, loading, children }: ButtonExtras & { size: ButtonSize; children?: ReactNode }) {
  const iconClass = cx(BUTTON_ICON[size], 'shrink-0')
  return (
    <>
      {loading ? <Loader2 className={cx(iconClass, 'animate-spin')} /> : Icon ? <Icon className={iconClass} /> : null}
      {children}
      {IconRight && !loading && <IconRight className={iconClass} />}
    </>
  )
}

export function Button({
  variant = 'secondary', size = 'sm', icon, iconRight, loading = false, pill = false, fullWidth = false,
  disabled, type = 'button', className, children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonExtras) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, cx(fullWidth && 'w-full', className), pill)}
    >
      <ButtonContent size={size} icon={icon} iconRight={iconRight} loading={loading}>{children}</ButtonContent>
    </button>
  )
}

export function LinkButton({
  variant = 'secondary', size = 'sm', icon, iconRight, pill = false, fullWidth = false, className, href, prefetch, children, ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & Omit<ButtonExtras, 'loading'> & { href: string; prefetch?: boolean }) {
  return (
    <Link {...props} href={href} prefetch={prefetch} className={buttonClass(variant, size, cx(fullWidth && 'w-full', className), pill)}>
      <ButtonContent size={size} icon={icon} iconRight={iconRight}>{children}</ButtonContent>
    </Link>
  )
}

export type IconButtonVariant = 'ghost' | 'plain' | 'secondary' | 'soft' | 'danger-ghost' | 'inverted' | 'inverted-ghost'

const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost:            'text-fg-muted hover:bg-surface-sunken hover:text-fg',
  plain:            'text-fg-muted hover:text-brand',
  secondary:        'border border-border bg-surface text-fg-secondary hover:border-border-strong hover:bg-surface-sunken hover:text-fg',
  soft:             'bg-brand/10 text-brand hover:bg-brand/15',
  'danger-ghost':   'text-fg-muted hover:bg-danger-soft hover:text-danger',
  inverted:         'bg-surface text-brand hover:bg-surface/90',
  'inverted-ghost': 'text-white/80 hover:bg-white/10 hover:text-white',
}

const ICON_BUTTON_SIZE: Record<'xs' | 'sm' | 'md', [string, string]> = {
  xs: ['h-7 w-7', 'h-3.5 w-3.5'],
  sm: ['h-8 w-8', 'h-4 w-4'],
  md: ['h-9 w-9', 'h-[18px] w-[18px]'],
}

/** Bouton icône seule : le libellé accessible est obligatoire (aria-label + title). */
export function IconButton({
  icon: Icon, label, variant = 'ghost', size = 'sm', loading = false, pill = false, disabled, type = 'button', className, ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon
  label: string
  variant?: IconButtonVariant
  size?: 'xs' | 'sm' | 'md'
  loading?: boolean
  pill?: boolean
}) {
  const [box, icon] = ICON_BUTTON_SIZE[size]
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center transition-colors outline-none select-none',
        'focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-40',
        ICON_BUTTON_VARIANT[variant], box, pill ? 'rounded-full' : 'rounded-control', className
      )}
    >
      {loading ? <Loader2 className={cx(icon, 'animate-spin')} /> : <Icon className={icon} />}
    </button>
  )
}

// ─── Champs ──────────────────────────────────────────────────────────────────

/** Habillage commun des contrôles de saisie (sans hauteur) */
export const controlClass =
  'rounded-control border border-border bg-surface text-fg outline-none transition-colors placeholder:text-fg-faint ' +
  'hover:border-border-strong focus:border-brand focus:ring-[3px] focus:ring-brand/10 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-muted disabled:hover:border-border ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/10'

const CONTROL_HEIGHT = {
  sm: 'h-8 px-2.5 text-caption',
  md: 'h-9 px-3 text-body',
  lg: 'h-10 px-3 text-sm',
} as const

/** Champ compact des barres d'outils (h-8) */
export const inputClass  = cx(controlClass, CONTROL_HEIGHT.sm)
export const selectClass = cx(inputClass, 'appearance-none pr-7')

export function Label({ required, className, children, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label {...props} className={cx('text-label font-bold uppercase tracking-wide text-fg-secondary', className)}>
      {children}
      {required && <span aria-hidden className="ml-0.5 text-danger">*</span>}
    </label>
  )
}

export function Input({ controlSize = 'md', invalid, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { controlSize?: 'sm' | 'md' | 'lg'; invalid?: boolean }) {
  return <input {...props} aria-invalid={invalid || undefined} className={cx(controlClass, CONTROL_HEIGHT[controlSize], 'w-full', className)} />
}

/** Liste déroulante native habillée : chevron dessiné, même bordure et focus que les champs */
export function Select({ controlSize = 'sm', className, wrapperClassName, children, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { controlSize?: 'sm' | 'md'; wrapperClassName?: string }) {
  return (
    <span className={cx('relative inline-flex min-w-0', wrapperClassName)}>
      <select
        {...props}
        className={cx(controlClass, CONTROL_HEIGHT[controlSize], 'w-full appearance-none truncate', controlSize === 'sm' ? 'pr-7' : 'pr-9', className)}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-muted', controlSize === 'sm' ? 'right-2 h-3.5 w-3.5' : 'right-3 h-4 w-4')} />
    </span>
  )
}

export function Field({ label, htmlFor, required, hint, error, className, children }: {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} required={required}>{label}</Label>
      {children}
      {error
        ? <p role="alert" className="text-caption font-semibold text-danger">{error}</p>
        : hint ? <p className="text-caption text-fg-muted">{hint}</p> : null}
    </div>
  )
}

// ─── Puces de filtre (contrôle segmenté sur rail gris) ───────────────────────

export function ChipGroup({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('inline-flex items-center gap-2', className)}>
      {label && <span className="text-label font-bold uppercase tracking-wide text-fg-faint">{label}</span>}
      <div className="inline-flex items-center gap-0.5 rounded-control bg-surface-sunken p-0.5">
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
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2.5 text-caption font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        // Sélection en encre pleine : lisible d'un coup d'œil, sans concurrencer le rouge des actions
        active ? 'bg-fg text-white shadow-sm' : 'text-fg-secondary hover:bg-surface hover:text-fg',
        className
      )}
    >
      {children}
    </button>
  )
}

// ─── Pastille de lecture (compteur, étiquette, état) ─────────────────────────

export type TagTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'inverted'

const TAG_TONE: Record<TagTone, string> = {
  neutral:  'bg-surface-sunken text-fg-muted',
  brand:    'bg-brand/10 text-brand',
  success:  'bg-success-soft text-success',
  warning:  'bg-warning-soft text-warning',
  danger:   'bg-danger-soft text-danger',
  info:     'bg-info-soft text-info',
  inverted: 'bg-white/15 text-white',
}

const TAG_OUTLINE: Record<TagTone, string> = {
  neutral:  'border-border bg-surface text-fg-muted',
  brand:    'border-brand/30 bg-surface text-brand',
  success:  'border-success/30 bg-surface text-success',
  warning:  'border-warning/40 bg-surface text-warning',
  danger:   'border-danger/30 bg-surface text-danger',
  info:     'border-info/30 bg-surface text-info',
  inverted: 'border-white/40 bg-transparent text-white',
}

const TAG_DOT: Record<TagTone, string> = {
  neutral:  'bg-fg-faint',
  brand:    'bg-brand',
  success:  'bg-success',
  warning:  'bg-warning',
  danger:   'bg-danger',
  info:     'bg-info',
  inverted: 'bg-white',
}

export function Tag({
  tone = 'neutral', size = 'sm', icon: Icon, dot = false, outline = false, className, children, title,
}: {
  tone?: TagTone
  /** sm : étiquettes de ligne (11px) · md : pastilles de section (12px) */
  size?: 'sm' | 'md'
  icon?: LucideIcon
  /** Point de couleur avant le libellé : la couleur n'est jamais seule */
  dot?: boolean
  /** Fond blanc + bordure teintée, pour rester lisible sur un fond déjà coloré */
  outline?: boolean
  className?: string
  children: ReactNode
  title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold',
        size === 'sm' ? 'h-5 gap-1.5 px-2 text-label' : 'h-6 gap-1.5 px-2.5 text-caption',
        outline ? cx('border', TAG_OUTLINE[tone]) : TAG_TONE[tone],
        className
      )}
    >
      {dot && <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', TAG_DOT[tone])} aria-hidden />}
      {Icon && <Icon className={cx(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5', 'shrink-0')} />}
      {children}
    </span>
  )
}

// ─── Onglets ─────────────────────────────────────────────────────────────────

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
  icon?: LucideIcon
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
    <div role="tablist" className={cx('flex items-end gap-1 border-b border-border', className)}>
      {items.map((it) => {
        const active = it.value === value
        const Icon = it.icon
        return (
          <button
            key={it.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cx(
              '-mb-px inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-body font-semibold transition-colors outline-none focus-visible:bg-surface-sunken',
              active ? 'border-brand text-brand' : 'border-transparent text-fg-muted hover:border-border-strong hover:text-fg'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {it.label}
            {it.count != null && (
              <span
                className={cx(
                  'rounded-full px-1.5 text-2xs font-bold leading-[18px] tabular-nums',
                  active
                    ? it.tone === 'warn' ? 'bg-warning-soft text-warning' : 'bg-brand/10 text-brand'
                    : 'bg-surface-sunken text-fg-muted'
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

// ─── Notice : encadré d'information non bloquante ───────────────────────────

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral'

const NOTICE_TONE: Record<NoticeTone, string> = {
  info:    'border-info/20 bg-info-soft text-info',
  warning: 'border-warning-border bg-warning-soft text-warning',
  danger:  'border-danger/20 bg-danger-soft text-danger',
  success: 'border-success/20 bg-success-soft text-success',
  neutral: 'border-border bg-surface text-fg-secondary shadow-card',
}

const NOTICE_ICON: Record<NoticeTone, LucideIcon> = {
  info: Info, warning: AlertTriangle, danger: AlertCircle, success: CheckCircle2, neutral: Info,
}

export function Notice({ tone = 'info', icon, className, children, actions }: {
  tone?: NoticeTone
  icon?: LucideIcon
  className?: string
  children: ReactNode
  /** Boutons alignés à droite (confirmer, annuler) */
  actions?: ReactNode
}) {
  const Icon = icon ?? NOTICE_ICON[tone]
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex items-start gap-2 rounded-control border px-3 py-2.5 text-caption leading-relaxed', NOTICE_TONE[tone], className)}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  )
}

// ─── Tableaux ────────────────────────────────────────────────────────────────

export const tableWrapClass   = 'overflow-hidden rounded-card border border-border bg-surface shadow-card'
export const tableClass       = 'w-full text-body'
export const theadClass       = 'border-b border-border bg-surface-muted'
export const thClass          = 'px-3 py-2 text-left text-label font-bold uppercase tracking-wide text-fg-muted whitespace-nowrap'
export const tbodyClass       = 'divide-y divide-border-subtle'
export const trClass          = 'transition-colors hover:bg-surface-muted'
export const tdClass          = 'px-3 py-2 align-middle text-fg-secondary'
export const tableFooterClass = 'flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-muted px-3 py-2 text-caption text-fg-muted'
/** Colonne collée à droite (lien « Voir ») : ombre douce vers la gauche */
export const stickyColClass   = 'sticky right-0 shadow-[-8px_0_12px_-4px_rgba(18,22,33,0.06)]'

/** Numéro de page de la pagination */
export function pageButtonClass(active: boolean): string {
  return cx(
    'inline-flex h-7 min-w-7 items-center justify-center rounded-control px-2 text-caption font-semibold tabular-nums transition-colors',
    active ? 'bg-brand text-brand-foreground' : 'text-fg-secondary hover:bg-surface-sunken hover:text-fg'
  )
}

// ─── État vide : dit ce qui manque ET quoi faire ─────────────────────────────

export function EmptyState({
  icon: Icon, title, description, action, compact = false, className, children,
}: {
  icon?: LucideIcon
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Version resserrée pour l'intérieur d'une carte ou d'un tableau */
  compact?: boolean
  className?: string
  /** Forme courte : le contenu sert de titre */
  children?: ReactNode
}) {
  const heading = title ?? children
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'gap-1.5 px-4 py-6' : 'gap-3 px-6 py-12', className)}>
      {Icon && (
        <span className={cx('flex items-center justify-center rounded-full bg-surface-sunken text-fg-faint', compact ? 'h-8 w-8' : 'h-12 w-12')}>
          <Icon className={compact ? 'h-4 w-4' : 'h-6 w-6'} />
        </span>
      )}
      <div className="flex flex-col gap-1">
        {heading && <p className={cx('font-semibold text-fg-secondary', compact ? 'text-body' : 'text-sm')}>{heading}</p>}
        {description && <p className="max-w-xs text-caption leading-relaxed text-fg-muted">{description}</p>}
      </div>
      {action && <div className={compact ? 'mt-1' : 'mt-2'}>{action}</div>}
    </div>
  )
}

import BackButton from '@/components/BackButton'
import { DAEStatusBadge } from '@/components/table/StatusBadge'
import { LOCATION_TYPES, MAINTENANCE_TYPES } from '@/lib/contract-groups'
import { Card, PageContainer, PageHeader, Tag, tableClass, tbodyClass, tdClass, thClass, theadClass, type TagTone } from '@/components/ui/primitives'

const STATUS_RULES = [
  {
    status: 'conforme',
    description: 'Toutes les échéances sont à jour et à plus de 30 jours.',
    conditions: [
      'Date de prochaine maintenance > aujourd\'hui + 30 jours (ou non renseignée)',
      'Date d\'expiration batterie > aujourd\'hui + 30 jours (ou non renseignée)',
      'Date d\'expiration électrodes (adultes et/ou pédiatriques) > aujourd\'hui + 30 jours (ou non renseignée)',
    ],
  },
  {
    status: 'vigilance',
    description: 'Au moins une échéance arrive dans moins de 30 jours, sans être dépassée.',
    conditions: [
      'Date de prochaine maintenance ≤ aujourd\'hui + 30 jours',
      'Date d\'expiration batterie ≤ aujourd\'hui + 30 jours',
      'Date d\'expiration électrodes (adultes ou pédiatriques) ≤ aujourd\'hui + 30 jours',
    ],
  },
  {
    status: 'critique',
    description: 'Au moins une échéance est dépassée. Le DAE est hors conformité.',
    conditions: [
      'Date de prochaine maintenance < aujourd\'hui : « Maintenance échue »',
      'Date d\'expiration batterie < aujourd\'hui : « Batterie expirée »',
      'Date d\'expiration électrodes (adultes ou pédiatriques) < aujourd\'hui : « Électrodes expirées »',
    ],
  },
  {
    status: 'inconnu',
    description: 'Aucune donnée disponible pour calculer le statut.',
    conditions: [
      'Aucune date de maintenance renseignée dans Synchroteam',
      'Aucune date d\'expiration batterie renseignée',
      'Aucune date d\'expiration électrodes renseignée',
    ],
  },
]

const CONSUMABLE_RULES: Array<{ label: string; tone: TagTone; rule: string }> = [
  { label: 'OK',          tone: 'success', rule: 'Date d\'expiration > aujourd\'hui + 30 jours' },
  { label: 'À remplacer', tone: 'warning', rule: 'Date d\'expiration ≤ aujourd\'hui + 30 jours, sans être dépassée' },
  { label: 'Expirée',     tone: 'danger',  rule: 'Date d\'expiration < aujourd\'hui' },
  { label: 'Inconnu',     tone: 'neutral', rule: 'Date d\'expiration non renseignée dans Synchroteam' },
]

const ELECTRODES_RULES = [
  { label: 'DLU pédiatrique renseignée', rule: 'Utilise la date pédiatrique telle quelle' },
  { label: 'DLU pédiatrique vide',       rule: 'Utilise la même date que les électrodes adultes' },
  { label: 'Cardiac Science',            rule: 'Pas d\'électrodes pédiatriques séparées (mode intégré), ignorées' },
]

// Les groupes Location et Maintenance lisent les mêmes listes que les filtres :
// impossible que la documentation et le comportement divergent.
const CONTRACT_GROUPS = [
  { label: 'Location',    values: LOCATION_TYPES,    note: null },
  { label: 'Maintenance', values: MAINTENANCE_TYPES, note: null },
  { label: 'Autres',      values: ['PDC - Passage Annuel', 'Audit simple', 'Contrat d\'audit', 'Aucun'], note: 'Tout type qui n\'est ni Location ni Maintenance, ainsi que les DAE sans type de contrat. Exemples ci-dessous.' },
]

const BATTERY_RULES = [
  { brand: 'Saver One', years: 4 },
  { brand: 'Stryker / HeartSine / Samaritan / LifePak', years: 4 },
  { brand: 'Mindray', years: 5 },
  { brand: 'ZOLL', years: 5 },
  { brand: 'Cardiac Science / PowerHeart', years: 4 },
  { brand: 'Colson / CU Medical / iPAD', years: 4 },
  { brand: 'Philips HeartStart FR3', years: 3 },
  { brand: 'Philips HeartStart FR2 / Laerdal', years: 4 },
  { brand: 'Autres', years: 5 },
]

function SectionHeading({ children, description }: { children: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-label font-bold uppercase tracking-wide text-fg-muted">{children}</h2>
      {description && <p className="mt-1 text-body text-fg-muted">{description}</p>}
    </div>
  )
}

function RuleTable({ head, rows }: { head: [string, string]; rows: Array<[React.ReactNode, React.ReactNode]> }) {
  return (
    <Card padded={false}>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th className={thClass}>{head[0]}</th>
            <th className={thClass}>{head[1]}</th>
          </tr>
        </thead>
        <tbody className={tbodyClass}>
          {rows.map(([a, b], i) => (
            <tr key={i}>
              <td className={`${tdClass} whitespace-nowrap`}>{a}</td>
              <td className={`${tdClass} text-fg-secondary`}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

export default function ReglesPage() {
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader
        eyebrow={<BackButton label="Retour" />}
        title="Règles du dashboard"
        subtitle="Logique de calcul des statuts et des indicateurs appliquée à chaque DAE du parc STAR aid."
      />

      <div className="space-y-8">
        {/* ── Statuts DAE ───────────────────────────────────────────────────── */}
        <section>
          <SectionHeading description="Le statut est recalculé à chaque synchronisation Synchroteam. La règle la plus sévère l'emporte : critique, puis vigilance, puis conforme, puis inconnu.">
            Statuts DAE
          </SectionHeading>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {STATUS_RULES.map((s) => (
              <Card key={s.status}>
                <div className="mb-2"><DAEStatusBadge status={s.status} /></div>
                <p className="text-body text-fg">{s.description}</p>
                <ul className="mt-2 space-y-1">
                  {s.conditions.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-caption text-fg-muted">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
                      {c}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Consommables ──────────────────────────────────────────────────── */}
        <section>
          <SectionHeading>Statuts consommables, batterie et électrodes</SectionHeading>
          <RuleTable
            head={['Statut', 'Condition']}
            rows={CONSUMABLE_RULES.map((r) => [
              <Tag key={r.label} tone={r.tone} dot>{r.label}</Tag>,
              r.rule,
            ])}
          />
        </section>

        {/* ── Groupes de contrats ───────────────────────────────────────────── */}
        <section>
          <SectionHeading description="Les puces Location, Maintenance et Autres de la barre de filtres regroupent les types de contrat Synchroteam suivants. Plusieurs groupes peuvent être sélectionnés en même temps.">
            Groupes de contrats (filtres)
          </SectionHeading>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {CONTRACT_GROUPS.map((g) => (
              <Card key={g.label} title={g.label}>
                {g.note && <p className="mb-2 text-caption text-fg-muted">{g.note}</p>}
                <ul className="space-y-1">
                  {g.values.map((v) => (
                    <li key={v} className="flex items-start gap-2 text-caption text-fg-secondary">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-border-strong" aria-hidden />
                      {v}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Électrodes pédiatriques ───────────────────────────────────────── */}
        <section>
          <SectionHeading>Règle électrodes pédiatriques</SectionHeading>
          <RuleTable
            head={['Cas', 'Règle appliquée']}
            rows={ELECTRODES_RULES.map((r) => [<span key={r.label} className="font-medium text-fg">{r.label}</span>, r.rule])}
          />
        </section>

        {/* ── Batterie par marque ───────────────────────────────────────────── */}
        <section>
          <SectionHeading description="La date d'expiration batterie est calculée depuis la date de mise en place de la batterie (champ Synchroteam). Source : tableau officiel STAR aid, juin 2026.">
            Durée de vie batterie par marque
          </SectionHeading>
          <RuleTable
            head={['Marque / modèle', 'Durée de vie']}
            rows={BATTERY_RULES.map((r) => [<span key={r.brand} className="text-fg">{r.brand}</span>, <span key={`${r.brand}-y`} className="font-semibold text-fg tabular-nums">{r.years} ans</span>])}
          />
        </section>
      </div>
    </PageContainer>
  )
}

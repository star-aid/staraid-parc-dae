import BackButton from '@/components/BackButton'

const STATUS_RULES = [
  {
    status: 'conforme',
    label: 'Conforme',
    color: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    description: 'Toutes les échéances sont à jour et à plus de 30 jours.',
    conditions: [
      'Date de prochaine maintenance > aujourd\'hui + 30 jours (ou non renseignée)',
      'Date d\'expiration batterie > aujourd\'hui + 30 jours (ou non renseignée)',
      'Date d\'expiration électrodes (adultes et/ou pédiatriques) > aujourd\'hui + 30 jours (ou non renseignée)',
    ],
  },
  {
    status: 'vigilance',
    label: 'Vigilance',
    color: 'bg-amber-100 text-amber-700 ring-amber-200',
    dot: 'bg-amber-500',
    description: 'Au moins une échéance arrive dans moins de 30 jours, mais n\'est pas encore dépassée.',
    conditions: [
      'Date de prochaine maintenance ≤ aujourd\'hui + 30 jours',
      'Date d\'expiration batterie ≤ aujourd\'hui + 30 jours',
      'Date d\'expiration électrodes (adultes ou pédiatriques) ≤ aujourd\'hui + 30 jours',
    ],
  },
  {
    status: 'critique',
    label: 'Critique',
    color: 'bg-red-100 text-red-700 ring-red-200',
    dot: 'bg-red-500',
    description: 'Au moins une échéance est dépassée. Le DAE est hors conformité.',
    conditions: [
      'Date de prochaine maintenance < aujourd\'hui → "Maintenance échue"',
      'Date d\'expiration batterie < aujourd\'hui → "Batterie expirée"',
      'Date d\'expiration électrodes (adultes ou pédiatriques) < aujourd\'hui → "Électrodes expirées"',
    ],
  },
  {
    status: 'inconnu',
    label: 'Inconnu',
    color: 'bg-slate-100 text-slate-500 ring-slate-200',
    dot: 'bg-slate-400',
    description: 'Aucune donnée disponible pour calculer le statut.',
    conditions: [
      'Aucune date de maintenance renseignée dans Synchroteam',
      'Aucune date d\'expiration batterie renseignée',
      'Aucune date d\'expiration électrodes renseignée',
    ],
  },
]

const CONSUMABLE_RULES = [
  { label: 'OK', color: 'text-emerald-600 bg-emerald-50', rule: 'Date d\'expiration > aujourd\'hui + 30 jours' },
  { label: 'À remplacer', color: 'text-amber-600 bg-amber-50', rule: 'Date d\'expiration ≤ aujourd\'hui + 30 jours (mais pas encore dépassée)' },
  { label: 'Expiré', color: 'text-red-600 bg-red-50', rule: 'Date d\'expiration < aujourd\'hui' },
  { label: 'Inconnu', color: 'text-slate-500 bg-slate-50', rule: 'Date d\'expiration non renseignée dans Synchroteam' },
]

const ELECTRODES_RULES = [
  { label: 'DLU pédiatrique renseignée', rule: 'Utilise la date pédiatrique telle quelle' },
  { label: 'DLU pédiatrique vide', rule: 'Utilise la même date que les électrodes adultes' },
  { label: 'Cardiac Science', rule: 'Pas d\'électrodes pédiatriques séparées (mode intégré) — ignorées' },
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

export default function ReglesPage() {
  return (
    <div className="p-6 lg:p-8 max-w-screen-lg mx-auto space-y-10">

      <div>
        <div className="mb-4">
          <BackButton label="Retour" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Règles du dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Logique de calcul des statuts et des indicateurs appliquée à chaque DAE du parc STAR aid.
        </p>
      </div>

      {/* ── Statuts DAE ──────────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Statuts DAE</h2>
        <p className="text-sm text-slate-500 mb-6">
          Le statut est calculé automatiquement à chaque synchronisation Synchroteam.
          La règle la plus sévère l&apos;emporte (critique &gt; vigilance &gt; conforme &gt; inconnu).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STATUS_RULES.map((s) => (
            <div key={s.status} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${s.color}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </div>
              <p className="text-sm text-slate-700 mb-3">{s.description}</p>
              <ul className="space-y-1.5">
                {s.conditions.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
                    <span className="mt-0.5 shrink-0 text-slate-300">→</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Statuts consommables ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Statuts consommables (batterie &amp; électrodes)</h2>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Condition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {CONSUMABLE_RULES.map((r) => (
                <tr key={r.label}>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${r.color}`}>{r.label}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-slate-600">{r.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Règle électrodes pédiatriques ────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Règle électrodes pédiatriques</h2>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cas</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Règle appliquée</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {ELECTRODES_RULES.map((r) => (
                <tr key={r.label}>
                  <td className="px-5 py-3 text-sm font-medium text-slate-700">{r.label}</td>
                  <td className="px-5 py-3 text-sm text-slate-600">{r.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Durée de vie batterie par marque ─────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Durée de vie batterie par marque</h2>
        <p className="text-sm text-slate-500 mb-4">
          La date d&apos;expiration batterie est calculée depuis la date de mise en place de la batterie (champ Synchroteam).
          Source : tableau officiel STAR aid — juin 2026.
        </p>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Marque / Modèle</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Durée de vie batterie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {BATTERY_RULES.map((r) => (
                <tr key={r.brand}>
                  <td className="px-5 py-3 text-sm text-slate-700">{r.brand}</td>
                  <td className="px-5 py-3">
                    <span className="text-sm font-semibold text-slate-800">{r.years} ans</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  )
}

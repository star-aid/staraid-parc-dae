// Lecture complète d'une requête Supabase malgré le plafond de 1 000 lignes par
// réponse (max_rows du projet), en minimisant les allers-retours : chaque
// aller-retour coûte 250 à 400 ms depuis les territoires, donc les pages partent
// en parallèle au lieu d'être enchaînées.
//
// Usage : fetchAllRows('libellé', (from, to, withCount) => supabase.from(...).select(cols, withCount ? { count: 'exact' } : undefined)....range(from, to), { expectedPages: 2 })
//   - la première page demande le total exact ;
//   - `expectedPages` pages sont demandées d'emblée en parallèle (estimation) ;
//   - les pages restantes, s'il y en a, partent ensuite en parallèle.
// Fichier serveur uniquement.

/** Taille maximale d'une réponse PostgREST sur ce projet */
export const SUPABASE_PAGE = 1000

export type PageQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count: number | null }>

export async function fetchAllRows<T>(
  label: string,
  build: (from: number, to: number, withCount: boolean) => PageQuery,
  opts: { expectedPages?: number; pageSize?: number } = {}
): Promise<T[]> {
  const size = opts.pageSize ?? SUPABASE_PAGE
  const expected = Math.max(1, opts.expectedPages ?? 1)
  const page = (i: number, withCount: boolean) => build(i * size, (i + 1) * size - 1, withCount)

  // Première vague : la page 0 avec le total, plus les pages attendues
  const first = await Promise.all(Array.from({ length: expected }, (_, i) => page(i, i === 0)))
  const rows: T[] = []
  let total = 0
  first.forEach((r, i) => {
    if (r.error) throw new Error(`${label} : ${r.error.message}`)
    const data = (r.data ?? []) as T[]
    if (i === 0) total = r.count ?? data.length
    if (i * size < total) rows.push(...data)
  })

  // Seconde vague, seulement si le total dépasse les pages déjà lues
  const pages = Math.ceil(total / size)
  if (pages > expected) {
    const rest = await Promise.all(Array.from({ length: pages - expected }, (_, i) => page(expected + i, false)))
    for (const r of rest) {
      if (r.error) throw new Error(`${label} : ${r.error.message}`)
      rows.push(...((r.data ?? []) as T[]))
    }
  }
  return rows
}

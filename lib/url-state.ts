'use client'
// État d'interface ↔ paramètres de l'URL. Onglet ouvert, filtres et page
// courante sont recopiés dans l'adresse (réécrite, jamais empilée dans
// l'historique) : le bouton Retour du navigateur ramène exactement à l'état
// quitté, un rafraîchissement le conserve, et un lien copié le transporte.
// Les valeurs par défaut sont omises pour garder des adresses courtes.
//
// L'adresse est réécrite avec `history.replaceState`, que le routeur de Next
// (14.1 et plus) synchronise avec `useSearchParams` : aucun aller-retour vers
// le serveur, contrairement à `router.replace`, qui rechargerait la page.
import { useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

export type UrlPatch = Record<string, string | number | null | undefined>

export function useUrlState() {
  const sp = useSearchParams()

  const get = useCallback((key: string): string | null => sp.get(key), [sp])

  /**
   * Fusionne `patch` dans les paramètres courants (null, undefined ou chaîne
   * vide = retrait) et réécrit l'adresse sans entrée d'historique ni requête.
   * Part de `window.location` et non de l'instantané React : deux appels
   * successifs dans le même gestionnaire se composent.
   */
  const set = useCallback((patch: UrlPatch) => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined || v === '') params.delete(k)
      else params.set(k, String(v))
    }
    const query = params.toString()
    window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
  }, [])

  return { get, set }
}

/** Lit un paramètre parmi une liste de valeurs admises, sinon la valeur par défaut */
export function pickParam<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** Numéro de page lu dans l'URL (≥ 1) */
export function pageParam(value: string | null): number {
  const n = parseInt(value ?? '1', 10)
  return Number.isFinite(n) && n > 1 ? n : 1
}

// Session utilisateur sans aller-retour réseau.
//
// Jusqu'ici, le middleware, le layout, certaines pages et les routes API
// appelaient supabase.auth.getUser() : un appel HTTP vers Supabase Auth
// (250 à 400 ms depuis La Réunion) à chaque navigation et à chaque appel API.
// Ici, le jeton d'accès lu dans les cookies est vérifié localement (signature,
// expiration, émetteur), ce qui prend moins d'une milliseconde :
//   1. avec les clés publiques du projet (JWKS, ES256), mises en cache par jose ;
//   2. avec le secret partagé SUPABASE_JWT_SECRET si le projet signe encore en HS256 ;
//   3. à défaut (jeton expiré, clé inconnue), repli sur getUser(), qui rafraîchit
//      aussi la session. La sécurité ne repose donc jamais sur un jeton non vérifié.
// Fichier serveur, compatible Node et Edge (middleware).

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/lib/supabase'

export interface SessionUser {
  id: string
  email: string | null
  role: UserRole
  name: string | null
  /** 'local' : jeton vérifié sans réseau ; 'network' : confirmé par Supabase Auth */
  source: 'local' | 'network'
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const ISSUER = `${SUPABASE_URL}/auth/v1`
/** Marge avant expiration en deçà de laquelle on laisse Supabase rafraîchir le jeton */
const EXPIRY_MARGIN_MS = 30_000

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
function remoteJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60_000,
      cooldownDuration: 60_000,
    })
  }
  return jwks
}

type SupabaseClaims = JWTPayload & {
  email?: string
  user_metadata?: { role?: string; name?: string } | null
}

/** Vérifie localement un jeton d'accès Supabase ; null s'il est invalide ou non vérifiable ici. */
export async function verifyAccessToken(token: string): Promise<SupabaseClaims | null> {
  if (!SUPABASE_URL) return null
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  } catch {
    return null
  }
  try {
    if (alg === 'HS256') {
      const secret = process.env.SUPABASE_JWT_SECRET
      if (!secret) return null
      return (await jwtVerify(token, new TextEncoder().encode(secret), { issuer: ISSUER })).payload as SupabaseClaims
    }
    return (await jwtVerify(token, remoteJwks(), { issuer: ISSUER })).payload as SupabaseClaims
  } catch {
    return null
  }
}

function toSessionUser(claims: { sub?: string; email?: string | null; user_metadata?: SupabaseClaims['user_metadata'] }, source: SessionUser['source']): SessionUser | null {
  if (!claims.sub) return null
  const meta = claims.user_metadata ?? {}
  return {
    id: claims.sub,
    email: claims.email ?? null,
    role: (meta.role ?? 'direction') as UserRole,
    name: meta.name ?? null,
    source,
  }
}

/**
 * Utilisateur de la session courante, à partir d'un client Supabase branché sur
 * les cookies de la requête. Vérification locale d'abord, Supabase Auth en repli.
 */
export async function getSessionUser(supabase: SupabaseClient): Promise<SessionUser | null> {
  // getSession() lit les cookies sans réseau tant que le jeton n'est pas expiré ;
  // seuls access_token et expires_at sont lus (pas session.user, non vérifié).
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (token && (session?.expires_at ?? 0) * 1000 > Date.now() + EXPIRY_MARGIN_MS) {
    const claims = await verifyAccessToken(token)
    if (claims) {
      const user = toSessionUser(claims, 'local')
      if (user) return user
    }
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return toSessionUser({ sub: user.id, email: user.email, user_metadata: user.user_metadata as SupabaseClaims['user_metadata'] }, 'network')
}

'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { Suspense } from 'react'
import { buttonClass, cx, inputClass } from '@/components/ui/primitives'

const DOMAIN = '@parc-dae.local'

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = searchParams.get('redirect') ?? '/dashboard'

  const [identifiant, setIdentifiant] = useState('')
  const [password,    setPassword]    = useState('')
  const [error,       setError]       = useState<string | null>(null)
  const [loading,     setLoading]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // L'utilisateur saisit "admin", on envoie "admin@parc-dae.local"
    const email = identifiant.trim().toLowerCase() + DOMAIN

    const supabase = getSupabaseBrowserClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Identifiant ou mot de passe incorrect.')
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      {/* Halo discret aux couleurs de la marque */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,_rgba(175,33,37,0.28),_transparent_65%)]"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-5 overflow-hidden rounded-lg ring-1 ring-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Logo STAR aid.png" alt="STAR aid" className="h-20 w-full object-cover" />
        </div>

        <div className="rounded-xl bg-white p-6 shadow-pop">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Connexion</h1>
          <p className="mt-0.5 text-13 text-slate-500">Espace réservé aux équipes STAR aid</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="identifiant" className="mb-1.5 block text-xs font-medium text-slate-700">
                Identifiant
              </label>
              <input
                id="identifiant"
                type="text"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                required
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                placeholder="ex : admin"
                className={cx(inputClass, 'h-9 w-full')}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-slate-700">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={cx(inputClass, 'h-9 w-full')}
              />
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !identifiant.trim()}
              className={buttonClass('primary', 'md', 'h-9 w-full')}
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-2xs text-slate-500">
          STAR aid · Saint-Denis, La Réunion · Suivi du parc DAE
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

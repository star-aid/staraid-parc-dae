'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { Suspense } from 'react'

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = searchParams.get('redirect') ?? '/dashboard'

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabaseBrowserClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Identifiants incorrects. Vérifiez votre email et mot de passe.')
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/Logo STAR aid.png" alt="STAR aid" className="h-24 w-auto object-contain mb-4" />
          <p className="text-sm text-slate-400 tracking-wide uppercase">Parc DAE · Espace sécurisé</p>
        </div>

        {/* Carte */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <h1 className="text-xl font-bold text-slate-800 mb-1">Connexion</h1>
          <p className="text-sm text-slate-500 mb-6">Accès réservé aux équipes STAR aid</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Adresse email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="prenom.nom@star-aid.fr"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AF2125] focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Mot de passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AF2125] focus:border-transparent"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-red-500 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#AF2125] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#961d21] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          STAR aid · Saint-Denis, La Réunion
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

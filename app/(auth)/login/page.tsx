'use client'
// Page de connexion : carte centrée sur le fond clair du produit, logo rouge
// au-dessus, la seule touche de marque. Le bouton plein rouge est l'unique
// action primaire de l'écran.
import { Suspense, useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase'
import { Button, Field, IconButton, Input, Notice } from '@/components/ui/primitives'

const DOMAIN = '@parc-dae.local'

function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = searchParams.get('redirect') ?? '/dashboard'
  const idId  = useId()
  const pwdId = useId()

  const [identifiant, setIdentifiant] = useState('')
  const [password,    setPassword]    = useState('')
  const [showPwd,     setShowPwd]     = useState(false)
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-star-aid-red.avif" alt="STAR aid" className="h-12 w-auto" />
        </div>

        <div className="rounded-panel border border-border bg-surface p-7 shadow-panel">
          <h1 className="text-lg font-bold tracking-tight text-fg">Connexion</h1>
          <p className="mt-1 text-body text-fg-muted">Identifiez-vous pour accéder au suivi du parc DAE.</p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <Field label="Identifiant" htmlFor={idId} required>
              <Input
                id={idId}
                controlSize="lg"
                type="text"
                value={identifiant}
                onChange={(e) => setIdentifiant(e.target.value)}
                required
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
                placeholder="ex : admin"
              />
            </Field>

            <Field label="Mot de passe" htmlFor={pwdId} required>
              <div className="relative">
                <Input
                  id={pwdId}
                  controlSize="lg"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <IconButton
                  icon={showPwd ? EyeOff : Eye}
                  label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  variant="plain"
                  size="sm"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                />
              </div>
            </Field>

            {error && <Notice tone="danger">{error}</Notice>}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              iconRight={ArrowRight}
              loading={loading}
              disabled={!identifiant.trim()}
              className="mt-1"
            >
              Se connecter
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-caption text-fg-faint">
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

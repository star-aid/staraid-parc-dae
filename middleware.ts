import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { UserRole } from '@/lib/supabase'

// Routes accessibles par rôle (préfixes)
const ROUTE_ACCESS: Record<string, UserRole[]> = {
  '/alertes':       ['administrateur', 'maintenance'],
  '/analyse':       ['administrateur'],
  '/admin':         ['administrateur'],
}

function canAccess(pathname: string, role: UserRole): boolean {
  for (const [prefix, roles] of Object.entries(ROUTE_ACCESS)) {
    if (pathname.startsWith(prefix)) return roles.includes(role)
  }
  return true // /dashboard, /parc, /parc/[id] → tous les rôles
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Ne protéger que les routes dashboard
  if (!pathname.startsWith('/dashboard') &&
      !pathname.startsWith('/parc') &&
      !pathname.startsWith('/alertes') &&
      !pathname.startsWith('/analyse') &&
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/regles')) {
    return NextResponse.next()
  }

  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Pas de session → login
  if (!user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  const role = (user.user_metadata?.role ?? 'direction') as UserRole

  // Vérification des droits par route
  if (!canAccess(pathname, role)) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/parc/:path*',
    '/alertes/:path*',
    '/analyse/:path*',
    '/admin/:path*',
    '/regles/:path*',
  ],
}

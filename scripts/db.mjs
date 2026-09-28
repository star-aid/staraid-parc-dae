#!/usr/bin/env node
// Migrations Supabase depuis le poste de travail (équivalent « prisma migrate deploy »).
//
// Charge SUPABASE_DB_URL depuis .env puis .env.local (sans écraser une variable
// déjà présente dans l'environnement) et délègue au CLI Supabase avec --db-url.
// La chaîne de connexion ne transite jamais par un shell : le CLI est lancé via
// le script npx de Node, ce qui évite les problèmes de caractères spéciaux (%, !).
//
// Usage :
//   npm run db:status                       état des migrations (locales / appliquées)
//   npm run db:push -- --dry-run            migrations qui seraient appliquées, sans rien exécuter
//   npm run db:push                         applique les migrations en attente
//   npm run db:baseline -- 20260622000001 … marque des versions comme déjà appliquées (sans les exécuter)
//
// SUPABASE_DB_URL : « Session pooler » du projet (port 5432). Les caractères
// spéciaux du mot de passe doivent être encodés (# → %23, @ → %40, ! → %21)
// et la valeur mise entre guillemets dans le fichier .env.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const CLI_PACKAGE = 'supabase@2'

/** Charge un fichier .env minimal : KEY=VALUE, guillemets optionnels, lignes # ignorées. */
function loadEnvFile(file) {
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    const quoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value)
    if (quoted) value = quoted[1]
    else value = value.replace(/\s+#.*$/, '') // commentaire de fin de ligne (valeur non quotée)
    process.env[key] = value
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL manquante : ajoutez la chaîne « Session pooler » du projet dans .env (voir .env.local.example).')
  process.exit(1)
}
try {
  new URL(url)
} catch {
  console.error('SUPABASE_DB_URL invalide : encodez les caractères spéciaux du mot de passe (# → %23, @ → %40) et mettez la valeur entre guillemets.')
  process.exit(1)
}

const COMMANDS = {
  status:   ['migration', 'list'],
  push:     ['db', 'push'],
  baseline: ['migration', 'repair', '--status', 'applied'],
}

const [command, ...extra] = process.argv.slice(2)
if (!COMMANDS[command]) {
  console.error(`Commande inconnue « ${command ?? ''} ». Attendu : ${Object.keys(COMMANDS).join(', ')}.`)
  process.exit(1)
}
if (command === 'baseline' && extra.length === 0) {
  console.error('db:baseline : indiquez les versions à marquer comme appliquées, ex. 20260622000001 20260622000002.')
  process.exit(1)
}

const cliArgs = ['--yes', CLI_PACKAGE, ...COMMANDS[command], ...extra, '--db-url', url]

// Lancement de npx sans shell : script npx-cli.js livré avec Node (Windows et installation
// système), sinon repli sur la commande npx via le shell.
const nodeDir = path.dirname(process.execPath)
const npxCli = [
  path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
].find((f) => existsSync(f))

const result = npxCli
  ? spawnSync(process.execPath, [npxCli, ...cliArgs], { stdio: 'inherit' })
  : spawnSync('npx', cliArgs, { stdio: 'inherit', shell: true })

if (result.error) {
  console.error(`Impossible de lancer le CLI Supabase : ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)

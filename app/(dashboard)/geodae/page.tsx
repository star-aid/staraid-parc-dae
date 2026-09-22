export const dynamic = 'force-dynamic'

import GeodaeClient from './GeodaeClient'

// Contrôle de cohérence Synchroteam ↔ Géo'DAE.
// L'extraction interroge Synchroteam en direct : elle est déclenchée à la
// demande depuis le composant client, pas au rendu de la page.
export default function GeodaePage() {
  return <GeodaeClient />
}

# Contrôle Géo'DAE : ce qui a été fait, comment l'étendre à Mayotte et Guadeloupe

Dernière mise à jour : 28 septembre 2026. Ce document est le fil conducteur du chantier
Synchroteam ↔ Géo'DAE. Il liste ce qui existe, où ça se trouve, et la marche à suivre
pour activer un nouveau compte Synchroteam (Mayotte, Guadeloupe).

## 1. Cahier des charges et état

| Point | Contenu | État |
|---|---|---|
| 1 | Extraire les DAE actifs sous contrat de location avec identifiant Synchroteam, n° de série et identifiant Géo'DAE | Fait (menu **Contrôle Géo'DAE**) |
| 2 | Pour chaque DAE sans identifiant : interroger Géo'DAE par n° de série ; trouvé → mettre à jour Synchroteam ; introuvable → journaliser | Fait : recherche automatique quotidienne (cron), report validé par un utilisateur |
| 3 | Réconciliation sur le n° de série et rapport d'anomalies : identifiant divergent, DAE Synchroteam absent de Géo'DAE, DAE Géo'DAE non référencé ou inactif dans Synchroteam | Fait : rapprochement quotidien par le cron (et à la demande), rapport filtrable, export CSV, clôture manuelle, badge dans le menu |

Décisions prises :

- **Report vers Synchroteam validé par un utilisateur**, ligne par ligne ou en lot pour les
  correspondances uniques. C'est la seule écriture de l'application vers Synchroteam
  (exception notée dans `CLAUDE.md`).
- **La page lit la copie Supabase** (synchronisation quotidienne), pas Synchroteam en direct.
  Un bouton « Actualiser depuis Synchroteam » relance la synchronisation à la demande.

## 2. Où est le code

| Rôle | Fichier |
|---|---|
| Page et interface | `app/(dashboard)/geodae/page.tsx`, `app/(dashboard)/geodae/GeodaeClient.tsx` |
| Lecture de la copie Supabase (source par défaut) | `lib/geodae/extract-supabase.ts` |
| Lecture directe Synchroteam (diagnostics, `?source=synchroteam`) | `lib/geodae/extract-synchroteam.ts` |
| Recherche d'identifiant par n° de série (open data + API exploitants) | `lib/geodae/client.ts` |
| Report dans Synchroteam avec garde-fous | `lib/geodae/writeback.ts`, méthode `sendEquipment` de `lib/synchroteam.ts` |
| Journal : exécutions, anomalies, reports | `lib/geodae/journal.ts` |
| Résultats de recherche conservés par DAE | `lib/geodae/lookups.ts` |
| Contrôle automatique (moteur du cron) | `lib/geodae/cron.ts`, route `app/api/geodae/cron`, planification `vercel.json` |
| Réconciliation et rapport d'anomalies (point 3) | `lib/geodae/reconcile.ts`, inventaire Géo'DAE dans `lib/geodae/client.ts`, route `app/api/geodae/anomalies` (liste, CSV, clôture manuelle) |
| Badge « anomalies ouvertes » du menu | `app/(dashboard)/layout.tsx` (comptage), `components/dashboard/Sidebar.tsx` |
| Types partagés, URL du portail, CSV | `lib/geodae/types.ts` |
| Autorisation des routes (administrateur, maintenance) | `lib/geodae/route-auth.ts` |
| Mapping des champs personnalisés (table `custom_field_mapping`) | `lib/geodae/mappings.ts` |
| Routes API | `app/api/geodae/extract`, `lookup`, `journal`, `writeback` |
| Accès au menu | `middleware.ts` (`/geodae`, rôles administrateur et maintenance), `components/dashboard/Sidebar.tsx` |
| Script de simulation du report (aucune écriture) | `scripts/geodae-writeback-dryrun.mts`, `npm run geodae:dryrun -- REU` |

## 3. Base de données

| Migration | Contenu |
|---|---|
| `20260922000009_geodae_reconciliation.sql` | `geodae_reconciliation_runs` (recherches groupées), `geodae_anomalies` (une ligne par DAE et par type, rouverte ou clôturée) |
| `20260928000010_geodae_grants.sql` | Droits du rôle service sur ces tables |
| `20260928000011_geodae_writebacks.sql` | `geodae_writebacks` : trace de chaque report (qui, quand, valeur précédente, résultat) |
| `20260928000012_geodae_lookups.sql` | `geodae_lookups` : dernier résultat de recherche par DAE (statut, candidats, date et auteur du contrôle, date de report) |

Colonne utilisée dans la table existante `defibrillators` : `geo_dae_id` (migration 005).
Un report réussi la met à jour aussitôt, sans attendre la synchronisation.

Application des migrations depuis le poste : `npm run db:status`, `npm run db:push`
(voir `supabase/README.md`). Toute nouvelle table doit accorder explicitement ses droits
au rôle service : les privilèges par défaut du projet n'en donnent aucun.

## 4. Flux de bout en bout

1. **Synchronisation quotidienne** (cron Vercel 06:00 UTC, `vercel.json`) : Synchroteam → `defibrillators`.
   Le type de contrat vient du contrat Synchroteam, sinon du champ personnalisé.
2. **Ouverture de la page** : lecture immédiate de la copie ; DAE actifs dont le type de contrat
   est reconnu comme « location » (`LOCATION_TYPES` dans `lib/contract-groups.ts`).
3. **Recherche** (bouton par ligne ou « Rechercher les manquants ») : n° de série →
   open data data.gouv.fr (nom du DAE contenant le n° de série, restreint au SIREN de
   `GEODAE_SIREN`) et API exploitants Atlasanté (champ `num_serie`, compte `GEODAE_USERNAME` /
   `GEODAE_PASSWORD` ; la connexion renvoie `access_token`). Résultat : une, plusieurs ou
   aucune correspondance ; aucune source qui répond = erreur, pas « introuvable ».
4. **Journal** : introuvable, ambigu ou erreur ouvrent une anomalie ; un identifiant retrouvé
   clôt celles du DAE. Le résultat de chaque DAE est aussi conservé dans `geodae_lookups`
   et rechargé à l'ouverture de la page (mention « Contrôlé le … par … » sous le résultat) :
   les identifiants trouvés restent à valider d'une session à l'autre.
5. **Contrôle automatique** (cron Vercel 07:00 UTC, `/api/geodae/cron`, moteur
   `lib/geodae/cron.ts`) : DAE en location sans identifiant, jamais contrôlés d'abord puis
   contrôles de plus de 7 jours, par lots de 30 avec un budget de 40 s ; la route se rappelle
   elle-même tant qu'il reste des DAE (10 fois au plus). Résultats dans le journal et dans
   `geodae_lookups` avec « cron » comme auteur. Le bouton « Contrôle automatique (un lot) »
   de la page lance le même moteur à la main. Le report reste manuel.
6. **Réconciliation** (première phase du cron, ou « Rapprocher maintenant ») : inventaire Géo'DAE
   du SIREN STAR par l'open data (1 136 DAE, numéro de série lu dans le nom déclaré) complété
   par l'API exploitants, comparé à tous les DAE de la copie Supabase. Produit et clôt
   automatiquement les anomalies « identifiant divergent », « absent de Géo'DAE » et « non
   référencé dans Synchroteam » (avec la situation réelle : absent, inactif, autre contrat).
   Le rapport est dans l'encart journal : filtre par type, colonnes identifiants des deux
   côtés et détail, clôture manuelle avec motif, export CSV complet, compteur dans le menu.
   Rien n'est écrit dans Synchroteam ni dans Géo'DAE.
7. **Report** (« Reporter dans Synchroteam », confirmation obligatoire) : relecture de
   l'équipement, n° de série identique exigé, jamais d'écrasement d'un champ déjà
   renseigné, écriture partielle (`POST /Api/v3/equipment/send`, seuls les champs fournis
   changent), relecture de contrôle, trace dans `geodae_writebacks`, clôture des anomalies,
   mise à jour de la copie locale.

## 5. Conventions à connaître

- **Un compte Synchroteam par territoire**, chacun avec ses propres identifiants de champs
  personnalisés. Le mapping `label → champ interne` est en base (`custom_field_mapping`,
  page `/admin/field-mapping`) et complété par une heuristique sur les libellés.
  Le report a besoin du champ interne `geo_dae_id` (libellé « Identifiant GEO DAE », type nombre
  sur le compte Réunion, id 227728).
- **Préfixe des identifiants** dans `defibrillators.synchroteam_id` : aucun pour la Réunion,
  `GLP_` pour la Guadeloupe, `MYT_` pour Mayotte (`buildAccounts` dans `lib/sync-territory-route.ts`).
  Le contrôle Géo'DAE travaille toujours avec l'identifiant brut et le code du compte.
- **Variables d'environnement** (`.env.local.example`) :
  `SYNCHROTEAM_DOMAIN` / `SYNCHROTEAM_API_KEY` (Réunion), `_MYT` et `_GLP` pour les deux autres
  comptes, `GEODAE_USERNAME`, `GEODAE_PASSWORD`, `GEODAE_SIREN`, `SUPABASE_DB_URL` (poste
  uniquement, jamais sur Vercel).
- **Limite Vercel** : 60 secondes par exécution de fonction. C'est ce qui a imposé la copie
  Supabase et qui imposera des lots pour le futur cron Géo'DAE.

## 6. Activer Mayotte ou Guadeloupe : liste à dérouler

1. **Clés Synchroteam** du compte : renseigner `SYNCHROTEAM_DOMAIN_MYT` et `SYNCHROTEAM_API_KEY_MYT`
   (ou `_GLP`) dans `.env` en local et dans les variables Vercel (production).
   Vérifier avec le compte que la clé autorise l'écriture si le report doit être utilisé.
2. **Synchronisation** : lancer une première synchro du territoire (bouton « Synchroniser
   maintenant » de la barre latérale, ou `/api/sync/myt` avec le secret cron), puis ajouter
   l'entrée correspondante dans `vercel.json` pour la synchro quotidienne. Aujourd'hui seule
   `/api/sync/reu` est planifiée.
3. **Champs personnalisés** : contrôler sur `/admin/field-mapping` que les champs du compte
   sont bien résolus, en particulier « Identifiant GEO DAE » → `geo_dae_id`, « N° de série »
   → `serial_number` et « Type de contrat » → `contract_type`. Les libellés peuvent différer
   d'un compte à l'autre.
4. **Simulation du report** : `npm run geodae:dryrun -- MYT` (ou `GLP`). Le script doit
   afficher le champ cible résolu et les cinq cas de garde-fous sans erreur. Aucune écriture.
5. **Page Contrôle Géo'DAE** : la carte du territoire doit indiquer « Synchronisé le … » et des
   compteurs cohérents. Vérifier que les valeurs de type de contrat du compte figurent dans la
   liste « Types de contrat rencontrés » et sont reconnues comme location ; sinon compléter
   `LOCATION_TYPES` dans `lib/contract-groups.ts`.
6. **Recherche puis report sur un seul DAE** du territoire, contrôle de la fiche dans
   Synchroteam, puis seulement utilisation du lot.
7. **Géo'DAE** : le compte exploitant et le SIREN sont nationaux, rien à changer, sauf si les
   DAE du territoire sont déclarés sous un autre SIREN (adapter `GEODAE_SIREN` ou lever le filtre).

## 7. Avant la mise en production

- **Variables Vercel** : `GEODAE_USERNAME`, `GEODAE_PASSWORD` et `GEODAE_SIREN` ont été créées en
  local après l'export des variables du projet ; elles doivent être ajoutées dans Vercel
  (Production et Preview). Sans elles, la recherche et le cron ne voient que l'open data.
- **Migrations** : `npm run db:status` doit montrer toutes les migrations appliquées.
- **Crons** : `vercel.json` planifie `/api/sync/reu` (06:00 UTC) et `/api/geodae/cron` (07:00 UTC).
  En plan Vercel gratuit c'est le maximum (deux crons, quotidiens). Pour couvrir les trois
  territoires, remplacer la cible de synchro par `/api/sync/trigger` (GET), qui déclenche les
  trois synchros ; ajouter d'abord le contrôle du secret (`Authorization: Bearer CRON_SECRET`)
  sur ce GET, absent aujourd'hui. `CRON_SECRET` doit exister sur Vercel (déjà utilisé par la synchro).
- **Variables Mayotte et Guadeloupe** (`SYNCHROTEAM_DOMAIN_MYT`, `SYNCHROTEAM_API_KEY_MYT`, `_GLP`) :
  présentes sur Vercel d'après les données du 7 septembre en base, à confirmer.
- **Premier report réel** sur un seul DAE, vérification de la fiche Synchroteam, puis le lot.

## 8. Reste à faire

- **Report automatique** des correspondances uniques par le cron, quand la confiance sera
  acquise (aujourd'hui volontairement manuel).
- **Alerte par e-mail** sur les anomalies ouvertes, si le compteur du menu ne suffit pas.
- **Compte API Géo'DAE** : le compte configuré (STAR MAINTENANCE, SIREN 908037971) ne voit que
  les DAE qu'il a lui-même déclarés (30 le 28/09/2026), pas le parc du SIREN principal
  (500168190). Un compte exploitant rattaché au SIREN principal donnerait le numéro de série
  explicite pour tout le parc, au lieu de le lire dans le nom.
- Champ Synchroteam « Date dernière Maintenance » (id 238257) non mappé, décision à prendre.

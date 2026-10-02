# Contrôle Géo'DAE : ce qui a été fait, comment l'étendre à Mayotte et Guadeloupe

Dernière mise à jour : 1er octobre 2026. Ce document est le fil conducteur du chantier
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
- **Source Géo'DAE unique : l'API exploitants du catalogue Atlasanté** (décision du 01/10/2026),
  avec le compte rattaché au SIREN du parc (STAR GROUP, 500168190). Elle donne le champ
  `num_serie` de chaque fiche. L'open data data.gouv.fr, où la recherche se faisait dans le nom
  du DAE, n'est plus interrogé. Conséquence : `GEODAE_USERNAME` et `GEODAE_PASSWORD` sont
  indispensables, en local comme sur Vercel ; sans eux, tout le menu Contrôle Géo'DAE est
  indisponible. Mesuré le 01/10/2026 : `limit` n'est pas plafonné (contrairement à ce qu'on
  croyait), l'inventaire complet (1 137 fiches, toutes avec `num_serie` et `dermnt`) arrive en une
  requête de 1,5 à 4 s. Simulation du 01/10/2026 : 1 092 appariés sur 1 102, 19 divergences,
  10 absents, 49 non référencés (contre 30 absents et 67 non référencés avec l'open data).

## 2. Où est le code

| Rôle | Fichier |
|---|---|
| Page et interface | `app/(dashboard)/geodae/page.tsx`, `app/(dashboard)/geodae/GeodaeClient.tsx` |
| Lecture de la copie Supabase (source par défaut) | `lib/geodae/extract-supabase.ts` |
| Lecture directe Synchroteam (diagnostics, `?source=synchroteam`) | `lib/geodae/extract-synchroteam.ts` |
| Accès à l'API exploitants Géo'DAE : connexion, inventaire du compte, recherche par n° de série | `lib/geodae/client.ts` |
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
| `20260929000014_geodae_writebacks_fields.sql` | `geodae_writebacks` : colonnes `field` et `value`, `geodae_gid` facultatif : la même table trace les reports de date de maintenance |

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
   API exploitants Atlasanté, égalité exacte sur le champ `num_serie` des fiches du compte
   (`GEODAE_USERNAME` / `GEODAE_PASSWORD` ; la connexion renvoie `access_token`), second essai
   en majuscules si la casse diffère. Résultat : une, plusieurs ou aucune correspondance ; API
   qui ne répond pas = erreur, pas « introuvable ». Une fiche dont le champ `num_serie` est
   vide n'est pas trouvée par la recherche, mais le rapprochement (point 6) la rattache encore
   par le nom déclaré.
4. **Journal** : introuvable, ambigu ou erreur ouvrent une anomalie ; un identifiant retrouvé
   clôt celles du DAE, et un nouveau résultat d'un autre type remplace le précédent (une « erreur
   de recherche » suivie d'un « introuvable » ne laisse qu'une anomalie ouverte).
   Le résultat de chaque DAE est aussi conservé dans `geodae_lookups`
   et rechargé à l'ouverture de la page (mention « Contrôlé le … par … » sous le résultat) :
   les identifiants trouvés restent à valider d'une session à l'autre.
5. **Contrôle automatique** (cron Vercel 07:00 UTC, `/api/geodae/cron`, moteur
   `lib/geodae/cron.ts`) : DAE en location sans identifiant, jamais contrôlés d'abord puis
   contrôles de plus de 7 jours, par lots de 30 avec un budget de 40 s ; la route se rappelle
   elle-même tant qu'il reste des DAE (10 fois au plus). Résultats dans le journal et dans
   `geodae_lookups` avec « cron » comme auteur. Le bouton « Contrôle automatique (un lot) »
   de la page lance le même moteur à la main. Le report reste manuel.
   Un « introuvable » enregistré sans réponse de l'API exploitants (résultats antérieurs au
   01/10/2026, numéro lu dans le nom de la fiche open data) n'est pas fiable : le cron le reprend
   sans attendre les 7 jours, « Rechercher les manquants » le reprend aussi, et la ligne l'affiche
   en orange avec la mention « sans l'API Géo'DAE, à refaire ». Une « erreur » (API injoignable ou
   identifiants refusés) est de même reprise au contrôle suivant : après un cron tombé sur un 401,
   les « erreur de recherche » se résorbent d'eux-mêmes dès que le compte est corrigé.
6. **Réconciliation** (première phase du cron, ou « Rapprocher maintenant ») : inventaire Géo'DAE
   lu par l'API exploitants (fiches du compte, restreintes à `GEODAE_SIREN` ; 1 137 DAE le
   01/10/2026, numéro de série pris dans `num_serie`, sinon lu dans le nom déclaré), comparé à
   tous les DAE de la copie Supabase. Produit et clôt
   automatiquement les anomalies « identifiant divergent », « absent de Géo'DAE » et « non
   référencé dans Synchroteam » (avec la situation réelle : absent, inactif, autre contrat).
   Le rapport est dans l'onglet « Anomalies » de la page : filtre par type, colonnes identifiants
   des deux côtés et détail, clôture manuelle avec motif, export CSV complet, compteur dans le menu.
   L'onglet « Historique » liste les exécutions (recherches, rapprochements) et les reports.
   Rien n'est écrit dans Synchroteam ni dans Géo'DAE.
   Le motif d'un « identifiant divergent » nomme la situation : identifiant copié sur deux DAE (l'autre
   DAE porte le numéro déclaré), numéros croisés entre deux appareils, même numéro à un caractère
   ambigu près (l, I, 1 ; O, 0), ou appareil remplacé. Le tableau affiche le numéro de série et le nom
   déclarés côté Géo'DAE. Les champs n° de série Synchroteam qui ne ressemblent pas à un numéro (nom de
   site, « Test », espaces) sont ignorés pour lire les noms Géo'DAE.
   Un « non référencé dans Synchroteam » précise la situation : présent sous un autre contrat ou inactif
   (rattaché par le numéro de série, sinon par l'identifiant Géo'DAE renseigné sur la fiche Synchroteam),
   absent de Synchroteam, ou numéro de série non identifiable dans le nom déclaré, auquel cas une piste
   est proposée quand un site Synchroteam porte le même nom (à vérifier à la main, ou compléter le nom de
   la déclaration Géo'DAE avec le numéro de série).
7. **Report** (« Reporter dans Synchroteam », confirmation obligatoire) : relecture de
   l'équipement, n° de série identique exigé, jamais d'écrasement d'un champ déjà
   renseigné, écriture partielle (`POST /Api/v3/equipment/send`, seuls les champs fournis
   changent), relecture de contrôle, trace dans `geodae_writebacks`, clôture des anomalies,
   mise à jour de la copie locale.
   **Ce qu'un envoi modifie dans Synchroteam** (vérifié dans la référence officielle api.synchroteam.com,
   Create/Update equipment, le 29/09/2026) : « only the fields provided will be updated. Fields not provided
   will not be deleted » ; les tags ne sont hérités du site ou du client qu'à la création, jamais à la mise à
   jour, et un identifiant inconnu fait échouer la requête au lieu de créer un équipement. Nos envois ne
   contiennent que l'identifiant de l'équipement et la liste des champs personnalisés, relue et renvoyée
   complète avec le seul champ visé remplacé (`buildPayload`), jamais de tags, nom, client ni site. Après
   chaque écriture, l'équipement est relu et comparé : tags, nom, état, client, site et autres champs ;
   tout écart est affiché sur la ligne et conservé dans l'historique (`collateralChanges`).
8. **Maintenance** (onglet, 29/09/2026) : pour chaque DAE en location apparié, le champ « Date dernière
   Maintenance » de la fiche équipement Synchroteam (champ interne `last_maintenance_field`, mappé et recopié
   par la synchronisation ; décision du 30/09/2026, la dernière intervention n'étant pas forcément une
   maintenance, elle reste affichée à titre d'information) est comparé à la date de maintenance déclarée dans Géo'DAE
   (champ `dermnt` des fiches du compte, lu en direct par l'API exploitants). Écart en jours, tolérance au choix (7,
   30 ou 90 jours), situations : identique, écart toléré, Synchroteam plus récent, Géo'DAE plus récent,
   Synchroteam sans date. Quand Géo'DAE est plus récent ou que Synchroteam n'a pas de date, un bouton écrit
   la date Géo'DAE dans le champ personnalisé « Date dernière Maintenance » de l'équipement Synchroteam
   (`writeMaintenanceDate`, mêmes garde-fous que l'identifiant, jamais de recul de date, format dd/mm/yyyy),
   trace dans `geodae_writebacks` (migration 014). Quand Synchroteam est plus récent, le bouton « Mettre à jour
   Géo'DAE » écrit la date de dernière maintenance Synchroteam dans le champ `dermnt` de la fiche Géo'DAE par l'API PRODIGE
   du catalogue Atlasanté (PATCH /api/data/{uuid}/gid, corps GeoJSON, documentation sur
   https://catalogue.atlasante.fr/api/doc) : `lib/geodae/geodae-write.ts`, fiche relue avant et après,
   SIREN vérifié, jamais de recul de date, tout autre champ modifié est signalé, trace `field = geodae_dermnt`.
   C'est la première écriture de l'application vers Géo'DAE ; le premier essai est fait par l'équipe STAR aid
   depuis l'interface, sur une fiche, avec vérification sur le portail (droits du compte et état de validation
   de la fiche à confirmer à cette occasion). Le champ interne `last_maintenance_field` (à mapper dans
   /admin/field-mapping puis synchroniser) permet d'afficher la valeur actuelle du champ Synchroteam.
   Module `lib/geodae/maintenance.ts`, route `app/api/geodae/maintenance`, composant `MaintenancePanel.tsx`.

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
  comptes, `GEODAE_USERNAME` et `GEODAE_PASSWORD` (indispensables au contrôle Géo'DAE depuis le
  01/10/2026), `GEODAE_SIREN` (restreint l'inventaire et protège les écritures), `SUPABASE_DB_URL`
  (poste uniquement, jamais sur Vercel).
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

- **Variables Vercel** : `GEODAE_USERNAME`, `GEODAE_PASSWORD` (compte STAR GROUP) et `GEODAE_SIREN`
  ont été créées en local après l'export des variables du projet ; elles doivent être ajoutées dans
  Vercel (Production et Preview) **avant** de déployer la version sans open data : sans elles, la
  recherche, le rapprochement du cron et l'onglet Maintenance répondent « GEODAE_USERNAME /
  GEODAE_PASSWORD non configurés ».
- **Migrations** : `npm run db:status` doit montrer toutes les migrations appliquées.
- **Crons** : `vercel.json` planifie `/api/sync/reu` (06:00 UTC) et `/api/geodae/cron` (07:00 UTC).
  En plan Vercel gratuit c'est le maximum (deux crons, quotidiens). Pour couvrir les trois
  territoires, remplacer la cible de synchro par `/api/sync/trigger` (GET), qui déclenche les
  trois synchros ; ce GET exige le secret (`Authorization: Bearer CRON_SECRET`, envoyé par Vercel
  quand la variable existe) depuis le 29/09/2026. `CRON_SECRET` doit exister sur Vercel. Les boutons
  « Synchroniser » de l'interface n'en dépendent plus : la route lance la synchro directement, sans
  relais HTTP, donc sans `NEXT_PUBLIC_APP_URL` ni secret en local.
- **Variables Mayotte et Guadeloupe** (`SYNCHROTEAM_DOMAIN_MYT`, `SYNCHROTEAM_API_KEY_MYT`, `_GLP`) :
  présentes sur Vercel d'après les données du 7 septembre en base, à confirmer.
- **Premier report réel** sur un seul DAE, vérification de la fiche Synchroteam, puis le lot.

## 8. Reste à faire

- **Report automatique** des correspondances uniques par le cron, quand la confiance sera
  acquise (aujourd'hui volontairement manuel).
- **Premier essai d'écriture dans Géo'DAE** (bouton « Mettre à jour Géo'DAE ») par l'équipe, sur une fiche.
- **Alerte par e-mail** sur les anomalies ouvertes, si le compteur du menu ne suffit pas.
- **Fiches Géo'DAE sans `num_serie`** : la recherche par numéro ne les trouve pas ; seul le
  rapprochement les rattache, par le nom déclaré. Compléter le champ sur le portail quand le cas
  se présente (le rapport d'anomalies les signale).
- Champ Synchroteam « Date dernière Maintenance » (id 238257) mappé sur `last_maintenance_field`
  le 30/09/2026 : lancer une synchronisation pour que la valeur arrive dans la copie Supabase.

Réglé : le compte API est désormais celui de STAR GROUP (SIREN 500168190, 1 137 fiches avec
`num_serie`), configuré en local le 29/09/2026 ; l'open data a été retiré le 01/10/2026.

# Design system — Parc DAE STAR aid

Ce document décrit les briques visuelles de l'application et les règles pour les assembler.
Il est aligné sur le design system de **prospection-app** (`apps/prospection-front/DESIGN_SYSTEM.md`)
pour que les deux outils STAR aid se ressemblent. Objectif : qu'un changement de design se fasse
à un seul endroit, et que deux écrans conçus à six mois d'intervalle se ressemblent.

- Tokens : [`tailwind.config.ts`](../tailwind.config.ts) (couleurs, tailles, rayons, ombres)
- Primitives : [`components/ui/primitives.tsx`](../components/ui/primitives.tsx)
- Squelettes de chargement : [`components/ui/skeleton.tsx`](../components/ui/skeleton.tsx)
- Shell de l'espace connecté : `components/dashboard/AppShell.tsx`, `Header.tsx`, `Sidebar.tsx`
- Icônes : `lucide-react` (jamais de SVG dessiné à la main dans une page)

## 1. Principes

1. **Jamais de valeur brute dans un composant.** Pas de `#ad2022`, pas de `text-slate-500`, pas de
   `text-[11.5px]` : uniquement des tokens (`text-brand`, `text-fg-muted`, `text-caption`). Seules
   exceptions : les *couleurs de données* (statuts DAE dans les graphiques et la carte, séries de
   la courbe des interventions), qui distinguent des catégories métier.
2. **Le rouge de marque = l'action ou le repère de marque, pas un fond décoratif.** Une seule action
   `primary` par zone visuelle. Le bandeau supérieur rouge est le seul aplat de marque.
3. **Une échelle typographique de 4 tailles « interface »** sous `text-sm` : `text-2xs` (10) ·
   `text-label` (11) · `text-caption` (12) · `text-body` (13), puis `text-sm`/`text-base`/`text-lg`/
   `text-xl` pour les titres.
4. **Trois rayons.** `rounded-control` (boutons, champs) · `rounded-card` (cartes, tableaux) ·
   `rounded-panel` (dialogues, page de connexion). `rounded-full` pour les pastilles.
5. **Les primitives d'abord.** Un bouton est un `<Button>`, un champ un `<Input>`/`<Select>` dans un
   `<Field>`, une section une `<Card>`, une étiquette un `<Tag>`, un message un `<Notice>`.

## 2. Tokens

### Couleurs sémantiques

| Token | Usage |
|---|---|
| `brand` / `brand-hover` / `brand-active` | Actions principales, bandeau supérieur, onglet actif, page de pagination courante |
| `brand-soft` · `brand/10` | Fond d'un élément sélectionné ou mis en avant |
| `brand-foreground` | Texte sur fond `brand` |
| `surface` | Cartes, panneaux, champs (blanc) |
| `surface-muted` | Fond de page, en-tête et pied de tableau |
| `surface-sunken` | Survol, rail des filtres, pastilles neutres |
| `surface-overlay` | Voile derrière le tiroir mobile |
| `sidebar`, `sidebar-raised`, `sidebar-active`, `sidebar-border`, `sidebar-fg`, `sidebar-fg-muted`, `sidebar-fg-faint` | Panneau de navigation sombre, tokens dédiés, jamais mélangés aux tokens clairs |
| `border` / `border-subtle` / `border-strong` | Bordure standard / séparateur interne / bordure au survol |
| `fg` / `fg-secondary` / `fg-muted` / `fg-faint` | Titres et valeurs / libellés / méta / icônes inactives et placeholders |
| `danger`, `success`, `warning`, `info` (+ `-soft`, `-border`, `-hover`) | États. Les statuts DAE les utilisent : critique = danger, vigilance = warning, conforme = success |
| `accent-blue/indigo/amber/violet/orange` (+ `-strong`, `-soft`) | Accents de section, via la prop `accent` de `Card`/`SectionTitle` |

Correspondance depuis l'ancienne palette : `slate-900/800` → `fg`, `slate-700/600` → `fg-secondary`,
`slate-500` → `fg-muted`, `slate-400` → `fg-faint`, `slate-300` (bordure) → `border-strong`,
`slate-200` → `border`, `slate-100` (séparateur) → `border-subtle`, `slate-100` (fond) →
`surface-sunken`, `slate-50` → `surface-muted`, `white` → `surface`, `red-700` → `danger`,
`emerald-700` → `success`, `amber-700` → `warning`, `text-13` → `text-body`, `text-2xs` (11 px)
→ `text-label`, `text-xs` → `text-caption`, `rounded-lg` → `rounded-card`, `rounded-md` →
`rounded-control`, `shadow-pop` → `shadow-float`.

### Typographie

Police Geist (`font-sans`), Geist Mono pour les identifiants (`font-mono` : n° de série,
identifiants Géo'DAE et Synchroteam). Chiffres tabulaires activés globalement.

| Classe | px | Usage |
|---|---|---|
| `text-2xs` | 10 | Compteurs en médaillon (badges du menu, onglets) |
| `text-label` | 11 | Titres de section et en-têtes de tableau (capitales), libellés de champ, étiquettes de ligne |
| `text-caption` | 12 | Méta, aide, boutons compacts, cellules secondaires |
| `text-body` | 13 | Texte courant, lignes de tableau, navigation |
| `text-sm` | 14 | Boutons `md`/`lg` |
| `text-lg` / `text-xl` | 18 / 20 | Titre de fiche / titre de page |

Graisse : `font-bold` pour les titres, les actions principales et les libellés de section ;
`font-semibold` pour les valeurs et boutons secondaires ; `font-extrabold` uniquement pour la marque
et les gros chiffres KPI.

### Focus

Toujours visible au clavier : `focus-visible:ring-2 focus-visible:ring-brand/40`. Les champs :
`focus:border-brand focus:ring-[3px] focus:ring-brand/10`. Les primitives l'intègrent.

## 3. Primitives

| Primitive | Rôle |
|---|---|
| `PageContainer`, `PageHeader` | Largeur et en-tête de page (titre, sous-titre, eyebrow, actions) |
| `Card` (`title`, `icon`, `accent`, `actions`, `padded`) | Surface blanche bordée, ombre `card` |
| `SectionTitle` | Titre en capitales avec tuile d'icône ; porte la couleur d'accent |
| `Button` (`variant`, `size`, `icon`, `iconRight`, `loading`, `pill`, `fullWidth`) | primary · secondary · ghost · soft · inverted · success · danger · danger-outline ; xs h-7 · sm h-8 (défaut) · md h-9 · lg h-10 |
| `LinkButton`, `buttonClass` | Même habillage pour un lien |
| `IconButton` | Icône seule, libellé accessible obligatoire |
| `Field`, `Label`, `Input`, `Select`, `controlClass`, `inputClass`, `selectClass` | Champs ; `Select` dessine son chevron |
| `ChipGroup`, `Chip` | Filtres à bascule sur rail gris (contrôle segmenté) |
| `Tag` (`tone`, `size`, `dot`, `icon`, `outline`) | Pastille de lecture : statut, compteur, étiquette |
| `Tabs` | Onglets soulignés, compteur en pastille |
| `Notice` (`tone`, `icon`, `actions`) | Encadré d'information ou d'erreur non bloquant |
| Classes de tableau (`tableWrapClass`, `theadClass`, `thClass`, `trClass`, `tdClass`, `tableFooterClass`, `stickyColClass`) et `pageButtonClass` | Tableaux et pagination uniformes |
| `EmptyState` (`icon`, `title`, `description`, `action`, `compact`) | Dit ce qui manque et quoi faire |

Statuts DAE : `DAEStatusBadge` et `ConsumableStatus` dans `components/table/StatusBadge.tsx`,
construits sur `Tag`.

## 4. Shell de l'espace connecté

- **Bandeau supérieur rouge** (`Header`) : logo blanc, nom du module, ouverture du menu sur mobile,
  menu utilisateur (identité, rôle, déconnexion confirmée).
- **Navigation sombre** (`Sidebar`) : entrées avec icône lucide, entrée active en pavé clair,
  compteurs en pastille `danger` (DAE critiques) ou `warning` (anomalies Géo'DAE), section
  Configuration, bloc de synchronisation en bas. Déployée sur grand écran, tiroir sur mobile.
- **Barre d'outils** blanche sous le bandeau : filtres globaux (contrat, client).
- **Contenu** sur fond `surface-muted`, cartes blanches détachées par `shadow-card`.

## 5. Changer le design demain

| Je veux… | Je modifie… |
|---|---|
| Changer la couleur de marque | `colors.brand` dans `tailwind.config.ts` |
| Aérer ou densifier toute l'application | `BUTTON_SIZE`, `CONTROL_HEIGHT`, les classes de tableau dans `primitives.tsx` |
| Arrondir ou carrer | `borderRadius` dans `tailwind.config.ts` |
| Changer la police | `app/layout.tsx` (next/font) + `fontFamily` |
| Ajouter un mode sombre | Redéfinir `surface*`, `fg*`, `border*` en variables CSS sous `prefers-color-scheme`, aucun composant à toucher si la règle 1 est respectée |

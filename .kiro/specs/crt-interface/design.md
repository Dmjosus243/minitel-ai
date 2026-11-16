# Conception — Interface CRT MVP

## Vue d'ensemble

L'interface CRT est rendue côté serveur par l'application Hono existante. `GET /` interprète `q` et `page`, demande le contenu au `ServiceRegistry`, conserve une seule `Page`, puis produit un document HTML complet. Les formulaires et les liens natifs assurent toute la navigation.

Le MVP ne requiert pas de client TypeScript ni d'API JSON. Cette décision réduit le travail et garantit d'emblée l'usage au clavier, le bouton Retour et le fallback sans JavaScript.

Deux notions restent séparées :

- le formateur existant impose la limite logique de 40 caractères par ligne et calcule `Page.metadata.byteSize` ;
- le CSS limite la largeur visuelle préférée à `40ch`, avec un retour visuel à la ligne sur les petits écrans.

## Périmètre technique

Le MVP réutilise sans modifier leurs contrats :

- l'application Hono et son middleware existant ;
- `defaultRegistry`, son ordre d'insertion et son routage ;
- `formatText()`, `Page` et `Page.metadata.byteSize` ;
- la génération actuelle de l'accueil ;
- `pagesToPlainText()` pour `/plain`.

Il ne modifie pas `Service`, les codes enregistrés, l'ordre des services, `/api/config` ni la configuration des fournisseurs NEWS.

## Architecture

```text
GET /?q=3615+NEWS&page=2&effects=off
                  |
                  v
         validation des paramètres
                  |
                  v
       accueil ou ServiceRegistry.route()
                  |
                  v
            Page[] existantes
                  |
                  v
       sélection d'une seule Page
                  |
                  v
          rendu du document HTML

GET /plain?q=3615+NEWS
                  |
                  v
       même résolution du contenu
                  |
                  v
          pagesToPlainText(Page[])
```

Aucune pagination n'est effectuée dans le navigateur. Un service dynamique peut être recalculé à chaque requête ; les liens représentent donc l'état courant du service.

## Modèle de vue minimal

Le rendu peut s'appuyer sur un modèle interne équivalent à celui-ci, sans imposer un nouveau contrat public :

```ts
interface TerminalView {
  state: 'home' | 'service' | 'error';
  query: string;
  title: string;
  page: {
    lines: readonly string[];
    number: number;
    total: number;
    byteSize: number;
  };
  links: {
    previous: string | null;
    next: string | null;
    home: string;
    plain: string;
    effectsToggle: string;
  };
  effectsEnabled: boolean;
  showHalloweenDecoration: boolean;
}
```

Ce modèle copie les données de la `Page` sélectionnée. Il ne reformate pas le texte et ne recalcule pas son poids.

## Résolution des requêtes

### Paramètre `q`

1. Une valeur absente ou vide ouvre l'accueil actuel.
2. Une suite de chiffres sélectionne le service à cette position dans `defaultRegistry.getAll()`.
3. Toute autre valeur bornée passe par la normalisation et le routage existants.
4. La valeur décodée est limitée à 40 caractères avant routage ou réflexion dans le HTML.
5. Une valeur invalide mais bornée reste dans le champ ; une valeur trop longue n'est pas réaffichée.
6. Après une sélection numérique réussie, les liens utilisent le code canonique du service.

### Paramètre `page`

- Une valeur absente, vide, mal formée, nulle ou négative donne la page 1.
- Un entier compris entre 1 et le total sélectionne cette page.
- Un entier supérieur au total sélectionne la dernière page.
- Le HTML ne contient que la page sélectionnée.

### Paramètre `effects`

- Les effets sont activés par défaut.
- `effects=off` désactive la trame, le balayage et le scintillement.
- Le lien de bascule ajoute ou retire ce paramètre sans perdre `q` ou `page`.
- Le formulaire et les liens de pagination conservent `effects=off` au moyen d'un paramètre caché ou d'URL construites avec `URLSearchParams`.
- `prefers-reduced-motion: reduce` désactive les animations même si le paramètre n'est pas présent.

Toutes les URL sont construites avec une API d'encodage de paramètres, et non par concaténation de valeurs non fiables.

## Rendu HTML

Le document est complet, en français, et garde cet ordre général :

```html
<main>
  <h1>MINITEL IA</h1>

  <section class="terminal" aria-labelledby="terminal-title">
    <pre class="halloween" aria-hidden="true">...</pre>
    <pre id="terminal-content">...</pre>

    <p>Page 1/3</p>
    <p>Poids : 742 octets</p>

    <nav aria-label="Navigation entre les pages">...</nav>

    <form method="get" action="/">
      <label for="terminal-query">Code ou numéro</label>
      <input id="terminal-query" name="q" maxlength="40"
             spellcheck="false" enterkeyhint="go">
      <!-- Présent seulement quand les effets sont désactivés. -->
      <input type="hidden" name="effects" value="off">
      <button type="submit">ENVOI</button>
    </form>

    <a href="{{ effectsToggleUrl }}">Désactiver les effets CRT</a>
    <a href="{{ plainUrl }}">Version texte</a>
    <a href="{{ homeUrl }}">Accueil</a>
  </section>
</main>
```

La structure exacte peut varier, mais les contrôles restent natifs et visibles. Le contenu dynamique est échappé en contexte texte ou attribut. La décoration ASCII est rendue uniquement sur la première page d'un accueil sans erreur.

Le champ conserve le curseur natif. Le CSS fixe sa couleur au vert sans le masquer ni le remplacer par un faux curseur.

## Navigation

Les liens précédent et suivant transportent le code canonique dans `q`, la page cible dans `page` et, si nécessaire, `effects=off`. Le lien d'accueil retire `q` et `page`. Le lien `/plain` transporte le `q` courant, mais pas `page`, car la version texte sérialise toutes les pages.

Pour une direction indisponible, le rendu affiche éventuellement un libellé désactivé sans lien et sans `tabindex`. Les formulaires et liens ordinaires laissent le navigateur gérer l'historique.

## Présentation CRT

### Palette et largeur

- fond presque noir ;
- texte et contrôles verts avec un contraste lisible ;
- pile monospace locale, sans webfont ;
- contenu en `white-space: pre-wrap`, largeur maximale préférée de `40ch` et `overflow-wrap` adapté aux écrans étroits ;
- aucune largeur fixe qui imposerait un défilement horizontal global.

### Effets

Des pseudo-éléments non interactifs fournissent :

- une trame horizontale discrète ;
- un balayage lent ;
- un scintillement de faible amplitude.

Les pseudo-éléments utilisent `pointer-events: none` et ne changent pas la géométrie. Une classe ou un attribut issu de `effects=off` supprime les trois effets. La règle `prefers-reduced-motion` supprime au minimum toutes les animations.

Le MVP n'impose ni seuil chiffré d'opacité/durée, ni URL d'asset, ni budget mesuré. Le contrôle visuel doit seulement rester léger et lisible.

## Citrouille ASCII

Décoration proposée :

```text
   ___
  / _ \
 | / \ |
 | \_/ |
  \___/
```

Elle tient dans 7 colonnes et 5 lignes. Elle est fixe, purement textuelle, marquée `aria-hidden="true"` et absente des services, des erreurs et des pages d'accueil suivantes. Un fantôme de dimensions équivalentes peut la remplacer.

## Clavier et téléphone

- Le DOM suit l'ordre visuel : contenu, pagination, saisie, bascule des effets, version texte et accueil.
- Les contrôles natifs restent accessibles avec Tab, Entrée et Espace selon leur type.
- `:focus-visible` fournit un contour distinct du simple halo vert.
- Les contrôles principaux offrent une cible de 44 × 44 pixels CSS.
- À 320 pixels CSS, les rangées de contrôles peuvent s'empiler et le contenu ne déborde pas horizontalement.
- Le champ a une taille minimale de 16 pixels sur téléphone et n'utilise pas `autofocus`.
- Les overlays CRT ne couvrent pas le focus, le curseur ou la sélection.

## Route texte brut

`GET /plain` réutilise la même résolution de `q`, puis appelle la sérialisation existante `pagesToPlainText()` sur toutes les pages obtenues. La réponse est en `text/plain; charset=UTF-8`. Le paramètre `page` est ignoré volontairement.

La page HTML fournit un lien vers `/plain` avec le code courant correctement encodé.

## Gestion des erreurs

| Cas | Comportement MVP |
| --- | --- |
| `q` vide | Afficher l'accueil |
| Numéro de menu invalide | Afficher une erreur française et garder le formulaire |
| Code inconnu | Conserver le comportement utilisateur actuel dans l'écran CRT |
| `q` trop long | Ne pas router ni réafficher la valeur ; montrer une erreur sûre |
| `page` invalide | Sélectionner la page 1 |
| `page` trop grand | Sélectionner la dernière page |
| Échec d'un service | Afficher le résultat d'indisponibilité actuel avec les contrôles |
| CSS indisponible | L'ordre HTML et tous les liens restent utilisables |

## Validation ciblée

La validation du MVP reste volontairement courte :

- tests HTTP de `GET /` et `GET /plain` ;
- exemples ciblés pour l'accueil, un numéro, `3615 NEWS`, une erreur et un service à plusieurs pages ;
- vérification qu'une seule page et son poids apparaissent dans le HTML ;
- vérification de l'échappement des valeurs dynamiques ;
- contrôle manuel au clavier, à 320 pixels CSS, à 200 % de zoom et avec réduction des animations ;
- exécution des commandes de typecheck, tests et build déjà présentes dans le dépôt.

Aucune matrice exhaustive, campagne de propriétés ou mesure automatisée du poids des assets n'est requise.

## Facultatif après le MVP (*)

- (*) API JSON et mise à jour de l'écran sans rechargement.
- (*) Client TypeScript pour l'historique, le focus après mise à jour et la gestion des requêtes concurrentes.
- (*) CSP avancée et politique complète d'en-têtes dédiés à l'interface.
- (*) Budget d'assets mesuré et seuil bloquant en CI.
- (*) Routes d'assets exactes, stratégie de cache dédiée et tests de traversée associés.
- (*) Tests de propriétés, automatisation navigateur et couverture exhaustive des combinaisons.

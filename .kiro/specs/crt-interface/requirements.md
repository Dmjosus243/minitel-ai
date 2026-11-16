# Exigences — Interface CRT MVP

## Objectif

Ce MVP doit être terminé pour la clôture fonctionnelle du 28 novembre. Il ajoute une interface web Minitel simple au serveur Hono existant, sans changer les services, leur ordre d'enregistrement, le routeur ni le formateur de pages.

La navigation principale repose sur des formulaires et des liens HTML en `GET`. Elle ne dépend pas de JavaScript. Le formateur existant reste l'autorité pour les pages logiques de 40 colonnes et leur poids.

## Glossaire

- **Page logique** : objet `Page` produit par le routeur et le formateur existants.
- **Accueil** : menu des services affiché quand `q` est absent ou vide.
- **Requête de navigation** : paramètre `q`, contenant un code tel que `3615 NEWS` ou un numéro de menu tel que `2`.
- **Page demandée** : paramètre `page`, utilisé pour choisir une page logique d'un service.
- **Effets CRT** : balayage, scintillement et trame visuelle légère, sans incidence sur le contenu.

## Exigences MVP

### Exigence 1 — Page HTML et routage existant

**Récit utilisateur :** En tant que visiteur, je veux ouvrir le Minitel dans mon navigateur et retrouver les services existants.

#### Critères d'acceptation

1. `GET /` renvoie un document HTML en français avec le type `text/html; charset=UTF-8`.
2. Sans paramètre `q`, ou avec un `q` vide, la page affiche l'accueil construit à partir de la liste actuelle des services.
3. Un `q` numérique sélectionne le service correspondant à sa position actuelle dans le menu.
4. Un `q` contenant un code est résolu par le routeur existant, avec sa normalisation actuelle des espaces et de la casse.
5. Le contenu d'un service passe par le routeur et le formateur existants. L'interface ne réimplémente ni le rendu d'un service, ni le découpage en pages.
6. Le document HTML contient une seule page logique à la fois.
7. En cas de code inconnu, de numéro invalide ou d'échec d'un service, une erreur française concise est affichée et les contrôles de navigation restent disponibles.
8. Tout contenu dynamique placé dans le HTML, notamment le texte d'un service et la valeur de `q`, est échappé selon son contexte.

### Exigence 2 — Présentation CRT sur 40 colonnes

**Récit utilisateur :** En tant que visiteur, je veux une présentation proche d'un terminal Minitel, lisible et discrète.

#### Critères d'acceptation

1. L'écran utilise un fond presque noir, un texte vert contrasté et une pile de polices monospace locales.
2. Le contenu de la page logique a une largeur préférée maximale de `40ch`. Le formateur existant reste l'autorité pour la limite logique de 40 caractères par ligne.
3. L'ordre des lignes, les lignes vides et le texte de la page logique sont conservés.
4. Sur un écran plus étroit que `40ch`, le contenu peut revenir visuellement à la ligne, sans être coupé et sans provoquer de défilement horizontal de la page.
5. Une trame légère, un balayage lent et un scintillement faible créent l'effet CRT. Ces couches ne déplacent pas la mise en page et n'interceptent pas les clics ou la sélection de texte.
6. Un contrôle visible, utilisable au clavier et au toucher, permet de désactiver puis de réactiver tous les effets CRT. Le choix est conservé dans les liens et formulaires de navigation du document.
7. Avec `prefers-reduced-motion: reduce`, les animations de balayage et de scintillement sont désactivées automatiquement.

### Exigence 3 — Saisie d'un code ou d'un numéro

**Récit utilisateur :** En tant que visiteur, je veux saisir un code ou un numéro de menu dans un seul champ.

#### Critères d'acceptation

1. Un champ texte visiblement étiqueté accepte des valeurs telles que `3615 NEWS` et `2`.
2. Le champ appartient à un formulaire natif `GET /` dont le nom de paramètre est `q`.
3. La touche Entrée et le bouton d'envoi déclenchent la même navigation et ouvrent la première page du nouveau résultat.
4. Le champ limite la saisie à 40 caractères. Le serveur refuse une valeur décodée dépassant cette limite avant de la router ou de la réafficher.
5. La correction orthographique est désactivée, l'action du clavier mobile indique un envoi et les codes alphabétiques sont présentés en majuscules sans imposer une saisie en majuscules.
6. Une valeur invalide mais bornée reste visible dans le champ après avoir été échappée. Une valeur trop longue n'est pas réaffichée.
7. Le champ garde le curseur natif du navigateur, visible en vert et clignotant lorsqu'il a le focus.
8. Le champ ne reçoit pas automatiquement le focus au chargement de la page.

### Exigence 4 — Navigation entre les pages d'un service

**Récit utilisateur :** En tant que visiteur, je veux parcourir toutes les pages d'un service.

#### Critères d'acceptation

1. L'interface affiche le statut `Page N/T` de la page logique sélectionnée.
2. Un lien précédent est disponible quand `N > 1`, et un lien suivant quand `N < T`.
3. Les actions indisponibles ne sont pas placées dans l'ordre de tabulation et leur état est visible.
4. Un paramètre `page` absent, vide, non numérique, nul ou négatif sélectionne la première page.
5. Un numéro supérieur au total sélectionne la dernière page disponible.
6. Les liens précédent et suivant conservent le code canonique du service. Ils conservent aussi le choix de désactivation des effets CRT.
7. Un lien vers l'accueil retire `q` et `page`, tout en conservant le choix concernant les effets CRT.
8. Le formulaire, les liens précédent/suivant, le lien d'accueil et le bouton Retour du navigateur fonctionnent sans JavaScript.

### Exigence 5 — Poids de la page

**Récit utilisateur :** En tant que visiteur, je veux connaître le poids de la page affichée.

#### Critères d'acceptation

1. L'interface affiche `Poids : N octets` pour la page logique sélectionnée.
2. `N` provient de `Page.metadata.byteSize` sans recalcul côté navigateur.
3. Le poids concerne uniquement la page logique. Il n'inclut pas le document HTML ou les styles.
4. Le MVP n'affiche pas d'estimation d'économie ni de taille source non vérifiable.

### Exigence 6 — Décoration ASCII sur l'accueil

**Récit utilisateur :** En tant que visiteur, je veux une petite touche Halloween sur l'accueil.

#### Critères d'acceptation

1. La première page de l'accueil affiche une citrouille ou un fantôme ASCII fixe.
2. La décoration ne dépasse pas 12 caractères de large et 6 lignes de haut.
3. Elle n'apparaît ni dans un service, ni dans un état d'erreur, ni sur une page ultérieure de l'accueil.
4. Elle utilise uniquement du texte et du CSS, sans image, police d'icônes, canevas, son ni animation propre.
5. Elle est masquée aux technologies d'assistance avec `aria-hidden="true"`; le titre visible conserve l'identité de la page.

### Exigence 7 — Utilisation au clavier et sur téléphone

**Récit utilisateur :** En tant que visiteur au clavier ou sur téléphone, je veux accéder à tous les contrôles et lire tout le contenu.

#### Critères d'acceptation

1. Le document utilise des éléments HTML natifs pour le contenu principal, le formulaire, les boutons et la navigation.
2. Tous les contrôles sont accessibles avec Tab et activables avec Entrée ou Espace selon leur comportement natif.
3. Chaque contrôle possède un indicateur de focus nettement visible.
4. À partir d'une largeur de 320 pixels CSS et à 200 % de zoom, aucun contenu ni contrôle n'est coupé et la page n'a pas de défilement horizontal global.
5. Le champ utilise une taille de texte d'au moins 16 pixels sur téléphone afin d'éviter un zoom automatique à la prise de focus.
6. Les cibles tactiles principales ont une zone active d'au moins 44 × 44 pixels CSS.
7. Les effets CRT ne masquent ni le focus, ni le curseur, ni la sélection du texte.

### Exigence 8 — Fallback texte brut

**Récit utilisateur :** En tant qu'utilisateur d'un client simple, je veux accéder au contenu sans présentation HTML.

#### Critères d'acceptation

1. `GET /plain` renvoie `text/plain; charset=UTF-8`.
2. `/plain` accepte le même paramètre `q` et utilise le même routage que `/`.
3. La réponse conserve la sérialisation actuelle de toutes les pages avec `pagesToPlainText()`; le paramètre `page` n'y limite pas le contenu.
4. La page HTML expose un lien visible vers la version texte correspondant au contenu courant.
5. `/plain` ne dépend ni des styles ni de JavaScript.

## Facultatif après le MVP (*)

Les éléments suivants ne conditionnent pas la livraison du MVP :

- (*) API JSON dédiée et navigation sans rechargement de page.
- (*) Politique CSP avancée et durcissement d'en-têtes au-delà des protections déjà présentes dans l'application.
- (*) Budget global mesuré pour le HTML, le CSS et le JavaScript.
- (*) Routes d'assets dédiées avec chemins, cache et types MIME imposés par cette spec.
- (*) Suite exhaustive de tests de propriétés, de tests navigateur et de cas combinatoires. Le MVP conserve seulement des tests ciblés sur les parcours essentiels.

# Plan d'implémentation — Interface CRT MVP

## Périmètre

Le plan contient **9 tâches MVP obligatoires**. Il privilégie le rendu HTML côté serveur et la navigation native afin de tenir la clôture fonctionnelle du 28 novembre. Les puces internes précisent les résultats attendus ; elles ne constituent pas des tâches supplémentaires.

## Tâches MVP

- [ ] 1. Construire le modèle de vue minimal à partir du routage existant
  - Résoudre `q` comme code ou numéro de menu en réutilisant `ServiceRegistry`, la génération de l'accueil et le formateur actuels.
  - Borner `q`, gérer les erreurs sans réfléchir une valeur trop longue et conserver le code canonique d'un service valide.
  - Sélectionner une seule `Page` à partir de `page`, avec retour à la première page pour une valeur invalide et à la dernière pour une valeur excessive.
  - Copier les lignes, `pageNumber`, `totalPages` et `metadata.byteSize` sans reformater ni recalculer.
  - _Exigences : 1, 3.4, 3.6, 4.4-4.6, 5_

- [ ] 2. Servir le document HTML principal sur `GET /`
  - Remplacer la réponse racine par un document français complet contenant une seule page logique.
  - Échapper tout texte et toute valeur d'attribut dynamiques.
  - Garder visibles le titre, le contenu, les contrôles, les erreurs et les liens même sans CSS ou JavaScript.
  - Ne modifier ni les contrats des services, ni leur ordre, ni `/api/config`.
  - _Exigences : 1.1, 1.5-1.8_

- [ ] 3. Ajouter la saisie native des codes et numéros
  - Ajouter le formulaire `GET /`, le champ `q`, son libellé, l'exemple `3615 NEWS` ou `2` et un bouton d'envoi.
  - Ouvrir la page 1 lors d'une nouvelle saisie, conserver une valeur invalide bornée et configurer le champ pour le clavier mobile.
  - Garder le curseur natif vert et clignotant, sans `autofocus` ni faux curseur.
  - _Exigences : 3_

- [ ] 4. Ajouter la navigation entre les pages d'un service
  - Afficher `Page N/T` et les liens natifs précédent, suivant et accueil.
  - Retirer les directions indisponibles de l'ordre de tabulation.
  - Construire les URL avec des paramètres encodés et conserver `q` ainsi que `effects=off` quand ils s'appliquent.
  - Vérifier que les liens et le bouton Retour fonctionnent sans JavaScript.
  - _Exigences : 4_

- [ ] 5. Afficher le poids et la décoration ASCII
  - Afficher `Poids : N octets` depuis `Page.metadata.byteSize` pour la page courante uniquement.
  - Ajouter une citrouille ou un fantôme ASCII de 12 colonnes sur 6 lignes au maximum sur la première page de l'accueil.
  - Masquer la décoration dans les services, les erreurs et les pages suivantes, et la marquer `aria-hidden="true"`.
  - _Exigences : 5, 6_

- [ ] 6. Appliquer le style CRT léger et sa désactivation
  - Créer le fond noir, le texte vert, la pile monospace locale et la largeur préférée de `40ch`.
  - Ajouter une trame, un balayage lent et un scintillement faible au moyen de couches non interactives.
  - Ajouter un contrôle visible qui bascule `effects=off`, puis préserver ce choix dans les formulaires et les liens.
  - Désactiver les animations avec `prefers-reduced-motion: reduce`.
  - Ne pas imposer de route d'asset précise ni mesurer un budget global d'assets.
  - _Exigences : 2_

- [ ] 7. Rendre l'interface utilisable au clavier et sur téléphone
  - Utiliser les éléments HTML natifs, un ordre de tabulation logique et un indicateur `:focus-visible` net.
  - Prévoir des cibles tactiles d'au moins 44 × 44 pixels CSS et un champ d'au moins 16 pixels.
  - Adapter les contrôles à 320 pixels CSS et à 200 % de zoom sans coupure ni défilement horizontal global.
  - Vérifier que les effets ne bloquent ni le focus, ni la sélection, ni le curseur.
  - _Exigences : 7_

- [ ] 8. Ajouter le fallback texte brut sur `GET /plain`
  - Réutiliser exactement la résolution de `q` de la page HTML.
  - Répondre en `text/plain; charset=UTF-8` avec la sérialisation existante `pagesToPlainText()` de toutes les pages.
  - Ajouter dans le HTML un lien vers la version texte du contenu courant.
  - _Exigences : 8_

- [ ] 9. Ajouter les tests ciblés et valider le MVP
  - Couvrir par quelques tests HTTP l'accueil, un numéro de menu, `3615 NEWS`, une erreur, un service multipage, le poids et `/plain`.
  - Vérifier qu'une seule page est rendue, que le HTML dynamique est échappé et que la bascule des effets conserve la navigation.
  - Faire un contrôle manuel au clavier, sur une largeur de 320 pixels CSS, à 200 % de zoom et avec réduction des animations.
  - Exécuter les commandes non interactives de typecheck, tests et build déjà définies dans le dépôt.
  - Ne pas bloquer le MVP sur une suite exhaustive, des tests de propriétés, une automatisation navigateur ou une mesure des assets.
  - _Exigences : 1-8_

## Facultatif après le MVP (*)

Ces éléments ne sont pas des tâches du plan MVP et ne sont pas inclus dans le total de 9 :

- (*) API JSON et navigation sans rechargement.
- (*) Client TypeScript d'amélioration progressive.
- (*) CSP avancée et durcissement complet des en-têtes.
- (*) Budget d'assets mesuré avec seuil CI.
- (*) Routes d'assets exactes et stratégie de cache dédiée.
- (*) Tests exhaustifs, tests de propriétés et automatisation navigateur.

## Ordre recommandé

```text
1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
```

Les tâches 5 à 8 peuvent avancer en parallèle après la mise en place du document HTML et du modèle de vue.

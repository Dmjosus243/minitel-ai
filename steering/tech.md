# Stack technique

- Langage : TypeScript partout (strict mode).
- Backend : Node.js avec Hono.
- Interface : HTML/CSS + TypeScript, sans gros framework.
- Tests : Vitest et fast-check (tests basés sur les propriétés).
- Pas de dépendance lourde : garder le projet léger.

## Conventions
- Fonctions courtes, noms explicites, commentaires en français.
- Chaque service (news, météo...) est un module séparé dans src/services/.
- Toute fonction qui produit une page doit respecter 40 colonnes et 2 Ko.
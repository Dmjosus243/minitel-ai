# minitel-ai

## Configuration des pages

Le serveur charge sa configuration initiale depuis les variables d'environnement suivantes :

- `MINITEL_PAGE_COLUMNS` (défaut : `40`)
- `MINITEL_PAGE_ROWS` (défaut : `24`)
- `MINITEL_PAGE_MAX_BYTES` (défaut : `2048`)
- `MINITEL_PAGE_WORD_WRAP` (défaut : `true`)

`GET /api/config` retourne la configuration active. `PATCH /api/config` accepte un objet JSON partiel et applique immédiatement les valeurs valides. Une mise à jour invalide est rejetée en entier avec un statut HTTP 400.

Les intégrations TypeScript peuvent utiliser `getPageConfig()` et `updatePageConfig()` depuis le point d'entrée du paquet.

## Configuration du service 3615 NEWS

Le service NEWS lit sa configuration au démarrage dans les variables d'environnement suivantes :

| Variable | Obligatoire | Défaut | Valeurs acceptées |
| --- | --- | --- | --- |
| `NEWS_RSS_URL` | oui | aucun | URL HTTPS absolue d'un flux RSS 2.0 public |
| `NEWS_SUMMARIZER_MODE` | non | `extractive` | `extractive` ou `ai`, sans distinction de casse et après suppression des espaces externes |
| `NEWS_MAX_ARTICLES` | non | `5` | entier de `1` à `20` |
| `NEWS_RSS_TIMEOUT_MS` | non | `5000` | entier de `1` à `60000` millisecondes |
| `NEWS_RSS_MAX_BYTES` | non | `1048576` | entier de `1` à `10485760` octets |
| `NEWS_AI_ENDPOINT` | en mode `ai` | aucun | URL HTTPS absolue de la passerelle de résumés |
| `NEWS_AI_MODEL` | non | omis | nom de modèle non vide |
| `NEWS_AI_API_KEY` | non | omise | clé envoyée comme jeton Bearer |
| `NEWS_AI_TIMEOUT_MS` | non | `5000` | entier de `1` à `60000` millisecondes |

Le mode `extractive` est le mode par défaut sans IA. Il résume le texte déjà présent dans le flux et n'appelle aucune passerelle IA. Le mode `ai` utilise la passerelle configurée, avec un repli extractif article par article si cette passerelle échoue.

L'exploitant est responsable du choix d'un flux RSS public et licite, dont les conditions autorisent l'utilisation prévue. NEWS télécharge uniquement le flux configuré : il ne suit pas les liens des éléments RSS et ne télécharge ni ne scrape les pages d'article correspondantes. Une configuration absente ou invalide laisse le service enregistré, mais celui-ci affiche `Service temporairement indisponible` sans exposer l'URL ou les secrets configurés.

### Contrat de la passerelle IA

En mode `ai`, NEWS envoie une requête HTTPS `POST` avec `Content-Type: application/json`. La clé `NEWS_AI_API_KEY`, lorsqu'elle est définie, est placée dans l'en-tête `Authorization: Bearer ...`. Le corps suit ce contrat :

```json
{
  "model": "nom-de-modele-optionnel",
  "input": {
    "title": "titre nettoyé",
    "text": "texte source nettoyé"
  },
  "constraints": {
    "language": "fr",
    "maxCharacters": 600,
    "columns": 40,
    "rows": 24,
    "maxBytes": 2048
  }
}
```

La propriété `model` est omise lorsque `NEWS_AI_MODEL` n'est pas défini. La passerelle doit répondre avec un statut HTTP de succès et un objet JSON contenant une propriété `summary` de type chaîne :

```json
{
  "summary": "Résumé français en texte simple"
}
```

## Extensions du transformateur

`registerPageTransformer()` enregistre une extension nommée exécutée avant la mise en page. La fonction retournée désenregistre l'extension et invalide le cache des pages transformées.

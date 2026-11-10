import { Hono } from 'hono';

import { formatText } from './core/formatter';
import { defaultRegistry, route } from './core/router';
import type { Page } from './core/types';
import { generateHomepage } from './services/home';

const MENU_NUMBER_PATTERN = /^\d+$/u;
const HOMEPAGE_TITLE = 'MINITEL IA';
const HOMEPAGE_RETURN = "Retour à l'accueil";

function homepage(message?: string): Page[] {
  const header = message === undefined
    ? HOMEPAGE_TITLE
    : `${message}\n\n${HOMEPAGE_TITLE}`;

  return generateHomepage(defaultRegistry.getAll(), {
    layout: { header },
  });
}

function errorPage(message: string): Page[] {
  return formatText(`${message}\n\n${HOMEPAGE_RETURN}`);
}

async function routeService(code: string): Promise<Page[]> {
  try {
    return await route(code);
  } catch {
    return errorPage('Service temporairement indisponible');
  }
}

/** Résout une saisie en code Minitel ou en numéro du menu courant. */
async function pagesForQuery(query: string | undefined): Promise<Page[]> {
  const input = query?.trim();

  if (!input) {
    return homepage();
  }

  if (MENU_NUMBER_PATTERN.test(input)) {
    const menuIndex = Number(input) - 1;
    const service = Number.isSafeInteger(menuIndex) && menuIndex >= 0
      ? defaultRegistry.getAll()[menuIndex]
      : undefined;

    return service === undefined
      ? homepage('Numéro invalide')
      : routeService(service.code);
  }

  try {
    const service = defaultRegistry.get(input);
    return service === null
      ? errorPage('Code inconnu')
      : routeService(service.code);
  } catch {
    return errorPage('Code inconnu');
  }
}

/** Sérialise chaque page comme texte lisible et affiche son poids UTF-8. */
export function pagesToPlainText(pages: readonly Page[]): string {
  return pages
    .map((page) => {
      const content = page.content.join('\n');
      const weight = `Poids: ${page.metadata.byteSize} octets`;

      return content.length > 0 ? `${content}\n\n${weight}` : weight;
    })
    .join('\n\n');
}

export const app = new Hono();

app.get('/', async (context) => {
  const pages = await pagesForQuery(context.req.query('q'));
  return context.text(pagesToPlainText(pages));
});

export default app;

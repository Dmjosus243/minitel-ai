import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Hono, type Context, type Next } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { getPageConfig, updatePageConfig } from './core/config';
import { clearPageCache, formatText } from './core/formatter';
import { responseTimeMonitor } from './core/performance';
import {
  defaultRegistry,
  route,
  SERVICE_UNAVAILABLE_MESSAGE,
} from './core/router';
import type { Page } from './core/types';
import { generateHomepage } from './services/home';

const MENU_NUMBER_PATTERN = /^\d+$/u;
const BEARER_PATTERN = /^Bearer\s+(.+)$/iu;
const MAX_CONFIG_BODY_BYTES = 4 * 1024;
const ADMIN_ERROR_MESSAGE = 'Administration token is missing or invalid.';
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
  } catch (error) {
    console.error(`Unexpected service routing failure for ${code}.`, error);
    return errorPage(SERVICE_UNAVAILABLE_MESSAGE);
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

/** Compare le jeton reçu au secret attendu sans exposer d'information par le temps de réponse. */
function isAuthorizedBearer(
  authorization: string | undefined,
  adminToken: string,
): boolean {
  const match = BEARER_PATTERN.exec(authorization ?? '');
  const receivedToken = Buffer.from(match?.[1] ?? '', 'utf8');
  const expectedToken = Buffer.from(adminToken, 'utf8');

  if (receivedToken.length !== expectedToken.length) {
    return false;
  }

  return timingSafeEqual(receivedToken, expectedToken);
}

/** Exige « Authorization: Bearer <ADMIN_TOKEN> » ; sans ADMIN_TOKEN configuré, la route refuse tout. */
async function requireAdminToken(
  context: Context,
  next: Next,
): Promise<Response | void> {
  const adminToken = process.env.ADMIN_TOKEN;

  if (
    adminToken === undefined
    || adminToken.trim() === ''
    || !isAuthorizedBearer(context.req.header('Authorization'), adminToken)
  ) {
    return context.json({ error: ADMIN_ERROR_MESSAGE }, 403);
  }

  await next();
  return undefined;
}

async function updateRuntimePageConfiguration(
  context: Context,
): Promise<Response> {
  let value: unknown;

  try {
    value = await context.req.json<unknown>();
  } catch {
    return context.json(
      { error: 'Request body must contain valid JSON.' },
      400,
    );
  }

  try {
    const pageConfig = updatePageConfig(value);
    clearPageCache();
    return context.json(pageConfig);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Invalid page configuration.';

    return context.json({ error: message }, 400);
  }
}

export const app = new Hono();

app.use('*', async (context, next) => {
  const startedAt = performance.now();

  try {
    await next();
  } finally {
    const durationMs = performance.now() - startedAt;
    const formattedDuration = durationMs.toFixed(2);

    responseTimeMonitor.record('httpResponse', durationMs);
    context.header('Server-Timing', `total;dur=${formattedDuration}`);
    context.header('X-Response-Time', `${formattedDuration}ms`);
  }
});

app.get('/api/config', (context) => context.json(getPageConfig()));
app.patch(
  '/api/config',
  requireAdminToken,
  bodyLimit({
    maxSize: MAX_CONFIG_BODY_BYTES,
    onError: (context) => context.json(
      { error: 'Request body must not exceed 4 KiB.' },
      413,
    ),
  }),
  updateRuntimePageConfiguration,
);

app.get('/', async (context) => {
  const pages = await pagesForQuery(context.req.query('q'));
  return context.text(pagesToPlainText(pages));
});

app.onError((error, context) => {
  console.error('Unhandled request failure.', error);

  // Keep the interface responsive even if normal page formatting cannot recover.
  return context.text(`${SERVICE_UNAVAILABLE_MESSAGE}\n\n${HOMEPAGE_RETURN}`);
});

export { responseTimeMonitor };
export default app;

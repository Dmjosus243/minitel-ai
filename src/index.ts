import { serve } from '@hono/node-server';

import { registerService } from './core/router';
import app from './server';
import { aideService } from './services/aide';
import { newsService } from './services/news';

registerService(aideService);
registerService(newsService);

export const PORT = 3000;

export function startServer() {
  return serve(
    {
      fetch: app.fetch,
      port: PORT,
    },
    ({ port }) => {
      console.log(`Serveur Minitel disponible sur http://localhost:${port}`);
    },
  );
}

// Les tests importent l'application sans ouvrir de socket.
if (
  process.env.NODE_ENV !== 'test'
  && typeof require !== 'undefined'
  && typeof module !== 'undefined'
  && require.main === module
) {
  startServer();
}

export {
  getPageConfig,
  loadPageConfig,
  runtimePageConfiguration,
  updatePageConfig,
} from './core/config';
export {
  registerPageTransformer,
  unregisterPageTransformer,
} from './core/formatter';
export { responseTimeMonitor } from './core/performance';
export { app };
export default app;

import { serve } from '@hono/node-server';

import { registerService } from './core/router';
import app from './server';
import { aideService } from './services/aide';

registerService(aideService);

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

export { app };
export default app;

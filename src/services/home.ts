import { formatText } from '../core/formatter';
import { defaultRegistry, ServiceRegistry } from '../core/router';
import type { Page, Service } from '../core/types';

function formatMenuEntry(service: Service, index: number): string {
  const heading = `${index + 1}. ${service.title} (${service.code})`;
  const description = service.description?.trim();

  return description ? `${heading} - ${description}` : heading;
}

/** Transforme une liste de services en menu Minitel numéroté. */
export function generateHomepage(services: readonly Service[]): Page[] {
  const menu = services.map(formatMenuEntry).join('\n');
  return formatText(menu);
}

/** Génère toujours l'accueil depuis l'état courant du registre. */
export class HomepageGenerator {
  constructor(private readonly registry: ServiceRegistry = defaultRegistry) {}

  generateHomepage(): Page[] {
    return generateHomepage(this.registry.getAll());
  }
}

export const Homepage_Generator = new HomepageGenerator();

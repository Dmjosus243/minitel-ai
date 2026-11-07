import { formatText } from '../core/formatter';
import { defaultRegistry, ServiceRegistry } from '../core/router';
import type { Page, Service } from '../core/types';

export type MenuFormat = 'inline' | 'compact' | 'detailed';

export interface MenuLayout {
  format?: MenuFormat;
  header?: string;
  footer?: string;
  itemSeparator?: string;
  sectionSeparator?: string;
}

export interface MenuStyle {
  numberPrefix?: string;
  numberSuffix?: string;
  codePrefix?: string;
  codeSuffix?: string;
  descriptionPrefix?: string;
}

export interface HomepageConfig {
  layout?: MenuLayout;
  style?: MenuStyle;
}

interface ResolvedMenuLayout {
  format: MenuFormat;
  header?: string;
  footer?: string;
  itemSeparator: string;
  sectionSeparator: string;
}

interface ResolvedMenuStyle {
  numberPrefix: string;
  numberSuffix: string;
  codePrefix: string;
  codeSuffix: string;
  descriptionPrefix: string;
}

const DEFAULT_MENU_LAYOUT: Readonly<ResolvedMenuLayout> = Object.freeze({
  format: 'inline',
  itemSeparator: '\n',
  sectionSeparator: '\n',
});

const DEFAULT_MENU_STYLE: Readonly<ResolvedMenuStyle> = Object.freeze({
  numberPrefix: '',
  numberSuffix: '.',
  codePrefix: '(',
  codeSuffix: ')',
  descriptionPrefix: ' - ',
});

function resolveConfig(config: HomepageConfig): {
  layout: ResolvedMenuLayout;
  style: ResolvedMenuStyle;
} {
  return {
    layout: {
      ...DEFAULT_MENU_LAYOUT,
      ...config.layout,
    },
    style: {
      ...DEFAULT_MENU_STYLE,
      ...config.style,
    },
  };
}

function formatMenuEntry(
  service: Service,
  index: number,
  layout: ResolvedMenuLayout,
  style: ResolvedMenuStyle,
): string {
  const number = `${style.numberPrefix}${index + 1}${style.numberSuffix}`;
  const code = `${style.codePrefix}${service.code}${style.codeSuffix}`;
  const description = service.description?.trim();

  switch (layout.format) {
    case 'inline': {
      const heading = `${number} ${service.title} ${code}`;
      return description
        ? `${heading}${style.descriptionPrefix}${description}`
        : heading;
    }
    case 'compact': {
      const heading = `${number} ${code} ${service.title}`;
      return description
        ? `${heading}${style.descriptionPrefix}${description}`
        : heading;
    }
    case 'detailed': {
      const heading = `${number} ${service.title} ${code}`;
      return description
        ? `${heading}\n${style.descriptionPrefix}${description}`
        : heading;
    }
    default:
      throw new RangeError(`Unsupported menu format: ${String(layout.format)}.`);
  }
}

/** Transforme une liste de services en menu Minitel configurable et numéroté. */
export function generateHomepage(
  services: readonly Service[],
  config: HomepageConfig = {},
): Page[] {
  const { layout, style } = resolveConfig(config);
  const menu = services
    .map((service, index) => formatMenuEntry(service, index, layout, style))
    .join(layout.itemSeparator);
  const sections: string[] = [];

  if (layout.header !== undefined) {
    sections.push(layout.header);
  }
  if (menu.length > 0) {
    sections.push(menu);
  }
  if (layout.footer !== undefined) {
    sections.push(layout.footer);
  }

  return formatText(sections.join(layout.sectionSeparator));
}

/** Génère toujours l'accueil depuis l'état courant du registre. */
export class HomepageGenerator {
  constructor(
    private readonly registry: ServiceRegistry = defaultRegistry,
    private readonly config: HomepageConfig = {},
  ) {}

  generateHomepage(): Page[] {
    return generateHomepage(this.registry.getAll(), this.config);
  }
}

export const Homepage_Generator = new HomepageGenerator();

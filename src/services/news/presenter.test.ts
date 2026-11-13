import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE_CONFIG,
  formatText,
  pageWeight,
} from '../../core/formatter';
import {
  fitArticleBlock,
  renderArticleBlock,
  renderNews,
  sanitizeExternalText,
} from './presenter';
import type { NewsItem } from './types';

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function expectOneDefaultPage(block: string): void {
  const pages = formatText(block, { ...DEFAULT_PAGE_CONFIG });

  expect(pages).toHaveLength(1);
  const page = pages[0];
  expect(page).toBeDefined();
  if (page === undefined) {
    return;
  }

  expect(page.content.length).toBeLessThanOrEqual(DEFAULT_PAGE_CONFIG.rows);
  for (const line of page.content) {
    expect(codePointLength(line)).toBeLessThanOrEqual(
      DEFAULT_PAGE_CONFIG.columns,
    );
  }
  expect(pageWeight(page)).toBeLessThan(DEFAULT_PAGE_CONFIG.maxBytes);
}

describe('nettoyage et rendu NEWS', () => {
  it('retire le balisage et le contenu actif tout en conservant le texte lisible', () => {
    /** **Validates: Requirements 6.2, 6.4** */
    const sanitized = sanitizeExternalText([
      '<article>Actualité <strong>utile</strong>.</article>',
      '<script>volerLesDonnees()</script>',
      '<style>article { display: none; }</style>',
      '<!-- commentaire --><![CDATA[Texte XML]]>',
      '<?instruction interdite?><meta name="test">',
    ].join(' '));

    expect(sanitized).toBe('Actualité utile. Texte XML');
  });

  it('neutralise le balisage encodé, les contrôles et les commandes bidi', () => {
    /** **Validates: Requirements 6.4** */
    const sanitized = sanitizeExternalText(
      'Crème e\u0301\t🌍 👩‍💻\u0000\u001b\u202e '
      + '&lt;script&gt;secret()&lt;/script&gt; 世界 &amp; paix',
    );

    expect(sanitized).toBe('Crème é 🌍 👩‍💻 世界 & paix');
    expect(sanitized).not.toMatch(/\p{Cc}/u);
    expect(sanitized).not.toContain('secret');
  });

  it('rend les métadonnées présentes avec une date UTC déterministe', () => {
    /** **Validates: Requirements 6.2, 6.3, 6.4** */
    const block = renderArticleBlock({
      title: '<b>Titre été</b>',
      sourceText: 'Corps',
      source: 'Agence <i>France</i>',
      publishedAt: new Date('2026-11-11T23:30:00-02:00'),
    }, '<p>Résumé fiable.</p>', 7);

    expect(block).toBe([
      '7. Titre été',
      'Agence France - 2026-11-12',
      'Résumé fiable.',
    ].join('\n'));
  });

  it('omet sans séparateur les métadonnées absentes ou invalides', () => {
    /** **Validates: Requirements 6.2, 6.3** */
    const withoutMetadata = renderArticleBlock({
      title: 'Titre',
      sourceText: 'Corps',
      source: '<style>invisible</style>',
      publishedAt: new Date(Number.NaN),
    }, 'Résumé.');
    const withDateOnly = renderArticleBlock({
      title: 'Autre titre',
      sourceText: 'Corps',
      publishedAt: new Date('2027-01-02T03:04:05.000Z'),
    }, 'Autre résumé.', 2);

    expect(withoutMetadata).toBe('1. Titre\nRésumé.');
    expect(withDateOnly).toBe(
      '2. Autre titre\n2027-01-02\nAutre résumé.',
    );
    expect(withoutMetadata).not.toContain(' - ');
  });

  it('rend le titre, la numérotation et les articles dans l’ordre du flux', () => {
    /** **Validates: Requirements 6.1, 6.2, 6.4** */
    const rendered = renderNews([
      {
        item: {
          title: 'Première actualité',
          sourceText: 'Premier corps.',
          source: 'Agence A',
        },
        summary: 'Premier résumé.',
      },
      {
        item: {
          title: 'Deuxième actualité',
          sourceText: 'Deuxième corps.',
        },
        summary: 'Deuxième résumé.',
      },
    ]);

    expect(rendered).toBe([
      '3615 NEWS',
      '',
      '1. Première actualité',
      'Agence A',
      'Premier résumé.',
      '',
      '2. Deuxième actualité',
      'Deuxième résumé.',
    ].join('\n'));
  });

  it('rend le message vide exact lorsqu’aucun article valide n’est fourni', () => {
    /** **Validates: Requirements 6.5** */
    expect(renderNews([])).toBe('Aucune actualité disponible');
  });
});

describe('ajustement des blocs d’article NEWS', () => {
  it('borne le titre, la source et le résumé à une limite de mot', () => {
    /** **Validates: Requirements 4.3, 5.4, 6.2, 6.6** */
    const block = fitArticleBlock({
      title: Array.from({ length: 30 }, () => 'titre').join(' '),
      sourceText: 'Corps de l’article.',
      source: Array.from({ length: 20 }, () => 'source').join(' '),
    }, Array.from({ length: 120 }, () => 'résumé').join(' '));
    const [numberedTitle, source, summary] = block.split('\n');

    expect(numberedTitle).toBeDefined();
    expect(source).toBeDefined();
    expect(summary).toBeDefined();
    expect(codePointLength(numberedTitle?.slice('1. '.length) ?? ''))
      .toBeLessThanOrEqual(120);
    expect(codePointLength(source ?? '')).toBeLessThanOrEqual(40);
    expect(codePointLength(summary ?? '')).toBeLessThanOrEqual(600);
    expect(numberedTitle).toMatch(/^1\. (?:titre ?)+\.\.\.$/u);
    expect(source).toMatch(/^(?:source ?)+\.\.\.$/u);
    expect(summary).toMatch(/^(?:résumé ?)+\.\.\.$/u);
    expectOneDefaultPage(block);
  });

  it('nettoie les accents, marques combinées, emoji et contrôles avant ajustement', () => {
    /** **Validates: Requirements 5.4, 6.2, 6.4, 6.6** */
    const block = fitArticleBlock({
      title: '<h1>Été e\u0301 🌍</h1>\u0000',
      sourceText: 'Texte source.',
      source: '<b>Réseau 👩‍💻</b>\u0007',
    }, '<p>Résumé e\u0301clairé 😀.</p><script>attaque()</script>');

    expect(block).toContain('1. Été é 🌍');
    expect(block).toContain('Réseau 👩‍💻');
    expect(block).toContain('Résumé éclairé 😀.');
    expect(block).not.toContain('<');
    expect(block).not.toContain('attaque');
    expectOneDefaultPage(block);
  });

  it.each([39, 40, 41])(
    'conserve un mot sûr de %i points de code autour de la limite de colonne',
    (summaryLength) => {
      /** **Validates: Requirements 6.6, 6.7** */
      const summary = 'é'.repeat(summaryLength);
      const block = fitArticleBlock({
        title: 'Titre',
        sourceText: 'Corps',
      }, summary);

      expect(block.split('\n').at(-1)).toBe(summary);
      expectOneDefaultPage(block);
    },
  );

  it.each([22, 23, 24])(
    'ajuste %i lignes potentielles de résumé autour de la limite de page',
    (wordCount) => {
      /** **Validates: Requirements 4.3, 6.6, 6.7** */
      const word = 'abcdefghijklmnopqrst';
      const summary = Array.from({ length: wordCount }, () => word).join(' ');
      const block = fitArticleBlock({
        title: 'Titre',
        sourceText: 'Corps',
      }, summary);
      const fittedSummary = block.split('\n').at(-1);

      if (wordCount <= 23) {
        expect(fittedSummary).toBe(summary);
      } else {
        expect(fittedSummary).not.toBe(summary);
        expect(fittedSummary).toMatch(/\.\.\.$/u);
      }
      expectOneDefaultPage(block);
    },
  );

  it.each([479, 480, 481, 599, 600, 601])(
    'ajuste un résumé multioctet de %i points de code près de la limite UTF-8',
    (summaryLength) => {
      /** **Validates: Requirements 5.4, 6.6, 6.7, 6.8** */
      const block = fitArticleBlock({
        title: '界'.repeat(120),
        sourceText: '界'.repeat(20),
        source: 'é'.repeat(40),
        publishedAt: new Date('2026-11-11T00:00:00.000Z'),
      }, '😀'.repeat(summaryLength), 42);

      expect(block).toMatch(/^42\. /u);
      expect(block).not.toContain('\ufffd');
      expectOneDefaultPage(block);
    },
  );

  it('réduit les mots finaux du résumé qui feraient dépasser 24 lignes', () => {
    /** **Validates: Requirements 4.3, 6.6, 6.7, 6.8** */
    const word = 'abcdefghijklmnopqrst';
    const oversizedSummary = Array.from({ length: 28 }, () => word).join(' ');
    const unfittedBlock = renderArticleBlock({
      title: 'Titre',
      sourceText: 'Corps',
    }, oversizedSummary);
    const fittedBlock = fitArticleBlock({
      title: 'Titre',
      sourceText: 'Corps',
    }, oversizedSummary);

    expect(formatText(unfittedBlock, { ...DEFAULT_PAGE_CONFIG }).length)
      .toBeGreaterThan(1);
    expect(fittedBlock).not.toBe(unfittedBlock);
    expect(fittedBlock.split('\n').at(-1)).toMatch(/\.\.\.$/u);
    expectOneDefaultPage(fittedBlock);
  });

  it('ajuste un bloc entièrement multioctet qui dépasse initialement le poids maximal', () => {
    /** **Validates: Requirements 5.4, 6.4, 6.6, 6.8** */
    const item: NewsItem = {
      title: '界'.repeat(120),
      sourceText: '界'.repeat(80),
      source: 'é'.repeat(40),
    };
    const summary = '😀'.repeat(600);
    const unfittedBlock = renderArticleBlock(item, summary);
    const fittedBlock = fitArticleBlock(item, summary);

    expect(formatText(unfittedBlock, { ...DEFAULT_PAGE_CONFIG }).length)
      .toBeGreaterThan(1);
    expect(fittedBlock).not.toBe(unfittedBlock);
    expect(fittedBlock).toMatch(/^1\. /u);
    expectOneDefaultPage(fittedBlock);
  });
});

const externalFragmentArbitrary = fc.oneof(
  fc.string({ maxLength: 240 }),
  fc.constantFrom(
    '<b>texte</b>',
    '<script>instruction hostile</script>',
    '<style>contenu invisible</style>',
    '<!-- commentaire --><p>visible</p>',
    '&lt;em&gt;encodé&lt;/em&gt;',
    '\u0000\u0007\u001b\u202e',
    'Économie e\u0301cologique 🌍 👩‍💻',
    '界'.repeat(800),
    '😀'.repeat(800),
    'mot-très-long'.repeat(80),
  ),
);

const generatedExternalTextArbitrary = fc
  .array(externalFragmentArbitrary, { maxLength: 8 })
  .map((fragments) => fragments.join(' '));

const generatedDateArbitrary = fc.oneof(
  fc.integer({
    min: -2_208_988_800_000,
    max: 4_102_444_800_000,
  }).map((timestamp) => new Date(timestamp)),
  fc.constant(new Date(Number.NaN)),
);

const generatedNewsItemArbitrary: fc.Arbitrary<NewsItem> = fc.record({
  title: generatedExternalTextArbitrary.map((value) => `Titre ${value}`),
  sourceText: generatedExternalTextArbitrary.map((value) => `Source ${value}`),
  source: fc.option(generatedExternalTextArbitrary, { nil: undefined }),
  publishedAt: fc.option(generatedDateArbitrary, { nil: undefined }),
});

const generatedSummaryArbitrary = generatedExternalTextArbitrary
  .map((value) => `Résumé ${value}`);

describe('propriétés de présentation NEWS', () => {
  it('Feature: news-service, Property 4: Article Block Fit', () => {
    /** **Validates: Requirements 5.4, 6.2, 6.4, 6.6, 6.7, 6.8** */
    fc.assert(
      fc.property(
        generatedNewsItemArbitrary,
        generatedSummaryArbitrary,
        (item, summary) => {
          const block = fitArticleBlock(item, summary);
          const pages = formatText(block, { ...DEFAULT_PAGE_CONFIG });

          expect(block.length).toBeGreaterThan(0);
          expect(block).toMatch(/^1\. /u);
          expect(block).not.toMatch(/<\/?[A-Za-z_][^<>]*>/u);
          expect(block).not.toMatch(
            /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u,
          );
          expect(pages).toHaveLength(1);

          const page = pages[0];
          expect(page).toBeDefined();
          if (page === undefined) {
            return;
          }

          expect(page.content.length).toBeLessThanOrEqual(
            DEFAULT_PAGE_CONFIG.rows,
          );
          for (const line of page.content) {
            expect(codePointLength(line)).toBeLessThanOrEqual(
              DEFAULT_PAGE_CONFIG.columns,
            );
          }
          expect(pageWeight(page)).toBeLessThan(
            DEFAULT_PAGE_CONFIG.maxBytes,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

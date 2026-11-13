import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBoundedRssTransport,
  createRssProvider,
  createSafeRssParser,
  normalizeRssItems,
  RssSourceError,
  type FetchRss,
  type ParsedRssItem,
  type RssFetchImplementation,
} from './rss-provider';

const RSS_URL = new URL('https://actualites.example/rss.xml?edition=fr');
const TEXT_ENCODER = new TextEncoder();
const BASE_CONFIG = Object.freeze({
  rssUrl: RSS_URL,
  maxArticles: 5,
  rssTimeoutMs: 1_000,
  rssMaxBytes: 16_384,
});

const COMPLETE_RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Fil public</title>
    <item>
      <title><![CDATA[Économie <b>d'été</b> 🙂]]></title>
      <content:encoded><![CDATA[
        <p>Corps principal &amp; détails.</p>
        <script>instruction dangereuse</script>
      ]]></content:encoded>
      <description>Cette description ne doit pas gagner.</description>
      <source>Agence &amp; presse</source>
      <pubDate>Tue, 11 Nov 2025 10:00:00 GMT</pubDate>
      <link>https://articles.example/ne-pas-charger</link>
    </item>
    <item>
      <title>Deuxième actualité</title>
      <content:encoded>   </content:encoded>
      <description>Résumé <em>utile</em>.</description>
      <pubDate>date impossible</pubDate>
    </item>
    <item>
      <description>Article sans titre</description>
    </item>
    <item>
      <title><![CDATA[<script>titre caché</script>]]></title>
      <description>Encore invalide</description>
    </item>
  </channel>
</rss>`;

function streamResponse(
  chunks: readonly Uint8Array[],
  init: ResponseInit = {},
): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/rss+xml; charset=utf-8');
  }

  return new Response(body, {
    ...init,
    headers,
  });
}

function providerFromXml(xml: string, maxArticles = 5) {
  return createRssProvider({
    config: {
      ...BASE_CONFIG,
      maxArticles,
    },
    fetchRss: async () => ({
      status: 200,
      body: TEXT_ENCODER.encode(xml),
    }),
    parser: createSafeRssParser(),
  });
}

function captureRssError(action: () => unknown): RssSourceError {
  try {
    action();
  } catch (error) {
    if (error instanceof RssSourceError) {
      return error;
    }
    throw error;
  }

  throw new Error('Une erreur RSS était attendue.');
}

async function captureAsyncRssError(
  action: Promise<unknown>,
): Promise<RssSourceError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof RssSourceError) {
      return error;
    }
    throw error;
  }

  throw new Error('Une erreur RSS asynchrone était attendue.');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('transport et fournisseur RSS bornés', () => {
  it('lit un flux injecté, assainit les champs et ne charge jamais les liens d’article', async () => {
    /** **Validates: Requirements 2.3, 2.4, 2.5, 2.8, 8.5** */
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImplementation: RssFetchImplementation = async (url, init) => {
      requests.push({ url: url.href, init });
      const bytes = TEXT_ENCODER.encode(COMPLETE_RSS_FIXTURE);
      return streamResponse([
        bytes.subarray(0, 97),
        bytes.subarray(97),
      ]);
    };
    const provider = createRssProvider({
      config: BASE_CONFIG,
      fetchRss: createBoundedRssTransport(fetchImplementation),
      parser: createSafeRssParser(),
    });

    const items = await provider.fetchLatest(new AbortController().signal);

    expect(items).toEqual([
      {
        title: "Économie d'été 🙂",
        sourceText: 'Corps principal & détails.',
        source: 'Agence & presse',
        publishedAt: new Date('2025-11-11T10:00:00.000Z'),
      },
      {
        title: 'Deuxième actualité',
        sourceText: 'Résumé utile .',
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(RSS_URL.href);
    expect(requests[0]?.init).toMatchObject({
      credentials: 'omit',
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
    });
    const requestHeaders = new Headers(requests[0]?.init.headers);
    expect(requestHeaders.get('cookie')).toBeNull();
    expect(requestHeaders.get('authorization')).toBeNull();
  });

  it('préfère le contenu, puis la description, puis le titre et omet les métadonnées invalides', () => {
    /** **Validates: Requirements 2.5, 2.6, 7.3** */
    const normalized = normalizeRssItems([
      {
        title: ' Premier ',
        content: '<p>Contenu retenu</p>',
        description: 'Description ignorée',
        source: '<style>secret</style>',
        publishedAt: 'invalide',
      },
      {
        title: 'Deuxième',
        content: ' ',
        description: '<b>Description retenue</b>',
      },
      {
        title: 'Titre de repli',
      },
      {
        title: '   ',
        description: 'Sans titre',
      },
    ], 5);

    expect(normalized).toEqual([
      { title: 'Premier', sourceText: 'Contenu retenu' },
      { title: 'Deuxième', sourceText: 'Description retenue' },
      { title: 'Titre de repli', sourceText: 'Titre de repli' },
    ]);
  });

  it('conserve l’ordre des éléments valides et s’arrête à la limite configurée', async () => {
    /** **Validates: Requirements 2.6, 2.7, 7.3** */
    const xml = `
      <rss version="2.0"><channel>
        <item><title>Un</title></item>
        <item><title> </title></item>
        <item><title>Deux</title></item>
        <item><title>Trois</title></item>
      </channel></rss>`;

    const items = await providerFromXml(xml, 2).fetchLatest(
      new AbortController().signal,
    );

    expect(items.map((item) => item.title)).toEqual(['Un', 'Deux']);
  });

  it('suit seulement les redirections HTTPS avec les mêmes options sans identité', async () => {
    /** **Validates: Requirements 2.3, 8.7** */
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImplementation: RssFetchImplementation = async (url, init) => {
      requests.push({ url: url.href, init });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn.example/feed.xml' },
        });
      }

      return streamResponse([TEXT_ENCODER.encode('<rss><channel /></rss>')]);
    };
    const transport = createBoundedRssTransport(fetchImplementation);

    const response = await transport(RSS_URL, {
      signal: new AbortController().signal,
      maxBytes: 1_024,
    });

    expect(new TextDecoder().decode(response.body)).toBe('<rss><channel /></rss>');
    expect(requests.map(({ url }) => url)).toEqual([
      RSS_URL.href,
      'https://cdn.example/feed.xml',
    ]);
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true);
  });

  it('rejette une redirection non HTTPS sans effectuer la seconde requête', async () => {
    /** **Validates: Requirements 2.3, 7.1, 8.7** */
    const fetchImplementation = vi.fn<RssFetchImplementation>(async () => (
      new Response(null, {
        status: 301,
        headers: { location: 'http://interne.example/feed.xml?secret=oui' },
      })
    ));
    const transport = createBoundedRssTransport(fetchImplementation);

    const error = await captureAsyncRssError(transport(RSS_URL, {
      signal: new AbortController().signal,
      maxBytes: 1_024,
    }));

    expect(error.kind).toBe('redirect');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(`${error.message}\n${error.stack}`).not.toContain('secret=oui');
  });

  it.each([
    {
      expectedKind: 'status',
      response: () => new Response('corps confidentiel', {
        status: 503,
        headers: { 'content-type': 'application/rss+xml' },
      }),
    },
    {
      expectedKind: 'content-type',
      response: () => new Response('<html>pas un flux</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    },
  ] as const)(
    'classe une réponse distante en erreur $expectedKind sans exposer son corps',
    async ({ expectedKind, response }) => {
      /** **Validates: Requirements 2.3, 7.1, 8.7** */
      const transport = createBoundedRssTransport(async () => response());

      const error = await captureAsyncRssError(transport(RSS_URL, {
        signal: new AbortController().signal,
        maxBytes: 1_024,
      }));
      const diagnostic = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;

      expect(error.kind).toBe(expectedKind);
      expect(diagnostic).not.toContain('corps confidentiel');
      expect(diagnostic).not.toContain('pas un flux');
      expect(diagnostic).not.toContain(RSS_URL.search);
    },
  );

  it('interrompt la lecture dès qu’un flux dépasse la limite en octets', async () => {
    /** **Validates: Requirements 2.9, 7.1, 8.5** */
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(TEXT_ENCODER.encode('1234'));
        controller.enqueue(TEXT_ENCODER.encode('5678'));
      },
      cancel() {
        canceled = true;
      },
    });
    const transport = createBoundedRssTransport(async () => new Response(body, {
      headers: { 'content-type': 'application/xml' },
    }));

    const error = await captureAsyncRssError(transport(RSS_URL, {
      signal: new AbortController().signal,
      maxBytes: 6,
    }));

    expect(error.kind).toBe('body-too-large');
    expect(canceled).toBe(true);
  });

  it('vérifie aussi la limite lorsqu’un transport injecté renvoie directement les octets', async () => {
    /** **Validates: Requirements 2.9, 8.5** */
    const provider = createRssProvider({
      config: { ...BASE_CONFIG, rssMaxBytes: 4 },
      fetchRss: async () => ({
        status: 200,
        body: TEXT_ENCODER.encode('12345'),
      }),
      parser: createSafeRssParser(),
    });

    const error = await captureAsyncRssError(provider.fetchLatest(
      new AbortController().signal,
    ));

    expect(error.kind).toBe('body-too-large');
  });

  it('annule le transport injecté et classe précisément le dépassement du délai', async () => {
    /** **Validates: Requirements 2.9, 7.1, 8.5** */
    vi.useFakeTimers();
    let transportSignal: AbortSignal | undefined;
    const fetchRss: FetchRss = (_url, options) => {
      transportSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new Error('requête annulée'));
        }, { once: true });
      });
    };
    const provider = createRssProvider({
      config: { ...BASE_CONFIG, rssTimeoutMs: 50 },
      fetchRss,
      parser: createSafeRssParser(),
    });

    const pendingResult = provider.fetchLatest(new AbortController().signal);
    const pendingAssertion = expect(pendingResult).rejects.toMatchObject({
      name: 'RssSourceError',
      kind: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(50);

    await pendingAssertion;
    expect(transportSignal?.aborted).toBe(true);
  });

  it('supprime les détails réseau et la requête configurée de ses erreurs', async () => {
    /** **Validates: Requirements 7.1, 7.5, 8.7** */
    const secret = 'jeton-ultra-secret';
    const transport = createBoundedRssTransport(async (url) => {
      throw new Error(`Échec vers ${url.href}; corps=${secret}`);
    });

    const error = await captureAsyncRssError(transport(
      new URL(`https://actualites.example/feed.xml?token=${secret}`),
      {
        signal: new AbortController().signal,
        maxBytes: 1_024,
      },
    ));
    const diagnostic = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;

    expect(error.kind).toBe('network');
    expect(diagnostic).not.toContain(secret);
    expect(diagnostic).not.toContain('token=');
  });
});

describe('analyse RSS 2.0 sûre', () => {
  it.each([
    [
      'un DTD et une entité externe',
      `<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
       <rss><channel><item><title>&xxe;</title></item></channel></rss>`,
    ],
    [
      'une déclaration ENTITY isolée',
      '<!ENTITY xxe SYSTEM "https://interne.example/secret"><rss><channel /></rss>',
    ],
    [
      'un XML mal formé',
      '<rss><channel><item><title>Incomplet</item></channel></rss>',
    ],
    [
      'une structure sans canal RSS',
      '<rss version="2.0"><item><title>Hors canal</title></item></rss>',
    ],
    [
      'un autre format XML',
      '<feed><entry><title>Atom</title></entry></feed>',
    ],
  ])('rejette %s comme document inutilisable', (_label, xml) => {
    /** **Validates: Requirements 2.4, 7.1, 8.6** */
    const error = captureRssError(() => createSafeRssParser().parse(xml));

    expect(error.kind).toBe('invalid-rss');
    expect(error.message).not.toContain(xml);
  });

  it('accepte un flux valide sans article comme une liste vide', async () => {
    /** **Validates: Requirements 2.4, 2.6, 7.3** */
    const items = await providerFromXml(
      '<?xml version="1.0"?><rss version="2.0"><channel /></rss>',
    ).fetchLatest(new AbortController().signal);

    expect(items).toEqual([]);
  });

  it('accepte du texte ressemblant à un DTD dans une section CDATA puis le retire', async () => {
    /** **Validates: Requirements 2.4, 2.5, 8.6** */
    const xml = `<rss version="2.0"><channel><item>
      <title>Texte sûr</title>
      <description><![CDATA[Avant <!DOCTYPE html> après]]></description>
    </item></channel></rss>`;

    const items = await providerFromXml(xml).fetchLatest(
      new AbortController().signal,
    );

    expect(items).toEqual([
      { title: 'Texte sûr', sourceText: 'Avant après' },
    ]);
  });
});

const readableTokenArbitrary = fc
  .array(fc.constantFrom('a', 'Z', 'é', 'ç', '界', '🙂'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((characters) => characters.join(''));

const invalidTitleArbitrary = fc.constantFrom(
  undefined,
  '',
  ' \t\n ',
  '<b> </b>',
  '<script>instruction</script>',
  '\u0000\u0007',
);

const parsedSequenceArbitrary: fc.Arbitrary<{
  parsedItems: ParsedRssItem[];
  expectedTitles: string[];
}> = fc.array(
  fc.oneof(
    fc.record({
      valid: fc.constant(true as const),
      token: readableTokenArbitrary,
      description: readableTokenArbitrary,
    }),
    fc.record({
      valid: fc.constant(false as const),
      title: invalidTitleArbitrary,
      description: readableTokenArbitrary,
    }),
  ),
  { maxLength: 40 },
).map((entries) => {
  const parsedItems: ParsedRssItem[] = [];
  const expectedTitles: string[] = [];

  entries.forEach((entry, index) => {
    if (entry.valid) {
      const title = `Article ${index} ${entry.token}`;
      parsedItems.push({ title, description: entry.description });
      expectedTitles.push(title);
      return;
    }

    parsedItems.push({
      title: entry.title,
      description: entry.description,
    });
  });

  return { parsedItems, expectedTitles };
});

describe('propriété de filtrage et de limitation RSS', () => {
  it('Feature: news-service, Property 2: RSS Item Filtering, Order, and Limit', () => {
    /** **Validates: Requirements 2.5, 2.6, 2.7, 7.3** */
    fc.assert(
      fc.property(
        parsedSequenceArbitrary,
        fc.integer({ min: 1, max: 20 }),
        ({ parsedItems, expectedTitles }, maxArticles) => {
          const normalized = normalizeRssItems(parsedItems, maxArticles);

          expect(normalized.map((item) => item.title)).toEqual(
            expectedTitles.slice(0, maxArticles),
          );
          expect(normalized).toHaveLength(
            Math.min(expectedTitles.length, maxArticles),
          );
          expect(normalized.every((item) => item.title.length > 0)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

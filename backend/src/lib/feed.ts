import { XMLParser } from 'fast-xml-parser';
import { resolveUrl } from './url';
import type { FeedEntry, ParsedFeed } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
};

function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (m, dec, hex, name) => {
      if (name) return NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? m;
      const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    },
  );
}

const first = (n: Node): Node => (Array.isArray(n) ? n[0] : n);
const arr = (n: Node): Node[] => (n === undefined || n === null ? [] : Array.isArray(n) ? n : [n]);

/** Raw text of a parsed node (string, or object with '#text'). */
function raw(n: Node): string {
  n = first(n);
  if (n === undefined || n === null) return '';
  if (typeof n === 'object') return raw(n['#text']);
  return String(n);
}

function plain(n: Node): string {
  return decodeEntities(raw(n).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function toIso(s: string): string | undefined {
  if (!s.trim()) return undefined;
  const t = new Date(s.trim()).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const isImage = (n: Node): boolean =>
  n?.['@_medium'] === 'image' || String(n?.['@_type'] ?? '').startsWith('image/');

function firstImgSrc(html: string): string | undefined {
  const m = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(html);
  const src = m && (m[1] ?? m[2]);
  return src ? decodeEntities(src) : undefined;
}

function thumbnail(item: Node, entryUrl: string, htmlFields: string[]): string | undefined {
  const candidates: (string | undefined)[] = [];
  candidates.push(first(item['media:thumbnail'])?.['@_url']);
  candidates.push(arr(item['media:content']).find(isImage)?.['@_url']);
  for (const g of arr(item['media:group']))
    candidates.push(arr(g?.['media:content']).find(isImage)?.['@_url']);
  candidates.push(arr(item.enclosure).find(isImage)?.['@_url']);
  for (const f of htmlFields) {
    const src = firstImgSrc(raw(item[f]));
    if (src) candidates.push(src);
  }
  for (const c of candidates) {
    const u = resolveUrl(c, entryUrl);
    if (u) return u;
  }
  return undefined;
}

function rssAuthor(s: string): string | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const m = /\(([^)]+)\)\s*$/.exec(t);
  return (m ? m[1] : t).trim() || undefined;
}

function atomLink(links: Node[]): string | undefined {
  const l = links.find((x) => (x['@_rel'] ?? 'alternate') === 'alternate');
  return l?.['@_href'];
}

function build(fields: Omit<FeedEntry, 'url'> & { url: string | undefined }): FeedEntry | null {
  if (!fields.url) return null;
  const e: FeedEntry = { url: fields.url, title: fields.title };
  if (fields.author) e.author = fields.author;
  if (fields.publishedAt) e.publishedAt = fields.publishedAt;
  if (fields.thumbnailUrl) e.thumbnailUrl = fields.thumbnailUrl;
  return e;
}

function rssEntries(items: Node[], feedUrl: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const it of items) {
    let url = resolveUrl(raw(it.link).trim(), feedUrl);
    if (!url && /^https?:\/\//i.test(raw(it.guid).trim()))
      url = resolveUrl(raw(it.guid).trim(), feedUrl);
    const e = build({
      url,
      title: plain(it.title),
      author: plain(it['dc:creator']) || rssAuthor(raw(it.author)),
      publishedAt: toIso(raw(it.pubDate)) ?? toIso(raw(it['dc:date'])),
      thumbnailUrl: url
        ? thumbnail(it, url, ['content:encoded', 'content', 'description', 'summary'])
        : undefined,
    });
    if (e) out.push(e);
  }
  return out;
}

function atomEntries(items: Node[], feedUrl: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const it of items) {
    const url = resolveUrl(atomLink(arr(it.link)), feedUrl);
    const e = build({
      url,
      title: plain(it.title),
      author: plain(first(it.author)?.name) || plain(it['dc:creator']) || undefined,
      publishedAt: toIso(raw(it.published)) ?? toIso(raw(it.updated)) ?? toIso(raw(it['dc:date'])),
      thumbnailUrl: url ? thumbnail(it, url, ['content', 'summary']) : undefined,
    });
    if (e) out.push(e);
  }
  return out;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  parseTagValue: false,
  isArray: (name, jpath) =>
    name === 'item' || name === 'entry' || (name === 'link' && String(jpath).startsWith('feed.')),
});

export function parseFeed(xml: string, feedUrl: string): ParsedFeed | null {
  let doc: Node;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  if (doc.rss?.channel) {
    const ch = first(doc.rss.channel);
    return {
      title: plain(ch.title),
      siteUrl: resolveUrl(raw(ch.link).trim(), feedUrl),
      entries: rssEntries(arr(ch.item), feedUrl),
    };
  }
  if (doc.feed && typeof doc.feed === 'object') {
    const f = doc.feed;
    return {
      title: plain(f.title),
      siteUrl: resolveUrl(atomLink(arr(f.link)), feedUrl),
      entries: atomEntries(arr(f.entry), feedUrl),
    };
  }
  if (doc['rdf:RDF']) {
    const rdf = doc['rdf:RDF'];
    const ch = first(rdf.channel) ?? {};
    return {
      title: plain(ch.title),
      siteUrl: resolveUrl(raw(ch.link).trim(), feedUrl),
      entries: rssEntries(arr(rdf.item), feedUrl),
    };
  }
  return null;
}

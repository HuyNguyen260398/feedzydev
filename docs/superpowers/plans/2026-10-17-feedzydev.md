# feedzydev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a personal DevOps-blog daily feed at https://feedzydev-claude.nghuy.link: a 7AM (Vietnam) crawler Lambda, a public feed page, and an owner-only (Google via Cognito) sources page.

**Architecture:** The same shape as the reference `/Users/huyng/ws/aws-serverless-webapp/`: CloudFront → private S3 (Next.js static export) plus `/api/*` → API Gateway REST (stage `api`) → a single API Lambda → DynamoDB. Added on top: an EventBridge-Scheduler-driven crawler Lambda, a Cognito pre-sign-up Lambda, Google federation, and ACM + Route 53 for the subdomain. Pure logic (URL normalisation, feed parsing, discovery, entry filtering) lives in `backend/src/lib` and `backend/src/crawler/entries.ts` and gets unit tests. Handlers are thin wiring.

**Tech Stack:** Node 24 / TypeScript, pnpm, esbuild, Jest + ts-jest + aws-sdk-client-mock, fast-xml-parser, node-html-parser, ulid, AWS SDK v3 (DynamoDB doc client, Lambda). Next.js 15 (App Router, static export), React 19, Tailwind CSS v4, aws-amplify v6, Vitest + Testing Library. Terraform ≥ 1.10, AWS provider `~> 6.0`. GitHub Actions with OIDC.

**Spec:** `docs/superpowers/specs/2026-10-17-feedzydev-design.md` (read it; this plan cites its sections as §N).

## Global Constraints

- Branch `feedzydev-claude` only. Never create, push to, or target `main`. Deploys run on push to `feedzydev-claude`.
- Never read, copy from, or modify `/Users/huyng/ws/feedzydev` (a separate build).
- AWS account `010382427026`, region `ap-southeast-1`; ACM certificate in `us-east-1` via provider alias `aws.us_east_1`.
- Domain `feedzydev-claude.nghuy.link` in the existing hosted zone `nghuy.link` (`Z10168803Q16IBJCR6YRD`). Look it up with a data source and never manage the zone itself.
- Name prefix `feedzydev-claude-prod` on every AWS resource. Site bucket `feedzydev-claude-prod-site-010382427026`, state bucket `feedzydev-claude-tfstate-010382427026`, Cognito domain prefix `feedzydev-claude-010382427026`, OIDC roles `feedzydev-claude-ci-plan` / `feedzydev-claude-ci-deploy`.
- Tables `feedzydev-claude-prod-sources` (PK `sourceId`) and `feedzydev-claude-prod-posts` (PK `postId`; GSIs `byPublished` = `feedKey`/`publishedAt` and `bySource` = `sourceId`/`publishedAt`; TTL attribute `expiresAt`), both PAY_PER_REQUEST.
- Schedule `cron(0 7 * * ? *)` with `schedule_expression_timezone = "Asia/Ho_Chi_Minh"`.
- Retention: `expiresAt = publishedAt + 90 days`. The crawler skips entries published more than 14 days before now.
- Allowed email comes from config only (`ALLOWED_EMAIL` env / `allowed_email` TF var / GitHub var). The value is `huynguyen260398@gmail.com`. Never hard-code it in source.
- User-Agent `feedzydev/1.0 (+https://feedzydev-claude.nghuy.link)`.
- The API is same-origin `/api/*` with no CORS anywhere. CloudFront has **no** `custom_error_response`.
- Next.js uses `output: 'export'`, `trailingSlash: true`, `images: { unoptimized: true }`. No SSR, no Next server features.
- Error body is `{ "error": { "code": string, "message": string } }`.
- Auth header: the raw Cognito **ID token** in `Authorization`, no `Bearer ` prefix.
- No long-lived AWS keys. CI uses OIDC. Lambda runtime is `nodejs24.x`, `.nvmrc` is `24`. `packageManager` is pinned to the locally installed pnpm (`pnpm -v`).
- Quality gates in every package: `format:check` (Prettier), `lint` (ESLint flat config), `typecheck` (`tsc --noEmit`), `test`, `build`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Messy real-world feed text.** Titles can contain CDATA, HTML tags, entities (`&amp;`, `&#8217;`) and Atom `type="html"`. Cards should show clean plain text. This is pinned by the `parseFeed` fixture tests in Task 3.
2. **Hanging, huge or hostile sites.** One source that stalls, sends 50 MB or returns garbage must not break the crawl or the add form. It should be marked `error` while the others still save. This is pinned by the `fetchText` timeout/size tests in Task 2 and the crawler isolation test in Task 6.
3. **Relative and protocol-relative URLs.** Thumbnails and links like `/img.png` or `//cdn/x.jpg`, and Atom relative hrefs, must become absolute `https` URLs or the cards break. This is pinned by the `resolveUrl` tests in Task 1 and the fixtures in Task 3.
4. **The same post twice.** A URL with `utm_*` params or a different host case, a post listed twice in one feed, or a post seen again on the next crawl must give exactly one card. This is pinned by the `normalizeUrl` tests in Task 1, the `toPosts` dedupe in Task 6 and `putIfAbsent` in Task 5.
5. **Thumbnails blocked by hotlink protection, or 404s.** The browser should show the branded placeholder rather than a broken image. This is pinned by the `PostCard` onError test in Task 12.

Also checked live in Task 15: the `/sources` URL rewrite, a 360px mobile width with no horizontal scroll, and a non-owner Google account being rejected.

---

## File Structure

```
.nvmrc  .prettierrc.json  .prettierignore  .gitignore  README.md
docs/architecture.md
backend/
  package.json tsconfig.json eslint.config.mjs jest.config.js build.mjs
  src/lib/{types,url,http,feed,html,discover,cursor,pool,errors}.ts
  src/lib/repo/{sources,posts}.ts
  src/crawler/{entries,crawl,handler}.ts
  src/api/{http,auth,router,handler}.ts
  src/presignup/handler.ts
  test/** (mirrors src) + test/fixtures/*.xml|*.html
frontend/
  package.json tsconfig.json eslint.config.mjs next.config.ts postcss.config.mjs vitest.config.ts vitest.setup.ts .env.example
  src/app/{layout.tsx,globals.css,page.tsx,sources/page.tsx}
  src/lib/{types,api,auth,time,placeholder,theme}.ts(x)
  src/hooks/usePosts.ts
  src/components/{Header,ThemeToggle,FilterChips,PostCard,Thumbnail,FeedGrid,SkeletonCard,ErrorBanner,EmptyState}.tsx
  src/components/sources/{SignInPanel,AddSourceForm,SourceRow,SourcesList}.tsx
  test/**
infra/
  bootstrap/{main,variables,outputs}.tf
  envs/prod/{backend,main,variables,outputs}.tf
  modules/data | lambda | auth | api | schedule | certificate | frontend (each main/variables/outputs.tf; frontend also rewrite.js)
.github/workflows/{ci,deploy}.yml
```

`backend` and `frontend` are separate pnpm packages with their own lockfiles, as in the reference.

---

### Task 1: Backend scaffold + URL utilities

**Files:**
- Create: `.nvmrc` (`24`), `.prettierrc.json` (`{"singleQuote":true,"printWidth":100,"trailingComma":"all"}`), `.prettierignore` (`dist`, `out`, `.next`, `coverage`, `*.lock`, `pnpm-lock.yaml`, `test/fixtures`)
- Create: `backend/package.json`, `backend/tsconfig.json` (strict, `target ES2023`, `module/moduleResolution NodeNext` or `Bundler`, `noEmit`), `backend/eslint.config.mjs` (typescript-eslint recommended), `backend/jest.config.js` (ts-jest, `testEnvironment node`, roots `test`), `backend/build.mjs`
- Create: `backend/src/lib/url.ts`, `backend/src/lib/errors.ts`
- Test: `backend/test/lib/url.test.ts`

**Interfaces:**
- Produces:
  - `normalizeUrl(url: string): string`: lowercases the scheme and host, drops the fragment and every `utm_*` query param, and keeps the remaining params in their original order.
  - `postIdFor(url: string): string`: the SHA-256 hex (64 chars) of `normalizeUrl(url)`.
  - `resolveUrl(href: string | undefined, base: string): string | undefined`: returns an absolute URL. Protocol-relative inputs get `https:`. Returns `undefined` for an empty or invalid href or a non-http(s) result.
  - `errors.ts`: `class AppError extends Error { constructor(public status: number, public code: string, message: string) }`.
  - `package.json` scripts: `build` = `node build.mjs`, `test` = `jest`, `lint` = `eslint .`, `typecheck` = `tsc --noEmit`, `format` / `format:check` = `prettier --write|--check .`.
  - `build.mjs` runs esbuild with `bundle`, `platform node`, `target node24` and `format cjs`. It has three entry points: `src/api/handler.ts` → `dist/api/index.js`, `src/crawler/handler.ts` → `dist/crawler/index.js` and `src/presignup/handler.ts` → `dist/presignup/index.js`. Skip any entry whose file doesn't exist yet, so the build passes from Task 1 on.
  - Deps: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-lambda`, `fast-xml-parser`, `node-html-parser`, `ulid`. Dev deps: `typescript`, `esbuild`, `jest`, `ts-jest`, `@types/jest`, `@types/node`, `@types/aws-lambda`, `aws-sdk-client-mock`, `eslint`, `typescript-eslint`, `prettier`.

- [ ] **Step 1: Scaffold the package**, add the files above, then run `cd backend && pnpm install`.
- [ ] **Step 2: Write the failing tests** in `test/lib/url.test.ts`:

```ts
test('normalizeUrl lowercases host, strips fragment and utm params', () => {
  expect(normalizeUrl('HTTPS://Blog.Example.com/a/?utm_source=x&b=1&utm_medium=rss#frag'))
    .toBe('https://blog.example.com/a/?b=1');
});
test('postIdFor is stable across tracking variants', () => {
  const a = postIdFor('https://blog.example.com/p?utm_source=rss');
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(postIdFor('https://BLOG.example.com/p#x')).toBe(a);
});
test.each([
  ['//cdn.x.io/a.png', 'https://b.com/', 'https://cdn.x.io/a.png'],
  ['/i.png', 'https://b.com/p/q/', 'https://b.com/i.png'],
  ['img/i.png', 'https://b.com/p/q/', 'https://b.com/p/q/img/i.png'],
  ['https://abs.io/z.jpg', 'https://b.com/', 'https://abs.io/z.jpg'],
])('resolveUrl(%s, %s)', (href, base, want) => expect(resolveUrl(href, base)).toBe(want));
test('resolveUrl rejects junk', () => {
  expect(resolveUrl('', 'https://b.com/')).toBeUndefined();
  expect(resolveUrl('javascript:alert(1)', 'https://b.com/')).toBeUndefined();
  expect(resolveUrl(undefined, 'https://b.com/')).toBeUndefined();
});
```

- [ ] **Step 3: Run** `pnpm test`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** `url.ts` with WHATWG `URL` and `node:crypto` `createHash('sha256')`.
- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. Expected: all pass.
- [ ] **Step 6: Commit** with message `feat(backend): scaffold package and url utilities`.

---

### Task 2: HTTP fetch helper

**Files:**
- Create: `backend/src/lib/http.ts`
- Test: `backend/test/lib/http.test.ts`

**Interfaces:**
- Produces:
  - `USER_AGENT = 'feedzydev/1.0 (+https://feedzydev-claude.nghuy.link)'`
  - `MAX_BYTES = 5 * 1024 * 1024`
  - `interface FetchResult { status: number; url: string /* final URL after redirects */; contentType: string; body: string }`
  - `type FetchText = (url: string, opts?: { timeoutMs?: number }) => Promise<FetchResult>`
  - `const fetchText: FetchText`: uses global `fetch` with `redirect: 'follow'`, the `User-Agent` header, `Accept: application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8` and `AbortSignal.timeout(timeoutMs ?? 10000)`. It streams the body and aborts once it passes `MAX_BYTES`. It **does not throw on non-2xx** (callers check `status`).
  - `class FetchError extends Error { code: 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK' }`

- [ ] **Step 1: Write the failing tests.** Stub `global.fetch` with `jest.spyOn`.
  - `'returns status, final url, content type and body'`: the stub returns `new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml' } })`, and `Object.defineProperty(res, 'url', { value: 'https://final/' })`. Expect `{ status: 200, url: 'https://final/', contentType: 'application/rss+xml', body: '<rss/>' }`.
  - `'sends the feedzydev user agent'`: expect the stub to have been called with headers containing `'User-Agent': USER_AGENT`.
  - `'returns non-2xx without throwing'`: a 404 response gives `status 404`.
  - `'throws TOO_LARGE past MAX_BYTES'`: the body is a `ReadableStream` that sends `MAX_BYTES + 1` bytes in 1 MiB chunks. Expect rejection with `code: 'TOO_LARGE'`.
  - `'throws TIMEOUT when aborted'`: the stub rejects with `new DOMException('x', 'TimeoutError')`. Expect `code: 'TIMEOUT'`.
- [ ] **Step 2: Run** `pnpm test -- http`. Expected: FAIL.
- [ ] **Step 3: Implement** `http.ts`.
- [ ] **Step 4: Run** `pnpm test -- http`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(backend): bounded fetch helper`.

---

### Task 3: Feed parsing (RSS 2.0 / Atom / RSS 1.0)

**Files:**
- Create: `backend/src/lib/types.ts`, `backend/src/lib/feed.ts`
- Create fixtures: `backend/test/fixtures/{rss2-media.xml,atom.xml,rss1.xml,aws-devops.xml,kubernetes.xml}`
- Test: `backend/test/lib/feed.test.ts`

**Interfaces:**
- Produces (`types.ts`, shared by all later backend tasks):

```ts
export interface FeedEntry { url: string; title: string; author?: string; publishedAt?: string; thumbnailUrl?: string }
export interface ParsedFeed { title: string; siteUrl?: string; entries: FeedEntry[] }
export interface Source {
  sourceId: string; name: string; siteUrl: string; feedUrl: string; iconUrl?: string; enabled: boolean; createdAt: string;
  lastCrawledAt?: string; lastStatus?: 'ok' | 'error'; lastError?: string; lastNewCount?: number;
}
export interface Post {
  postId: string; url: string; title: string; author?: string; publishedAt: string; thumbnailUrl?: string;
  sourceId: string; sourceName: string; feedKey: 'ALL'; crawledAt: string; expiresAt: number;
}
export type PublicPost = Omit<Post, 'feedKey' | 'expiresAt' | 'crawledAt'>;
export interface FeedCandidate { feedUrl: string; title: string; siteUrl: string; iconUrl?: string; preview: { title: string; publishedAt?: string }[] }
```

- `parseFeed(xml: string, feedUrl: string): ParsedFeed | null`. It returns `null` when the document isn't RSS 2.0 (`rss.channel`), Atom (`feed`) or RSS 1.0 (`rdf:RDF`), or isn't XML at all.
  - Use `XMLParser` with `ignoreAttributes: false`, `attributeNamePrefix: '@_'`, `processEntities: true`, and an `isArray` that forces `item`, `entry` and `link` (in Atom) to arrays.
  - Map titles to plain text: strip tags, decode HTML entities (named + numeric), collapse whitespace, trim.
  - The author is `dc:creator` › Atom `author.name` › RSS `author`. For the RSS `email (Name)` form, use `Name`.
  - `publishedAt` is `pubDate` › `published` › `updated` › `dc:date`, converted to `toISOString()`. It's `undefined` when unparsable.
  - The Atom link is the first `rel="alternate"` or rel-less link, resolved against `feedUrl`.
  - The thumbnail is the first of `media:thumbnail@url`, `media:content@url` (where `medium="image"` or the type is `image/*`), a `media:group` `media:content` image, an `enclosure@url` with an `image/*` type, then the first `<img src>` in `content:encoded` › `content` › `description` › `summary`. Resolve it with `resolveUrl(…, entryUrl)`.
  - `siteUrl` is the channel `link` or the Atom `rel=alternate` link.
  - Drop entries with no resolvable URL.

- [ ] **Step 1: Create the synthetic fixtures.** Use these exactly:

`rss2-media.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Example DevOps Blog</title><link>https://blog.example.com/</link>
<item><title><![CDATA[Blue/Green &amp; Canary with <em>ECS</em>]]></title><link>https://blog.example.com/posts/blue-green?utm_source=rss</link><dc:creator>Jane Doe</dc:creator><pubDate>Fri, 16 Oct 2026 23:12:00 GMT</pubDate><media:thumbnail url="https://cdn.example.com/bg.png"/></item>
<item><title>It&#8217;s relative</title><link>https://blog.example.com/posts/relative</link><pubDate>Thu, 15 Oct 2026 08:00:00 +0700</pubDate><content:encoded><![CDATA[<p>Hi</p><img src="/images/rel.png"><img src="https://x.io/second.png">]]></content:encoded></item>
<item><title>Enclosure post</title><link>https://blog.example.com/posts/enclosure</link><author>ops@example.com (Ops Team)</author><pubDate>Wed, 14 Oct 2026 10:00:00 GMT</pubDate><enclosure url="//cdn.example.com/enc.jpg" type="image/jpeg" length="1"/></item>
<item><title>No date post</title><link>https://blog.example.com/posts/nodate</link></item>
</channel></rss>
```

`atom.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<title type="text">Atom Ops</title><link rel="self" href="https://atom.example.org/feed.xml"/><link rel="alternate" href="https://atom.example.org/"/>
<entry><title type="html">Terraform 1.12 &lt;b&gt;stacks&lt;/b&gt;</title><link rel="enclosure" href="https://atom.example.org/a.mp3"/><link rel="alternate" type="text/html" href="/2026/10/stacks/"/><author><name>Team Atom</name></author><published>2026-10-16T05:00:00Z</published><updated>2026-10-16T06:00:00Z</updated><media:content url="https://atom.example.org/stacks.webp" medium="image"/></entry>
<entry><title>Updated only</title><link href="https://atom.example.org/2026/10/updated/"/><updated>2026-10-12T00:00:00+02:00</updated></entry>
</feed>
```

`rss1.xml` (exactly **one** item, which exercises `isArray`):
```xml
<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://rdf.example.net/"><title>RDF Blog</title><link>https://rdf.example.net/</link></channel>
<item rdf:about="https://rdf.example.net/p1"><title>P1</title><link>https://rdf.example.net/p1</link><dc:date>2026-10-10T12:00:00Z</dc:date><dc:creator>R. Writer</dc:creator></item>
</rdf:RDF>
```

Snapshot the real feeds with `curl -sL -A 'feedzydev/1.0' https://aws.amazon.com/blogs/devops/feed/ > test/fixtures/aws-devops.xml` and `curl -sL https://kubernetes.io/feed.xml > test/fixtures/kubernetes.xml`, then trim each to at most 5 items, keeping the XML valid.

- [ ] **Step 2: Write the failing tests:**

```ts
const fx = (n: string) => readFileSync(join(__dirname, '../fixtures', n), 'utf8');
test('rss2: channel and entries', () => {
  const f = parseFeed(fx('rss2-media.xml'), 'https://blog.example.com/feed')!;
  expect(f.title).toBe('Example DevOps Blog');
  expect(f.siteUrl).toBe('https://blog.example.com/');
  expect(f.entries).toHaveLength(4);
  expect(f.entries[0]).toEqual({ url: 'https://blog.example.com/posts/blue-green?utm_source=rss',
    title: 'Blue/Green & Canary with ECS', author: 'Jane Doe',
    publishedAt: '2026-10-16T23:12:00.000Z', thumbnailUrl: 'https://cdn.example.com/bg.png' });
  expect(f.entries[1]).toMatchObject({ title: 'It’s relative', publishedAt: '2026-10-15T01:00:00.000Z',
    thumbnailUrl: 'https://blog.example.com/images/rel.png' });
  expect(f.entries[1].author).toBeUndefined();
  expect(f.entries[2]).toMatchObject({ author: 'Ops Team', thumbnailUrl: 'https://cdn.example.com/enc.jpg' });
  expect(f.entries[3].publishedAt).toBeUndefined();
});
test('atom: alternate link, html title, media:content', () => {
  const f = parseFeed(fx('atom.xml'), 'https://atom.example.org/feed.xml')!;
  expect(f).toMatchObject({ title: 'Atom Ops', siteUrl: 'https://atom.example.org/' });
  expect(f.entries[0]).toEqual({ url: 'https://atom.example.org/2026/10/stacks/', title: 'Terraform 1.12 stacks',
    author: 'Team Atom', publishedAt: '2026-10-16T05:00:00.000Z', thumbnailUrl: 'https://atom.example.org/stacks.webp' });
  expect(f.entries[1].publishedAt).toBe('2026-10-11T22:00:00.000Z');
});
test('rss1: single item still yields an array', () => {
  const f = parseFeed(fx('rss1.xml'), 'https://rdf.example.net/rss')!;
  expect(f.title).toBe('RDF Blog');
  expect(f.entries).toEqual([{ url: 'https://rdf.example.net/p1', title: 'P1', author: 'R. Writer', publishedAt: '2026-10-10T12:00:00.000Z' }]);
});
test.each(['<html><body>hi</body></html>', 'not xml at all', ''])('non-feed %p → null', (s) => {
  expect(parseFeed(s, 'https://x.io/')).toBeNull();
});
test.each(['aws-devops.xml', 'kubernetes.xml'])('real feed %s parses', (n) => {
  const f = parseFeed(fx(n), 'https://example.com/')!;
  expect(f.entries.length).toBeGreaterThan(0);
  for (const e of f.entries) { expect(e.url).toMatch(/^https:\/\//); expect(e.title.length).toBeGreaterThan(0); expect(e.publishedAt).toBeDefined(); }
});
```

- [ ] **Step 3: Run** `pnpm test -- feed`. Expected: FAIL.
- [ ] **Step 4: Implement** `types.ts` and `feed.ts`.
- [ ] **Step 5: Run** `pnpm test -- feed`. Expected: PASS.
- [ ] **Step 6: Commit** with message `feat(backend): rss/atom feed parser`.

---

### Task 4: HTML helpers + feed discovery

**Files:**
- Create: `backend/src/lib/html.ts`, `backend/src/lib/discover.ts`
- Test: `backend/test/lib/html.test.ts`, `backend/test/lib/discover.test.ts`

**Interfaces:**
- Consumes: `FetchText`, `FetchResult` (Task 2); `parseFeed`, `FeedCandidate` (Task 3); `resolveUrl` (Task 1); `AppError` (Task 1).
- Produces:
  - `extractFeedLinks(html: string, baseUrl: string): string[]`: collects `<link rel~="alternate" type="application/rss+xml"|"application/atom+xml" href>` values in document order. Results are absolute and deduped. It **excludes** links whose `href` or `title` matches `/comments/i` (WordPress comment feeds).
  - `extractPageMeta(html: string, baseUrl: string): { ogImage?: string; iconUrl?: string }`. `ogImage` is `og:image` › `og:image:url` › `twitter:image`. `iconUrl` is `link[rel~=icon]` › `apple-touch-icon`. Both are absolute.
  - `PROBE_PATHS = ['feed', 'feed/', 'rss', 'rss.xml', 'atom.xml', 'index.xml', 'feed.xml']`
  - `discoverFeeds(inputUrl: string, fetch: FetchText): Promise<FeedCandidate[]>`. It throws `AppError(400, 'INVALID_URL', 'Enter a valid http(s) URL.')` for a non-http(s) URL or one longer than 2048 characters.
    1. Fetch the URL with an 8000ms timeout. If `parseFeed` succeeds, return a single candidate whose `feedUrl` is the final URL.
    2. Otherwise, if the page is HTML, fetch each `extractFeedLinks` result in parallel and keep those that parse.
    3. If none parse, probe `PROBE_PATHS` resolved against the input URL's directory, then against the site root (deduped). Run the probes in parallel and return the first one, in list order, that has a 2xx status and parses.
    4. A candidate's `title` is the feed title, falling back to the hostname. `siteUrl` is the feed `siteUrl` › the input page URL › the origin. `iconUrl` comes from `extractPageMeta` when the input was HTML. `preview` holds the first 3 entries' `{title, publishedAt}`.
    5. Individual fetch failures are swallowed. With nothing found, the result is `[]`.

- [ ] **Step 1: Write the failing tests.** Use a fake `FetchText` built from a `Record<string, {status?: number; body: string; contentType?: string}>` map. Unknown URLs return 404. Reuse the `rss2-media.xml` fixture as the feed body.
  - html: `'extractFeedLinks resolves, dedupes, drops comment feeds'`. The HTML contains `<link rel="alternate" type="application/rss+xml" href="/feed/">`, the same href again, `<link rel="alternate" type="application/atom+xml" href="https://x.io/atom.xml">` and `<link rel="alternate" type="application/rss+xml" title="Comments Feed" href="/comments/feed/">`, with base `https://x.io/blog/`. Expect `['https://x.io/feed/', 'https://x.io/atom.xml']`.
  - html: `'extractPageMeta reads og:image and icon'` with `<meta property="og:image" content="/og.png"><link rel="shortcut icon" href="/fav.ico">`. Expect `{ ogImage: 'https://x.io/og.png', iconUrl: 'https://x.io/fav.ico' }`.
  - discover: `'direct feed URL → one candidate with preview of 3'`. Expect `feedUrl` to be the requested URL, `title` `'Example DevOps Blog'` and `preview.length === 3`.
  - discover: `'homepage advertising two feeds → both'`. Expect the two feed URLs in document order, and `iconUrl` set from the homepage.
  - discover: `'advertised link that is not a feed is excluded'`.
  - discover: `'probes paths when nothing advertised'`. The input is `https://site.dev/blog/`, only `https://site.dev/blog/rss.xml` returns the feed, and expect `[that URL]`.
  - discover: `'falls back to site-root probes'`. Only `https://site.dev/index.xml` returns the feed.
  - discover: `'nothing found → []'`.
  - discover: `'fetch errors are swallowed'`. The fake throws `FetchError('TIMEOUT')` for the homepage. Expect `[]`, not a rejection.
  - discover: `'ftp://x and 3000-char URL → AppError INVALID_URL'`.
- [ ] **Step 2: Run** `pnpm test -- html discover`. Expected: FAIL.
- [ ] **Step 3: Implement** `html.ts` (node-html-parser) and `discover.ts`.
- [ ] **Step 4: Run** `pnpm test -- html discover`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(backend): feed discovery`.

---

### Task 5: DynamoDB repositories + cursor

**Files:**
- Create: `backend/src/lib/cursor.ts`, `backend/src/lib/repo/sources.ts`, `backend/src/lib/repo/posts.ts`
- Test: `backend/test/lib/cursor.test.ts`, `backend/test/lib/repo/sources.test.ts`, `backend/test/lib/repo/posts.test.ts`

**Interfaces:**
- Consumes: `Source`, `Post` (Task 3), `AppError` (Task 1).
- Produces:
  - `encodeCursor(key: Record<string, unknown>): string` (base64url JSON) and `decodeCursor(s: string): Record<string, unknown>`. `decodeCursor` throws `AppError(400, 'INVALID_CURSOR', 'Invalid cursor.')`.
  - `class SourcesRepo` with `constructor(doc: DynamoDBDocumentClient, table: string)`:
    - `list(): Promise<Source[]>` scans all pages and sorts by `name` (case-insensitive).
    - `get(id): Promise<Source | undefined>`
    - `findByFeedUrl(feedUrl: string): Promise<Source | undefined>` compares `normalizeUrl` values.
    - `create(input: { name: string; siteUrl: string; feedUrl: string; iconUrl?: string }): Promise<Source>` sets a `ulid()` id, `enabled: true` and an ISO `createdAt`.
    - `update(id, patch: { name?: string; enabled?: boolean }): Promise<Source | undefined>` uses `ConditionExpression: 'attribute_exists(sourceId)'`. A ConditionalCheckFailed gives `undefined`.
    - `remove(id): Promise<boolean>` behaves the same way.
    - `recordCrawl(id, r: { status: 'ok' | 'error'; error?: string; newCount: number; at: string }): Promise<void>` sets `lastStatus`, `lastNewCount` and `lastCrawledAt`. It sets `lastError` (truncated to 500 chars) on error and REMOVEs it on ok.
  - `class PostsRepo` with `constructor(doc, table)`:
    - `exists(postId): Promise<boolean>`
    - `putIfAbsent(post: Post): Promise<boolean>` uses `ConditionExpression: 'attribute_not_exists(postId)'`. A ConditionalCheckFailed gives `false`.
    - `listPage(q: { limit: number; cursor?: string; sourceId?: string }): Promise<{ items: Post[]; nextCursor?: string }>` queries `IndexName: 'byPublished'` with `feedKey = 'ALL'`, or `'bySource'` with `sourceId = :s`. It uses `ScanIndexForward: false` and `Limit: limit`, and `ExclusiveStartKey` comes from the decoded cursor.
    - `deleteBySource(sourceId): Promise<number>` queries all `bySource` pages (projecting `postId`), sends `BatchWriteCommand` in chunks of 25, and retries `UnprocessedItems` up to 3 times.

- [ ] **Step 1: Write the failing tests** with `mockClient(DynamoDBDocumentClient)`:
  - cursor: a round trip, and `decodeCursor('%%%')` throws `INVALID_CURSOR`.
  - posts: `'putIfAbsent sends conditional put'`. Assert the `PutCommand` input `ConditionExpression === 'attribute_not_exists(postId)'`. Rejecting with `new ConditionalCheckFailedException({ message: 'x', $metadata: {} })` gives `false`.
  - posts: `'listPage global uses byPublished newest-first'`. Assert the `QueryCommand` input matches `{ IndexName: 'byPublished', ScanIndexForward: false, Limit: 30 }` and the `:k` value is `'ALL'`. With `LastEvaluatedKey: {postId:'p', feedKey:'ALL', publishedAt:'t'}`, `decodeCursor(nextCursor)` equals it, and passing that cursor back sets `ExclusiveStartKey`.
  - posts: `'listPage by source uses bySource'`.
  - posts: `'deleteBySource batches by 25'`. Two query pages give 30 items. Expect 2 `BatchWriteCommand` calls with 25 and 5 items, and a return of `30`.
  - sources: `'update on missing id → undefined'`, `'findByFeedUrl matches normalized url'` and `'recordCrawl ok removes lastError'` (the UpdateExpression contains `REMOVE lastError`).
- [ ] **Step 2: Run** `pnpm test -- repo cursor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test -- repo cursor`. Expected: PASS.
- [ ] **Step 5: Commit** with message `feat(backend): dynamodb repositories`.

---

### Task 6: Crawler

**Files:**
- Create: `backend/src/lib/pool.ts`, `backend/src/crawler/entries.ts`, `backend/src/crawler/crawl.ts`, `backend/src/crawler/handler.ts`
- Test: `backend/test/crawler/entries.test.ts`, `backend/test/crawler/crawl.test.ts`

**Interfaces:**
- Consumes: `parseFeed` (Task 3), `extractPageMeta` (Task 4), `FetchText` (Task 2), `SourcesRepo` and `PostsRepo` (Task 5), `postIdFor` (Task 1).
- Produces:
  - `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]>` preserves order.
  - `MAX_AGE_DAYS = 14` and `RETENTION_DAYS = 90`.
  - `toPosts(entries: FeedEntry[], source: Source, now: Date): Post[]`:
    - Drop entries with no `url` or `publishedAt`.
    - Drop those published before `now - 14d`. The boundary is inclusive, so exactly 14 days old is kept.
    - Drop those published after `now + 1 day`. Clamp anything in the future up to that limit to `now`.
    - Dedupe by `postIdFor(url)`, keeping the first.
    - Set `expiresAt = Math.floor(publishedMs / 1000) + 90 * 86400`, `feedKey 'ALL'`, `crawledAt = now.toISOString()` and `sourceName = source.name`.
  - `interface CrawlDeps { sources: Pick<SourcesRepo, 'list' | 'get' | 'recordCrawl'>; posts: Pick<PostsRepo, 'exists' | 'putIfAbsent'>; fetchText: FetchText; now: () => Date }`
  - `interface SourceResult { sourceId: string; status: 'ok' | 'error'; newCount: number; error?: string }`
  - `OG_FETCH_BUDGET = 30`, `SOURCE_CONCURRENCY = 5`
  - `crawlSource(source: Source, deps: CrawlDeps, budget: { og: number }): Promise<SourceResult>`:
    - Fetch the feed with a 10000ms timeout. A non-2xx status or a `parseFeed` null is an error.
    - Run `toPosts` on the entries.
    - For each post that isn't `exists`, if it has no thumbnail and `budget.og > 0`, decrement the budget, fetch the page with a 5000ms timeout and use `extractPageMeta().ogImage`. Swallow failures.
    - `putIfAbsent` each post and count the `true` results.
    - Always `recordCrawl`, and never throw.
  - `crawlAll(deps: CrawlDeps, opts: { sourceId?: string }): Promise<SourceResult[]>`. With a `sourceId`, crawl only that source, whatever its `enabled` flag. A missing source gives `[]`. Without one, crawl every enabled source through `mapWithConcurrency(…, 5)`, sharing one budget.
  - `handler(event: { sourceId?: string })` wires the real repos from env `SOURCES_TABLE` and `POSTS_TABLE`. It logs `JSON.stringify({ msg: 'crawl.summary', results, totalNew })` and returns the results.

- [ ] **Step 1: Write the failing `entries` tests** with `now = new Date('2026-10-17T00:00:00Z')`:
  - `'keeps recent, sets expiresAt'`. A post published `2026-10-16T00:00:00Z` gets `expiresAt === Date.parse('2026-10-16T00:00:00Z')/1000 + 7776000`.
  - `'14-day boundary'`. `2026-10-03T00:00:00Z` is kept and `2026-10-02T23:59:59Z` is dropped.
  - `'drops missing date or url'`.
  - `'clamps near-future, drops far-future'`. `2026-10-17T12:00:00Z` gives a publishedAt of `2026-10-17T00:00:00.000Z`, and `2026-10-19T00:00:00Z` is dropped.
  - `'dedupes tracking variants'`. `https://a.io/p?utm_source=x` and `https://A.io/p` give 1 post.
- [ ] **Step 2: Write the failing `crawl` tests** with in-memory fakes for the repos and fetch:
  - `'saves new posts and records ok'`. One source with the rss2 fixture, with dates rewritten so 3 are recent. Expect `recordCrawl` with `{status:'ok', newCount:3}`.
  - `'one failing source does not stop others'`. Source B's fetch throws `FetchError('TIMEOUT')`. Expect A's posts saved, B recorded `error` with a message containing `TIMEOUT`, and `crawlAll` resolving with 2 results.
  - `'og:image fallback only for new thumbnail-less posts'`. An existing post gets no page fetch. A new one gets a page fetch and has `thumbnailUrl` set from `og:image`.
  - `'og budget caps page fetches at 30'`. 31 new thumbnail-less entries give exactly 30 page fetches.
  - `'skips disabled; sourceId crawls only that one'`.
  - `'putIfAbsent false is not counted'`.
- [ ] **Step 3: Run** `pnpm test -- crawler`. Expected: FAIL.
- [ ] **Step 4: Implement** `pool.ts`, `entries.ts`, `crawl.ts` and `handler.ts`.
- [ ] **Step 5: Run** `pnpm test && pnpm build`. Expected: PASS, and `dist/crawler/index.js` exists.
- [ ] **Step 6: Commit** with message `feat(backend): crawler`.

---

### Task 7: API Lambda + pre-sign-up Lambda

**Files:**
- Create: `backend/src/api/http.ts`, `backend/src/api/auth.ts`, `backend/src/api/router.ts`, `backend/src/api/handler.ts`, `backend/src/presignup/handler.ts`
- Test: `backend/test/api/router.test.ts`, `backend/test/presignup/handler.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5 (`discoverFeeds`, `parseFeed`, repos, `AppError`, `PublicPost`).
- Produces:
  - `json(status: number, body?: unknown): APIGatewayProxyResult` sets `Content-Type: application/json` and `Cache-Control: no-store`. `fail(status, code, message)`.
  - `getOwnerEmail(event: APIGatewayProxyEvent, allowedEmail: string): 'none' | 'forbidden' | string`. It reads `requestContext.authorizer.claims`. No claims gives `'none'`. Matching `email` (case-insensitive) with `email_verified` of `'true'` or `true` returns the email. Anything else is `'forbidden'`.
  - `interface ApiDeps { sources: SourcesRepo; posts: PostsRepo; fetchText: FetchText; invokeCrawl: (p: { sourceId?: string }) => Promise<void>; allowedEmail: string }`
  - `route(event: APIGatewayProxyEvent, deps: ApiDeps): Promise<APIGatewayProxyResult>` routes on `event.httpMethod` and `event.path` (the path excludes the stage, so CloudFront's `/api/posts` arrives as `/posts`):

| Method & path | Behaviour |
|---|---|
| `GET /posts` | `limit` defaults to 30 and is clamped to 1–50. Takes optional `cursor` and `sourceId`. Returns 200 `{ items: PublicPost[], nextCursor? }`, dropping `feedKey`, `expiresAt` and `crawledAt`. |
| `GET /sources` | 200 `{ items: {sourceId,name,siteUrl,iconUrl?}[] }`, enabled sources only |
| `* /admin/*` | `'none'` → 401 `UNAUTHORIZED`; `'forbidden'` → 403 `FORBIDDEN` "This app is private." |
| `GET /admin/sources` | 200 `{ items: Source[] }` |
| `POST /admin/sources/discover` `{url}` | 200 `{ candidates }`. An empty result → 422 `NO_FEED_FOUND` "No RSS/Atom feed found at this URL — try pasting the feed URL directly." |
| `POST /admin/sources` `{feedUrl, name?}` | Validates the URL (400 `INVALID_URL`). A duplicate (via `findByFeedUrl`) → 409 `DUPLICATE_SOURCE`. Fetches with an 8000ms timeout and parses. A failure → 422 `NOT_A_FEED`. The name is the trimmed `name` › the feed title › the hostname, capped at 120 characters. `siteUrl` is the feed `siteUrl` › the origin. Then `invokeCrawl({sourceId})` and 201 with the source. |
| `PATCH /admin/sources/{id}` `{name?, enabled?}` | Type-checks the fields and rejects an empty name (400 `INVALID_INPUT`). Missing → 404 `NOT_FOUND`. Otherwise 200. |
| `DELETE /admin/sources/{id}` | Missing → 404. Otherwise `posts.deleteBySource`, then `sources.remove`, then 204. |
| `POST /admin/crawl` `{sourceId?}` | `invokeCrawl`, then 202 `{ status: 'started' }` |
| other | 404 `NOT_FOUND` |

  - Invalid JSON gives 400 `INVALID_JSON`, and an `AppError` gives its own status and code. Anything else is logged and returns 500 `INTERNAL`.
  - `handler.ts` reads env `SOURCES_TABLE`, `POSTS_TABLE`, `ALLOWED_EMAIL` and `CRAWLER_FUNCTION_NAME`. `invokeCrawl` sends `InvokeCommand({ FunctionName, InvocationType: 'Event', Payload: JSON })`.
  - `checkSignUp(event: PreSignUpTriggerEvent, allowedEmail: string): PreSignUpTriggerEvent` throws `new Error('This app is private.')` unless `event.triggerSource === 'PreSignUp_ExternalProvider'` **and** `userAttributes.email` matches case-insensitively (native `PreSignUp_SignUp` / `PreSignUp_AdminCreateUser` are always rejected — otherwise anyone could self-register with the owner's address and be auto-verified). When it matches, it sets `response.autoConfirmUser = true` and `response.autoVerifyEmail = true`. The `handler` calls it with `process.env.ALLOWED_EMAIL`.

- [ ] **Step 1: Write the failing router tests.** Build events with a helper `ev(method, path, { body?, query?, claims?, pathParameters? })` and use fake deps with `allowedEmail: 'owner@example.com'`. Cover:
  - `GET /posts` strips internal fields and clamps `limit=500` → `listPage` called with `limit 50`.
  - A bad cursor gives 400 `INVALID_CURSOR`.
  - `GET /sources` returns only enabled sources with the subset of fields.
  - Admin with no claims gives 401. `{email:'x@y.z', email_verified:'true'}` gives 403. `{email:'Owner@Example.com', email_verified:'true'}` passes.
  - Discover with `ftp://a` gives 400 `INVALID_URL`. An empty result gives 422 with the exact `NO_FEED_FOUND` message.
  - Add-source covers a duplicate (409), not-a-feed (422 `NOT_A_FEED`), and success (201 with `invokeCrawl` called with `{sourceId}`).
  - PATCH on a missing source gives 404, and `{name:''}` gives 400 `INVALID_INPUT`.
  - DELETE gives 204, with `deleteBySource` called before `remove`.
  - Crawl gives 202.
  - Body `'{'` gives 400 `INVALID_JSON`, and `GET /nope` gives 404.
- [ ] **Step 2: Write the failing presignup tests.** `'OWNER@example.com'` with an allowed value of `'owner@example.com'` gives `autoConfirmUser` and `autoVerifyEmail` both true. `'other@gmail.com'` throws `'This app is private.'`. A missing email throws.
- [ ] **Step 3: Run** `pnpm test -- api presignup`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`. Expected: all pass, and `dist/{api,crawler,presignup}/index.js` all exist.
- [ ] **Step 6: Commit** with message `feat(backend): api router and presignup trigger`.

---

### Task 8: Terraform bootstrap (state bucket + OIDC roles)

**Files:**
- Create: `infra/bootstrap/{main,variables,outputs}.tf`

**Interfaces:**
- Produces outputs: `state_bucket_name`, `plan_role_arn`, `deploy_role_arn`.
- Variables (with defaults): `region = "ap-southeast-1"`, `state_bucket_name = "feedzydev-claude-tfstate-010382427026"`, `github_repo = "HuyNguyen260398/feedzydev"`, `deploy_branch = "feedzydev-claude"`, `name_prefix = "feedzydev-claude-prod"`.
- The state bucket is versioned, uses SSE AES256, blocks all public access, and has `prevent_destroy`. There is **no** DynamoDB lock table.
- `data "aws_iam_openid_connect_provider" "github" { url = "https://token.actions.githubusercontent.com" }`. Look it up only and never create it.
- Role `feedzydev-claude-ci-plan`:
  - Trust: `aud = sts.amazonaws.com`, and `sub` StringLike in [`repo:HuyNguyen260398/feedzydev:pull_request`, `repo:HuyNguyen260398/feedzydev:ref:refs/heads/feedzydev-claude`].
  - Permissions: the managed `ReadOnlyAccess`, plus `s3:GetObject`, `PutObject`, `DeleteObject` and `ListBucket` on the state bucket (the lock file needs Put/Delete).
- Role `feedzydev-claude-ci-deploy`:
  - Trust: `sub` StringEquals `repo:HuyNguyen260398/feedzydev:ref:refs/heads/feedzydev-claude` only.
  - Permissions use an inline policy, scoped by resource ARN wherever the service supports it:
    - `dynamodb:*` on `table/feedzydev-claude-prod-*` (and `/index/*`)
    - `lambda:*` on `function:feedzydev-claude-prod-*`
    - `iam:*Role*`, `iam:*RolePolicy*` and `iam:PassRole` on `role/feedzydev-claude-prod-*`
    - `logs:*` on `log-group:/aws/lambda/feedzydev-claude-prod-*`, plus `logs:DescribeLogGroups` on `*`
    - `scheduler:*` on `schedule/default/feedzydev-claude-prod-*`
    - `s3:*` on the site bucket and its objects, plus the state bucket objects
    - `apigateway:*` on `arn:aws:apigateway:ap-southeast-1::/*`
    - `cloudfront:*`, `cognito-idp:*` and `acm:*` on `*` (no useful ARN scoping at create time)
    - `route53:ChangeResourceRecordSets` and `ListResourceRecordSets` on `hostedzone/Z10168803Q16IBJCR6YRD`, plus `route53:GetChange`, `ListHostedZones*` and `GetHostedZone` on `*`
    - `sts:GetCallerIdentity`, and `ReadOnlyAccess` attached for plan-time reads

- [ ] **Step 1: Write the bootstrap files.**
- [ ] **Step 2: Run** `cd infra/bootstrap && terraform fmt -check && terraform init && terraform validate`. Expected: `Success! The configuration is valid.`
- [ ] **Step 3: Run** `terraform plan`. Expected: 2 roles, the bucket and its settings, policies, and **0** OIDC providers to add. Don't apply yet (Task 15).
- [ ] **Step 4: Commit** with message `infra: bootstrap state bucket and ci roles`.

---

### Task 9: Terraform modules — data, lambda, auth, schedule

**Files:**
- Create: `infra/modules/data/*`, `infra/modules/lambda/*`, `infra/modules/auth/*`, `infra/modules/schedule/*`

**Interfaces (module variables → outputs):**
- `data(name_prefix)` → `sources_table_name`, `sources_table_arn`, `posts_table_name`, `posts_table_arn`. Builds both tables as in Global Constraints. Both GSIs use projection ALL, TTL is on `expiresAt`, and point-in-time recovery is on for `sources` only.
- `lambda(function_name, zip_path, timeout = 10, memory_size = 256, environment = {}, policy_json = null, reserved_concurrency = -1)` → `function_name`, `arn`, `invoke_arn`, `role_name`. It creates:
  - an IAM role (`${function_name}-role`) with `AWSLambdaBasicExecutionRole`, plus the optional inline `policy_json`
  - an `aws_cloudwatch_log_group` `/aws/lambda/${function_name}` with 30-day retention
  - the function: `runtime nodejs24.x`, `handler index.handler`, `architectures ["arm64"]`, and `source_code_hash = filebase64sha256(zip_path)`
- `auth(name_prefix, domain_prefix, google_client_id, google_client_secret (sensitive), callback_urls, presignup_lambda_arn, presignup_function_name)` → `user_pool_id`, `user_pool_arn`, `user_pool_client_id`, `cognito_domain` (the full host `${domain_prefix}.auth.${region}.amazoncognito.com`).
  - User pool: `username_attributes = ["email"]`, `admin_create_user_config.allow_admin_create_user_only = true` (blocks the public SignUp API; Google federation still creates users), and `lambda_config.pre_sign_up` set to the presignup ARN.
  - `aws_cognito_identity_provider` Google: `authorize_scopes "openid email profile"`, with the attribute mapping `email→email`, `email_verified→email_verified`, `name→name`, `picture→picture`, `username→sub`.
  - `aws_cognito_user_pool_domain` uses the prefix.
  - Client: no secret, `explicit_auth_flows = ["ALLOW_REFRESH_TOKEN_AUTH"]` (no password/SRP login), `allowed_oauth_flows ["code"]`, `allowed_oauth_scopes ["openid","email","profile"]`, `supported_identity_providers ["Google"]`, `callback_urls = logout_urls = var.callback_urls` and `allowed_oauth_flows_user_pool_client = true`.
  - `aws_lambda_permission` lets `cognito-idp.amazonaws.com` invoke the presignup function, with `source_arn` set to the pool ARN.
- `schedule(name_prefix, target_lambda_arn, target_function_name)` → `schedule_name`.
  - `aws_scheduler_schedule` `${name_prefix}-daily-crawl`: `cron(0 7 * * ? *)`, timezone `Asia/Ho_Chi_Minh`, flexible window OFF, `retry_policy { maximum_retry_attempts = 2 }`, input `{}`.
  - Plus a scheduler IAM role allowed `lambda:InvokeFunction` on the target.

- [ ] **Step 1: Write the four modules.**
- [ ] **Step 2: Run** `terraform fmt -check -recursive infra/modules`. Expected: no output. (Validation happens via the root in Task 10.)
- [ ] **Step 3: Commit** with message `infra: data, lambda, auth, schedule modules`.

---

### Task 10: Terraform modules — api, certificate, frontend + prod root

**Files:**
- Create: `infra/modules/api/*`, `infra/modules/certificate/*`, `infra/modules/frontend/{main,variables,outputs}.tf`, `infra/modules/frontend/rewrite.js`
- Create: `infra/envs/prod/{backend,main,variables,outputs}.tf`, `infra/envs/prod/terraform.tfvars.example`

**Interfaces:**
- `api(name_prefix, user_pool_arn, lambda_invoke_arn, lambda_function_name)` → `invoke_domain`, `stage_name` (`"api"`).
  - The REST API has resources `/posts` (GET, `authorization NONE`), `/sources` (GET, NONE) and `/admin/{proxy+}` (ANY, `COGNITO_USER_POOLS` authorizer, `identity_source = "method.request.header.Authorization"`). All of them use AWS_PROXY to the API Lambda.
  - Add a Lambda permission, and a deployment with a `triggers` hash over all methods and integrations plus `create_before_destroy` (as in the reference).
  - The stage is `api` with `throttling` via `aws_api_gateway_method_settings` (`*/*`: burst 20, rate 10).
- `certificate(domain_name, zone_id)` uses `providers = { aws = aws.us_east_1 }` → `certificate_arn` (from `aws_acm_certificate_validation`). It's DNS validated, with the validation records in the zone.
- `frontend(name_prefix, bucket_name, domain_name, zone_id, certificate_arn, api_invoke_domain)` → `site_bucket_name`, `distribution_id`, `distribution_domain`.
  - Same as the reference module, **except**:
    - `aliases = [domain_name]`
    - `viewer_certificate { acm_certificate_arn, ssl_support_method "sni-only", minimum_protocol_version "TLSv1.2_2021" }`
    - **no** `custom_error_response`
    - an `aws_cloudfront_function` (`cloudfront-js-2.0`, code from `rewrite.js`) associated `viewer-request` on the **default behaviour only**
    - `http_version "http2and3"`, `price_class "PriceClass_200"`, `comment = name_prefix`
  - Route 53 `A` and `AAAA` alias records for `domain_name` point to the distribution.
  - `rewrite.js` is `function handler(event)`. If the URI ends in `/`, it appends `index.html`. If the last path segment has no `.`, it appends `/index.html`. It then returns the request.
- `envs/prod`:
  - `backend "s3" { key = "feedzydev-claude/prod/terraform.tfstate", encrypt = true, use_lockfile = true }`. The bucket and region come via `-backend-config`.
  - Providers: `aws` (var.region), and `aws` alias `us_east_1` (region `us-east-1`). Both have `default_tags { Project = "feedzydev-claude", Environment = "prod", ManagedBy = "terraform" }`.
  - Variables: `region` (default `ap-southeast-1`), `name_prefix` (`feedzydev-claude-prod`), `domain_name` (`feedzydev-claude.nghuy.link`), `hosted_zone_name` (`nghuy.link`), `site_bucket_name` (`feedzydev-claude-prod-site-010382427026`), `cognito_domain_prefix` (`feedzydev-claude-010382427026`), plus `allowed_email`, `google_client_id` and `google_client_secret` (sensitive, no defaults).
  - `data "aws_route53_zone" "main" { name = var.hosted_zone_name }`
  - Three `archive_file`s zip `backend/dist/{api,crawler,presignup}/index.js` to `backend/dist/{name}.zip`.
  - The `lambda` module is instantiated three times:
    - `${prefix}-api` gets env `SOURCES_TABLE`, `POSTS_TABLE`, `ALLOWED_EMAIL` and `CRAWLER_FUNCTION_NAME`, a policy for CRUD + Query + BatchWrite + Scan on both tables and their indexes, and `lambda:InvokeFunction` on the crawler. Timeout 29, memory 256.
    - `${prefix}-crawler` gets a policy for Scan/Get/UpdateItem on sources and Get/PutItem on posts, timeout 300, memory 512 and `reserved_concurrency 1`.
    - `${prefix}-presignup` gets env `ALLOWED_EMAIL`, timeout 5.
  - Wire `auth` with `callback_urls = ["https://${var.domain_name}/sources/", "http://localhost:3000/sources/"]`, then `schedule`, `api`, `certificate` and `frontend`.
  - Outputs: `user_pool_id`, `user_pool_client_id`, `cognito_domain`, `site_bucket_name`, `distribution_id`, `site_url` (`https://${var.domain_name}`), `crawler_function_name` and `schedule_name`.

- [ ] **Step 1: Write the modules and the root.**
- [ ] **Step 2: Verify the rewrite function** with `node -e "$(cat infra/modules/frontend/rewrite.js); for (const u of ['/','/sources','/sources/','/_next/a.js']) console.log(u, handler({request:{uri:u}}).uri)"`. Expected: `/index.html`, `/sources/index.html`, `/sources/index.html`, `/_next/a.js`.
- [ ] **Step 3: Run** `cd backend && pnpm build && cd ../infra/envs/prod && terraform fmt -check -recursive ../.. && terraform init -backend=false && terraform validate`. Expected: `Success! The configuration is valid.`
- [ ] **Step 4: Commit** with message `infra: api, certificate, frontend modules and prod root`.

---

### Task 11: Frontend scaffold, theme, API client, auth

**Files:**
- Create: `frontend/package.json`, `tsconfig.json`, `eslint.config.mjs` (`eslint-config-next` flat), `next.config.ts`, `postcss.config.mjs` (`@tailwindcss/postcss`), `vitest.config.ts` (jsdom, `@vitejs/plugin-react`, setup file), `vitest.setup.ts` (`@testing-library/jest-dom/vitest`), `.env.example`
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/{types,api,auth,theme,placeholder}.ts(x)`, `src/components/{Header,ThemeToggle,ErrorBanner}.tsx`
- Test: `frontend/test/lib/api.test.ts`, `frontend/test/lib/placeholder.test.ts`

**Interfaces:**
- `package.json` scripts: `dev`, `build` (`next build`), `lint` (`eslint .`), `typecheck`, `test` (`vitest run`), `format`/`format:check`.
- `types.ts` mirrors the backend: `PublicPost`, `PublicSource { sourceId; name; siteUrl; iconUrl? }`, `AdminSource` (= backend `Source`), `FeedCandidate` and `Page<T> { items: T[]; nextCursor?: string }`.
- `api.ts`:
  - `class ApiError extends Error { status: number; code: string }`, which parses the `{error:{code,message}}` body.
  - Public: `getPosts(p: { cursor?: string; sourceId?: string; limit?: number }): Promise<Page<PublicPost>>` and `getSources(): Promise<PublicSource[]>`.
  - Admin, which sends `Authorization: <raw idToken>` from `getIdToken()`: `listAdminSources(): Promise<AdminSource[]>`, `discover(url): Promise<FeedCandidate[]>`, `addSource(i: { feedUrl: string; name?: string }): Promise<AdminSource>`, `updateSource(id, patch: { name?: string; enabled?: boolean }): Promise<AdminSource>`, `deleteSource(id): Promise<void>` and `triggerCrawl(sourceId?: string): Promise<void>`.
  - Base path `/api`.
- `auth.ts`:
  - `configureAmplify()` sets `Auth.Cognito.userPoolId` and `userPoolClientId`, plus `loginWith.oauth { domain: NEXT_PUBLIC_COGNITO_DOMAIN, scopes ['openid','email','profile'], redirectSignIn/redirectSignOut [`${window.location.origin}/sources/`], responseType 'code', providers ['Google'] }`.
  - `signIn()` calls `signInWithRedirect({ provider: 'Google' })`. Also `signOut()` and `getIdToken(): Promise<string | undefined>`.
  - `useAuth(): { status: 'loading' | 'signedOut' | 'signedIn'; email?: string }` listens to the Amplify `Hub` `auth` channel.
- `theme.tsx`: `ThemeProvider` and `useTheme(): { theme: 'dark' | 'light'; toggle(): void }`. The class `dark` goes on `<html>`, the value persists in `localStorage['fz-theme']` (wrapped in try/catch), and the **default is dark**. `layout.tsx` inlines a tiny pre-hydration script that applies the stored theme so the page doesn't flash.
- `placeholder.ts`: `placeholderStyle(seed: string): { background: string }` returns a deterministic two-stop `linear-gradient` from a string-hash hue, and `initialOf(name): string` returns the uppercase first alphanumeric.
- Design tokens in `globals.css`. Tailwind v4 `@theme` with CSS variables. Dark: bg `#0b1020`, surface `#121a33`, border `#1e293b`, text `#e2e8f0`, muted `#94a3b8`, accent `#22d3ee`. Light: bg `#f8fafc`, surface `#ffffff`, border `#e2e8f0`, text `#0f172a`, muted `#475569`, accent `#0891b2`. Use `@custom-variant dark (&:where(.dark, .dark *))`. Fonts via `next/font/google`: Inter (sans) and JetBrains Mono (mono). Polish beyond these tokens is the implementer's call; use the `ui-ux-pro-max` skill.
- `Header`: the mono wordmark `> feedzydev_` with `dev` in the accent colour, nav links Feed (`/`) and Sources (`/sources/`) with the active state, and `ThemeToggle`. It's sticky, and at 360px everything fits in one row.
- `ErrorBanner({ message, onRetry? })`.

- [ ] **Step 1: Scaffold** and run `pnpm install`.
- [ ] **Step 2: Write the failing tests**, with `fetch` stubbed via `vi.stubGlobal`:
  - `'getPosts builds query'`: calling `getPosts({cursor:'c', sourceId:'s'})` fetches `/api/posts?cursor=c&sourceId=s`.
  - `'admin calls send raw id token'`: with `getIdToken` mocked to `'tok'`, the headers contain `Authorization: 'tok'` (no `Bearer`).
  - `'error body becomes ApiError'`: a 422 `{error:{code:'NO_FEED_FOUND',message:'m'}}` rejects with `{status:422, code:'NO_FEED_FOUND', message:'m'}`.
  - `'placeholderStyle is deterministic'`: equal seeds give equal output and different seeds differ. `initialOf('  aws devops')` is `'A'`.
- [ ] **Step 3: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && NEXT_PUBLIC_USER_POOL_ID=x NEXT_PUBLIC_USER_POOL_CLIENT_ID=x NEXT_PUBLIC_COGNITO_DOMAIN=x pnpm build`. Expected: all pass, and `out/index.html` exists.
- [ ] **Step 6: Commit** with message `feat(frontend): scaffold, theme, api client, auth`.

---

### Task 12: Feed page

**Files:**
- Create: `src/lib/time.ts`, `src/hooks/usePosts.ts`, `src/components/{Thumbnail,PostCard,FeedGrid,FilterChips,SkeletonCard,EmptyState}.tsx`, `src/app/page.tsx`
- Test: `frontend/test/lib/time.test.ts`, `frontend/test/components/PostCard.test.tsx`

**Interfaces:**
- Consumes: `getPosts`, `getSources`, `PublicPost` and `PublicSource` (Task 11), `placeholderStyle` and `initialOf` (Task 11).
- Produces:
  - `formatPostTime(iso: string, now: Date): string`:
    - under 1 minute → `'just now'`
    - under 60 minutes → `'${m}m ago'`
    - under 24 hours → `'${h}h ago'`
    - otherwise `Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })` in the local time zone (the year is added when it isn't the current year)
  - `groupByDay(posts: PublicPost[], now: Date): { key: string /* YYYY-MM-DD local */; label: string; posts: PublicPost[] }[]` keeps input order. The label is `'Today'`, `'Yesterday'` or a weekday + date such as `'Wed, Oct 14'`.
  - `usePosts(sourceId?: string): { posts: PublicPost[]; loading: boolean; error?: string; done: boolean; loadMore(): void; retry(): void }`. It fetches pages of 30, resets when `sourceId` changes, and ignores responses from stale requests.
  - `Thumbnail({ src?, sourceName, iconUrl?, alt, className? })` renders `<img loading="lazy" decoding="async" referrerPolicy="no-referrer">` with a fixed aspect ratio (16:9). With no `src`, or on `onError`, it renders the placeholder: a gradient from `placeholderStyle(sourceName)` plus the icon or the initial.
  - `PostCard({ post, variant: 'featured' | 'tile', iconUrl?, now })` makes the whole card an `<a href={post.url} target="_blank" rel="noopener noreferrer">`. Inside are `Thumbnail`, a mono source chip with `sourceName`, the title (clamped to 3 lines on tiles and 2 lines in compact mode on mobile), the author when present, and `<time dateTime={publishedAt} title={full local datetime}>{formatPostTime}</time>`. Hover and focus-visible give a lift plus the accent glow, and the tap target is the whole card.
  - `FeedGrid({ groups, sources, now })`. The first post of the first group is the `featured` variant. Breakpoints:
    - `<640px`: 1 column, featured full width
    - `≥640px`: 2 columns
    - `≥1024px`: 3 columns, with the featured card spanning 2 columns × 2 rows (bento)
    - Day headers are sticky, small, mono, uppercase.
  - `FilterChips({ sources, value?: string, onChange(id?: string) })`: "All" plus one chip per source. The row scrolls horizontally (`overflow-x-auto`, no wrap) and is a single row on mobile. Each chip is `aria-pressed` and at least 44px tall.
  - `page.tsx`: `Header`, `FilterChips`, `FeedGrid`, and an IntersectionObserver sentinel that calls `loadMore`. There's also a visible "Load more" button fallback, `SkeletonCard`×6 while loading the first page, `EmptyState` ("No posts yet — add a source" linking to `/sources/`), `ErrorBanner` with retry, and an end marker `— you're all caught up —` when `done`.

- [ ] **Step 1: Write the failing tests** with `now = new Date('2026-10-17T10:00:00')` (local) and `TZ=Asia/Ho_Chi_Minh` set in `vitest.config.ts` `env`:
  - `formatPostTime`: `09:59:30` → `'just now'`, `09:15` → `'45m ago'`, `2026-10-16T12:00` → `'22h ago'`, and `2026-10-15T08:30` matches `/Oct 15/`.
  - `groupByDay`: posts on the 17th, the 17th, the 16th and the 14th give labels `['Today','Yesterday','Wed, Oct 14']` with counts `[2,1,1]`.
  - `PostCard`:
    - `'renders all card fields and links out'`: the title, author, source name and `time[datetime="…"]` are present, and the link has `href=post.url`, `target=_blank` and `rel="noopener noreferrer"`.
    - `'omits author when absent'`.
    - `'falls back to placeholder when image errors'`: `fireEvent.error(img)` removes the img and shows the initial of `sourceName`.
    - `'placeholder when no thumbnailUrl'`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gates as in Task 11 Step 5. Expected: all pass.
- [ ] **Step 5: Visual check.** Run `pnpm dev` with `/api/posts` mocked: add a dev-only `NEXT_PUBLIC_MOCK=1` branch in `api.ts` that returns fixture data from `src/lib/mock.ts`, excluded from production builds. Check the page with claude-in-chrome at 390×844 and 1440×900. Expected: no horizontal scroll at 360px, the featured card spans 2 columns on desktop, and dark is the default.
- [ ] **Step 6: Commit** with message `feat(frontend): feed page`.

---

### Task 13: Sources page

**Files:**
- Create: `src/app/sources/page.tsx`, `src/components/sources/{SignInPanel,AddSourceForm,SourceRow,SourcesList}.tsx`
- Test: `frontend/test/components/AddSourceForm.test.tsx`, `frontend/test/components/SourceRow.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `signIn` and `signOut` (Task 11), the admin API (Task 11), `formatPostTime` (Task 12).
- Produces:
  - `page.tsx`:
    - `loading` shows a skeleton.
    - `signedOut` shows `SignInPanel` (a "Sign in with Google" button calling `signIn()`, with the copy "Only the owner can manage sources.").
    - `signedIn` shows a header with the email, a Sign out button, `AddSourceForm`, a "Crawl now" button and `SourcesList`.
    - A 403 `ApiError` shows "This account isn't allowed to manage sources." with a sign-out option.
  - "Crawl now" calls `triggerCrawl()` and then shows the inline notice "Crawl started — refresh in a minute."
  - `AddSourceForm({ onAdded(): void })`:
    - It has a URL input with `type=url` and the placeholder `https://example.com/blog or feed URL`, and a Discover button.
    - Submitting calls `discover(url)` and shows candidates as checkboxes, all checked, each with its title, feedUrl and 3 preview titles with relative dates.
    - "Add selected (n)" calls `addSource({ feedUrl })` once per checked candidate, in sequence.
    - On success it clears and calls `onAdded`.
    - It shows each `ApiError.message` inline. A 409 per candidate shows "Already added" next to that candidate and doesn't abort the others.
    - Buttons are disabled while busy.
  - `SourceRow({ source, onChange(): void })`:
    - It shows the name (inline rename with Enter or blur saving via `updateSource`, and Esc cancelling), the feed URL (truncated, a link) and an enabled toggle (`role=switch`, calling `updateSource`).
    - The status line reads `ok · 3 new · 2h ago`, or `error` with the `lastError` text in a `<details>`.
    - Delete uses a two-step in-page confirm ("Delete" → "Confirm delete?" for 5s), then `deleteSource`. Never use `window.confirm`.
  - `SourcesList({ sources, onChange })`: rows stack as cards on mobile and form a table-like grid at `≥768px`. The empty state reads "No sources yet."

- [ ] **Step 1: Write the failing tests** with the admin API mocked via `vi.mock('@/lib/api')`:
  - `'discover → candidates → add selected'`: `discover` resolves 2 candidates. Unchecking one and clicking "Add selected (1)" calls `addSource` once with `{feedUrl: c2.feedUrl}`, and `onAdded` is called.
  - `'shows NO_FEED_FOUND message'`: `discover` rejects with `ApiError(422,'NO_FEED_FOUND','No RSS/Atom feed found at this URL — try pasting the feed URL directly.')`, and that text is visible.
  - `'409 marks candidate already added and continues'`.
  - `SourceRow`: `'toggle calls updateSource with enabled false'`, `'delete requires confirm click'` (the first click doesn't call `deleteSource` and the second does), and `'renders error status with lastError'`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the gates as in Task 11 Step 5, and confirm `out/sources/index.html` exists.
- [ ] **Step 5: Commit** with message `feat(frontend): sources page`.

---

### Task 14: CI/CD workflows + docs

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `README.md`, `docs/architecture.md`

**Interfaces:**
- `ci.yml`: `on: pull_request: branches: [feedzydev-claude]`, `workflow_call`, `workflow_dispatch`. `permissions: id-token: write, contents: read`.
  - Jobs `backend` and `frontend` each run `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` and `build`. The frontend build uses the placeholder `NEXT_PUBLIC_*` env.
  - Job `terraform` runs `fmt -check -recursive infra` and `init -backend=false` + `validate` in `infra/envs/prod`. It runs `validate` in `infra/bootstrap` too.
  - If `dorny/paths-filter` reports `infra/**` or `backend/**` changes, the job also builds the backend, assumes `secrets.AWS_PLAN_ROLE_ARN`, runs `terraform init -backend-config="bucket=${{ vars.STATE_BUCKET_NAME }}" -backend-config="region=${{ vars.AWS_REGION }}"`, then runs `terraform plan -input=false -lock=false` with env `TF_VAR_allowed_email: ${{ vars.ALLOWED_EMAIL }}`, `TF_VAR_google_client_id: ${{ secrets.GOOGLE_CLIENT_ID }}` and `TF_VAR_google_client_secret: ${{ secrets.GOOGLE_CLIENT_SECRET }}`.
  - Use the same action versions as the reference's `ci.yml`. `node-version-file: .nvmrc`.
- `deploy.yml`: `on: push: branches: [feedzydev-claude]` and `workflow_dispatch`. `concurrency: { group: deploy-feedzydev-claude-prod, cancel-in-progress: false }`.
  - Job `gates: uses: ./.github/workflows/ci.yml, secrets: inherit`.
  - Job `deploy: needs: gates` follows the reference's `deploy.yml` steps, with these changes:
    - OIDC uses `secrets.AWS_DEPLOY_ROLE_ARN`.
    - It uses the `TF_VAR_*` env as above, with no `-var` for buckets (defaults are used) and `terraform apply -auto-approve -input=false`.
    - Capture the outputs `user_pool_id`, `user_pool_client_id`, `cognito_domain`, `site_bucket_name` and `distribution_id`.
    - Build the frontend with `NEXT_PUBLIC_USER_POOL_ID`, `NEXT_PUBLIC_USER_POOL_CLIENT_ID` and `NEXT_PUBLIC_COGNITO_DOMAIN`.
    - `s3 sync --delete`, using `--cache-control "public,max-age=31536000,immutable"` for `_next/static/*` and `"no-cache"` for everything else (two syncs).
    - Invalidate `/*`.
    - Smoke test: `curl -fsS https://feedzydev-claude.nghuy.link/api/posts?limit=1`.
- `README.md` covers what the app is, a link to the architecture doc, local dev (`pnpm dev`, `NEXT_PUBLIC_MOCK=1`), quality-gate commands, and the full setup runbook (§16a of the spec: bootstrap, Google OAuth click-by-click, `gh variable set` / `gh secret set` commands, push to deploy). It also has a starter sources section and a tear-down section (`terraform destroy` on prod, then bootstrap after emptying the bucket).
- `docs/architecture.md` has a services table and Mermaid diagrams for runtime (feed read, admin write with authorizer, scheduled crawl) and deploy.

- [ ] **Step 1: Write the workflows and docs.**
- [ ] **Step 2: Lint the workflows** with `actionlint` (`brew install actionlint` if it's missing). Expected: no errors.
- [ ] **Step 3: Run** the full local gate: `(cd backend && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build) && (cd frontend && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test) && terraform fmt -check -recursive infra`. Expected: all pass.
- [ ] **Step 4: Commit** with message `ci: quality gates and deploy from feedzydev-claude; docs`.

---

### Task 15: Go-live (live changes, cleared by the owner)

**Files:**
- Modify: `README.md` (add a "Live" section with the URL, recorded discovery behaviour for `https://aws.amazon.com/blogs/`, and the verified starter feeds)

Live changes in this task are authorised by the owner (spec §16a). Still, stop and report if anything would touch resources outside the `feedzydev-claude*` names.

- [ ] **Step 1: Pre-flight.** Run `aws sts get-caller-identity` and expect account `010382427026`. Run `aws route53 list-resource-record-sets --hosted-zone-id Z10168803Q16IBJCR6YRD --query "ResourceRecordSets[?contains(Name,'feedzydev-claude')]"` and expect `[]`. Run `gh variable list -R HuyNguyen260398/feedzydev` and `gh secret list -R HuyNguyen260398/feedzydev` and expect no names that collide with ours (otherwise prefix ours with `FZC_` in both workflows).
- [ ] **Step 2: Apply the bootstrap.** Run `cd infra/bootstrap && terraform apply`. Expected: it creates the bucket and 2 roles, and the outputs print.
- [ ] **Step 3: Owner step: Google OAuth client.** Give the owner these steps and **pause until they hand back the client ID/secret**:
  1. Go to https://console.cloud.google.com/ and create or select a project.
  2. Under APIs & Services → OAuth consent screen, choose External, app name `feedzydev`, support email = the owner, and add the owner as a test user.
  3. Under Credentials → Create credentials → OAuth client ID, choose Web application. Set Authorized JavaScript origin `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com` and Authorized redirect URI `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com/oauth2/idpresponse`.
  4. Copy the Client ID and Client secret.
- [ ] **Step 4: Set the repo config.**
  - `gh variable set AWS_REGION -b ap-southeast-1`
  - `STATE_BUCKET_NAME` (the bootstrap output) and `ALLOWED_EMAIL` (`huynguyen260398@gmail.com`)
  - `gh secret set AWS_PLAN_ROLE_ARN` and `AWS_DEPLOY_ROLE_ARN` (the bootstrap outputs)
  - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (piped through stdin, never echoed)
  - Every command takes `-R HuyNguyen260398/feedzydev`.
- [ ] **Step 5: Push and watch.** Run `git push -u origin feedzydev-claude`, then `gh run watch` on the Deploy run. Expected: the gates and deploy are green. If the run fails, use superpowers:systematic-debugging, fix, commit and push again.
- [ ] **Step 6: Verify with curl:**
  - `curl -sI https://feedzydev-claude.nghuy.link/` gives `200` with an `x-cache` header.
  - `curl -s https://feedzydev-claude.nghuy.link/sources | grep -i sources` matches (the rewrite works).
  - `curl -s https://feedzydev-claude.nghuy.link/api/posts` returns `{"items":[...]}`.
  - `curl -s -o /dev/null -w '%{http_code}' -X POST https://feedzydev-claude.nghuy.link/api/admin/crawl` gives `401`.
  - `aws scheduler get-schedule --name feedzydev-claude-prod-daily-crawl --query '[ScheduleExpression,ScheduleExpressionTimezone]'` returns `["cron(0 7 * * ? *)","Asia/Ho_Chi_Minh"]`.
- [ ] **Step 7: Verify in the browser** with claude-in-chrome, recording a GIF `feedzydev-golive.gif`:
  1. Open `/sources/` and click "Sign in with Google". **The owner completes the Google login.**
  2. Confirm the signed-in view.
  3. Add `https://aws.amazon.com/blogs/` and record what discovery returns.
  4. Add the starter feeds, each verified to discover:
     - `https://aws.amazon.com/blogs/devops/feed/`
     - `https://aws.amazon.com/blogs/containers/feed/`
     - `https://www.hashicorp.com/blog/feed.xml`
     - `https://kubernetes.io/feed.xml`
     - `https://www.cncf.io/feed/`
     - `https://github.blog/feed/`
     - `https://www.docker.com/blog/feed/`
     - `https://grafana.com/blog/index.xml`

     Drop any that fail and note it.
  5. Click "Crawl now", wait about 60s, and open `/`. Expected: posts with thumbnails and correct sources.
  6. Resize to 360×780 and 390×844. Expected: one column, chips scroll, no horizontal page scroll.
  7. Toggle the theme and reload. Expected: the choice is kept.
- [ ] **Step 8: Run the non-owner check.** Ask the owner to try signing in with a different Google account (in a private window). Expected: Cognito shows an error containing "This app is private." If the owner can't test this, record it as not verified.
- [ ] **Step 9: Record the results** in the README "Live" section, commit with message `docs: record go-live verification`, and push. Expected: the Deploy run is green.
- [ ] **Step 10: Stop the visual companion server** with `bash /Users/huyng/.claude/plugins/cache/claude-plugins-official/superpowers/7.0.0/skills/brainstorming/scripts/stop-server.sh /Users/huyng/ws/feedzydev-claude/.superpowers/brainstorm/95135-1792204668`.

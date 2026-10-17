# feedzydev — Design

Date: 2026-10-17
Repo: https://github.com/HuyNguyen260398/feedzydev (work branch: `feedzydev-claude`)
Live URL: https://feedzydev-claude.nghuy.link
Reference architecture: `/Users/huyng/ws/aws-serverless-webapp/` (the owner's own sample; reuse its shape, tooling, and conventions unless this doc says otherwise)

Notation: **[owner]** = decided by the owner in conversation. **[call]** = a decision made during design that the owner can still overturn. Everything unmarked is direct restatement of the requirements.

## 1. Intent

A personal morning feed of new DevOps tech blog posts. Every day at 7AM (Vietnam time) a crawler pulls new posts from a list of sources the owner curates. The website shows them as a modern, scannable list of cards; clicking a card opens the original post. There is no reading view — the app is a launcher to the original articles.

It is for the owner first **[owner]**. The feed is public to read; only the owner can manage sources.

Success looks like: the owner opens feedzydev-claude.nghuy.link on phone or laptop in the morning, sees yesterday's/today's new posts from all their sources with real thumbnails, and taps through to read. Adding a new blog takes under a minute by pasting its homepage.

## 2. Goals

1. **Daily crawl** at 07:00 Asia/Ho_Chi_Minh via a scheduled Lambda.
2. **Feed page** (`/`): list of crawled posts, newest first. Each card shows original thumbnail, title, author, published date/time, source name, and links to the original post URL.
3. **Sources page** (`/sources/`): owner adds/removes/enables/disables sources and can trigger a crawl on demand.
4. **Source input accepts either a blog homepage or an RSS/Atom feed URL [owner]**, with automatic feed discovery for homepages.
5. **Modern, responsive UI** — must work well on mobile **[owner]**. Chosen direction: dark "dev console" bento (mockup option B) **[owner]**.
6. **Serverless backend, Next.js frontend, Terraform IaC, GitHub Actions CI/CD** with quality gates (format, lint, type check, test, build, terraform fmt/validate/plan) and automated deployment.
7. **Custom domain** `feedzydev-claude.nghuy.link` under the existing Route 53 hosted zone `nghuy.link` (zone ID `Z10168803Q16IBJCR6YRD`, account `010382427026`).

## 3. Non-goals

- No post reading page, no full-text storage, no summaries.
- No multi-user accounts, sign-up, or per-user feeds (but don't paint the data model into a corner — see §6).
- No HTML scraping of blogs without a feed **[call]**: if no RSS/Atom feed is found, the add fails with a clear message. Scrapers break whenever a site changes markup, and nearly all DevOps blogs publish feeds.
- No search, bookmarks, read/unread tracking, notifications, or email digests in v1.
- No staging environment — single `prod`, like the reference.

## 4. Anti-goals (would be a failure even if it "works")

- Anyone other than the owner can add, edit, delete sources or trigger crawls.
- A single broken source stops the whole crawl.
- The feed floods with years-old posts when a new source is added.
- The page is unusable or cramped on a phone.
- Long-lived AWS keys anywhere (CI uses OIDC, like the reference).
- Meaningful idle cost: no NAT gateways, VPCs, always-on compute, OpenSearch, etc.

## 5. Architecture

Same shape as the reference (CloudFront → S3 static site + `/api/*` → API Gateway REST → Lambda → DynamoDB, Cognito for auth), plus a scheduled crawler and a custom domain.

```
Browser ──HTTPS──> CloudFront (feedzydev-claude.nghuy.link, ACM cert in us-east-1)
                     ├─ default  → S3 (private, OAC) — Next.js static export
                     └─ /api/*   → API Gateway REST (stage "api")
                                     ├─ public GET methods (no auth)
                                     └─ write methods: Cognito authorizer
                                           → API Lambda (single function, internal router)
                                                ├─ DynamoDB: sources, posts
                                                └─ async-invokes Crawler Lambda ("Crawl now")
EventBridge Scheduler: cron(0 7 * * ? *) tz Asia/Ho_Chi_Minh → Crawler Lambda → fetch feeds → DynamoDB
Cognito User Pool ── federated Google IdP; Pre-sign-up Lambda allows only the owner's email
Route 53 (nghuy.link zone): A/AAAA alias feedzydev → CloudFront; ACM DNS validation records
```

Region: `ap-southeast-1` for everything except the ACM certificate (`us-east-1`, required by CloudFront) — use an aliased AWS provider.

### Deliberate differences from the reference

- **Multi-page static export.** The reference is a single page and maps CloudFront 403/404 → `/index.html`. This app has two pages (`/` and `/sources/`) and its API returns meaningful 403/404s. CloudFront custom error responses apply to **all** origins, so they would replace API errors with HTML. Therefore: **no custom error responses**; use `trailingSlash: true` in Next.js and a **CloudFront Function** (viewer-request, default behavior only) that rewrites directory-style URIs to `.../index.html` (`/sources` → `/sources/index.html`, `/` → `/index.html`). Missing pages may show S3's 403 or a `404.html` via the function — builder's choice.
- **Mixed auth on API Gateway.** Read endpoints are public; write endpoints use the Cognito authorizer. Auth is set per method, not with `ANY`.
- **Second Lambda (crawler) + pre-sign-up Lambda.** The API Lambda stays a single function with an internal router (as in the reference). The crawler is a separate function because it runs on a schedule, needs a longer timeout, and is invoked asynchronously.
- **Terraform state locking** uses S3 native locking (`use_lockfile = true`, Terraform ≥ 1.10) instead of a DynamoDB lock table **[call]** — one less resource.
- **GitHub OIDC roles are created by `infra/bootstrap`** (applied manually once, alongside the state bucket) **[call]**, trusting the account's already-existing GitHub OIDC provider (look it up with a data source; don't create a second one). The reference created roles by hand.
- **Prettier and explicit `typecheck` scripts** are added as quality gates (the reference had only lint/test/build).

## 6. Data model (DynamoDB, on-demand)

### `feedzydev-claude-prod-sources`

| Attribute | Notes |
|---|---|
| `sourceId` (PK, S) | ULID |
| `name` | From feed title; owner can rename |
| `siteUrl` | Homepage (from feed `<link>` or what the owner pasted) |
| `feedUrl` | Resolved RSS/Atom URL; unique among sources (reject duplicates) |
| `iconUrl` | Site favicon if found (used for the placeholder thumbnail); optional |
| `enabled` | boolean |
| `createdAt` | ISO 8601 |
| `lastCrawledAt`, `lastStatus` (`ok`/`error`), `lastError`, `lastNewCount` | Updated by each crawl |

Small table; `Scan` is fine.

### `feedzydev-claude-prod-posts`

| Attribute | Notes |
|---|---|
| `postId` (PK, S) | SHA-256 hex of the normalized post URL (lowercase host, strip fragment and `utm_*` params). Dedupes the same post across crawls. |
| `url`, `title`, `author` (optional), `publishedAt` (ISO 8601 UTC), `thumbnailUrl` (optional) | Card fields |
| `sourceId`, `sourceName` | Denormalized so the feed needs no join |
| `feedKey` | Constant `"ALL"` — partition for the global feed index |
| `crawledAt` | ISO 8601 |
| `expiresAt` | Epoch seconds; DynamoDB TTL = `publishedAt + 90 days` **[call]** |

Indexes:
- **GSI `byPublished`**: PK `feedKey`, SK `publishedAt` — global newest-first feed, paginated. A single constant partition is fine at personal scale (hundreds of posts/day max).
- **GSI `bySource`**: PK `sourceId`, SK `publishedAt` — the per-source filter and deleting a source's posts.

Writes use `ConditionExpression: attribute_not_exists(postId)` so re-crawls are idempotent and never overwrite.

Future multi-user: sources would gain an owner partition; posts could stay global. Not built now.

## 7. API (same-origin `/api/*`, JSON)

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/posts?limit=30&cursor=…&sourceId=…` | public | Newest-first page of posts; `cursor` is an opaque base64 of `LastEvaluatedKey`. `sourceId` switches to the `bySource` index. |
| `GET /api/sources` | public | Enabled sources' `sourceId`, `name`, `siteUrl`, `iconUrl` (for filter chips). |
| `GET /api/admin/sources` | owner | All sources with status fields. |
| `POST /api/admin/sources/discover` `{url}` | owner | Resolve URL → candidate feeds, each with title, feedUrl, siteUrl, and latest 3 entry titles/dates as preview. Does not save. |
| `POST /api/admin/sources` `{feedUrl, name?}` | owner | Re-validates the feed, saves the source. 409 if `feedUrl` already exists. |
| `PATCH /api/admin/sources/{id}` `{name?, enabled?}` | owner | Rename / enable / disable. |
| `DELETE /api/admin/sources/{id}` | owner | Delete source **and its posts** **[call]**. |
| `POST /api/admin/crawl` `{sourceId?}` | owner | Async-invoke the crawler (all enabled sources, or one). Returns 202. |

"Owner" means: API Gateway Cognito authorizer validates the **ID token** (sent as `Authorization: Bearer <idToken>`), **and** the Lambda checks `claims.email === ALLOWED_EMAIL` and `email_verified`, returning 403 otherwise **[call: defense in depth]**. Grouping writes under `/api/admin/*` makes per-method authorizer config simple (one proxy resource with the authorizer).

Errors: `{ "error": { "code": "...", "message": "..." } }` with appropriate 4xx/5xx. Discovery returns 422 `NO_FEED_FOUND` with message "No RSS/Atom feed found at this URL — try pasting the feed URL directly."

## 8. Feed discovery (on add, in the API Lambda)

Given a URL:
1. Fetch it (timeout 8s, follow redirects, UA `feedzydev/1.0 (+https://feedzydev-claude.nghuy.link)`).
2. If the response parses as RSS/Atom → that's the single candidate.
3. Else parse HTML: collect `<link rel="alternate" type="application/rss+xml|application/atom+xml" href>` (resolve relative URLs).
4. If none, probe in order: `/feed`, `/feed/`, `/rss`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/feed.xml` (relative to the given URL's path, then the site root); stop at the first that parses.
5. Return all candidates (deduped) with previews. The UI lets the owner tick one or more; each becomes its own source.

Note: the owner's example `https://aws.amazon.com/blogs/` is a hub of many AWS blogs. If discovery returns several feeds, the multi-select covers it. If it returns none, the owner pastes specific feeds (e.g. the AWS DevOps blog feed). The builder should test discovery against this URL and record the actual behaviour in the README.

API Gateway's 29s limit is the hard ceiling; keep total discovery under ~20s (parallel probes with per-request timeouts).

## 9. Crawler

- Trigger: EventBridge Scheduler `cron(0 7 * * ? *)`, `schedule_expression_timezone = "Asia/Ho_Chi_Minh"` **[owner: 7AM Vietnam]**, plus async invocation from `POST /api/admin/crawl` (payload `{sourceId?}`).
- Lambda: Node 20+, timeout 5 min, memory 512 MB **[call]**; reserved concurrency 1 so a manual crawl and the scheduled run can't overlap.
- For each enabled source (concurrency ~5): fetch feed (timeout 10s, use `If-None-Match`/`If-Modified-Since` if previously stored — optional), parse RSS 2.0 / Atom 1.0 / RSS 1.0.
- Per entry: skip if no link or no parsable date; **skip entries published more than 14 days ago [call]** (prevents flooding on first crawl of a new source); skip entries dated in the future by >1 day (clamp otherwise).
- Field mapping:
  - title: entry title, HTML-decoded and stripped.
  - author: `dc:creator` / `author/name` / `author`; omit if absent.
  - publishedAt: `pubDate` / `published` / `updated` / `dc:date`, normalized to UTC ISO.
  - thumbnail, first match: `media:thumbnail`, `media:content` (image), `enclosure` with image type, first `<img src>` in content/description; else fetch the post page and read `og:image` / `twitter:image` (only for new posts, capped at ~30 page fetches per run, 5s timeout). Thumbnail URLs are made absolute.
- Insert with conditional put (ignore `ConditionalCheckFailed`).
- Per-source try/catch: update the source's `lastStatus`/`lastError`/`lastCrawledAt`/`lastNewCount`; never let one source fail the run. Log a structured JSON summary per run.
- Scheduler retry policy: up to 2 retries; the run is idempotent.

Library choice is left to the builder (e.g. `fast-xml-parser` or `rss-parser` for feeds, `node-html-parser` or `cheerio` for HTML). Bundle with esbuild as in the reference. Use Node's global `fetch`.

## 10. Auth (Cognito + Google) [owner]

- Cognito User Pool with **Google as the only identity provider** (no username/password, no self-service sign-up UI).
- Hosted UI on Cognito's **prefix domain** (`feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com`) **[call]** — no custom auth subdomain/cert.
- App client: public (no secret), authorization-code flow with PKCE, scopes `openid email profile`. Callback/logout URLs: `https://feedzydev-claude.nghuy.link/sources/` and `http://localhost:3000/sources/`.
- Google attribute mapping: `email`, `email_verified`, `name`, `picture`.
- **Pre-sign-up Lambda** rejects any email other than `ALLOWED_EMAIL` (case-insensitive). For the allowed email it auto-confirms.
- Allowed email: `huynguyen260398@gmail.com` **[owner]** — supplied via Terraform variable / GitHub repo variable `ALLOWED_EMAIL`, not hard-coded in source.
- Google OAuth client is created **manually** in Google Cloud Console (OAuth consent screen "External", in testing or production; authorized redirect URI `https://<cognito-domain>/oauth2/idpresponse`). Its client ID/secret go to GitHub secrets `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and into Terraform as sensitive variables. (They will be stored in Terraform state; the state bucket is private and encrypted — acceptable.)
- Frontend uses AWS Amplify Auth (v6) `signInWithRedirect({ provider: 'Google' })`, `fetchAuthSession()` for the ID token, `signOut()`.

## 11. Frontend

- Next.js (current stable, App Router), TypeScript, **static export** (`output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`), Tailwind CSS. All data is fetched client-side from `/api/*`.
- Pages: `/` (Feed), `/sources/` (Sources; signed-out shows a "Sign in with Google" panel; signed in as non-owner is impossible by design but handle a 403 with a friendly message).
- **Visual direction (mockup B) [owner]:** dark-first "dev console" look — deep navy background (~`#0b1020`), raised cards (~`#121a33`, 1px `#1e293b` border), cyan accent (~`#22d3ee`), monospace wordmark `> feedzydev_`, mono source chips, subtle glow/lift on hover/focus. A light theme exists via a header toggle; preference persisted in `localStorage`; default is dark regardless of OS setting **[call]**. Exact palette, fonts and spacing are the builder's (use the `ui-ux-pro-max` / frontend design skills).
- **Feed layout:** the newest post is a large featured card; remaining posts in a bento/grid of smaller cards. Posts grouped under day headers by local published date ("Today", "Yesterday", "Wed, Oct 15"). Source filter chips across the top (horizontally scrollable on mobile). Infinite scroll in pages of 30 (IntersectionObserver) with a "Load more" button fallback **[call]**.
- **Card:** thumbnail (plain `<img loading="lazy" referrerpolicy="no-referrer">`, fixed aspect ratio, `onError` → placeholder), title (2–3 line clamp), author, published date/time (relative for <24h, e.g. "2h ago", absolute otherwise; full datetime in a tooltip/`<time datetime>`; displayed in the browser's local time zone), source name chip. The whole card is an `<a href={url} target="_blank" rel="noopener noreferrer">`.
- **Placeholder thumbnail:** gradient seeded from the source name with the source's favicon or initial.
- **Responsive [owner]:** mobile-first. ≤640px: single column, featured card full-width, chips scroll horizontally, nav stays compact. Tablet: 2 columns. Desktop: featured card spans 2 columns + bento grid. No horizontal page scroll at 360px width. Tap targets ≥44px.
- **States:** loading skeleton cards, empty feed ("No posts yet — add a source"), API error banner with retry, end-of-feed marker.
- **Sources page:** "Add source" input → Discover → candidate list with checkboxes + preview → Add selected. Table/cards of sources: name (inline rename), feed URL, enabled toggle, last crawl time + status (error message on tap/hover), last new count, delete (with an in-page confirm, not `window.confirm`). "Crawl now" button (shows "Crawl started — refresh in a minute"). Sign out in header.
- Accessibility: semantic landmarks, visible focus rings, alt text = post title, colour contrast AA in both themes.

## 12. Infrastructure (Terraform)

Layout mirrors the reference:

```
infra/
  bootstrap/          # manual, once: state bucket (versioned, encrypted, private) + GitHub OIDC plan/deploy roles
  envs/prod/          # root module; backend "s3" with use_lockfile = true; providers: aws (ap-southeast-1), aws.us_east_1
  modules/
    data/             # sources + posts tables, GSIs, TTL
    auth/             # user pool, Google IdP, domain, app client, pre-sign-up Lambda + permission
    api/              # REST API, resources/methods (public vs authorizer), stage "api", API Lambda + role
    crawler/          # crawler Lambda + role, EventBridge Scheduler + its role
    frontend/         # S3 site bucket, OAC, CloudFront + CloudFront Function, bucket policy
    dns/              # ACM cert (us-east-1) + validation records, Route 53 alias A/AAAA
```

(Placing the Lambda functions inside `api/`, `crawler/`, `auth/` vs a shared `compute/` module is the builder's call.)

- Terraform ≥ 1.10, AWS provider current major. `default_tags` with `Project = feedzydev`, `Environment = prod`, `ManagedBy = terraform`.
- Name prefix `feedzydev-claude-prod`.
- Hosted zone looked up via `data "aws_route53_zone"` for `nghuy.link` — never managed/created by this repo.
- IAM least privilege: API Lambda — CRUD on both tables + `lambda:InvokeFunction` on crawler; crawler — read sources, update sources, put posts; pre-sign-up — logs only.
- CloudWatch log groups with 30-day retention **[call]**.
- Lambda artifacts built by esbuild to `backend/dist/<fn>/index.js`, zipped with `archive_file` (as in the reference).

## 13. Code layout

```
backend/              # one package, three esbuild entry points
  src/api/            # handler + router + routes
  src/crawler/        # handler + crawl orchestration
  src/presignup/      # handler
  src/lib/            # feed parsing, discovery, thumbnail extraction, url normalization, ddb repositories, http fetch helper
  test/               # Jest; feed/HTML fixtures under test/fixtures (real saved RSS/Atom/HTML samples)
frontend/             # Next.js static export
infra/
.github/workflows/    # ci.yml, deploy.yml
docs/                 # architecture.md (Mermaid), superpowers/ specs & plans
```

pnpm, Node version pinned in `.nvmrc` (20 or 22, builder's choice, Lambda runtime to match). Separate `package.json`/lockfiles for `backend` and `frontend` (as reference) or a pnpm workspace — builder's call.

## 14. Testing

- Backend (Jest + `aws-sdk-client-mock`): URL normalization; RSS 2.0 / Atom / RSS 1.0 parsing from fixtures (incl. AWS blog, a WordPress blog, a Hugo blog, a Medium feed); thumbnail extraction precedence; og:image fallback; discovery (feed URL, `<link rel=alternate>`, path probing, none-found); router auth (public vs admin, wrong email → 403); repositories (conditional put, pagination cursor); crawler isolation (one source throws, others still saved); 14-day cut-off.
- Frontend (Vitest + Testing Library): PostCard rendering of all fields and missing-field fallbacks; day grouping + relative time formatting; sources discovery flow with mocked fetch.
- Network is always mocked in unit tests.

## 15. CI/CD (GitHub Actions)

**Deploys come from branch `feedzydev-claude`, not `main` [owner].** This build never touches `main`.

- `ci.yml` — reusable quality gates (`on: pull_request` targeting `feedzydev-claude`, plus `workflow_call` so deploy can reuse it): jobs `backend` and `frontend` each run `format:check` (Prettier), `lint` (ESLint), `typecheck` (`tsc --noEmit`), `test`, `build`; job `terraform` runs `fmt -check -recursive`, `init -backend=false` + `validate` always, and `plan` with the read-only OIDC role only when `infra/**` or `backend/**` changed (as reference). Optionally `tflint`.
- `deploy.yml` on push to `feedzydev-claude` (+ `workflow_dispatch`): first calls `ci.yml` (gates must pass), then: OIDC deploy role → build backend → `terraform apply` → capture outputs → build frontend with `NEXT_PUBLIC_*` env (user pool id, client id, Cognito domain, site URL) → `aws s3 sync --delete` → CloudFront invalidation. `concurrency: deploy-feedzydev-claude-prod`, no cancel-in-progress.
- Repo variables: `AWS_REGION`, `STATE_BUCKET_NAME`, `SITE_BUCKET_NAME`, `ALLOWED_EMAIL`, `COGNITO_DOMAIN_PREFIX`. Secrets: `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. The repo is shared with another build, so names must not collide with anything that build sets — if it ever uses the same names, prefix these with `FZC_` (check `gh variable list` / `gh secret list` first; today the repo is empty).
- Plan role trusts `repo:HuyNguyen260398/feedzydev:pull_request`; deploy role trusts only `repo:HuyNguyen260398/feedzydev:ref:refs/heads/feedzydev-claude`.

## 16. Isolation from the other FeedzyDev build [owner]

A separate, independent FeedzyDev implementation exists locally at `/Users/huyng/ws/feedzydev` (branch `feat/feedzydev-mvp`, same GitHub repo, never pushed or deployed). This build must be fully isolated from it:

- Subdomain **`feedzydev-claude.nghuy.link`** (not `feedzydev.nghuy.link`, which is left free for the other build).
- Every AWS resource name uses prefix `feedzydev-claude-prod` (tables, Lambdas, roles, API, CloudFront comment, scheduler, log groups); S3 buckets `feedzydev-claude-prod-site-010382427026` and `feedzydev-claude-tfstate-010382427026`; Cognito domain prefix `feedzydev-claude-010382427026`.
- Own Terraform state bucket and bootstrap; never import or reference the other build's state.
- OIDC roles `feedzydev-claude-ci-plan` / `feedzydev-claude-ci-deploy`. The deploy role's IAM permissions should be scoped by resource name prefix `feedzydev-claude-*` wherever the service supports it.
- Don't read from, copy, or modify `/Users/huyng/ws/feedzydev`.

## 16a. Setup and go-live — performed by the builder [owner: cleared for live changes]

The owner has cleared live changes to AWS account `010382427026` and to GitHub repo settings. The plan should carry these through to a verified live site:

1. Apply `infra/bootstrap` with local AWS credentials (state bucket + OIDC roles). Before creating anything, confirm the GitHub OIDC provider exists and that no Route 53 record already uses `feedzydev-claude.nghuy.link`.
2. **Owner step (only manual one):** create the Google OAuth client in Google Cloud Console with authorized redirect URI `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com/oauth2/idpresponse` (fixed up front, so it can be done before the first apply) and hand over client ID/secret. The builder writes exact click-by-click instructions and pauses for them.
3. Set GitHub variables/secrets with `gh`.
4. Push `feedzydev-claude` (the remote is empty, so it becomes the default branch) → deploy workflow runs.
5. Verify live: HTTPS on the subdomain, feed page loads on desktop and mobile width, Google sign-in as the owner works, a different Google account is rejected, add a source via homepage URL, "Crawl now" produces posts with thumbnails, the scheduler shows next run 07:00 Asia/Ho_Chi_Minh, admin endpoints return 401 without a token.

## 17. Starter sources [call]

Ship a small `backend/scripts/seed-sources.ts` (run manually, owner-only, uses local AWS creds) or just list suggested URLs in the README — builder's call. Suggested: AWS DevOps Blog, AWS Containers Blog, HashiCorp Blog, Kubernetes Blog, CNCF Blog, GitHub Blog (engineering/changelog), Docker Blog, Grafana Labs Blog. Verify each feed URL works before listing it.

## 18. Left to the builder

Exact libraries for feed/HTML parsing; exact palette/typography within the chosen direction; module boundaries for Lambdas; workspace vs separate packages; Node 20 vs 22; whether to use conditional GET headers; how missing static pages render; seed script vs README list; tflint; whether to use GitHub Environments for the deploy job.

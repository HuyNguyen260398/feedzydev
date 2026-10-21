# New-posts Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a full crawl (scheduled or "Crawl now") that inserts new posts, send a Web Push notification titled with the newest new post to every anonymous subscriber.

**Architecture:** Browsers subscribe through a bell in the header (Push API + VAPID). Their subscriptions go to a new public `/push/subscriptions` endpoint and are stored in a new DynamoDB table. At the end of a full run, the crawler Lambda fans out pushes with `web-push` and prunes dead subscriptions. `public/sw.js` shows the notification and focuses or opens the feed on click.

**Tech Stack:** TypeScript, Lambda (Node 24, esbuild), DynamoDB, API Gateway REST, Terraform, Next.js static export, hand-written service worker, jest + aws-sdk-client-mock, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-19-push-notifications-design.md`

## Global Constraints

- Triggers: only full runs (`crawlAll` without `sourceId`, result not `null`) with total new posts > 0. Never for `sourceId` runs.
- Body copy: `` `${sourceName} · Click to read ${n} more posts` `` where n = totalNew − 1. If n = 0: `` `${sourceName} · Click to read` ``. Title truncated to 120 chars.
- Payload: `{ title, body, url: '/', image?, tag: 'feedzy-new-posts' }`.
- Send options: `TTL: 86400`, `urgency: 'normal'`, concurrency 10. HTTP 404/410 → delete the subscription. Any other error → keep it and count it as failed. Push failures never throw out of the crawler.
- Endpoint allowlist (https only, exact or suffix match): `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`. Endpoint ≤ 1024 chars. `p256dh`/`auth` are base64url and ≤ 256 chars.
- Subscription id = lowercase hex SHA-256 of the endpoint, both server-side and client-side.
- Cap: 1000 subscriptions. A new id beyond the cap → 503 `SUBSCRIPTIONS_FULL`. Re-POSTing an existing id always succeeds.
- Error codes: 400 `INVALID_SUBSCRIPTION`; the existing `INVALID_JSON` for an unparsable body.
- Env: `SUBSCRIPTIONS_TABLE` (API + crawler); `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:<allowed_email>`) for the crawler only; `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the frontend. Missing VAPID env → crawler logs `push.skipped`. Missing public key → the bell isn't rendered.
- Log lines: `push.summary` `{ sent, removed, failed }`, `push.failed`, `push.skipped`. The `crawl.summary` log must not include `newest`.
- No permission prompt without a click on the bell.

## Review Focus

1. **Duplicate titles across sources / identical `publishedAt`:** the newest pick must be deterministic. Ties resolve to the first in result order. The test lives in Task 4.
2. **Malformed push payload in the SW** (empty data, non-JSON): it must still show a generic "New posts on feedzydev" notification, because Chrome penalises silent pushes. The SW is a single classic script with no test harness, so the parse lives in a top-level `notificationFromPush(data)` in `sw.js` and is verified manually (Task 6, Step 4).
3. **Endpoint lookalikes:** `https://fcm.googleapis.com.evil.io/…`, `http://fcm.googleapis.com/…` and `https://evilpush.apple.com/…` must be rejected. Suffix match on `.push.apple.com` only. Tests in Task 1.
4. **Post with no thumbnail:** `image` is omitted from the payload, not `undefined`/`""`. Test in Task 4.
5. **Permission granted but subscription gone** (the user cleared site data, or the server pruned it): on load the bell shows "off" and doesn't auto-subscribe. If a subscription exists, it is re-POSTed. Tests in Task 7.

---

### Task 1: Push validation and payload helpers

**Files:**
- Create: `backend/src/lib/push.ts`
- Test: `backend/test/lib/push.test.ts`

**Interfaces:**
- Produces:
  - `interface PushSubscriptionRecord { id: string; endpoint: string; p256dh: string; auth: string; createdAt: string; updatedAt: string }`
  - `interface PushPayload { title: string; body: string; url: string; image?: string; tag: string }`
  - `subscriptionId(endpoint: string): string`: hex SHA-256 via `node:crypto`.
  - `parseSubscription(body: Record<string, unknown>): { endpoint: string; p256dh: string; auth: string }`: throws `AppError(400, 'INVALID_SUBSCRIPTION', …)`.
  - `buildPayload(newest: Pick<Post,'title'|'sourceName'|'thumbnailUrl'>, totalNew: number): PushPayload`
  - `const MAX_SUBSCRIPTIONS = 1000`, `const PUSH_TAG = 'feedzy-new-posts'`

- [ ] **Step 1: Write failing tests**

```ts
describe('subscriptionId', () => {
  it('is the hex sha256 of the endpoint', () => {
    expect(subscriptionId('https://fcm.googleapis.com/x')).toMatch(/^[0-9a-f]{64}$/);
    expect(subscriptionId('a')).toBe(subscriptionId('a'));
  });
});
describe('parseSubscription', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNc-_1', auth: 'tB_-2' } };
  it('accepts allowlisted hosts', () => {
    for (const e of ['https://fcm.googleapis.com/a', 'https://updates.push.services.mozilla.com/a',
      'https://web.push.apple.com/a', 'https://wns2-sg2p.notify.windows.com/w/?token=x'])
      expect(parseSubscription({ ...ok, endpoint: e }).endpoint).toBe(e);
  });
  it.each([
    'http://fcm.googleapis.com/a', 'https://fcm.googleapis.com.evil.io/a',
    'https://evilpush.apple.com/a', 'https://example.com/a', 'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(1024)}`,
  ])('rejects endpoint %s', (endpoint) => {
    expect(() => parseSubscription({ ...ok, endpoint })).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_SUBSCRIPTION' }));
  });
  it.each([{}, { p256dh: 'a' }, { p256dh: 'a+b', auth: 'c' }, { p256dh: 'a'.repeat(257), auth: 'c' }])(
    'rejects keys %j', (keys) => {
      expect(() => parseSubscription({ ...ok, keys })).toThrow(expect.objectContaining({ code: 'INVALID_SUBSCRIPTION' }));
    });
});
describe('buildPayload', () => {
  const p = { title: 'AWS launches X', sourceName: 'AWS News Blog', thumbnailUrl: 'https://i/x.png' };
  it('counts the others', () => {
    expect(buildPayload(p, 12)).toEqual({ title: 'AWS launches X', body: 'AWS News Blog · Click to read 11 more posts', url: '/', image: 'https://i/x.png', tag: 'feedzy-new-posts' });
  });
  it('single post copy and no image key', () => {
    const out = buildPayload({ title: 'T', sourceName: 'S' }, 1);
    expect(out.body).toBe('S · Click to read');
    expect('image' in out).toBe(false);
  });
  it('truncates long titles to 120 chars', () => {
    expect(buildPayload({ ...p, title: 'x'.repeat(300) }, 2).title).toHaveLength(120);
  });
});
```

- [ ] **Step 2: Run** `cd backend && pnpm jest test/lib/push.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `backend/src/lib/push.ts`** with the interfaces above. Parse the host with `new URL`. A host is allowed if it equals an exact entry or ends with `.push.apple.com` / `.notify.windows.com`. Base64url check: `/^[A-Za-z0-9_-]+=*$/`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): push subscription validation and payload builder`

### Task 2: SubscriptionsRepo

**Files:**
- Create: `backend/src/lib/repo/subscriptions.ts`
- Test: `backend/test/lib/repo/subscriptions.test.ts`

**Interfaces:**
- Consumes: `PushSubscriptionRecord`, `subscriptionId` (Task 1).
- Produces: `class SubscriptionsRepo { constructor(doc: DynamoDBDocumentClient, table: string); exists(id: string): Promise<boolean>; count(): Promise<number>; put(s: { endpoint: string; p256dh: string; auth: string }, now?: Date): Promise<PushSubscriptionRecord>; remove(id: string): Promise<void>; list(): Promise<PushSubscriptionRecord[]> }`

- [ ] **Step 1: Write failing tests** in the style of `settings.test.ts` (`mockClient(DynamoDBDocumentClient)`):
  - `put` sends an `UpdateCommand` keyed `{ id: subscriptionId(endpoint) }` that sets `endpoint, p256dh, auth, updatedAt` and `createdAt = if_not_exists(createdAt, :now)`, and returns the record from `ReturnValues: 'ALL_NEW'`.
  - `exists` uses `GetCommand` with `ProjectionExpression: 'id'` → true or false.
  - `count` pages `ScanCommand` with `Select: 'COUNT'` across `LastEvaluatedKey` (two pages of 3 and 2 → 5).
  - `list` pages `ScanCommand` and concatenates `Items`.
  - `remove` sends `DeleteCommand` with `Key: { id }`.
- [ ] **Step 2: Run** `pnpm jest test/lib/repo/subscriptions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to match the tests, following the `SourcesRepo.list` paging style.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): push subscriptions repository`

### Task 3: Public subscription API

**Files:**
- Modify: `backend/src/api/router.ts` (`ApiDeps`, `route`)
- Modify: `backend/src/api/handler.ts` (wire `SubscriptionsRepo` from `SUBSCRIPTIONS_TABLE`)
- Test: `backend/test/api/router.test.ts`

**Interfaces:**
- Consumes: `SubscriptionsRepo` (Task 2), `parseSubscription`, `MAX_SUBSCRIPTIONS` (Task 1).
- Produces: `ApiDeps.subscriptions: Pick<SubscriptionsRepo, 'exists' | 'count' | 'put' | 'remove'>`; routes `POST /push/subscriptions` → `201 { id }`, `DELETE /push/subscriptions/{id}` → `204`.

- [ ] **Step 1: Write failing tests** (extend `mk()` with a `subscriptions` mock). Every case runs **without** claims:
  - A valid POST → 201 `{ id }`, and `put` is called with `{ endpoint, p256dh, auth }`.
  - A POST with a disallowed host → 400 `INVALID_SUBSCRIPTION`, and `put` is not called.
  - A POST body `'nope'` → 400 `INVALID_JSON`.
  - `exists` false and `count` 1000 → 503 `SUBSCRIPTIONS_FULL`, and `put` is not called.
  - `exists` true and `count` 1000 → 201, and `count` is not called.
  - `DELETE /push/subscriptions/abc` → 204, and `remove('abc')` is called. A trailing slash works too.
  - `GET /push/subscriptions` → 404.
- [ ] **Step 2: Run** `pnpm jest test/api/router.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** a `subscribe(event, deps)` handler and a delete route in `route()` before the 404 fallthrough. The 503 message is `'Notification sign-ups are full right now.'`. Wire the handler.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(backend): public push subscription endpoints`

### Task 4: Crawler sends notifications

**Files:**
- Modify: `backend/src/crawler/crawl.ts` (`crawlInner` returns `{ newCount, newest? }`; `SourceResult.newest?: Post`)
- Create: `backend/src/crawler/notify.ts`
- Modify: `backend/src/crawler/handler.ts`
- Modify: `backend/package.json` (add `web-push` dependency and `@types/web-push` dev dependency; `pnpm add web-push && pnpm add -D @types/web-push`)
- Test: `backend/test/crawler/crawl.test.ts`, create `backend/test/crawler/notify.test.ts`

**Interfaces:**
- Consumes: `buildPayload`, `PushPayload`, `PushSubscriptionRecord` (Task 1); `SubscriptionsRepo` (Task 2); `mapWithConcurrency`.
- Produces:
  - `type SendPush = (sub: PushSubscriptionRecord, payload: PushPayload) => Promise<void>`. It rejects with an error carrying `statusCode?: number`.
  - `interface NotifyDeps { subscriptions: Pick<SubscriptionsRepo, 'list' | 'remove'>; sendPush: SendPush }`
  - `notifyNewPosts(deps: NotifyDeps, results: SourceResult[]): Promise<{ sent: number; removed: number; failed: number }>`
  - `notifyAfterCrawl(deps: NotifyDeps | null, event: { sourceId?: string }, results: SourceResult[] | null): Promise<void>`. This is the gate: it returns when `deps` is null (logs `push.skipped`), when `event.sourceId` is set, when `results` is null, or when totalNew is 0. Otherwise it calls `notifyNewPosts` inside try/catch and logs `push.summary` or `push.failed`.

- [ ] **Step 1: Write failing crawl tests:** with fixture `rss2-media.xml`, `crawlAll` results carry `newest` equal to the inserted post with the max `publishedAt`. When every post already exists, there's `newCount: 0` and no `newest`. `recordCrawl` is called without `newest`.
- [ ] **Step 2: Write failing notify tests:**
  - Picks the newest across two sources' `newest`. Ties keep the earlier result.
  - It sends `buildPayload(newest, totalNew)` to every listed subscription.
  - 410 and 404 → `remove(id)`. 500 → kept. Returns `{ sent: 1, removed: 2, failed: 1 }` for a mix of [ok, 410, 404, 500].
  - No subscriptions → `{ 0, 0, 0 }`, and `sendPush` is not called.
  - `notifyAfterCrawl`: doesn't call `list` for `{ sourceId: 'S1' }`, for `null` results, or for zero new posts. With `deps === null` it logs `push.skipped`. When `list` rejects, it resolves (doesn't throw) and logs `push.failed`.
- [ ] **Step 3: Run** `pnpm jest test/crawler`. Expected: FAIL.
- [ ] **Step 4: Implement.** In `crawlInner`, track the newest by `publishedAt` string compare (ISO). Use `mapWithConcurrency(subs, 10, …)`. In `handler.ts`, build `NotifyDeps` only when all of `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `SUBSCRIPTIONS_TABLE` are set. `sendPush` calls `webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload), { TTL: 86400, urgency: 'normal', vapidDetails: { subject, publicKey, privateKey } })`. Strip `newest` from the `crawl.summary` log (`results.map(({ newest, ...r }) => r)`), then `await notifyAfterCrawl(notifyDeps, event ?? {}, results)` before returning.
- [ ] **Step 5: Run** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`. Expected: PASS, and `dist/crawler/index.js` exists.
- [ ] **Step 6: Commit** `feat(backend): send push notification after full crawls`

### Task 5: Infrastructure and CI

**Files:**
- Modify: `infra/modules/data/main.tf`, `infra/modules/data/outputs.tf`
- Modify: `infra/modules/api/main.tf`
- Modify: `infra/envs/prod/main.tf`, `infra/envs/prod/variables.tf`, `infra/envs/prod/terraform.tfvars.example`
- Modify: `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `frontend/.env.example`

**Interfaces:**
- Produces: table `${name_prefix}-push-subscriptions` (hash `id` S, PAY_PER_REQUEST, no PITR); outputs `push_subscriptions_table_name` and `push_subscriptions_table_arn`; vars `vapid_public_key` (string) and `vapid_private_key` (string, sensitive).

- [ ] **Step 1: Data module:** add the table and outputs.
- [ ] **Step 2: API module:** add `aws_api_gateway_resource` `push` (under root) → `push_subscriptions` (`subscriptions`) → `push_subscription` (`{id}`). Methods: `POST` on `push_subscriptions` and `DELETE` on `push_subscription`, `authorization = "NONE"`, plus `AWS_PROXY` integrations mirroring `posts`. Add all new resource, method and integration ids to the deployment `triggers` list.
- [ ] **Step 3: Prod env:** add a `subs_table` local ARN. The API policy gets `GetItem`, `UpdateItem`, `DeleteItem` and `Scan` on it. The crawler policy gets `Scan` and `DeleteItem`. API env gets `SUBSCRIPTIONS_TABLE`. Crawler env gets `SUBSCRIPTIONS_TABLE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT = "mailto:${var.allowed_email}"`. Add the variables and the example entries.
- [ ] **Step 4: Workflows:** in `deploy.yml` apply env add `TF_VAR_vapid_public_key: ${{ vars.VAPID_PUBLIC_KEY }}` and `TF_VAR_vapid_private_key: ${{ secrets.VAPID_PRIVATE_KEY }}`, and in the frontend build env add `NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${{ vars.VAPID_PUBLIC_KEY }}`. In `ci.yml`, add the same two TF vars to the plan step and `NEXT_PUBLIC_VAPID_PUBLIC_KEY: placeholder` to the build step. Add `NEXT_PUBLIC_VAPID_PUBLIC_KEY=` to `frontend/.env.example`.
- [ ] **Step 5: Verify** `terraform -chdir=infra/envs/prod fmt -check -recursive ../../` and `terraform -chdir=infra/envs/prod init -backend=false && terraform -chdir=infra/envs/prod validate`. Expected: no fmt diff, "Success! The configuration is valid."
- [ ] **Step 6: Commit** `feat(infra): push subscriptions table, public routes, VAPID config`

### Task 6: Service worker push handling and client push library

**Files:**
- Modify: `frontend/public/sw.js`
- Create: `frontend/src/lib/push.ts`
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/test/lib/push.test.ts`

**Interfaces:**
- Produces:
  - `api.ts`: `postSubscription(sub: PushSubscriptionJSON): Promise<{ id: string }>`, `deleteSubscription(id: string): Promise<void>` (via the existing `request`).
  - `push.ts`: `type PushState = 'hidden' | 'needs-install' | 'off' | 'on' | 'blocked'`; `VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''`; `getPushState(): Promise<PushState>`; `subscribe(): Promise<PushState>` (resolves `'on'`, `'blocked'` if denied, or `'off'` if dismissed; throws on API/network failure after undoing a browser subscription); `unsubscribe(): Promise<PushState>`; `resync(): Promise<void>` (re-POSTs an existing subscription and swallows errors); `endpointId(endpoint: string): Promise<string>` (hex SHA-256 via `crypto.subtle`); `urlBase64ToUint8Array(s: string): Uint8Array`.
  - `isIos()` and `isStandalone()` move from `InstallButton.tsx` to `frontend/src/lib/platform.ts`, and both components import them from there.

- [ ] **Step 1: Write failing tests** for `push.ts` with stubbed `navigator.serviceWorker.ready`, `PushManager`, `Notification` and mocked `@/lib/api`:
  - `getPushState` returns `'hidden'` when `VAPID_PUBLIC_KEY` is empty (use `vi.stubEnv` + `vi.resetModules`).
  - It returns `'needs-install'` for an iPhone UA, not standalone, with no `PushManager`.
  - It returns `'blocked'` when `Notification.permission === 'denied'`.
  - It returns `'on'` with an existing subscription, and `'off'` with none.
  - `subscribe` calls `requestPermission` and then `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and `postSubscription(sub.toJSON())`. When `postSubscription` rejects, it calls `sub.unsubscribe()` and rethrows.
  - `unsubscribe` calls `deleteSubscription(await endpointId(endpoint))` and `sub.unsubscribe()`.
  - `resync` with permission granted and a subscription calls `postSubscription`. With no subscription it doesn't call `postSubscription` or `pushManager.subscribe`.
  - `endpointId('a')` equals `'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'`.
- [ ] **Step 2: Run** `cd frontend && pnpm vitest run test/lib/push.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `platform.ts`, `push.ts` and the API functions. Mock mode (`NEXT_PUBLIC_MOCK === '1'`) → `getPushState` returns `'hidden'`.
- [ ] **Step 4: Service worker:** add a top-level `function notificationFromPush(data)` that returns `{ title, options }`, with the fallback title `'New posts on feedzydev'` and body `'Click to read'` for missing or invalid JSON. Add a `push` listener → `event.waitUntil(self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', image, tag, renotify: true, data: { url } }))`. Add a `notificationclick` listener per spec §6.5 (close; `matchAll({ type: 'window', includeUncontrolled: true })`; for a same-origin client, `navigate(url).catch(() => {})` then `focus()`; otherwise `openWindow(url)`). Verify manually: run `pnpm build`, serve `out/`, and in Chrome DevTools → Application → Service Workers → Push, send `{"title":"T","body":"B","url":"/"}` and then `garbage`. Both show a notification, and clicking it focuses the tab.
- [ ] **Step 5: Run** `pnpm vitest run && pnpm typecheck && pnpm lint`. Expected: PASS, including the existing `InstallButton` tests.
- [ ] **Step 6: Commit** `feat(frontend): service worker push display and client push library`

### Task 7: Notification bell in the header

**Files:**
- Create: `frontend/src/components/NotifyButton.tsx`
- Create: `frontend/src/components/IosInstallSteps.tsx` (the Share → Add to Home Screen list extracted from `InstallButton`)
- Modify: `frontend/src/components/InstallButton.tsx`, `frontend/src/components/Header.tsx` (render `<NotifyButton />` between `InstallButton` and `ThemeToggle`)
- Test: `frontend/test/components/NotifyButton.test.tsx`

**Interfaces:**
- Consumes: `getPushState`, `subscribe`, `unsubscribe`, `resync`, `PushState` (Task 6).

- [ ] **Step 1: Write failing tests** (mock `@/lib/push`):
  - `'hidden'` → no button.
  - `'off'` → a button named `'Turn on new-post notifications'` with `aria-pressed="false"`. Clicking it calls `subscribe`, and on resolve to `'on'` the name becomes `'Turn off notifications'` with `aria-pressed="true"`.
  - `'on'` → a click calls `unsubscribe` → `'off'`.
  - `subscribe` rejects with `ApiError(503, 'SUBSCRIPTIONS_FULL', …)` → the button reverts to `'off'` and a status message with the error text shows.
  - `'blocked'` → a click opens a dialog containing `'Notifications are blocked for this site'`, and `subscribe` is not called.
  - `'needs-install'` → a click opens a dialog containing `'add feedzydev to your Home Screen first'` and `'Add to Home Screen'`.
  - On mount with state `'on'`, `resync` is called once. With `'off'` it isn't called.
  - While a click is pending, the button is `disabled`.
- [ ] **Step 2: Run** `pnpm vitest run test/components/NotifyButton.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse InstallButton's `btn` classes; the `'on'` state adds `text-accent`. Popovers use the same outside-click/Escape behaviour as `InstallButton`. Bell icons are inline SVGs (outline, filled, slashed). Dialog copy:
  - needs-install: "To get notifications on iPhone/iPad, add feedzydev to your Home Screen first." followed by `<IosInstallSteps />`
  - blocked: "Notifications are blocked for this site. Enable them in your browser's site settings."
- [ ] **Step 4: Run** `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): notification bell toggle in header`

### Task 8: Docs

**Files:**
- Modify: `docs/architecture.md` (Services table row "Push" → Web Push via `web-push`, `push-subscriptions` table; add a "Push notification" mermaid sequence: Browser → POST /api/push/subscriptions → API Lambda → DynamoDB; Crawler → Scan subscriptions → push services → SW → notification)
- Modify: `docs/runbooks/go-live.md` (one-time step: `npx web-push generate-vapid-keys`; set the GitHub variable `VAPID_PUBLIC_KEY` and the secret `VAPID_PRIVATE_KEY`; manual verification checklist from spec §7)
- Modify: `README.md` if it lists features or env vars (add the notification bullet and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`)

- [ ] **Step 1: Write the doc changes.**
- [ ] **Step 2: Run** `pnpm --dir backend format:check` and `pnpm --dir frontend format:check` (if docs are covered). Expected: PASS.
- [ ] **Step 3: Commit** `docs: push notifications architecture and VAPID setup`

# New-posts push notifications — Design

Date: 2026-10-19
Builds on: `docs/superpowers/specs/2026-10-17-feedzydev-design.md` (which listed notifications as a v1 non-goal; this lifts that).

Notation: **[owner]** = decided by the owner in conversation. **[call]** = a decision made during design that the owner can still overturn. Everything unmarked is direct restatement of the requirements.

## 1. Intent

When a crawl finishes and finds new posts, everyone who opted in gets a system notification on their device. It teases the newest new post and invites them back to the feed, for example:

> **AWS announces Graviton5 instances for EKS**
> AWS News Blog · Click to read 11 more posts

It must work in the browser and in the installed PWA, on desktop and mobile **[owner]**, including when Feedzy is not open. The crawler runs on Lambda, so this requires **Web Push** (Push API + VAPID) delivered through the existing service worker. Polling or in-page notifications would not reach a closed app.

## 2. Goals

1. **Anyone can subscribe**, signed in or not **[owner]**, with a bell toggle in the header.
2. **Triggers:** scheduled crawls and the Sources page "Crawl now" button **[owner]**. Both are full runs (`crawlAll` without `sourceId`). Single-source crawls (adding a source, re-crawling one source) do **not** notify **[call]**. A scheduled tick that is skipped (not a configured hour) does not notify either.
3. **Content:** title = the newest post among the posts inserted by that run, by `publishedAt` **[owner]**. Body = `<sourceName> · Click to read N more posts`, where N = total new posts − 1. If N = 0, the body is `<sourceName> · Click to read` **[call]**.
4. **One notification per qualifying run** **[call]**. With several crawl hours configured, each run that finds new posts sends one. A run with 0 new posts sends nothing.
5. **Tap → open the feed** (`/`), focusing an existing Feedzy window or tab if there is one, otherwise opening a new one **[call]**. It does not open the post itself, because the copy says "read more posts".
6. **Platforms:** Chrome/Edge/Firefox desktop, Android Chrome/Firefox (browser and installed), Safari macOS 16+, and iOS/iPadOS 16.4+ **only when installed to the Home Screen**. That last restriction is Apple's, not ours.

## 3. Non-goals

- No per-source or per-keyword notification preferences.
- No quiet hours, digest batching, or email/SMS.
- No notification history or inbox inside the app.
- No subscriber accounts. A subscription is anonymous and tied to the device/browser.
- No badge counts (`navigator.setAppBadge`) in this iteration.

## 4. Anti-goals

- A failing push (dead subscription, push-service outage) makes the crawl fail or skips recording results. Push sending is best-effort and isolated, like `purgeExpired`.
- The public subscribe endpoint lets a stranger make the crawler send requests to arbitrary URLs. Endpoints are restricted to known push services (§6.2).
- Users get pestered: no automatic permission prompt on page load. The prompt appears only after a click on the bell.
- Dead subscriptions pile up and get retried forever.

## 5. Constraints

- Existing stack: Next.js static export + `public/sw.js` (hand-written, no Workbox), Lambda (Node 24, esbuild bundle), DynamoDB on-demand, API Gateway REST with **explicit** public routes (`/posts`, `/sources`) and an authorized `/admin/{proxy+}`, Terraform modules under `infra/modules`, GitHub Actions deploy.
- Secrets follow the existing pattern: GitHub secret → `TF_VAR_*` (sensitive) → Lambda environment variable (like `google_client_secret`).
- `NEXT_PUBLIC_*` values are inlined at frontend build time.
- API Gateway stage throttling (burst 20, rate 10) already applies to all routes.

## 6. Design

### 6.1 Keys (VAPID)

- One VAPID key pair, generated once with `npx web-push generate-vapid-keys`.
- **Public key:** GitHub Actions variable `VAPID_PUBLIC_KEY`. It is passed to the frontend build as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and to Terraform as `TF_VAR_vapid_public_key`.
- **Private key:** GitHub secret `VAPID_PRIVATE_KEY` → `TF_VAR_vapid_private_key` (sensitive) → crawler Lambda env `VAPID_PRIVATE_KEY`.
- **Subject:** `mailto:` the existing `allowed_email` var → crawler env `VAPID_SUBJECT` **[call]**.
- If `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is empty (local dev, mock mode), the bell is not rendered. If the crawler lacks VAPID env vars, it logs `push.skipped` and sends nothing.

### 6.2 Data — `push_subscriptions` table

New DynamoDB table `${name_prefix}-push-subscriptions` in `infra/modules/data`, on-demand billing, hash key `id` (S).

| attr | type | notes |
|---|---|---|
| `id` | S | hex SHA-256 of `endpoint`. Makes upserts idempotent and lets the client delete without sending keys. |
| `endpoint` | S | push service URL |
| `p256dh` | S | subscription key |
| `auth` | S | subscription key |
| `createdAt` | S | ISO time of first subscribe |
| `updatedAt` | S | ISO time of last upsert |

New `backend/src/lib/repo/subscriptions.ts` → `SubscriptionsRepo` with `put(sub)`, `remove(id)` and `list()` (paginated Scan collecting all items). This follows the style of the other repos.

**Validation** (in a new `backend/src/lib/push.ts`, shared by the API and crawler):
- `endpoint` must be an `https:` URL whose hostname matches an allowlist of push services **[call]**:
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`, `push.services.mozilla.com`. Unknown hosts are rejected with 400 `INVALID_SUBSCRIPTION`.
- `endpoint` ≤ 1024 chars. `p256dh` and `auth` are non-empty base64url strings ≤ 256 chars.
- **Cap:** reject new subscriptions with 503 `SUBSCRIPTIONS_FULL` when the table already holds ≥ 1000 items **[call]**. This bounds crawler fan-out and cost if someone scripts subscriptions. Check with a `Select: COUNT` scan only on insert of a new id. A put that hits an existing id always succeeds.

### 6.3 API (public, no auth)

Router additions in `backend/src/api/router.ts`:

- `POST /push/subscriptions` with body `{ endpoint, keys: { p256dh, auth } }`. This is the browser's `PushSubscription.toJSON()` shape. It validates, upserts and returns `201 { id }`. It is idempotent.
- `DELETE /push/subscriptions/{id}` → `204`. It is idempotent: deleting an id that doesn't exist is still 204.

`ApiDeps` gains `subscriptions: SubscriptionsRepo`. API Lambda env gains `SUBSCRIPTIONS_TABLE`. IAM gains `PutItem`, `DeleteItem`, `GetItem` and `Scan` on that table.

Terraform `infra/modules/api`: add resources `push` → `subscriptions` → `{id}` with methods `POST` (on `subscriptions`) and `DELETE` (on `{id}`), both `authorization = "NONE"`, Lambda proxy integration, and add them to the deployment's redeploy triggers. CloudFront already forwards `/api/*`. The frontend service worker already skips non-GET requests, so no caching concerns.

The id being an unguessable hash of the endpoint means only the holder of the subscription can practically unsubscribe it.

### 6.4 Crawler — sending

`crawlInner` currently returns a count. It changes to return `{ newCount, newest?: Post }`, where `newest` is the inserted post with the greatest `publishedAt`. `SourceResult` gains an optional `newest` that is **not** written by `recordCrawl` and is stripped from the `crawl.summary` log line, which stays as it is today **[call]**.

`crawlAll` stays pure (returns results). Notification happens in a new exported function:

```ts
notifyNewPosts(deps: NotifyDeps, results: SourceResult[]): Promise<{ sent: number; removed: number; failed: number }>
```

It is called from `crawler/handler.ts` only when the run was full (`!event.sourceId`), `results !== null`, and `totalNew > 0`. It:

1. Picks the newest post across `results[].newest`.
2. Builds the payload (JSON, kept well under the 4 KB push limit; the title is truncated to 120 chars):
   ```json
   { "title": "<post title>", "body": "<sourceName> · Click to read 11 more posts",
     "url": "/", "image": "<thumbnailUrl, optional>", "tag": "feedzy-new-posts" }
   ```
3. Lists all subscriptions and sends with the `web-push` npm package (new backend dependency; bundles under esbuild) using `TTL: 86400` and `urgency: 'normal'`, with concurrency 10 via the existing `mapWithConcurrency`.
4. Responses **404 / 410** → `subscriptions.remove(id)`. Other errors are counted as `failed` and the subscription is kept.
5. Logs `{ msg: 'push.summary', sent, removed, failed }`. The whole function is wrapped so any throw is logged as `push.failed` and never propagates. The crawl result is unaffected.

`NotifyDeps = { subscriptions: Pick<SubscriptionsRepo,'list'|'remove'>, sendPush: (sub, payload) => Promise<void> }`, injected so it can be unit-tested without network access. The crawler env gains `SUBSCRIPTIONS_TABLE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Crawler IAM gains `Scan` and `DeleteItem` on the subscriptions table.

Timing: the crawler timeout is 300 s and reserved concurrency is 1. With ≤ 1000 subscriptions at concurrency 10 and roughly 200 ms per send, the push phase takes about 20 s. That's acceptable.

### 6.5 Service worker (`frontend/public/sw.js`)

Add two listeners. The caching logic stays the same.

- `push`: parse `event.data.json()` (fall back to a generic "New posts on feedzydev" if it's missing or malformed) and call `self.registration.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', image, tag, renotify: true, data: { url } })` inside `event.waitUntil`. With `tag` + `renotify`, a newer crawl notification replaces an unread older one but still alerts **[call]**.
- `notificationclick`: close the notification. Then `clients.matchAll({ type: 'window', includeUncontrolled: true })`. If there's a same-origin client, `navigate(url)` it (ignore errors) and `focus()` it. Otherwise `clients.openWindow(url)`.

### 6.6 Frontend UI — bell toggle

New `frontend/src/components/NotifyButton.tsx`, placed in `Header` between `InstallButton` and `ThemeToggle`, styled with the same 40×40 icon button as `InstallButton`. New `frontend/src/lib/push.ts` holds the browser logic (`getState`, `subscribe`, `unsubscribe`) plus API calls added to `frontend/src/lib/api.ts` (`postSubscription`, `deleteSubscription`).

States:

| state | condition | bell | click |
|---|---|---|---|
| hidden | no VAPID key, SSR, or no `serviceWorker`/`PushManager`/`Notification`, unless it's iOS (see next row) | not rendered | — |
| needs install | iOS/iPadOS and not standalone (`PushManager` absent in a Safari tab) | bell with a slash | popover: "To get notifications on iPhone/iPad, add feedzydev to your Home Screen first," with the same Share → Add to Home Screen steps as `InstallButton` (extract the steps into a shared component) **[call]** |
| off | permission `default`/`granted`, no subscription | outline bell | `Notification.requestPermission()` → if granted, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` → POST → state on |
| on | an active subscription exists | filled bell, accent colour | `subscription.unsubscribe()` + DELETE by id (computed client-side as SHA-256 of the endpoint via `crypto.subtle`) → off |
| blocked | permission `denied` | bell with a slash, muted | popover: "Notifications are blocked for this site. Enable them in your browser's site settings." |
| busy | while subscribing or unsubscribing | disabled and spinning | — |

The `aria-label`/`title` reflects the state ("Turn on new-post notifications" / "Turn off notifications" / …), and `aria-pressed` is set for on/off. Errors (a network failure, or 503 full) show the existing `ErrorBanner` pattern or a short popover message, and the state reverts.

**Keep-alive resync:** on app load, if permission is `granted` and `pushManager.getSubscription()` returns one, re-POST it silently (idempotent upsert). This covers browsers that rotate subscriptions and server-side removals **[call]**. If permission is granted but there's no subscription, show "off". The app does not auto-resubscribe.

The service worker is registered only in production builds (`ServiceWorker.tsx`), so the bell needs `navigator.serviceWorker.ready`. In dev, the bell is hidden unless the VAPID env var is set and a production build is served.

### 6.7 Infra & CI summary

- `infra/modules/data`: new table + output `push_subscriptions_table_name`.
- `infra/envs/prod/main.tf`: table ARN local, IAM statements for API and crawler, env vars, new variables `vapid_public_key` and `vapid_private_key` (sensitive).
- `infra/modules/api`: new public resources and methods (§6.3).
- `.github/workflows/deploy.yml`: pass `TF_VAR_vapid_public_key: ${{ vars.VAPID_PUBLIC_KEY }}` and `TF_VAR_vapid_private_key: ${{ secrets.VAPID_PRIVATE_KEY }}` to plan/apply, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${{ vars.VAPID_PUBLIC_KEY }}` to the frontend build. `ci.yml`'s remote `terraform plan` step needs the same two `TF_VAR_vapid_*` vars, next to the existing google ones. Its frontend build step gets `NEXT_PUBLIC_VAPID_PUBLIC_KEY: placeholder`, like the other placeholders.
- `frontend/.env.example`: add `NEXT_PUBLIC_VAPID_PUBLIC_KEY=`.
- Docs: add a "Push notification" sequence to `docs/architecture.md`, and add key generation plus the GitHub var/secret setup to `docs/runbooks/go-live.md`.

## 7. Testing

- **Backend (jest):** `push.ts` validation (allowlist, lengths); `SubscriptionsRepo` with `aws-sdk-client-mock`; router POST/DELETE (valid, invalid host, malformed body, cap reached, idempotent re-POST); `crawlInner`/`crawlSource` returning `newest`; `notifyNewPosts` (picks the newest across sources, body copy for N=0/N>0, removes on 404/410, keeps on 500, never throws, no-op when no subscriptions); the handler not notifying for `sourceId` runs, skipped runs or 0 new posts.
- **Frontend (vitest):** `NotifyButton` state rendering and transitions with mocked `Notification`, `PushManager`, `serviceWorker` and API (off→on, on→off, denied, iOS not-standalone popover, hidden without a key).
- **Manual (post-deploy):** subscribe in desktop Chrome and on Android (installed), and on an iPhone with the PWA installed. Press "Crawl now" with a source that has fresh posts, confirm the notification copy and that tapping opens or focuses the feed, then unsubscribe and confirm nothing arrives on the next crawl.

## 8. Left to the builder

- Exact icon SVGs for the bell states.
- How to share the iOS install steps between `InstallButton` and `NotifyButton`.
- Whether `SubscriptionsRepo.list()` streams pages into the sender or collects them first (collect is fine at ≤ 1000).
- Exact wording of error popovers, as long as it matches the existing UI tone.

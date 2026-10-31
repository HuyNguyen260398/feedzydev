# Go-live runbook — feedzydev-claude

First deployment of https://feedzydev-claude.nghuy.link into AWS account `010382427026` (`ap-southeast-1`), deployed by GitHub Actions from branch `main` of `HuyNguyen260398/feedzydev`.

**How to use this:** work top to bottom. Each step says **who** runs it, the command, and what "done" looks like. Don't start a step until the previous checkpoint passes. Commands are written to run from the repo root (`/Users/huyng/ws/feedzydev-claude`); in Claude Code, prefix with `!` so the output lands in the conversation.

| Who        | Meaning                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------- |
| **Owner**  | You — needs your browser login, a secret, or an action Claude Code's safety rules reserve for you |
| **Claude** | Read-only checks or local work Claude can run                                                     |

Estimated time: ~45 min, mostly waiting on CloudFront and ACM.

---

## 0. Pre-flight — Claude ✅ (done 2026-10-18)

- [x] `aws sts get-caller-identity` → account `010382427026`
- [x] No Route 53 records containing `feedzydev-claude` in zone `Z10168803Q16IBJCR6YRD`
- [x] GitHub repo has no variables/secrets (no name collisions)
- [x] Cognito domain prefix `feedzydev-claude-010382427026` is free
- [x] Lambda unreserved concurrency 993 (crawler reserves 1)
- [x] All quality gates green locally; whole-branch review clean

---

## 1. Bootstrap: state bucket, CI roles, permissions boundary — Owner

Creates 11 resources: S3 state bucket (versioned, encrypted, private, `prevent_destroy`), `feedzydev-claude-ci-plan` and `feedzydev-claude-ci-deploy` roles trusting the existing GitHub OIDC provider, and the `feedzydev-claude-prod-boundary` policy.

```bash
cd infra/bootstrap && terraform init -input=false && terraform apply
```

Review the plan, type `yes`.

**Done when:** `Apply complete! Resources: 11 added, 0 changed, 0 destroyed.` and these outputs print:

```
deploy_role_arn          = "arn:aws:iam::010382427026:role/feedzydev-claude-ci-deploy"
permissions_boundary_arn = "arn:aws:iam::010382427026:policy/feedzydev-claude-prod-boundary"
plan_role_arn            = "arn:aws:iam::010382427026:role/feedzydev-claude-ci-plan"
state_bucket_name        = "feedzydev-claude-tfstate-010382427026"
```

> Bootstrap state stays local in `infra/bootstrap/terraform.tfstate` (gitignored). Keep it — it's needed to change or tear down these roles later.

**If it fails:** `EntityAlreadyExists` on a role → a previous attempt half-applied; run `terraform apply` again (it reconciles). `BucketAlreadyExists` → someone else owns the name; stop and tell Claude.

---

## 2. Google OAuth client — Owner

1. https://console.cloud.google.com/ → create/select a project (e.g. `feedzydev`).
2. **APIs & Services → OAuth consent screen**: User type **External**; app name `feedzydev`; support email = your Gmail; **Test users**: add `huynguyen260398@gmail.com`. Save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → **Web application**, name `feedzydev-claude`:
   - Authorized JavaScript origins: `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com`
   - Authorized redirect URIs: `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com/oauth2/idpresponse`
4. Create → keep the dialog open (Client ID + Client secret) for step 3.

**Done when:** you have a Client ID ending in `.apps.googleusercontent.com` and a Client secret.

> While the consent screen is in "Testing", only listed test users can sign in at all — that's fine (and an extra lock) for a personal app.

---

## 3. GitHub repository configuration — Owner

Variables (not secret):

```bash
gh variable set AWS_REGION        -R HuyNguyen260398/feedzydev -b ap-southeast-1
gh variable set STATE_BUCKET_NAME -R HuyNguyen260398/feedzydev -b feedzydev-claude-tfstate-010382427026
gh variable set ALLOWED_EMAIL     -R HuyNguyen260398/feedzydev -b huynguyen260398@gmail.com
```

Secrets (the role ARNs aren't sensitive, so they're passed inline; the two Google commands prompt — paste the value, nothing is echoed):

```bash
gh secret set AWS_PLAN_ROLE_ARN    -R HuyNguyen260398/feedzydev -b arn:aws:iam::010382427026:role/feedzydev-claude-ci-plan
gh secret set AWS_DEPLOY_ROLE_ARN  -R HuyNguyen260398/feedzydev -b arn:aws:iam::010382427026:role/feedzydev-claude-ci-deploy
gh secret set GOOGLE_CLIENT_ID     -R HuyNguyen260398/feedzydev
gh secret set GOOGLE_CLIENT_SECRET -R HuyNguyen260398/feedzydev
```

**Checkpoint — Claude:**

```bash
gh variable list -R HuyNguyen260398/feedzydev
gh secret list   -R HuyNguyen260398/feedzydev
```

**Done when:** 3 variables (`AWS_REGION`, `STATE_BUCKET_NAME`, `ALLOWED_EMAIL`) and 4 secrets (`AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) are listed.

---

## 4. Push and deploy — Owner

The remote is empty, so this push creates the repo's first (default) branch and triggers **Deploy** (`deploy.yml`): quality gates → `terraform apply` (≈51 resources) → frontend build → S3 sync → CloudFront invalidation → smoke test.

```bash
git push -u origin main
```

Watch it:

```bash
gh run list -R HuyNguyen260398/feedzydev --workflow Deploy --limit 1
gh run watch -R HuyNguyen260398/feedzydev --exit-status
```

**Done when:** the run is green. First run takes ~15–25 min (ACM validation and CloudFront distribution creation dominate).

**If it fails — Claude triages from the log** (`gh run view --log-failed -R HuyNguyen260398/feedzydev`):

| Symptom                                                   | Likely cause                                                             | Fix                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust `sub` mismatch or secret typo                                      | Re-check step 3 ARNs; confirm push was to `main`                                    |
| `AccessDenied ... iam:CreateRole` / `PutRolePolicy`       | Role missing permissions boundary, or name not `feedzydev-claude-prod-*` | Code fix in `infra/modules/*`, commit, push                                         |
| `AccessDenied` on another service                         | Deploy policy gap                                                        | Widen `infra/bootstrap/main.tf` deploy policy, re-run step 1 apply, re-run workflow |
| Cognito `InvalidParameterException` on Google IdP         | Wrong Google client ID/secret                                            | Fix secrets (step 3), `gh run rerun --failed`                                       |
| `Domain already exists` (Cognito)                         | Prefix taken                                                             | Change `cognito_domain_prefix`, update Google redirect URI (step 2)                 |
| Smoke test `curl` fails but apply succeeded               | DNS/CloudFront still propagating                                         | Wait 5 min, `gh run rerun --failed`                                                 |

A failed apply is safe to re-run — Terraform resumes from state.

---

## 5. Verify — Claude (curl/AWS) + Owner (browser)

### 5a. Edge and API — Claude

```bash
curl -sI https://feedzydev-claude.nghuy.link/ | head -5                                  # 200, x-cache header
curl -s  https://feedzydev-claude.nghuy.link/sources | grep -io 'sources' | head -1      # rewrite works
curl -s  https://feedzydev-claude.nghuy.link/api/posts                                   # {"items":[]}
curl -s  -o /dev/null -w '%{http_code}\n' -X POST https://feedzydev-claude.nghuy.link/api/admin/crawl   # 401
curl -s  -o /dev/null -w '%{http_code}\n' https://feedzydev-claude.nghuy.link/api/admin/sources         # 401
aws scheduler get-schedule --name feedzydev-claude-prod-daily-crawl --region ap-southeast-1 \
  --query '[ScheduleExpression,ScheduleExpressionTimezone,State]'                        # cron(0 7 * * ? *), Asia/Ho_Chi_Minh, ENABLED
```

### 5b. Owner sign-in — Owner

1. Open https://feedzydev-claude.nghuy.link/sources/ → **Sign in with Google** → choose `huynguyen260398@gmail.com`.
2. **Done when:** you land back on `/sources/` showing your email, "Add source", "Crawl now" and an (empty) sources list — **no "Request failed (401)"**. That proves the ID token reaches the API on GETs through CloudFront.

### 5c. Non-owner is rejected — Owner

In a private window, try signing in with a different Google account.

**Done when:** you're returned to `/sources/` with "This app is private — only the owner can sign in." (If the consent screen is in Testing, Google may refuse earlier — also acceptable; note which happened.)

### 5d. Add sources and crawl — Owner (Claude can drive the browser if you prefer)

1. Paste `https://aws.amazon.com/blogs/` → **Discover**. Note what comes back (several feeds / none) — Claude records it in the README.
2. Add the starter feeds (discover each, then **Add selected**):
   - `https://aws.amazon.com/blogs/devops/feed/`
   - `https://aws.amazon.com/blogs/containers/feed/`
   - `https://www.hashicorp.com/blog/feed.xml`
   - `https://kubernetes.io/feed.xml`
   - `https://www.cncf.io/feed/`
   - `https://github.blog/feed/`
   - `https://www.docker.com/blog/` (homepage — exercises discovery)
   - `https://grafana.com/blog/index.xml`
3. Each add triggers a crawl of that source; also click **Crawl now** once.
4. Wait ~60 s, open https://feedzydev-claude.nghuy.link/.

**Done when:** posts from the last 14 days appear, newest as the featured card, with thumbnails (or branded placeholders), author, time and source chip; clicking a card opens the original post in a new tab; each source row shows `ok · N new`.

### 5e. Mobile and theme — Owner or Claude

- Phone (or devtools at 360 × 780 and 390 × 844): single column, chips scroll sideways, **no horizontal page scroll**.
- Toggle the theme, reload → choice kept; first visit is dark.

### 5f. Logs — Claude

```bash
aws logs tail /aws/lambda/feedzydev-claude-prod-crawler --since 30m --region ap-southeast-1 | grep crawl.summary
aws logs tail /aws/lambda/feedzydev-claude-prod-api     --since 30m --region ap-southeast-1 | grep -i error
```

**Done when:** a `crawl.summary` line shows `totalNew > 0`; no unexpected API errors.

---

## 6. Record and close — Claude

- Fill the README **Live** section: URL, go-live date, discovery result for `aws.amazon.com/blogs/`, verified starter feeds (drop any that failed), non-owner check result.
- Commit `docs: record go-live verification`; **Owner** pushes (`git push`) → Deploy runs again (docs-only → fast, no infra change).
- Next scheduled crawl: 07:00 Vietnam time — check the feed the next morning.

---

## 7. Push notifications (one-time) — Owner

Generate one VAPID key pair. Keep the private key out of the repo and the shell history:

```bash
npx web-push generate-vapid-keys
gh variable set VAPID_PUBLIC_KEY -R HuyNguyen260398/feedzydev -b <public key>
gh secret set VAPID_PRIVATE_KEY  -R HuyNguyen260398/feedzydev   # paste the private key when prompted
```

The public key goes to the frontend build (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`) and Terraform
(`TF_VAR_vapid_public_key`); the private key reaches only the crawler Lambda. Rotating the pair
invalidates every existing subscription, so don't rotate unless it leaks.

**Verify after the next deploy — Owner:**

- [ ] Desktop Chrome: the bell appears in the header; clicking it prompts, then shows filled.
- [ ] Android Chrome (installed app): same.
- [ ] iPhone: in a Safari tab the bell explains Add to Home Screen; in the installed app it subscribes.
- [ ] Sources → "Crawl now" with a source that has fresh posts: a notification arrives titled with the
      newest post and "<source> · Click to read N more posts".
- [ ] Tapping it focuses an open feedzydev tab (or opens one) on the feed.
- [ ] Turning the bell off, then crawling again: nothing arrives.
- [ ] Crawler logs show `push.summary` with the expected `sent` count (no `push.failed`).

## Rollback

| Situation                   | Action                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Bad app deploy (UI/API bug) | `git revert <sha>` on `main`, push → redeploys previous code                                                             |
| Need the site offline fast  | `aws cloudfront get-distribution-config` → set `Enabled=false` via `update-distribution` (or disable in console)         |
| Remove everything           | Follow README → **Tear down** (empties site bucket, disables Cognito deletion protection, destroys prod, then bootstrap) |

Nothing here touches the other build (`feedzydev.nghuy.link`, `/Users/huyng/ws/feedzydev`) — all resources are prefixed `feedzydev-claude`.

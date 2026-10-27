# feedzydev

A personal morning feed of new DevOps tech blog posts. A scheduled Lambda runs
every hour (Asia/Ho_Chi_Minh) and crawls the RSS/Atom feeds of sources the owner
curates at the crawl hours saved in settings (07:00 by default; other hours exit
early); the site shows the posts as scannable cards (thumbnail, title,
author, date, source) that link to the original article. The feed is public;
only the owner (Google sign-in, single allowed email) can manage sources and
trigger a crawl. Anyone can turn on the header bell to get a Web Push
notification (browser or installed PWA) when a crawl finds new posts.

Live site: https://feedzydev-claude.nghuy.link

Architecture and diagrams: [`docs/architecture.md`](docs/architecture.md).

Stack: Next.js static export, CloudFront + S3, API Gateway REST, Lambda
(Node), DynamoDB, Cognito (Google federation), EventBridge Scheduler,
Terraform, GitHub Actions with OIDC (no long-lived AWS keys).

> Setting this up creates real AWS resources. Usage-based pricing keeps idle
> cost near zero, but see [Tear down](#tear-down) when you are done.

## Live

https://feedzydev-claude.nghuy.link — live since 2026-10-18.

- Verified: edge and API checks, owner Google sign-in, non-owner sign-in rejected, daily crawl schedule (07:00 `Asia/Ho_Chi_Minh`), first crawl (`totalNew: 100`).
- Discovery on `https://aws.amazon.com/blogs/` returns one feed, AWS "Recent Announcements" (`https://aws.amazon.com/about-aws/whats-new/recent/feed/`): the page advertises no blog feed of its own. For blog posts, add the per-blog feeds (e.g. `https://aws.amazon.com/blogs/devops/feed/`).
- The repository uses GitHub's immutable OIDC subjects (`repo:owner@id/name@id:...`); the bootstrap trust policy matches that via `github_sub_prefix`.

## Local development

Packages are separate (no root `package.json`); run commands per package.
Node version is in `.nvmrc`; pnpm version is pinned by each `packageManager` field.

```bash
cd frontend
pnpm install
NEXT_PUBLIC_MOCK=1 pnpm dev      # UI against built-in mock data, no AWS needed
```

For a real backend set `NEXT_PUBLIC_USER_POOL_ID`, `NEXT_PUBLIC_USER_POOL_CLIENT_ID`
and `NEXT_PUBLIC_COGNITO_DOMAIN` (see `frontend/.env.example`), plus
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` to show the notification bell. Never set
`NEXT_PUBLIC_MOCK` in CI or deploy builds.

## Quality gates

```bash
(cd backend  && pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build)
(cd frontend && pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test)
terraform fmt -check -recursive infra
```

CI (`.github/workflows/ci.yml`) runs the same gates on pull requests to
`feedzydev-claude`, validates Terraform, and (when `infra/**` or `backend/**`
changed) runs `terraform plan` with the read-only OIDC role.

## Setup runbook

For the first deployment, follow the step-by-step [go-live runbook](docs/runbooks/go-live.md) (who runs what, checkpoints, troubleshooting, rollback). The summary below is the reference version.

Prerequisites: AWS CLI authenticated to the target account with admin-level
rights (first apply only), Terraform >= 1.15, `gh` authenticated to the repo,
Node + pnpm, and a Route 53 hosted zone for `nghuy.link`.

### 1. Bootstrap state bucket and CI roles

Before applying, confirm the GitHub OIDC provider already exists in the account
(`aws iam list-open-id-connect-providers`) and that no Route 53 record already
uses `feedzydev-claude.nghuy.link`.

```bash
cd infra/bootstrap
terraform init
terraform apply
terraform output      # state_bucket_name, plan_role_arn, deploy_role_arn, permissions_boundary_arn
```

### 2. Create the Google OAuth client

1. Open https://console.cloud.google.com/ and create (or select) a project.
2. Go to **APIs & Services > OAuth consent screen**. Choose **External**, fill
   in app name and your email, save. Under **Audience**, add your Google
   account as a test user (or publish the app).
3. Go to **APIs & Services > Credentials > Create credentials > OAuth client ID**.
4. Application type: **Web application**. Name it `feedzydev`.
5. Under **Authorized redirect URIs** add exactly:
   `https://feedzydev-claude-010382427026.auth.ap-southeast-1.amazoncognito.com/oauth2/idpresponse`
6. Click **Create** and copy the **Client ID** and **Client secret**.

### 3. Set GitHub variables and secrets

Check `gh variable list` and `gh secret list` first so nothing collides with
existing names. Values come from the bootstrap outputs and the Google client.

```bash
gh variable set AWS_REGION            --body "ap-southeast-1"
gh variable set STATE_BUCKET_NAME     --body "feedzydev-claude-tfstate-010382427026"
gh variable set ALLOWED_EMAIL         --body "huynguyen260398@gmail.com"
gh variable set VAPID_PUBLIC_KEY      --body "<from npx web-push generate-vapid-keys>"

gh secret set AWS_PLAN_ROLE_ARN   --body "$(cd infra/bootstrap && terraform output -raw plan_role_arn)"
gh secret set AWS_DEPLOY_ROLE_ARN --body "$(cd infra/bootstrap && terraform output -raw deploy_role_arn)"
gh secret set GOOGLE_CLIENT_ID     # paste when prompted
gh secret set GOOGLE_CLIENT_SECRET # paste when prompted
gh secret set VAPID_PRIVATE_KEY    # paste when prompted
```

### 4. Push to deploy

```bash
git push -u origin feedzydev-claude
```

The Deploy workflow runs the CI gates, then applies Terraform, builds the
frontend with the Cognito outputs, syncs to S3, invalidates CloudFront and
smoke-tests `/api/posts`. Re-run it any time with **Run workflow**
(`workflow_dispatch`).

### 5. Verify

HTTPS on the subdomain; the feed loads on desktop and mobile width; Google
sign-in works for the owner and a different account is rejected; adding a
source by homepage URL works; "Crawl now" yields posts with thumbnails; the
scheduler runs hourly (Asia/Ho_Chi_Minh) and crawls at the saved crawl hours;
admin endpoints return 401 without a token.

## Starter sources

Paste any of these homepages (or feed URLs) on the Sources page. Feed URLs were
checked to respond.

- AWS DevOps Blog: https://aws.amazon.com/blogs/devops/feed/
- AWS Containers Blog: https://aws.amazon.com/blogs/containers/feed/
- HashiCorp Blog: https://www.hashicorp.com/blog/feed.xml
- Kubernetes Blog: https://kubernetes.io/feed.xml
- CNCF Blog: https://www.cncf.io/feed/
- GitHub Engineering: https://github.blog/engineering/feed/
- Grafana Labs Blog: https://grafana.com/blog/index.xml
- Docker Blog: https://www.docker.com/blog/ (paste the homepage; feed discovery finds the feed)

## Tear down

```bash
cd infra/envs/prod
terraform init -backend-config="bucket=feedzydev-claude-tfstate-010382427026" -backend-config="region=ap-southeast-1"
aws s3 rm s3://feedzydev-claude-prod-site-010382427026 --recursive   # site bucket is not force_destroy
# The Cognito user pool has deletion protection. Temporarily set
# deletion_protection = "INACTIVE" in infra/modules/auth/main.tf and apply it first
# (avoid `aws cognito-idp update-user-pool`, which resets unspecified settings).
terraform apply        # applies only the deletion-protection change
terraform destroy      # prompts for the three required variables (or use TF_VAR_*)

# Then the bootstrap stack. Empty the state bucket first (all object versions):
aws s3api delete-objects --bucket feedzydev-claude-tfstate-010382427026 \
  --delete "$(aws s3api list-object-versions --bucket feedzydev-claude-tfstate-010382427026 \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json)"
cd ../../bootstrap && terraform destroy
```

If the bucket also holds delete markers, remove them the same way
(`DeleteMarkers[]`). The site bucket is not `force_destroy`, which is why the block
above empties it before the prod destroy.

## Known behaviour

Renaming a source does not rename it on already-crawled posts; those posts keep
the old name until they expire (within 90 days).

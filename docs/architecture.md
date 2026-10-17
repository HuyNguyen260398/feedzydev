# Architecture

CloudFront is the single entry point (custom domain `feedzydev-claude.nghuy.link`,
ACM certificate in us-east-1). The default behavior serves the Next.js static
export from a private S3 bucket (OAC); `/api/*` forwards to API Gateway, so the
frontend is same-origin with the API and needs no CORS.

## Services

| Concern | Service | Role |
|---|---|---|
| Edge / entry | CloudFront + ACM + Route 53 | HTTPS, custom domain, routes static vs `/api/*` |
| Static hosting | S3 (private, OAC) | Next.js static export |
| API | API Gateway REST | Public GETs; write methods behind a Cognito authorizer |
| API compute | Lambda (single function, internal router) | Sources CRUD, posts list, "Crawl now" |
| Crawler | Lambda | Fetches feeds, extracts thumbnails, writes posts |
| Schedule | EventBridge Scheduler | `cron(0 7 * * ? *)`, Asia/Ho_Chi_Minh |
| Data | DynamoDB (sources, posts) | On-demand billing |
| Auth | Cognito + Google IdP | Pre-sign-up Lambda allows only the owner's email |
| CI/CD | GitHub Actions + OIDC | Plan role (read-only) and deploy role (branch-scoped) |
| State | S3 (native lockfile) | Terraform remote state |

## Runtime

### Feed read (public)

```mermaid
sequenceDiagram
    participant B as Browser
    participant CF as CloudFront
    participant S3 as S3 (static site)
    participant APIGW as API Gateway
    participant L as API Lambda
    participant DDB as DynamoDB
    B->>CF: GET /
    CF->>S3: static page (OAC)
    S3-->>B: HTML/JS
    B->>CF: GET /api/posts?limit=N
    CF->>APIGW: /api/* (no auth)
    APIGW->>L: invoke
    L->>DDB: query posts (newest first)
    DDB-->>B: posts via Lambda/API Gateway/CloudFront
```

### Admin write (authorizer)

```mermaid
sequenceDiagram
    participant B as Browser (owner)
    participant G as Google
    participant C as Cognito
    participant CF as CloudFront
    participant APIGW as API Gateway
    participant L as API Lambda
    participant CR as Crawler Lambda
    participant DDB as DynamoDB
    B->>C: Hosted UI sign-in
    C->>G: federated login
    G-->>C: identity
    C->>C: Pre-sign-up Lambda checks allowed email
    C-->>B: JWT
    B->>CF: POST /api/sources (Authorization: JWT)
    CF->>APIGW: forward
    APIGW->>C: Cognito authorizer validates JWT
    APIGW->>L: invoke (401 if invalid)
    L->>DDB: write source
    B->>CF: POST /api/crawl
    CF->>APIGW: forward (authorized)
    APIGW->>L: invoke
    L-->>CR: async invoke
```

### Scheduled crawl

```mermaid
flowchart LR
    S[EventBridge Scheduler<br/>07:00 Asia/Ho_Chi_Minh] --> CR[Crawler Lambda]
    CR -->|list enabled| DS[(DynamoDB sources)]
    CR -->|fetch RSS/Atom| W[Blog feeds]
    CR -->|new posts + thumbnails| DP[(DynamoDB posts)]
```

A failing source is recorded and skipped; it never aborts the whole crawl.

## Deploy

```mermaid
flowchart LR
    PR[Pull request] --> CI[ci.yml<br/>format, lint, typecheck, test, build,<br/>terraform fmt/validate/plan]
    Push[Push to feedzydev-claude] --> G[gates: ci.yml]
    G --> D[deploy job<br/>OIDC deploy role]
    D --> B[Build backend]
    B --> TF[terraform apply]
    TF --> O[Capture outputs]
    O --> FE[Build frontend<br/>NEXT_PUBLIC_*]
    FE --> SY[s3 sync --delete]
    SY --> INV[CloudFront invalidation]
    INV --> SM[Smoke test /api/posts]
```

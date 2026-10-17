// Dev-only fixture data, loaded by api.ts when NEXT_PUBLIC_MOCK=1.
import type { Page, PublicPost, PublicSource } from '@/lib/types';

const SOURCES: PublicSource[] = [
  { sourceId: 'k8s', name: 'Kubernetes Blog', siteUrl: 'https://kubernetes.io/blog/' },
  { sourceId: 'aws', name: 'AWS DevOps Blog', siteUrl: 'https://aws.amazon.com/blogs/devops/' },
  { sourceId: 'hashi', name: 'HashiCorp', siteUrl: 'https://www.hashicorp.com/blog' },
  { sourceId: 'cncf', name: 'CNCF', siteUrl: 'https://www.cncf.io/blog/' },
  { sourceId: 'sre', name: 'SRE Weekly', siteUrl: 'https://sreweekly.com/' },
];

const TITLES = [
  'Zero-downtime Kubernetes upgrades with surge node pools',
  'Terraform 2.0 state locking: what changes for your CI pipelines',
  'Debugging DNS latency spikes inside a service mesh',
  'Shrinking container images by 80% with distroless and multi-stage builds',
  'GitOps at scale: running Argo CD across 300 clusters',
  'Postmortem: how a single expired certificate took down checkout',
  'eBPF-powered observability without sidecars',
  'Rightsizing Lambda memory with Power Tuning and cost alarms',
  'OpenTelemetry Collector pipelines you can actually maintain',
  'Blue/green deploys on ECS with CodeDeploy hooks',
  'Kubernetes 1.36: sidecar containers graduate, in-place pod resize lands',
  'Writing SLOs that your on-call rotation will thank you for',
  'Policy as code with OPA Gatekeeper: lessons from production',
  'Vault dynamic secrets for short-lived database credentials',
  'Karpenter vs Cluster Autoscaler: a 6-month cost comparison',
  'Chaos engineering game days for teams of five',
  'Securing GitHub Actions with OIDC and least-privilege roles',
  'Cutting CI time in half with remote build caches',
  'The hidden cost of cross-AZ traffic in EKS',
  'Prometheus cardinality explosions and how to tame them',
  'Platform engineering: paving the golden path without walls',
  'Rolling out feature flags safely across regions',
  'CloudFront functions for edge redirects and header rewrites',
  'Packer + Ansible: immutable AMIs in under ten minutes',
  'Gateway API is the new Ingress: a migration guide',
  'Incident review culture: blameless does not mean actionless',
  'Running stateful workloads on spot instances without tears',
  'Supply-chain security with Sigstore, cosign and SLSA provenance',
  'Grafana dashboards as code with Jsonnet and Grizzly',
  'DynamoDB single-table design for event logs',
  'Kustomize overlays vs Helm values: picking the right tool',
  'A practical guide to pod disruption budgets',
  'Alert fatigue is a design bug, not a people problem',
  'Self-hosted runners on Kubernetes with Actions Runner Controller',
  'Multi-account AWS landing zones with Control Tower',
  'Load testing with k6 inside your deployment pipeline',
  'Service mesh in 2026: do you still need one?',
  'Nix for reproducible developer environments',
  'Tracing a 99th percentile latency regression end to end',
  'Building a cheap, reliable cron platform on EventBridge Scheduler',
];

const AUTHORS = ['Priya Raman', 'Marco Rossi', undefined, 'Lena Fischer', 'Tuan Nguyen', undefined];

function buildPosts(): PublicPost[] {
  const now = Date.now();
  return TITLES.map((title, i) => {
    const source = SOURCES[i % SOURCES.length];
    // Spread ~40 posts over the last 5 days, newest first.
    const publishedAt = new Date(now - (i * 5 * 24 * 60 * 60 * 1000) / TITLES.length - i * 37_000);
    const thumbnailUrl =
      i % 4 === 3
        ? undefined
        : i === 6
          ? 'https://example.invalid/broken-thumbnail.png'
          : `https://picsum.photos/seed/${i + 1}/640/360`;
    return {
      postId: `mock-${i + 1}`,
      url: `${source.siteUrl}mock-${i + 1}`,
      title,
      author: AUTHORS[i % AUTHORS.length],
      publishedAt: publishedAt.toISOString(),
      thumbnailUrl,
      sourceId: source.sourceId,
      sourceName: source.name,
    };
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockPosts(p: {
  cursor?: string;
  sourceId?: string;
  limit?: number;
}): Promise<Page<PublicPost>> {
  await delay(400);
  const all = buildPosts().filter((post) => !p.sourceId || post.sourceId === p.sourceId);
  const start = p.cursor ? Number(p.cursor) : 0;
  const end = start + (p.limit ?? 30);
  return {
    items: all.slice(start, end),
    ...(end < all.length ? { nextCursor: String(end) } : {}),
  };
}

export async function mockSources(): Promise<PublicSource[]> {
  await delay(150);
  return SOURCES;
}

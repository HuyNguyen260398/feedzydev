export interface SourceTheme {
  label: string;
  accent: string;
}

export const WINDOW_FILL = '#121a33';

interface Brand extends SourceTheme {
  /** Matched against the post's host, including subdomains. */
  hosts: string[];
  /** Matched against the words of the source name when the host is not listed. */
  keywords?: string[];
}

// Accents follow each brand's colour, lightened where needed to stay readable on WINDOW_FILL.
// Sources with no brand colour of their own get a distinct colour of ours.
const BRANDS: Brand[] = [
  // Technology vendors
  {
    label: 'aws',
    accent: '#ff9900',
    hosts: ['aws.amazon.com', 'aws.com', 'aws'],
    keywords: ['aws'],
  },
  { label: 'gcp', accent: '#4285f4', hosts: ['cloud.google.com'], keywords: ['gcp'] },
  { label: 'azure', accent: '#3aa0f3', hosts: ['azure.microsoft.com'], keywords: ['azure'] },
  {
    label: 'kubernetes',
    accent: '#5b8def',
    hosts: ['kubernetes.io', 'k8s.io'],
    keywords: ['kubernetes', 'k8s'],
  },
  { label: 'terraform', accent: '#a77bf3', hosts: ['terraform.io'], keywords: ['terraform'] },
  { label: 'hashicorp', accent: '#f1f5f9', hosts: ['hashicorp.com'], keywords: ['hashicorp'] },
  { label: 'docker', accent: '#2496ed', hosts: ['docker.com'], keywords: ['docker'] },
  {
    label: 'github',
    accent: '#3fb950',
    hosts: ['github.blog', 'github.com'],
    keywords: ['github'],
  },
  { label: 'gitlab', accent: '#fc6d26', hosts: ['gitlab.com'], keywords: ['gitlab'] },
  { label: 'grafana', accent: '#f46800', hosts: ['grafana.com'], keywords: ['grafana'] },
  { label: 'prometheus', accent: '#e6522c', hosts: ['prometheus.io'], keywords: ['prometheus'] },
  { label: 'cloudflare', accent: '#f38020', hosts: ['cloudflare.com'], keywords: ['cloudflare'] },
  { label: 'atlassian', accent: '#4c9aff', hosts: ['atlassian.com'], keywords: ['atlassian'] },
  { label: 'cncf', accent: '#38b6ff', hosts: ['cncf.io'], keywords: ['cncf'] },
  { label: 'datadog', accent: '#a56eff', hosts: ['datadoghq.com'], keywords: ['datadog'] },
  { label: 'honeycomb', accent: '#ffb000', hosts: ['honeycomb.io'], keywords: ['honeycomb'] },
  { label: 'octopus', accent: '#2f93e0', hosts: ['octopus.com'], keywords: ['octopus'] },
  { label: 'pulumi', accent: '#f26e7e', hosts: ['pulumi.com'], keywords: ['pulumi'] },
  { label: 'redhat', accent: '#ff4d4d', hosts: ['redhat.com'], keywords: ['redhat'] },
  { label: 'dev', accent: '#8b95f5', hosts: ['dev.to'] },
  // Publications with no well-known colour
  { label: 'devops', accent: '#2dd4bf', hosts: ['devops.com'] },
  { label: 'devopscube', accent: '#22d3ee', hosts: ['devopscube.com'] },
  { label: 'devopsvietnam', accent: '#f472b6', hosts: ['devops.vn'] },
  { label: 'devopsvn', accent: '#86efac', hosts: ['devopsvn.tech'] },
  { label: 'kodekloud', accent: '#93c5fd', hosts: ['kodekloud.com'] },
  { label: 'platform', accent: '#c084fc', hosts: ['platformengineering.org'] },
  { label: 'spacelift', accent: '#818cf8', hosts: ['spacelift.io'] },
  { label: 'sre', accent: '#facc15', hosts: ['sreweekly.com'] },
  { label: 'thenewstack', accent: '#fb7185', hosts: ['thenewstack.io'] },
  { label: 'virtualizationhowto', accent: '#a3e635', hosts: ['virtualizationhowto.com'] },
];

// Colours for sources added later that are not in BRANDS.
const PALETTE = [
  '#22d3ee',
  '#2dd4bf',
  '#a3e635',
  '#facc15',
  '#fb923c',
  '#fb7185',
  '#f472b6',
  '#c084fc',
  '#818cf8',
  '#60a5fa',
];

export const ACCENTS = [...BRANDS.map((b) => b.accent), ...PALETTE];

const STOP_WORDS = new Set(
  'a an and at blog blogs by for from in inside latest my new news of official on our the to weekly'.split(
    ' ',
  ),
);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function colourFor(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** The one lowercase word and colour that stand for a source on its generated thumbnail. */
export function sourceTheme(sourceName: string, postUrl: string): SourceTheme {
  const host = hostOf(postUrl);
  const byHost =
    host && BRANDS.find((b) => b.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  if (byHost) return { label: byHost.label, accent: byHost.accent };

  const name = sourceName.split(' | ')[0].toLowerCase();
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    const brand = BRANDS.find((b) => b.keywords?.includes(word));
    if (brand) return { label: brand.label, accent: brand.accent };
  }

  const label =
    words.find((word) => !STOP_WORDS.has(word)) ??
    host?.replace(/^www\./, '').split('.')[0] ??
    'feed';
  return { label, accent: colourFor(label) };
}

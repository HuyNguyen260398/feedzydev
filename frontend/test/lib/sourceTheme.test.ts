import { describe, expect, it } from 'vitest';
import { ACCENTS, WINDOW_FILL, sourceTheme } from '@/lib/sourceTheme';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Every source on the live site, as [site, name, expected word].
const LIVE_SOURCES: [string, string, string][] = [
  ['aws.amazon.com', 'AWS Architecture Blog', 'aws'],
  ['aws.amazon.com', 'AWS DevOps & Developer Productivity Blog', 'aws'],
  ['aws.amazon.com', 'Recent Announcements', 'aws'],
  ['blog.cloudflare.com', 'Cloudflare Blog', 'cloudflare'],
  ['cloud.google.com', 'DevOps & SRE', 'gcp'],
  ['dev.to', 'DEV Community', 'dev'],
  ['dev.to', 'DEV Community: AWS Community Builders', 'dev'],
  ['devops.com', 'DevOps.com', 'devops'],
  ['devops.vn', 'DevOps VietNam', 'devopsvietnam'],
  ['devopscube.com', 'DevOpsCube – Easy DevOps, SRE Guides & Reviews', 'devopscube'],
  ['devopsvn.tech', 'DevOps VN', 'devopsvn'],
  ['github.blog', 'The GitHub Blog', 'github'],
  ['github.blog', "The latest from GitHub's engineering team - The GitHub Blog", 'github'],
  ['grafana.com', 'Grafana Labs blog on Grafana Labs', 'grafana'],
  ['hashicorp.com', 'HashiCorp Blog', 'hashicorp'],
  ['kodekloud.com', 'KodeKloud Blog | DevOps, Cloud, Kubernetes, AI Tutorials & More', 'kodekloud'],
  ['kubernetes.io', 'Kubernetes Blog', 'kubernetes'],
  ['octopus.com', 'Octopus blog', 'octopus'],
  ['platformengineering.org', 'Platform Engineering Blog', 'platform'],
  ['spacelift.io', 'Managing Infrastructure at Scale | Spacelift Blog', 'spacelift'],
  ['sreweekly.com', 'SRE WEEKLY', 'sre'],
  ['thenewstack.io', 'The New Stack | DevOps, Open Source, and Cloud Native News', 'thenewstack'],
  ['www.atlassian.com', 'Inside Atlassian', 'atlassian'],
  ['www.cncf.io', 'Blog – Cloud Native Computing Foundation', 'cncf'],
  ['www.datadoghq.com', 'Datadog | The Monitor blog', 'datadog'],
  ['www.docker.com', 'Docker', 'docker'],
  ['www.honeycomb.io', 'Honeycomb Blog', 'honeycomb'],
  ['www.pulumi.com', 'Pulumi Blog', 'pulumi'],
  ['www.redhat.com', 'Red Hat Blog', 'redhat'],
  ['www.virtualizationhowto.com', 'DevOps - Virtualization Howto', 'virtualizationhowto'],
];

describe('sourceTheme', () => {
  it.each(LIVE_SOURCES)('labels %s %s as %s', (host, name, word) => {
    expect(sourceTheme(name, `https://${host}/some-post/`).label).toBe(word);
  });

  it('gives each live source word its own colour', () => {
    const byLabel = new Map(
      LIVE_SOURCES.map(([host, name]) => {
        const theme = sourceTheme(name, `https://${host}/some-post/`);
        return [theme.label, theme.accent];
      }),
    );
    expect(new Set(byLabel.values()).size).toBe(byLabel.size);
  });

  it.each([
    ['aws', '#ff9900', 'https://aws.amazon.com/blogs/devops/a/'],
    ['aws', '#ff9900', 'https://docs.aws.amazon.com/a/'],
    ['aws', '#ff9900', 'https://builder.aws.com/a'],
    ['aws', '#ff9900', 'https://repost.aws/a'],
  ])('recognises %s by host', (label, accent, url) => {
    expect(sourceTheme('Some Feed', url)).toEqual({ label, accent });
  });

  it('prefers the host over a technology named in the source name', () => {
    expect(sourceTheme('AWS Community Builders', 'https://dev.to/a').label).toBe('dev');
  });

  it('recognises a technology named by a source on an unknown host', () => {
    expect(sourceTheme('Terraform Tips', 'https://tips.example.com/a').label).toBe('terraform');
  });

  it.each([
    'https://aws.amazon.com.evil.example/a',
    'https://notaws.amazon.com/a',
    'https://www.amazon.com/a',
    'https://my-bucket.s3.amazonaws.com/a',
    'not a url',
  ])('does not treat %s as AWS', (url) => {
    expect(sourceTheme('Kube Weekly', url).label).toBe('kube');
  });

  it.each([
    ['Kubernetes Blog', 'kubernetes'],
    ['SRE Weekly', 'sre'],
    ['The Acme Engineering Blog', 'acme'],
    ['Inside Acme', 'acme'],
    ['Acme.io | Tagline', 'acme'],
    ['Thoughts: on code', 'thoughts'],
  ])('shortens the unknown source %s to %s', (name, word) => {
    expect(sourceTheme(name, 'https://unknown.example.org/a').label).toBe(word);
  });

  it('falls back to the host when the name has no usable word', () => {
    expect(sourceTheme('The Blog', 'https://www.acme.example/a').label).toBe('acme');
  });

  it('gives an unknown source a colour that stays the same', () => {
    const first = sourceTheme('Acme Blog', 'https://acme.example/a');
    expect(ACCENTS).toContain(first.accent);
    expect(sourceTheme('Acme Blog', 'https://acme.example/b')).toEqual(first);
  });

  it('only uses colours readable on the terminal window', () => {
    for (const accent of ACCENTS) {
      expect(contrast(accent, WINDOW_FILL), accent).toBeGreaterThanOrEqual(4.5);
    }
  });
});

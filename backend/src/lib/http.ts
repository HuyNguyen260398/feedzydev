export const USER_AGENT = 'feedzydev/1.0 (+https://feedzydev.nghuy.link)';
export const MAX_BYTES = 5 * 1024 * 1024;

const ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8';

export interface FetchResult {
  status: number;
  url: string;
  contentType: string;
  body: string;
}

export type FetchText = (url: string, opts?: { timeoutMs?: number }) => Promise<FetchResult>;

export class FetchError extends Error {
  constructor(
    public code: 'TIMEOUT' | 'TOO_LARGE' | 'NETWORK',
    message: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readBody(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new FetchError('TOO_LARGE', `response exceeds ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const fetchText: FetchText = async (url, opts) => {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 10000),
    });
    const body = await readBody(res);
    return {
      status: res.status,
      url: res.url || url,
      contentType: res.headers.get('content-type') ?? '',
      body,
    };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (isTimeout(err)) throw new FetchError('TIMEOUT', `request timed out: ${url}`);
    throw new FetchError('NETWORK', err instanceof Error ? err.message : String(err));
  }
};

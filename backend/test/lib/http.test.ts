import { fetchText, FetchError, MAX_BYTES, USER_AGENT } from '../../src/lib/http';

function withUrl(res: Response, url: string): Response {
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

describe('fetchText', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns status, final url, content type and body', async () => {
    const res = withUrl(
      new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml' } }),
      'https://final/',
    );
    jest.spyOn(global, 'fetch').mockResolvedValue(res);
    await expect(fetchText('https://start/')).resolves.toEqual({
      status: 200,
      url: 'https://final/',
      contentType: 'application/rss+xml',
      body: '<rss/>',
    });
  });

  it('sends the feedzydev user agent', async () => {
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('x'));
    await fetchText('https://start/');
    expect(spy).toHaveBeenCalledWith(
      'https://start/',
      expect.objectContaining({
        redirect: 'follow',
        headers: expect.objectContaining({ 'User-Agent': USER_AGENT }),
      }),
    );
  });

  it('returns non-2xx without throwing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(fetchText('https://start/')).resolves.toMatchObject({ status: 404 });
  });

  it('surfaces the cf-mitigated header, and omits it when absent', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response('Just a moment...', { status: 403, headers: { 'cf-mitigated': 'challenge' } }),
      )
      .mockResolvedValueOnce(new Response('x'));
    await expect(fetchText('https://start/')).resolves.toMatchObject({
      status: 403,
      cfMitigated: 'challenge',
    });
    await expect(fetchText('https://start/')).resolves.not.toHaveProperty('cfMitigated');
  });

  it('throws TOO_LARGE past MAX_BYTES', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const size = Math.min(chunk.length, MAX_BYTES + 1 - sent);
        if (size <= 0) {
          controller.close();
          return;
        }
        controller.enqueue(chunk.subarray(0, size));
        sent += size;
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));
    await expect(fetchText('https://start/')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('throws TIMEOUT when aborted', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new DOMException('x', 'TimeoutError'));
    const err = await fetchText('https://start/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err).toMatchObject({ code: 'TIMEOUT' });
  });

  it('wraps other failures as NETWORK', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchText('https://start/')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

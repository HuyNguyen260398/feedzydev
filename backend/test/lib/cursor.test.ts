import { decodeCursor, encodeCursor } from '../../src/lib/cursor';
import { AppError } from '../../src/lib/errors';

describe('cursor', () => {
  it('round trips', () => {
    const key = { postId: 'p', feedKey: 'ALL', publishedAt: '2026-01-01T00:00:00.000Z' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('rejects garbage with INVALID_CURSOR', () => {
    expect.assertions(3);
    try {
      decodeCursor('%%%');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe('INVALID_CURSOR');
    }
  });

  it('rejects valid base64url that is not a JSON object', () => {
    expect(() => decodeCursor(Buffer.from('[1]').toString('base64url'))).toThrow(AppError);
    expect(() => decodeCursor(Buffer.from('nope').toString('base64url'))).toThrow(AppError);
  });
});

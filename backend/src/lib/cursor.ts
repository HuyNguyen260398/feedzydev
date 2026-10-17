import { AppError } from './errors';

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(s: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new AppError(400, 'INVALID_CURSOR', 'Invalid cursor.');
}

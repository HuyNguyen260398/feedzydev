import { createHash } from 'node:crypto';
import { AppError } from './errors';
import type { Post } from './types';

export const MAX_SUBSCRIPTIONS = 1000;
export const PUSH_TAG = 'feedzy-new-posts';

const MAX_ENDPOINT_LENGTH = 1024;
const MAX_KEY_LENGTH = 256;
const MAX_TITLE_LENGTH = 120;
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;
const EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
]);
const HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string;
  updatedAt: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  image?: string;
  tag: string;
}

export function subscriptionId(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function invalid(message: string): AppError {
  return new AppError(400, 'INVALID_SUBSCRIPTION', message);
}

/** Only known push services, so a subscriber can't point the crawler at arbitrary URLs. */
function allowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  return EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
}

function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= MAX_KEY_LENGTH && BASE64URL.test(key);
}

/** Validates a browser `PushSubscription.toJSON()` body. */
export function parseSubscription(body: Record<string, unknown>): {
  endpoint: string;
  p256dh: string;
  auth: string;
} {
  const { endpoint, keys } = body;
  if (!allowedEndpoint(endpoint)) throw invalid('endpoint must be a known push service URL');
  const k = (keys && typeof keys === 'object' ? keys : {}) as Record<string, unknown>;
  if (!validKey(k.p256dh) || !validKey(k.auth))
    throw invalid('keys.p256dh and keys.auth must be base64url strings');
  return { endpoint, p256dh: k.p256dh, auth: k.auth };
}

export function buildPayload(
  newest: Pick<Post, 'title' | 'sourceName' | 'thumbnailUrl'>,
  totalNew: number,
): PushPayload {
  const more = totalNew - 1;
  return {
    title: newest.title.slice(0, MAX_TITLE_LENGTH),
    body:
      more > 0
        ? `${newest.sourceName} · Click to read ${more} more posts`
        : `${newest.sourceName} · Click to read`,
    url: '/',
    ...(newest.thumbnailUrl ? { image: newest.thumbnailUrl } : {}),
    tag: PUSH_TAG,
  };
}

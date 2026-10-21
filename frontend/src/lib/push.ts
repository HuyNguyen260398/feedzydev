import { deleteSubscription, postSubscription } from '@/lib/api';
import { isIos, isStandalone } from '@/lib/platform';

export type PushState = 'hidden' | 'needs-install' | 'off' | 'on' | 'blocked';

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function supported(): boolean {
  return 'serviceWorker' in navigator && !!window.PushManager && !!window.Notification;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export function urlBase64ToUint8Array(s: string): Uint8Array<ArrayBuffer> {
  const base64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Hex SHA-256 of the endpoint: the server's id for this subscription. */
export async function endpointId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !VAPID_PUBLIC_KEY) return 'hidden';
  if (process.env.NEXT_PUBLIC_MOCK === '1') return 'hidden';
  // Safari tabs on iOS have no PushManager; only the Home Screen app can subscribe.
  if (!supported()) return isIos() && !isStandalone() ? 'needs-install' : 'hidden';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** Must run from a click: it shows the browser's permission prompt. */
export async function subscribe(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  try {
    await postSubscription(sub.toJSON());
  } catch (err) {
    // Don't leave a browser subscription the server never heard of.
    await sub.unsubscribe().catch(() => false);
    throw err;
  }
  return 'on';
}

export async function unsubscribe(): Promise<PushState> {
  const sub = await currentSubscription();
  if (!sub) return 'off';
  const id = await endpointId(sub.endpoint);
  await sub.unsubscribe();
  // Best effort: if this fails, the next push gets a 410 and the server prunes it.
  await deleteSubscription(id).catch(() => {});
  return 'off';
}

/** Keeps the server's copy fresh (browsers rotate subscriptions); never subscribes on its own. */
export async function resync(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await postSubscription(sub.toJSON());
  } catch {
    // Retried on the next app load.
  }
}

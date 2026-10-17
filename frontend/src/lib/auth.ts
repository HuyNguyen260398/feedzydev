'use client';

import { useEffect, useState } from 'react';
import { Amplify } from 'aws-amplify';
import {
  fetchAuthSession,
  fetchUserAttributes,
  signInWithRedirect,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

let configured = false;

export function configureAmplify(): void {
  if (configured) return;
  configured = true;
  const redirect = [`${window.location.origin}/sources/`];
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
        loginWith: {
          oauth: {
            domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN!,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: redirect,
            redirectSignOut: redirect,
            responseType: 'code',
            providers: ['Google'],
          },
        },
      },
    },
  });
}

export async function signIn(): Promise<void> {
  await signInWithRedirect({ provider: 'Google' });
}

export async function signOut(): Promise<void> {
  await amplifySignOut();
}

/** Raw Cognito ID token (sent as-is in the Authorization header), if signed in. */
export async function getIdToken(): Promise<string | undefined> {
  const session = await fetchAuthSession();
  return session.tokens?.idToken?.toString();
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  email?: string;
}

async function readState(): Promise<AuthState> {
  if (process.env.NEXT_PUBLIC_MOCK === '1')
    return { status: 'signedIn', email: 'mock@feedzydev.dev' };
  try {
    const session = await fetchAuthSession();
    if (!session.tokens?.idToken) return { status: 'signedOut' };
    const email =
      (session.tokens.idToken.payload.email as string | undefined) ??
      (await fetchUserAttributes().catch(() => ({}) as { email?: string })).email;
    return { status: 'signedIn', email };
  } catch {
    return { status: 'signedOut' };
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    const refresh = () =>
      void readState().then((s) => {
        if (live) setState(s);
      });
    refresh();
    const stop = Hub.listen('auth', refresh);
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}

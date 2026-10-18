import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignInPanel from '@/components/sources/SignInPanel';

vi.mock('@/lib/auth', () => ({ signIn: vi.fn() }));

afterEach(() => window.history.replaceState(null, '', '/'));

describe('SignInPanel', () => {
  it('shows a private-app message after a rejected sign-in and cleans the URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/sources/?error=invalid_request&error_description=PreSignUp+failed+with+error+This+app+is+private.',
    );
    render(<SignInPanel />);
    expect(
      await screen.findByText('This app is private — only the owner can sign in.'),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('shows no message on a normal visit', () => {
    render(<SignInPanel />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

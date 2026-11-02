import { expect } from 'vitest';

/** Asserts a button shows only an icon, with a tooltip for sighted users. */
export function expectIconOnly(button: HTMLElement, tooltip: string) {
  expect(button).toHaveTextContent('');
  expect(button.querySelector('svg')).not.toBeNull();
  expect(button).toHaveAttribute('title', tooltip);
}

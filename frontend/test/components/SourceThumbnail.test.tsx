import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import SourceThumbnail, { titleFontSize } from '@/components/SourceThumbnail';

describe('SourceThumbnail', () => {
  it('writes every word in lowercase', () => {
    const { container } = render(
      <SourceThumbnail sourceName="SRE WEEKLY" postUrl="https://sreweekly.com/a" />,
    );
    const text = container.querySelector('svg')!.textContent!;
    expect(text).toContain('> sre_');
    expect(text).toBe(text.toLowerCase());
  });

  it('colours the word with the source theme', () => {
    const { container } = render(
      <SourceThumbnail sourceName="Anything" postUrl="https://aws.amazon.com/a" />,
    );
    const word = [...container.querySelectorAll('tspan')].find((t) => t.textContent === 'aws');
    expect(word).toHaveAttribute('fill', '#ff9900');
  });

  it('keeps the size of the original template for a short word', () => {
    expect(titleFontSize('docker')).toBe(84);
  });

  it.each([12, 19, 26, 40])('fits a %i letter word inside the window', (length) => {
    const shown = Math.min(length, 26) + 3;
    expect(shown * 0.6 * titleFontSize('x'.repeat(length))).toBeLessThanOrEqual(640);
  });
});

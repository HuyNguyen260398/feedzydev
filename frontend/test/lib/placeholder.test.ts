import { describe, expect, it } from 'vitest';
import { initialOf, placeholderStyle } from '@/lib/placeholder';

describe('placeholder', () => {
  it('placeholderStyle is deterministic', () => {
    expect(placeholderStyle('a')).toEqual(placeholderStyle('a'));
    expect(placeholderStyle('a')).not.toEqual(placeholderStyle('b'));
    expect(placeholderStyle('a').background).toContain('linear-gradient');
  });
  it('initialOf takes first alphanumeric uppercased', () => {
    expect(initialOf('  aws devops')).toBe('A');
    expect(initialOf('--7up')).toBe('7');
    expect(initialOf('')).toBe('?');
  });
});

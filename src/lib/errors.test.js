import { describe, it, expect } from 'vitest';
import { isRateLimited } from './errors';

describe('isRateLimited', () => {
  it('recognises the rate limit error from the database', () => {
    expect(isRateLimited({ code: 'PT429', message: 'You are posting too fast.' })).toBe(true);
  });

  it.each([
    ['another database error', { code: '23514', message: 'check violation' }],
    ['a permission error', { code: '42501', message: 'row-level security' }],
    ['an error without a code', { message: 'something broke' }],
    ['a similar looking code', { code: 'PT42', message: 'x' }],
    ['a lowercase code', { code: 'pt429', message: 'x' }],
    ['the number 429 instead of the code', { code: 429 }],
  ])('does not treat %s as a rate limit', (_name, error) => {
    expect(isRateLimited(error)).toBe(false);
  });

  it.each([null, undefined, '', 'PT429', 429])('copes with %s without crashing', (value) => {
    expect(isRateLimited(value)).toBe(false);
  });
});

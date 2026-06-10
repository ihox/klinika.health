import { describe, expect, it } from 'vitest';

import { breakpointForWidth } from './use-breakpoint';

/**
 * Boundaries must match the spec + the CSS layer (md=768, lg=1024,
 * xl=1280). The hook drives structural switches (week-grid vs day-list,
 * split-pane vs drilldown), so off-by-one at a boundary would flip the
 * wrong tree.
 */
describe('breakpointForWidth — spec breakpoints', () => {
  it('phone below 768', () => {
    expect(breakpointForWidth(320)).toBe('phone');
    expect(breakpointForWidth(375)).toBe('phone');
    expect(breakpointForWidth(414)).toBe('phone');
    expect(breakpointForWidth(767)).toBe('phone');
  });

  it('tablet-portrait 768–1023', () => {
    expect(breakpointForWidth(768)).toBe('tablet-portrait');
    expect(breakpointForWidth(900)).toBe('tablet-portrait');
    expect(breakpointForWidth(1023)).toBe('tablet-portrait');
  });

  it('tablet-landscape 1024–1279', () => {
    expect(breakpointForWidth(1024)).toBe('tablet-landscape');
    expect(breakpointForWidth(1200)).toBe('tablet-landscape');
    expect(breakpointForWidth(1279)).toBe('tablet-landscape');
  });

  it('desktop at and above 1280 (untouched zone)', () => {
    expect(breakpointForWidth(1280)).toBe('desktop');
    expect(breakpointForWidth(1440)).toBe('desktop');
    expect(breakpointForWidth(1920)).toBe('desktop');
  });
});

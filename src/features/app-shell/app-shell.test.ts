import { describe, it, expect } from 'vitest';
import { mountShell } from './shell';
import { showProgress, updateProgress, hideProgress } from './progress';
import { showContextMenu, hideContextMenu } from './context-menu';
import { escapeHtml, formatBuildVolume, formatPixelSize } from './utils';

describe('app-shell utils', () => {
  it('escapeHtml escapes special characters', () => {
    expect(escapeHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
    expect(escapeHtml('"quotes"')).toBe('&quot;quotes&quot;');
    expect(escapeHtml("a'b")).toBe('a&#039;b');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('formatBuildVolume formats dimensions', () => {
    const result = formatBuildVolume({ buildWidthMM: 218.88, buildDepthMM: 122.88, buildHeightMM: 245 });
    expect(result).toContain('218.88');
    expect(result).toContain('122.88');
    expect(result).toContain('245');
  });

  it('formatPixelSize formats correctly', () => {
    const result = formatPixelSize({ buildWidthMM: 218.88, buildDepthMM: 122.88, resolutionX: 11520, resolutionY: 5120 });
    expect(result).toContain('19');
  });
});

describe('app-shell exports', () => {
  it('mountShell is a function', () => {
    expect(typeof mountShell).toBe('function');
  });

  it('progress helpers are functions', () => {
    expect(typeof showProgress).toBe('function');
    expect(typeof updateProgress).toBe('function');
    expect(typeof hideProgress).toBe('function');
  });

  it('context-menu helpers are functions', () => {
    expect(typeof showContextMenu).toBe('function');
    expect(typeof hideContextMenu).toBe('function');
  });
});

import { describe, it, expect } from 'vitest';
import { injectProductionMetaCsp } from '../../electron-vite.config.js';

describe('Vite Production Meta CSP Plugin', () => {
  it('is strictly scoped to build mode and inactive in serve/development', () => {
    const plugin = injectProductionMetaCsp();
    expect(plugin.name).toBe('production-meta-csp-inject');
    expect(plugin.apply).toBe('build');
  });

  it('injects strict Content-Security-Policy meta tag into head-prepend during production build', () => {
    const plugin = injectProductionMetaCsp();
    expect(typeof plugin.transformIndexHtml).toBe('function');

    // @ts-expect-error simulating transformIndexHtml call
    const result = plugin.transformIndexHtml('<html><head></head><body></body></html>');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);

    const descriptor = result[0];
    expect(descriptor.tag).toBe('meta');
    expect(descriptor.injectTo).toBe('head-prepend');
    expect(descriptor.attrs).toBeDefined();
    expect(descriptor.attrs['http-equiv']).toBe('Content-Security-Policy');

    const expectedCsp =
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'";
    expect(descriptor.attrs.content).toBe(expectedCsp);
  });
});

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEWPORT_PROFILES,
  validateViewportProfile,
  validateViewportProfileList,
  MIN_VIEWPORT_WIDTH,
  MAX_VIEWPORT_WIDTH,
  MIN_VIEWPORT_HEIGHT,
  MAX_VIEWPORT_HEIGHT,
  MIN_DEVICE_SCALE_FACTOR,
  MAX_DEVICE_SCALE_FACTOR,
} from '../../src/main/browser/viewport-profiles.js';
import type { ViewportProfile } from '../../src/main/browser/visual-types.js';

describe('Viewport Profiles Suite', () => {
  it('defines at least the 8 required default profiles', () => {
    expect(DEFAULT_VIEWPORT_PROFILES.length).toBeGreaterThanOrEqual(8);

    const ids = DEFAULT_VIEWPORT_PROFILES.map(p => p.id);
    expect(ids).toContain('small-mobile');
    expect(ids).toContain('standard-mobile');
    expect(ids).toContain('large-mobile');
    expect(ids).toContain('tablet-portrait');
    expect(ids).toContain('tablet-landscape');
    expect(ids).toContain('laptop');
    expect(ids).toContain('desktop');
    expect(ids).toContain('large-desktop');
  });

  it('validates each default profile successfully', () => {
    for (const profile of DEFAULT_VIEWPORT_PROFILES) {
      const validated = validateViewportProfile(profile);
      expect(validated.id).toBe(profile.id);
      expect(validated.width).toBeGreaterThanOrEqual(MIN_VIEWPORT_WIDTH);
      expect(validated.width).toBeLessThanOrEqual(MAX_VIEWPORT_WIDTH);
      expect(validated.height).toBeGreaterThanOrEqual(MIN_VIEWPORT_HEIGHT);
      expect(validated.height).toBeLessThanOrEqual(MAX_VIEWPORT_HEIGHT);
      expect(validated.deviceScaleFactor).toBeGreaterThanOrEqual(MIN_DEVICE_SCALE_FACTOR);
      expect(validated.deviceScaleFactor).toBeLessThanOrEqual(MAX_DEVICE_SCALE_FACTOR);
    }
  });

  it('validates a custom valid viewport profile', () => {
    const custom: ViewportProfile = {
      id: 'custom-foldable',
      name: 'Custom Foldable',
      width: 540,
      height: 720,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      isLandscape: false,
    };

    const validated = validateViewportProfile(custom);
    expect(validated.id).toBe('custom-foldable');
    expect(validated.name).toBe('Custom Foldable');
    expect(validated.width).toBe(540);
    expect(validated.height).toBe(720);
    expect(validated.deviceScaleFactor).toBe(2);
    expect(validated.isMobile).toBe(true);
    expect(validated.hasTouch).toBe(true);
  });

  it('rejects invalid width values', () => {
    const invalidLow: ViewportProfile = {
      id: 'too-narrow',
      name: 'Too Narrow',
      width: 100, // < 240
      height: 800,
      deviceScaleFactor: 1,
    };
    expect(() => validateViewportProfile(invalidLow)).toThrow(/Invalid viewport width \(100\)/);

    const invalidHigh: ViewportProfile = {
      id: 'too-wide',
      name: 'Too Wide',
      width: 10000, // > 7680
      height: 800,
      deviceScaleFactor: 1,
    };
    expect(() => validateViewportProfile(invalidHigh)).toThrow(/Invalid viewport width \(10000\)/);

    const nonInteger: ViewportProfile = {
      id: 'fractional',
      name: 'Fractional',
      width: 375.5,
      height: 800,
      deviceScaleFactor: 1,
    };
    expect(() => validateViewportProfile(nonInteger)).toThrow(/Invalid viewport width/);
  });

  it('rejects invalid height values', () => {
    const invalidLow: ViewportProfile = {
      id: 'too-short',
      name: 'Too Short',
      width: 375,
      height: 150, // < 240
      deviceScaleFactor: 1,
    };
    expect(() => validateViewportProfile(invalidLow)).toThrow(/Invalid viewport height \(150\)/);

    const invalidHigh: ViewportProfile = {
      id: 'too-tall',
      name: 'Too Tall',
      width: 375,
      height: 5000, // > 4320
      deviceScaleFactor: 1,
    };
    expect(() => validateViewportProfile(invalidHigh)).toThrow(/Invalid viewport height \(5000\)/);
  });

  it('rejects invalid deviceScaleFactor values', () => {
    const invalidLow: ViewportProfile = {
      id: 'low-scale',
      name: 'Low Scale',
      width: 375,
      height: 800,
      deviceScaleFactor: 0.1, // < 0.5
    };
    expect(() => validateViewportProfile(invalidLow)).toThrow(/Invalid deviceScaleFactor/);

    const invalidHigh: ViewportProfile = {
      id: 'high-scale',
      name: 'High Scale',
      width: 375,
      height: 800,
      deviceScaleFactor: 5.0, // > 4.0
    };
    expect(() => validateViewportProfile(invalidHigh)).toThrow(/Invalid deviceScaleFactor/);

    const nanScale: ViewportProfile = {
      id: 'nan-scale',
      name: 'NaN Scale',
      width: 375,
      height: 800,
      deviceScaleFactor: Number.NaN,
    };
    expect(() => validateViewportProfile(nanScale)).toThrow(/Invalid deviceScaleFactor/);
  });

  it('rejects empty profile list', () => {
    expect(() => validateViewportProfileList([])).toThrow(
      /Viewport profiles list must contain at least one profile/,
    );
  });

  it('rejects duplicate profile IDs in profile list', () => {
    const dupes: ViewportProfile[] = [
      { id: 'mobile', name: 'Mobile 1', width: 375, height: 667, deviceScaleFactor: 1 },
      { id: 'mobile', name: 'Mobile 2', width: 414, height: 896, deviceScaleFactor: 1 },
    ];
    expect(() => validateViewportProfileList(dupes)).toThrow(
      /Duplicate viewport profile id detected: "mobile"/,
    );
  });

  it('enforces maximum profile count per audit', () => {
    const manyProfiles: ViewportProfile[] = [];
    for (let i = 0; i < 15; i++) {
      manyProfiles.push({
        id: `profile-${i}`,
        name: `Profile ${i}`,
        width: 320 + i * 10,
        height: 640 + i * 10,
        deviceScaleFactor: 1,
      });
    }

    expect(() => validateViewportProfileList(manyProfiles, 10)).toThrow(
      /Exceeded maximum allowed viewport profiles \(15 > 10\)/,
    );
  });
});

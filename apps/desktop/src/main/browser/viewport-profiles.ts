import type { ViewportProfile } from './visual-types.js';

/**
 * Standard Default Viewport Profiles
 */
export const DEFAULT_VIEWPORT_PROFILES: readonly ViewportProfile[] = [
  {
    id: 'small-mobile',
    name: 'Small Mobile',
    width: 320,
    height: 640,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
  {
    id: 'standard-mobile',
    name: 'Standard Mobile',
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
  {
    id: 'large-mobile',
    name: 'Large Mobile',
    width: 430,
    height: 932,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
  {
    id: 'tablet-portrait',
    name: 'Tablet Portrait',
    width: 768,
    height: 1024,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    isLandscape: false,
  },
  {
    id: 'tablet-landscape',
    name: 'Tablet Landscape',
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  {
    id: 'laptop',
    name: 'Laptop',
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  {
    id: 'desktop',
    name: 'Desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
  {
    id: 'large-desktop',
    name: 'Large Desktop',
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
] as const;

export const MIN_VIEWPORT_WIDTH = 240;
export const MAX_VIEWPORT_WIDTH = 7680;
export const MIN_VIEWPORT_HEIGHT = 240;
export const MAX_VIEWPORT_HEIGHT = 4320;
export const MIN_DEVICE_SCALE_FACTOR = 0.5;
export const MAX_DEVICE_SCALE_FACTOR = 4.0;
export const DEFAULT_MAX_PROFILES = 12;

/**
 * Validates a single viewport profile.
 * Throws an Error with a descriptive message if the profile is invalid.
 */
export function validateViewportProfile(profile: ViewportProfile): ViewportProfile {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Invalid viewport profile: Profile must be a non-null object.');
  }

  if (typeof profile.id !== 'string' || profile.id.trim().length === 0) {
    throw new Error('Invalid viewport profile: "id" must be a non-empty string.');
  }

  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    throw new Error('Invalid viewport profile: "name" must be a non-empty string.');
  }

  if (
    !Number.isInteger(profile.width) ||
    profile.width < MIN_VIEWPORT_WIDTH ||
    profile.width > MAX_VIEWPORT_WIDTH
  ) {
    throw new Error(
      `Invalid viewport width (${profile.width}). Width must be an integer between ${MIN_VIEWPORT_WIDTH} and ${MAX_VIEWPORT_WIDTH} pixels.`,
    );
  }

  if (
    !Number.isInteger(profile.height) ||
    profile.height < MIN_VIEWPORT_HEIGHT ||
    profile.height > MAX_VIEWPORT_HEIGHT
  ) {
    throw new Error(
      `Invalid viewport height (${profile.height}). Height must be an integer between ${MIN_VIEWPORT_HEIGHT} and ${MAX_VIEWPORT_HEIGHT} pixels.`,
    );
  }

  if (
    typeof profile.deviceScaleFactor !== 'number' ||
    Number.isNaN(profile.deviceScaleFactor) ||
    profile.deviceScaleFactor < MIN_DEVICE_SCALE_FACTOR ||
    profile.deviceScaleFactor > MAX_DEVICE_SCALE_FACTOR
  ) {
    throw new Error(
      `Invalid deviceScaleFactor (${profile.deviceScaleFactor}). Scale factor must be between ${MIN_DEVICE_SCALE_FACTOR} and ${MAX_DEVICE_SCALE_FACTOR}.`,
    );
  }

  return {
    id: profile.id.trim(),
    name: profile.name.trim(),
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: Boolean(profile.isMobile),
    hasTouch: Boolean(profile.hasTouch),
    isLandscape: profile.isLandscape ?? profile.width > profile.height,
  };
}

/**
 * Validates a list of viewport profiles, enforcing bounds and unique IDs.
 */
export function validateViewportProfileList(
  profiles: readonly ViewportProfile[],
  maxProfiles = DEFAULT_MAX_PROFILES,
): ViewportProfile[] {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error('Viewport profiles list must contain at least one profile.');
  }

  if (profiles.length > maxProfiles) {
    throw new Error(
      `Exceeded maximum allowed viewport profiles (${profiles.length} > ${maxProfiles}).`,
    );
  }

  const seenIds = new Set<string>();
  const validated: ViewportProfile[] = [];

  for (const p of profiles) {
    const valid = validateViewportProfile(p);
    if (seenIds.has(valid.id)) {
      throw new Error(`Duplicate viewport profile id detected: "${valid.id}".`);
    }
    seenIds.add(valid.id);
    validated.push(valid);
  }

  return validated;
}

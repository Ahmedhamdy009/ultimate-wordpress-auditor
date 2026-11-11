/**
 * Safe Offline axe-core Script Loader.
 * Provides access to the locally bundled axe-core JavaScript engine without
 * any external network calls, CDN requests, or Node.js API exposure to web pages.
 */

import axe from 'axe-core';
import type { Page } from 'playwright-core';

export class AxeCoreLoader {
  private static cachedSource: string | null = null;
  private static cachedVersion: string | null = null;

  /**
   * Returns the bundled, offline source code of axe-core.
   */
  public static getAxeSource(): string {
    if (!AxeCoreLoader.cachedSource) {
      if (!axe || !axe.source) {
        throw new Error('Failed to load offline axe-core: bundle source is empty or missing.');
      }
      AxeCoreLoader.cachedSource = axe.source;
    }
    return AxeCoreLoader.cachedSource;
  }

  /**
   * Returns the pinned version of axe-core.
   */
  public static getAxeVersion(): string {
    if (!AxeCoreLoader.cachedVersion) {
      AxeCoreLoader.cachedVersion = axe.version || '4.14.0';
    }
    return AxeCoreLoader.cachedVersion;
  }

  /**
   * Injects the axe-core script into a Playwright Page via Chrome DevTools Protocol runtime evaluation.
   * Does NOT append external script tags or contact external servers.
   * Safe with Content Security Policy (CDP bypasses script-src restrictions safely).
   */
  public static async injectAxe(page: Page): Promise<boolean> {
    if (page.isClosed()) {
      throw new Error('Cannot inject axe-core: target page is already closed.');
    }

    // Check if axe is already available on the page to prevent redundant evaluations
    const isAlreadyLoaded = await page
      .evaluate(() => {
        return (
          typeof (globalThis as unknown as { axe?: { run?: unknown } }).axe?.run === 'function'
        );
      })
      .catch(() => false);

    if (isAlreadyLoaded) {
      return true;
    }

    const source = AxeCoreLoader.getAxeSource();

    // Evaluate the axe bundle inside page context
    await page.evaluate((axeSource: string) => {
      // Evaluate within global scope
      (0, eval)(axeSource);
    }, source);

    return true;
  }
}

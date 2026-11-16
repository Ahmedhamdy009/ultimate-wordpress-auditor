import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { AuditUiProvider } from '../../src/renderer/src/context/AuditUiContext.js';
import { VisualEvidenceGallery } from '../../src/renderer/src/components/dashboard/VisualEvidenceGallery.js';
import type { VisualEvidenceEntryDTO } from '@auditor/shared';

describe('VisualEvidenceGallery Component Tests', () => {
  const sampleEvidence: Record<string, VisualEvidenceEntryDTO> = {
    'desktop-clean.png': {
      fileName: 'desktop-clean.png',
      byteLength: 45000,
      embedded: true,
      dataUri:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      pageUrl: 'https://example.com/clean-page',
      viewport: 'Desktop Viewport (1440x900)',
      viewportCategory: 'desktop',
      width: 1440,
      height: 900,
      captureType: 'viewport',
      status: 'captured',
    },
    'mobile-clean.png': {
      fileName: 'mobile-clean.png',
      byteLength: 22000,
      embedded: true,
      dataUri:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      pageUrl: 'https://example.com/clean-mobile',
      viewport: 'Mobile Viewport (390x844)',
      viewportCategory: 'mobile',
      width: 390,
      height: 844,
      captureType: 'viewport',
      status: 'captured',
    },
    'tablet-omitted.png': {
      fileName: 'tablet-omitted.png',
      byteLength: 0,
      embedded: false,
      pageUrl: 'https://example.com/tablet-fail',
      viewport: 'Tablet Viewport (820x1180)',
      viewportCategory: 'tablet',
      width: 820,
      height: 1180,
      captureType: 'viewport',
      status: 'failed',
      omittedReason: 'Visual preview unavailable: screenshot status is failed.',
    },
  };

  it('renders null when visualEvidence is empty and not loading', () => {
    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(VisualEvidenceGallery, {
          visualEvidence: {},
          visualEvidenceLoading: false,
        }),
      ),
    );
    expect(html).toBe('');
  });

  it('renders loading state when visualEvidenceLoading is true', () => {
    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(VisualEvidenceGallery, {
          visualEvidence: {},
          visualEvidenceLoading: true,
        }),
      ),
    );
    expect(html).toContain('Loading visual evidence...');
  });

  it('renders screenshot cards with viewport categories, badges, and dimensions', () => {
    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'en', initialViewMode: 'dual' },
        React.createElement(VisualEvidenceGallery, {
          visualEvidence: sampleEvidence,
          visualEvidenceLoading: false,
        }),
      ),
    );

    expect(html).toContain('Visual Evidence &amp; Page Screenshots');
    expect(html).toContain('desktop-clean.png');
    expect(html).toContain('mobile-clean.png');
    expect(html).toContain('tablet-omitted.png');

    // Badges & dimensions
    expect(html).toContain('1440×900');
    expect(html).toContain('390×844');
    expect(html).toContain('820×1180');
    expect(html).toContain('desktop');
    expect(html).toContain('mobile');
    expect(html).toContain('tablet');

    // URLs
    expect(html).toContain('https://example.com/clean-page');
    expect(html).toContain('https://example.com/clean-mobile');

    // Omission reason for failed screenshot
    expect(html).toContain('Visual preview unavailable: screenshot status is failed.');
  });

  it('renders Arabic labels when locale is ar', () => {
    const html = renderComponentToHtml(
      React.createElement(
        AuditUiProvider,
        { initialLocale: 'ar', initialViewMode: 'dual' },
        React.createElement(VisualEvidenceGallery, {
          visualEvidence: sampleEvidence,
          visualEvidenceLoading: false,
        }),
      ),
    );

    expect(html).toContain('الأدلة البصرية ولقطات الشاشة');
    expect(html).toContain('سطح المكتب');
    expect(html).toContain('هاتف محمول');
    expect(html).toContain('جهاز لوحي');
  });
});

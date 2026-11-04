import { describe, it, expect } from 'vitest';
import type { Finding, FindingSeverity, FindingStatus, FindingConfidence } from '../src/index.js';

describe('Shared Finding Schema Tests', () => {
  it('constructs and type-checks a valid Finding object', () => {
    const severity: FindingSeverity = 'critical';
    const confidence: FindingConfidence = 'high';
    const status: FindingStatus = 'confirmed';

    const finding: Finding = {
      id: 'finding-test-001',
      siteId: 'site-test-wp',
      scanRunId: 'scan-run-test-001',
      module: 'core-audit',
      category: 'Security Configuration',
      title: 'Debug mode enabled in production',
      description: 'WP_DEBUG is set to true in production configuration.',
      severity,
      confidence,
      status,
      affectedUrl: 'https://example.com/wp-config.php',
      evidence: 'define("WP_DEBUG", true);',
      source: 'wp-config-audit',
      detectedAt: '2026-11-04T12:00:00.000Z',
      remediation: 'Set WP_DEBUG to false in production environments.',
      verificationSteps: 'Inspect wp-config.php and verify WP_DEBUG is false.',
    };

    expect(finding.id).toBe('finding-test-001');
    expect(finding.severity).toBe('critical');
    expect(finding.confidence).toBe('high');
    expect(finding.status).toBe('confirmed');
  });
});

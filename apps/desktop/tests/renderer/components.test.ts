import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderComponentToHtml } from '../helpers/react-test-harness.js';
import { Card } from '../../src/renderer/src/components/common/Card.js';
import { Badge } from '../../src/renderer/src/components/common/Badge.js';
import { Alert } from '../../src/renderer/src/components/common/Alert.js';

describe('Phase 1.2.5.1 — Reusable UI Components', () => {
  describe('Card Component', () => {
    it('renders with children and base class', () => {
      const html = renderComponentToHtml(
        React.createElement(Card, null, React.createElement('p', null, 'Card content')),
      );

      expect(html).toContain('class="auditor-card"');
      expect(html).toContain('Card content');
      expect(html).not.toContain('auditor-card__header');
    });

    it('renders title, subtitle, and header action when provided', () => {
      const html = renderComponentToHtml(
        React.createElement(
          Card,
          {
            title: 'Test Title',
            subtitle: 'Test Subtitle',
            headerAction: React.createElement('button', null, 'Action'),
          },
          'Body Text',
        ),
      );

      expect(html).toContain('auditor-card__header');
      expect(html).toContain('<h2 class="auditor-card__title">Test Title</h2>');
      expect(html).toContain('<p class="auditor-card__subtitle">Test Subtitle</p>');
      expect(html).toContain('<div class="auditor-card__action"><button>Action</button></div>');
      expect(html).toContain('Body Text');
    });

    it('applies elevated class when elevated=true', () => {
      const html = renderComponentToHtml(
        React.createElement(Card, { elevated: true }, 'Elevated Card'),
      );

      expect(html).toContain('auditor-card--elevated');
    });

    it('renders footer when provided', () => {
      const html = renderComponentToHtml(
        React.createElement(
          Card,
          { footer: React.createElement('span', null, 'Footer Content') },
          'Body Text',
        ),
      );

      expect(html).toContain(
        '<footer class="auditor-card__footer"><span>Footer Content</span></footer>',
      );
    });

    it('supports custom role and aria-label', () => {
      const html = renderComponentToHtml(
        React.createElement(
          Card,
          { role: 'region', 'aria-label': 'Diagnostic Panel' },
          'Panel content',
        ),
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Diagnostic Panel"');
    });
  });

  describe('Badge Component', () => {
    it('renders default variant and md size by default', () => {
      const html = renderComponentToHtml(React.createElement(Badge, null, 'Active'));

      expect(html).toContain('class="auditor-badge auditor-badge--default auditor-badge--md"');
      expect(html).toContain('Active');
    });

    it.each([
      ['default', 'auditor-badge--default'],
      ['success', 'auditor-badge--success'],
      ['warning', 'auditor-badge--warning'],
      ['danger', 'auditor-badge--danger'],
      ['info', 'auditor-badge--info'],
      ['neutral', 'auditor-badge--neutral'],
    ] as const)('applies correct class for variant "%s"', (variant, expectedClass) => {
      const html = renderComponentToHtml(React.createElement(Badge, { variant }, 'Badge Content'));

      expect(html).toContain(expectedClass);
    });

    it('applies small size class when size="sm"', () => {
      const html = renderComponentToHtml(React.createElement(Badge, { size: 'sm' }, 'Small'));

      expect(html).toContain('auditor-badge--sm');
    });

    it('renders title attribute when provided', () => {
      const html = renderComponentToHtml(
        React.createElement(Badge, { title: 'Informational Note' }, 'Note'),
      );

      expect(html).toContain('title="Informational Note"');
    });
  });

  describe('Alert Component', () => {
    it('renders alert with role="alert" and semantic variant class', () => {
      const html = renderComponentToHtml(
        React.createElement(
          Alert,
          { variant: 'danger', title: 'Fatal Error' },
          'Something went wrong',
        ),
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('class="auditor-alert auditor-alert--danger"');
      expect(html).toContain('<div class="auditor-alert__title">Fatal Error</div>');
      expect(html).toContain('Something went wrong');
    });

    it.each([
      ['info', 'auditor-alert--info'],
      ['success', 'auditor-alert--success'],
      ['warning', 'auditor-alert--warning'],
      ['danger', 'auditor-alert--danger'],
    ] as const)('renders alert variant "%s"', (variant, expectedClass) => {
      const html = renderComponentToHtml(React.createElement(Alert, { variant }, 'Alert message'));

      expect(html).toContain(expectedClass);
    });

    it('renders dismiss button when onDismiss callback is passed', () => {
      const onDismiss = vi.fn();
      const html = renderComponentToHtml(
        React.createElement(Alert, { variant: 'info', onDismiss }, 'Dismissible alert'),
      );

      expect(html).toContain('class="auditor-alert__dismiss"');
      expect(html).toContain('aria-label="Dismiss alert"');
    });

    it('does not render dismiss button when onDismiss is omitted', () => {
      const html = renderComponentToHtml(
        React.createElement(Alert, { variant: 'info' }, 'Static alert'),
      );

      expect(html).not.toContain('auditor-alert__dismiss');
    });
  });
});

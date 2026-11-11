import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderComponentToHtml, renderTestHook } from '../helpers/react-test-harness.js';
import { ErrorBoundary } from '../../src/renderer/src/components/common/ErrorBoundary.js';

describe('Phase 1.2.5.2 — ErrorBoundary', () => {
  it('renders children when no rendering exception is thrown', () => {
    const html = renderComponentToHtml(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement('div', { id: 'child-content' }, 'Normal UI View'),
      ),
    );

    expect(html).toContain('id="child-content"');
    expect(html).toContain('Normal UI View');
    expect(html).not.toContain('auditor-error-fallback');
  });

  it('generates safe fallback state without exposing raw error stacks or file paths', () => {
    // Test getDerivedStateFromError directly to inspect the security sanitization
    const maliciousSensitiveError = new Error(
      'Database password failed at C:\\Users\\secret\\server.ts:45',
    );
    maliciousSensitiveError.stack = 'Error: at C:\\Users\\secret\\server.ts:45:12';

    const state = ErrorBoundary.getDerivedStateFromError(maliciousSensitiveError);

    expect(state.hasError).toBe(true);
    expect(state.safeMessage).toBe('An unexpected rendering error occurred in this view.');
    // Must never leak file paths or password text
    expect(state.safeMessage).not.toContain('secret');
    expect(state.safeMessage).not.toContain('C:\\Users');
    expect(state.safeMessage).not.toContain('server.ts');
  });

  it('catches genuine rendering error thrown by child component in live React tree and presents fallback UI', async () => {
    let shouldThrow = true;
    const ThrowingChild: React.FC = () => {
      if (shouldThrow) {
        throw new Error('Secret internal error at C:\\Users\\ahmed\\secret.ts:10');
      }
      return React.createElement('div', { id: 'recovered' }, 'Recovered successfully');
    };

    const onReset = vi.fn(() => {
      shouldThrow = false;
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      let boundaryInstance: ErrorBoundary | null = null;
      const harness = await renderTestHook(() => {
        return React.createElement(
          ErrorBoundary,
          {
            onReset,
            ref: (inst: ErrorBoundary | null) => {
              boundaryInstance = inst;
            },
          },
          React.createElement(ThrowingChild),
        );
      });

      await harness.mount();

      expect(boundaryInstance).not.toBeNull();
      expect((boundaryInstance as unknown as ErrorBoundary).state.hasError).toBe(true);
      expect((boundaryInstance as unknown as ErrorBoundary).state.safeMessage).toBe(
        'An unexpected rendering error occurred in this view.',
      );

      // Verify no sensitive path leaked
      expect((boundaryInstance as unknown as ErrorBoundary).state.safeMessage).not.toContain(
        'secret.ts',
      );
      expect((boundaryInstance as unknown as ErrorBoundary).state.safeMessage).not.toContain(
        'C:\\Users',
      );

      // Test reset recovery
      await harness.act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (boundaryInstance as any).handleReset();
      });

      expect((boundaryInstance as unknown as ErrorBoundary).state.hasError).toBe(false);
      expect(onReset).toHaveBeenCalledTimes(1);

      await harness.unmount();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('renders fallback UI with customizable title and message', () => {
    class ThrowingComponent extends React.Component {
      public override render(): React.ReactNode {
        throw new Error('Explosion');
      }
    }

    // Suppress console.error during expected throw in test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const boundary = new ErrorBoundary({
        fallbackTitle: 'Audit Panel Crashed',
        fallbackMessage: 'Custom safe message',
        children: React.createElement(ThrowingComponent),
      });

      // Simulate React error caught transition
      boundary.state = {
        hasError: true,
        safeMessage: 'Custom safe message',
      };

      const html = renderComponentToHtml(boundary.render() as React.ReactElement);

      expect(html).toContain('class="auditor-error-fallback"');
      expect(html).toContain('Audit Panel Crashed');
      expect(html).toContain('Custom safe message');
      expect(html).toContain('Reload View');
      expect(html).not.toContain('Explosion');
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('resets error state when onReset is triggered', async () => {
    const onReset = vi.fn();

    let boundaryInstance: ErrorBoundary | null = null;

    const harness = await renderTestHook(() => {
      return React.createElement(
        ErrorBoundary,
        {
          onReset,
          ref: (inst: ErrorBoundary | null) => {
            boundaryInstance = inst;
          },
        },
        React.createElement('span', null, 'Content'),
      );
    });

    await harness.mount();

    expect(boundaryInstance).not.toBeNull();
    if (boundaryInstance) {
      // Simulate transition into error state
      await harness.act(async () => {
        (boundaryInstance as ErrorBoundary).setState({
          hasError: true,
          safeMessage: 'Error message',
        });
      });

      expect((boundaryInstance as ErrorBoundary).state.hasError).toBe(true);

      // Trigger reset
      await harness.act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (boundaryInstance as any).handleReset();
      });

      expect((boundaryInstance as ErrorBoundary).state.hasError).toBe(false);
      expect((boundaryInstance as ErrorBoundary).state.safeMessage).toBe('');
      expect(onReset).toHaveBeenCalledTimes(1);
    }

    await harness.unmount();
  });
});

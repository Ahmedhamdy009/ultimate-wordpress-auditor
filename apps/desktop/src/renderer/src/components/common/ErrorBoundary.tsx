import React, { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallbackTitle?: string;
  readonly fallbackMessage?: string;
  readonly onReset?: () => void;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly safeMessage: string;
}

/**
 * React Error Boundary for the Desktop Renderer.
 *
 * Catches unhandled errors within the rendering tree and presents a safe fallback UI.
 *
 * Security Requirements:
 * - Strictly conceals raw Error instances, stack traces, and local filesystem paths.
 * - Does not use dangerouslySetInnerHTML.
 * - Adheres to style-src 'self' without inline styles.
 *
 * Note on Asynchronous Errors:
 * React Error Boundaries do NOT catch asynchronous IPC errors, Promise rejections,
 * or event-handler exceptions. Those are handled explicitly within custom hooks and components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    safeMessage: '',
  };

  public static getDerivedStateFromError(_error: unknown): ErrorBoundaryState {
    // Strictly convert any error into a safe user-facing message without leaking stacks or paths
    return {
      hasError: true,
      safeMessage: 'An unexpected rendering error occurred in this view.',
    };
  }

  public override componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    // Log safe error name/message in non-production environments without exposing sensitive paths
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ErrorBoundary caught error]:', error.name);
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, safeMessage: '' });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="auditor-error-fallback" role="alert">
          <h2 className="auditor-error-fallback__title">
            {this.props.fallbackTitle ?? 'Component Rendering Error'}
          </h2>
          <p className="auditor-error-fallback__message">
            {this.props.fallbackMessage ?? this.state.safeMessage}
          </p>
          <button
            type="button"
            className="auditor-button auditor-button--primary"
            onClick={this.handleReset}
          >
            Reload View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

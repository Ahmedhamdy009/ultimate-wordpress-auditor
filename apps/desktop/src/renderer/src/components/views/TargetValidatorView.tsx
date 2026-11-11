import React, { useState } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useTargetValidator } from '../../hooks/useTargetValidator.js';

export const TargetValidatorView: React.FC = () => {
  const [targetInput, setTargetInput] = useState<string>('');
  const [scopeInput, setScopeInput] = useState<string>('');
  const [allowAnyPort, setAllowAnyPort] = useState<boolean>(false);
  const [allowedPortsInput, setAllowedPortsInput] = useState<string>('');

  const {
    validating,
    result,
    error,
    isValid,
    isInScope,
    normalizedUrl,
    validationError,
    validate,
    reset,
  } = useTargetValidator();

  const handleValidate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!targetInput.trim() || validating) {
      return;
    }

    // Parse user-supplied explicit scope (one per line, trimmed, non-empty)
    const parsedScope = scopeInput
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Parse port policy if supplied
    const parsedPorts = allowedPortsInput
      .split(',')
      .map(p => Number.parseInt(p.trim(), 10))
      .filter(p => !Number.isNaN(p) && p > 0 && p <= 65535);

    const validationOptions = {
      ...(allowAnyPort ? { allowAnyPort: true } : {}),
      ...(parsedPorts.length > 0 ? { allowedPorts: parsedPorts } : {}),
    };

    await validate(
      targetInput,
      parsedScope.length > 0 ? parsedScope : undefined,
      Object.keys(validationOptions).length > 0 ? validationOptions : undefined,
    );
  };

  const handleReset = (): void => {
    setTargetInput('');
    setScopeInput('');
    setAllowAnyPort(false);
    setAllowedPortsInput('');
    reset();
  };

  return (
    <div>
      <div className="auditor-view-header">
        <h1 className="auditor-view-title">Target Validator &amp; Scope Boundary Tester</h1>
        <p className="auditor-view-description">
          RFC 3986 candidate target syntax validation and strict Scope Guard boundary testing.
        </p>
      </div>

      <Alert variant="warning" title="Critical Authorization Notice">
        A target URL can be <strong>syntactically valid</strong> while remaining{' '}
        <strong>out of scope</strong>. Validation does not grant authorization to audit unapproved
        domains, nor does it prove that a website is benign or audited.
      </Alert>

      {error && (
        <Alert variant="danger" title="IPC Dispatch Error">
          {error.message} (Code: {error.code})
        </Alert>
      )}

      <div className="auditor-grid-2">
        {/* Input Form Panel */}
        <Card
          title="Candidate Target Configuration"
          subtitle="Configure target URL and explicit authorization boundaries"
        >
          <form className="auditor-form" onSubmit={handleValidate}>
            <div className="auditor-form-group">
              <label htmlFor="target-url-input" className="auditor-label">
                Target URL
              </label>
              <input
                id="target-url-input"
                type="text"
                className="auditor-input auditor-input--mono"
                placeholder="https://example.com:8443/test"
                value={targetInput}
                onChange={e => setTargetInput(e.target.value)}
                disabled={validating}
                required
              />
              <p className="auditor-help-text">
                Candidate URL to parse, normalize, and check against port policies.
              </p>
            </div>

            <div className="auditor-form-group">
              <label htmlFor="allowed-scope-input" className="auditor-label">
                Explicit Authorized Scope (One per line)
              </label>
              <textarea
                id="allowed-scope-input"
                className="auditor-textarea auditor-textarea--mono"
                placeholder="https://example.com&#10;https://staging.example.com"
                value={scopeInput}
                onChange={e => setScopeInput(e.target.value)}
                disabled={validating}
              />
              <p className="auditor-help-text">
                User-provided authorization whitelist. If omitted, scope authorization will be
                honestly reported as unsupplied.
              </p>
            </div>

            <div className="auditor-form-group">
              <label htmlFor="allow-any-port-checkbox" className="auditor-checkbox-label">
                <input
                  id="allow-any-port-checkbox"
                  type="checkbox"
                  className="auditor-checkbox"
                  checked={allowAnyPort}
                  onChange={e => setAllowAnyPort(e.target.checked)}
                  disabled={validating}
                />
                Allow non-standard ports (bypass standard 80/443 restriction)
              </label>
            </div>

            {!allowAnyPort && (
              <div className="auditor-form-group">
                <label htmlFor="allowed-ports-input" className="auditor-label">
                  Custom Allowed Ports (Optional, comma-separated)
                </label>
                <input
                  id="allowed-ports-input"
                  type="text"
                  className="auditor-input auditor-input--mono"
                  placeholder="8080, 8443, 3000"
                  value={allowedPortsInput}
                  onChange={e => setAllowedPortsInput(e.target.value)}
                  disabled={validating}
                />
              </div>
            )}

            <div className="auditor-form-actions">
              <button
                type="submit"
                id="validate-target-button"
                className="auditor-button auditor-button--primary"
                disabled={!targetInput.trim() || validating}
              >
                {validating ? 'Validating via IPC...' : 'Validate Target'}
              </button>
              <button
                type="button"
                id="clear-target-button"
                className="auditor-button auditor-button--secondary"
                onClick={handleReset}
                disabled={validating && !targetInput}
              >
                Clear
              </button>
            </div>
          </form>
        </Card>

        {/* Validation Results Panel */}
        <Card
          title="Boundary Inspection Results"
          subtitle="Independent syntax and authorization evaluations"
          headerAction={
            validating ? (
              <Badge variant="info">Validating...</Badge>
            ) : result ? (
              <Badge variant="neutral">Evaluated</Badge>
            ) : (
              <Badge variant="neutral">Awaiting Input</Badge>
            )
          }
        >
          {result ? (
            <div className="auditor-results-box">
              {/* Syntax Validity Result */}
              <div className="auditor-result-status-row">
                <span>RFC 3986 Syntax &amp; Port Validity:</span>
                {isValid === true && <Badge variant="success">Valid Target Syntax</Badge>}
                {isValid === false && (
                  <Badge variant="danger">Invalid Syntax / Port Violation</Badge>
                )}
                {isValid === null && <Badge variant="neutral">Not Evaluated</Badge>}
              </div>

              {/* Scope Authorization Result */}
              <div className="auditor-result-status-row">
                <span>Scope Guard Authorization:</span>
                {isInScope === true && <Badge variant="success">Authorized In-Scope</Badge>}
                {isInScope === false && <Badge variant="danger">Out of Scope (Unauthorized)</Badge>}
                {isInScope === null && <Badge variant="warning">No Scope Supplied (Unknown)</Badge>}
              </div>

              {/* Normalized URL Display */}
              {normalizedUrl && (
                <div className="auditor-form-group">
                  <span className="auditor-label">Normalized URL (Canonical):</span>
                  <div className="auditor-code-block">{normalizedUrl}</div>
                </div>
              )}

              {/* Failure Error Display */}
              {validationError && (
                <Alert variant="danger" title="Validation Rejection Reason">
                  {validationError}
                </Alert>
              )}
            </div>
          ) : (
            <p>
              Enter a candidate target URL and click <strong>Validate Target</strong> to execute
              isomorphic normalization and scope containment checks in the Main process.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
};

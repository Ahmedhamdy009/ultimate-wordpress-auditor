import React from 'react';
import { validateScanTarget, type FindingSeverity } from '@auditor/shared';

export const App: React.FC = () => {
  const sampleSeverity: FindingSeverity = 'informational';
  const sampleValidation = validateScanTarget('https://example.com');

  return (
    <div className="auditor-container">
      <div className="auditor-card">
        <h1>Ultimate WordPress &amp; Website Auditor</h1>
        <p>Phase 1.2.1 Desktop Workspace Initialized.</p>
        <p>
          Shared Package Link Status: Connected (Sample Severity: {sampleSeverity}, Target Valid:{' '}
          {sampleValidation.valid ? 'true' : 'false'})
        </p>
      </div>
    </div>
  );
};

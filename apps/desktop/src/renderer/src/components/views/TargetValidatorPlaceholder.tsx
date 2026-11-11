import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';

export const TargetValidatorPlaceholder: React.FC = () => {
  return (
    <div>
      <div className="auditor-view-header">
        <h1 className="auditor-view-title">Target Validator</h1>
        <p className="auditor-view-description">
          RFC 3986 candidate target syntax validation and strict Scope Guard boundary testing.
        </p>
      </div>

      <Alert variant="warning" title="Semantic Scope Notice">
        A target URL can be <strong>syntactically valid</strong> while remaining{' '}
        <strong>out of scope</strong>. Validation does not grant authorization to audit unapproved
        domains, nor does it guarantee safety.
      </Alert>

      <div className="auditor-grid-2">
        <Card
          title="Validation Contract"
          subtitle="IPC Channel: audit:validate-target"
          headerAction={<Badge variant="info">Typed Hook Ready</Badge>}
        >
          <p>
            The <code>useTargetValidator</code> hook is implemented with unmount protection,
            monotonic request ID sequencing, and independent <code>valid</code> vs.{' '}
            <code>inScope</code> semantics.
          </p>
        </Card>

        <Card
          title="Interactive Scope Tester"
          subtitle="Scheduled for Phase 1.2.5.2 (Batch 2)"
          headerAction={<Badge variant="neutral">Batch 2</Badge>}
        >
          <p>
            The complete interactive UI form with live input, scope rules, and port policy
            inspection will be finalized in Batch 2.
          </p>
        </Card>
      </div>
    </div>
  );
};

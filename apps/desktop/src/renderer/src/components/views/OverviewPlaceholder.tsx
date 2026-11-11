import React from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';

export const OverviewPlaceholder: React.FC = () => {
  return (
    <div>
      <div className="auditor-view-header">
        <h1 className="auditor-view-title">Audit Overview</h1>
        <p className="auditor-view-description">
          Phase 1.2.5.1 Dashboard Foundation active. Interactive audit management scheduled for
          Batch 2.
        </p>
      </div>

      <Alert variant="info" title="Foundation State">
        The dark design system, typed IPC bridge hooks, application shell, and error boundaries are
        active and verified. Full overview dashboards, recent scans, and audit controllers will be
        integrated in Batch 2 (Phase 1.2.5.2).
      </Alert>

      <div className="auditor-grid-2">
        <Card
          title="Audit Engine Foundation"
          subtitle="IPC Contracts &amp; Security Boundary"
          headerAction={<Badge variant="success">Phase 1.2.4 Verified</Badge>}
        >
          <p>
            The secure Electron preload bridge, sender guard, and IPC dispatcher enforce strict
            isolation and CSP boundaries.
          </p>
        </Card>

        <Card
          title="Interactive Controllers"
          subtitle="Scheduled for Phase 1.2.5.2 (Batch 2)"
          headerAction={<Badge variant="neutral">Batch 2</Badge>}
        >
          <p>
            Interactive scan launch, target parameter controls, and summary statistics will be
            connected in the next approved batch.
          </p>
        </Card>
      </div>
    </div>
  );
};

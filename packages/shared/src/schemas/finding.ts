/**
 * Standard finding schema and status definitions according to ARCHITECTURE.md.
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

export type FindingConfidence = 'high' | 'medium' | 'low';

export type FindingStatus =
  | 'confirmed'
  | 'potential'
  | 'needs_manual_review'
  | 'false_positive'
  | 'fixed'
  | 'accepted_risk'
  | 'retest_required';

export interface Finding {
  id: string;
  siteId: string;
  scanRunId: string;
  module: string;
  category: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  affectedUrl: string;
  evidence: string;
  source: string;
  detectedAt: string;
  remediation: string;
  verificationSteps: string;
}

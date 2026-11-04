/**
 * Ultimate WordPress & Website Auditor
 * Root entry point - re-exports from @auditor/shared for backward compatibility
 *
 * Implements architecture principles defined in ARCHITECTURE.md and SECURITY_POLICY.md:
 * - Strict URL scope enforcement (passive / read-only boundaries)
 * - Standardized Finding schemas and status representations
 */

export * from '@auditor/shared';

/**
 * Standards-aware Schema.org Structured Data / JSON-LD Extraction & Validation Engine.
 * Supports multiple JSON-LD script blocks, @graph arrays, entity hierarchy,
 * syntax error localization, and documented Validation Profile v1.
 * Strict SSRF protection: Zero external context fetching.
 */

import type { AnalyzerFinding } from '../analyzers/types.js';
import type { CrawledPageResult } from '../crawler/types.js';
import type {
  ExtractedSchemaEntity,
  PageStructuredDataResult,
  SchemaValidationIssue,
  SeoCoverageReport,
  StructuredDataAnalysisResult,
} from './types.js';

export const SCHEMA_PROFILE_VERSION = 'v1.0.0';

/**
 * Common Schema.org validation rules for Profile v1.
 */
interface TypeValidationRules {
  readonly requiredProperties?: readonly string[];
  readonly recommendedProperties?: readonly string[];
  readonly propertyValidators?: Record<string, (val: unknown) => string | null>;
}

const TYPE_RULES: Record<string, TypeValidationRules> = {
  article: {
    requiredProperties: ['headline', 'author', 'datePublished'],
    recommendedProperties: ['image', 'publisher'],
    propertyValidators: {
      headline: v =>
        typeof v === 'string' && v.trim().length > 0 ? null : 'Headline must be a non-empty string',
      datePublished: v =>
        typeof v === 'string' && !isNaN(Date.parse(v))
          ? null
          : 'datePublished must be a valid ISO 8601 date',
    },
  },
  blogposting: {
    requiredProperties: ['headline', 'author', 'datePublished'],
    recommendedProperties: ['image', 'publisher'],
    propertyValidators: {
      headline: v =>
        typeof v === 'string' && v.trim().length > 0 ? null : 'Headline must be a non-empty string',
    },
  },
  newsarticle: {
    requiredProperties: ['headline', 'author', 'datePublished'],
    recommendedProperties: ['image', 'publisher'],
  },
  website: {
    requiredProperties: ['name'],
    recommendedProperties: ['url'],
  },
  webpage: {
    recommendedProperties: ['name', 'url'],
  },
  organization: {
    requiredProperties: ['name'],
    recommendedProperties: ['url', 'logo'],
  },
  corporation: {
    requiredProperties: ['name'],
    recommendedProperties: ['url', 'logo'],
  },
  breadcrumblist: {
    requiredProperties: ['itemListElement'],
    propertyValidators: {
      itemListElement: v =>
        Array.isArray(v) && v.length > 0
          ? null
          : 'itemListElement must be a non-empty array of ListItems',
    },
  },
  product: {
    requiredProperties: ['name'],
    recommendedProperties: ['offers', 'image', 'description'],
    propertyValidators: {
      name: v =>
        typeof v === 'string' && v.trim().length > 0
          ? null
          : 'Product name must be a non-empty string',
    },
  },
  localbusiness: {
    requiredProperties: ['name', 'address'],
    recommendedProperties: ['telephone', 'url'],
  },
};

/**
 * Validates a single JSON-LD entity against Schema.org Profile v1.
 */
export function validateSchemaEntity(
  entity: Record<string, unknown>,
  defaultContext?: string,
): { entityType: string; issues: SchemaValidationIssue[] } {
  const issues: SchemaValidationIssue[] = [];

  // 1. Context validation
  const rawContext = (entity['@context'] as string) || defaultContext;
  if (
    !rawContext ||
    typeof rawContext !== 'string' ||
    !rawContext.toLowerCase().includes('schema.org')
  ) {
    issues.push({
      ruleId: 'SEO_SCHEMA_MISSING_CONTEXT',
      message: 'Entity lacks a valid Schema.org @context declaration ("https://schema.org").',
      severity: 'warning',
    });
  }

  // 2. Type validation
  const rawType = entity['@type'];
  if (!rawType || (typeof rawType !== 'string' && !Array.isArray(rawType))) {
    issues.push({
      ruleId: 'SEO_SCHEMA_MISSING_TYPE',
      message: 'Entity lacks a declared @type property.',
      severity: 'error',
    });
    return { entityType: 'Unknown', issues };
  }

  const entityType = Array.isArray(rawType) ? String(rawType[0]) : String(rawType);
  const typeKey = entityType.toLowerCase();
  const rules = TYPE_RULES[typeKey];

  if (rules) {
    // Check required properties
    if (rules.requiredProperties) {
      for (const reqProp of rules.requiredProperties) {
        if (entity[reqProp] === undefined || entity[reqProp] === null || entity[reqProp] === '') {
          let ruleId = 'SEO_SCHEMA_REQUIRED_PROPERTY_MISSING';
          if (typeKey === 'article' || typeKey === 'blogposting' || typeKey === 'newsarticle') {
            ruleId = 'SEO_SCHEMA_ARTICLE_MISSING_REQUIRED';
          } else if (typeKey === 'product') {
            ruleId = 'SEO_SCHEMA_PRODUCT_MISSING_REQUIRED';
          }
          issues.push({
            ruleId,
            message: `Type "${entityType}" is missing required property: "${reqProp}".`,
            severity: 'error',
            entityType,
            path: reqProp,
          });
        }
      }
    }

    // Check recommended properties
    if (rules.recommendedProperties) {
      for (const recProp of rules.recommendedProperties) {
        if (entity[recProp] === undefined || entity[recProp] === null || entity[recProp] === '') {
          issues.push({
            ruleId: 'SEO_SCHEMA_RECOMMENDED_PROPERTY_MISSING',
            message: `Type "${entityType}" is missing recommended property: "${recProp}".`,
            severity: 'info',
            entityType,
            path: recProp,
          });
        }
      }
    }

    // Check custom property validators
    if (rules.propertyValidators) {
      for (const [prop, validator] of Object.entries(rules.propertyValidators)) {
        if (entity[prop] !== undefined) {
          const err = validator(entity[prop]);
          if (err) {
            const ruleId =
              typeKey === 'breadcrumblist'
                ? 'SEO_SCHEMA_BREADCRUMB_INVALID'
                : 'SEO_SCHEMA_PROPERTY_VALUE_INVALID';
            issues.push({
              ruleId,
              message: `Invalid value for "${prop}" on "${entityType}": ${err}`,
              severity: 'warning',
              entityType,
              path: prop,
            });
          }
        }
      }
    }
  }

  // Product Offers inspection
  if (typeKey === 'product' && entity['offers']) {
    const offers = entity['offers'];
    const offersList = Array.isArray(offers) ? offers : [offers];
    for (const off of offersList) {
      if (typeof off === 'object' && off !== null) {
        const offObj = off as Record<string, unknown>;
        if (offObj.price !== undefined) {
          const numPrice =
            typeof offObj.price === 'number' ? offObj.price : parseFloat(String(offObj.price));
          if (isNaN(numPrice) || numPrice < 0) {
            issues.push({
              ruleId: 'SEO_SCHEMA_PROPERTY_VALUE_INVALID',
              message: `Product offer price must be a non-negative number. Found: "${offObj.price}".`,
              severity: 'warning',
              entityType,
              path: 'offers.price',
            });
          }
        }
        if (!offObj.priceCurrency) {
          issues.push({
            ruleId: 'SEO_SCHEMA_RECOMMENDED_PROPERTY_MISSING',
            message: `Product offer is missing priceCurrency (e.g. "USD", "EUR").`,
            severity: 'info',
            entityType,
            path: 'offers.priceCurrency',
          });
        }
      }
    }
  }

  return { entityType, issues };
}

export class StructuredDataEngine {
  readonly id = 'structured-data-engine';
  readonly name = 'Structured Data / Schema.org Engine';

  /**
   * Analyzes JSON-LD script blocks from a single page or crawled page result.
   */
  analyzePage(
    scriptsOrPage: readonly string[] | CrawledPageResult,
    pageUrlCandidate?: string,
  ): PageStructuredDataResult {
    let jsonLdScripts: readonly string[];
    let pageUrl: string;

    if (Array.isArray(scriptsOrPage)) {
      jsonLdScripts = scriptsOrPage;
      pageUrl = pageUrlCandidate || '';
    } else {
      const page = scriptsOrPage as CrawledPageResult;
      pageUrl = page.requestedUrl;
      jsonLdScripts = page.parsedDocument?.jsonLdScripts ?? [];
    }

    const findings: AnalyzerFinding[] = [];
    const extractedEntities: ExtractedSchemaEntity[] = [];
    const seenIds = new Map<string, string>(); // @id -> entityType
    const syntaxErrors: string[] = [];

    let syntaxErrorsCount = 0;

    for (let scriptIndex = 0; scriptIndex < jsonLdScripts.length; scriptIndex++) {
      const scriptContent = jsonLdScripts[scriptIndex].trim();
      if (!scriptContent) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(scriptContent);
      } catch (err) {
        syntaxErrorsCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        syntaxErrors.push(errMsg);
        findings.push({
          ruleId: 'SEO_SCHEMA_SYNTAX_ERROR',
          category: 'technical-seo',
          title: `Syntax Error in JSON-LD Script Block #${scriptIndex + 1}`,
          description: `The JSON-LD structured data block on ${pageUrl} contains malformed JSON syntax: ${errMsg}. Search engines will skip unparseable blocks.`,
          severity: 'medium',
          confidence: 'confirmed',
          status: 'confirmed',
          targetUrl: pageUrl,
          evidence: {
            scriptIndex: scriptIndex + 1,
            error: errMsg,
            snippet: scriptContent.slice(0, 150),
          },
          remediation:
            'Ensure the content inside <script type="application/ld+json"> is strictly valid JSON without trailing commas or unescaped characters.',
          references: ['https://json-ld.org/spec/latest/json-ld/'],
        });
        continue;
      }

      // Unpack @graph or top-level arrays
      const rawEntities: Array<Record<string, unknown>> = [];
      let defaultContext: string | undefined;

      if (typeof parsed === 'object' && parsed !== null) {
        const rootObj = parsed as Record<string, unknown>;
        if (typeof rootObj['@context'] === 'string') {
          defaultContext = rootObj['@context'];
        }

        if (Array.isArray(rootObj['@graph'])) {
          for (const item of rootObj['@graph']) {
            if (typeof item === 'object' && item !== null) {
              rawEntities.push(item as Record<string, unknown>);
            }
          }
        } else if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'object' && item !== null) {
              rawEntities.push(item as Record<string, unknown>);
            }
          }
        } else {
          rawEntities.push(rootObj);
        }
      }

      // Validate each entity
      for (const ent of rawEntities) {
        const { entityType, issues } = validateSchemaEntity(ent, defaultContext);

        // Check @id collisions
        const entityId = typeof ent['@id'] === 'string' ? ent['@id'].trim() : null;
        if (entityId) {
          if (seenIds.has(entityId) && seenIds.get(entityId) !== entityType) {
            findings.push({
              ruleId: 'SEO_SCHEMA_DUPLICATE_ID',
              category: 'technical-seo',
              title: `Conflicting @id Assignment for Distinct Schema Entities`,
              description: `The entity identifier "${entityId}" is claimed by both "${seenIds.get(entityId)}" and "${entityType}". In JSON-LD, @id must globally identify a single entity.`,
              severity: 'info',
              confidence: 'confirmed',
              status: 'confirmed',
              targetUrl: pageUrl,
              evidence: { entityId, conflictingTypes: [seenIds.get(entityId), entityType] },
              remediation:
                'Assign distinct URI values to different entities or merge complementary properties into a single entity.',
              references: ['https://www.w3.org/TR/json-ld11/#node-identifiers'],
            });
          } else {
            seenIds.set(entityId, entityType);
          }
        }

        extractedEntities.push({
          type: entityType,
          id: entityId,
          context: (ent['@context'] as string) || defaultContext || null,
          properties: Object.freeze(ent),
          issues: Object.freeze(issues),
        });

        // Translate errors and warnings into findings
        for (const issue of issues) {
          if (issue.severity === 'info') continue;
          findings.push({
            ruleId: issue.ruleId,
            category: 'technical-seo',
            title: `Structured Data Issue: ${issue.message}`,
            description: `On page ${pageUrl}, Schema entity "${entityType}" failed validation: ${issue.message}`,
            severity: issue.severity === 'error' ? 'low' : 'info',
            confidence: 'confirmed',
            status: 'confirmed',
            targetUrl: pageUrl,
            evidence: {
              entityType,
              entityId,
              issuePath: issue.path,
              missingProperties: issue.path ? [issue.path] : [],
              rule: issue.ruleId,
            },
            remediation:
              'Update the structured data payload to satisfy Schema.org Profile v1 specifications.',
            references: [`https://schema.org/${entityType}`],
          });
        }
      }
    }

    return {
      targetUrl: pageUrl,
      scriptBlocksCount: jsonLdScripts.length,
      scriptsFound: jsonLdScripts.length,
      syntaxErrorsCount,
      syntaxErrors: Object.freeze(syntaxErrors),
      entities: Object.freeze(extractedEntities),
      entitiesParsed: extractedEntities.length,
      findings: Object.freeze(findings),
    };
  }

  /**
   * Aggregates structured data results across all crawled pages.
   */
  summarizeSite(
    pageResults: readonly (PageStructuredDataResult | CrawledPageResult)[],
  ): StructuredDataAnalysisResult {
    const resolvedResults: PageStructuredDataResult[] = pageResults.map(item => {
      if ('entities' in item && 'scriptBlocksCount' in item) {
        return item as PageStructuredDataResult;
      }
      return this.analyzePage(item as CrawledPageResult);
    });

    let pagesWithStructuredData = 0;
    let totalEntitiesFound = 0;
    let totalScriptsFound = 0;
    let totalSyntaxErrors = 0;
    const entityCountsByType: Record<string, number> = {};
    const allFindings: AnalyzerFinding[] = [];

    for (const pr of resolvedResults) {
      if (pr.scriptBlocksCount > 0) pagesWithStructuredData++;
      totalScriptsFound += pr.scriptBlocksCount;
      totalSyntaxErrors += pr.syntaxErrorsCount;
      totalEntitiesFound += pr.entities.length;
      allFindings.push(...pr.findings);

      for (const ent of pr.entities) {
        entityCountsByType[ent.type] = (entityCountsByType[ent.type] || 0) + 1;
      }
    }

    const coverage: SeoCoverageReport = {
      engine: 'structured-data',
      executed: true,
      status: 'full',
      itemsEvaluated: resolvedResults.length,
    };

    return {
      pagesWithStructuredData,
      totalEntitiesFound,
      entityCountsByType: Object.freeze(entityCountsByType),
      entityTypeDistribution: Object.freeze(entityCountsByType),
      totalScriptsFound,
      totalSyntaxErrors,
      totalPagesAudited: resolvedResults.length,
      findings: Object.freeze(allFindings),
      coverage,
    };
  }
}

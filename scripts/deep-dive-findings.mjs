import fs from 'node:fs';
import path from 'node:path';

const reportPath = path.join(
  process.env.APPDATA || 'C:\\Users\\Ahmed Hamdy\\AppData\\Roaming',
  'ultimate-wordpress-and-website-auditor',
  'reports',
  'Partial-Audit-Findings---November-9-cad7bc4b.json',
);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const findings = report.findings || [];

console.log('=== SITE-LEVEL VS PAGE-LEVEL ANALYSIS ===\n');

// 1. Check WP_DETECTED
const wpDetected = findings.filter(f => f.ruleId === 'WP_DETECTED');
console.log(`WP_DETECTED: ${wpDetected.length} findings`);
console.log('Sample evidence 0:', JSON.stringify(wpDetected[0].evidence, null, 2));
console.log('Sample evidence 1:', JSON.stringify(wpDetected[1].evidence, null, 2));

// 2. Check SEC_HEADER_CSP_MISSING
const cspMissing = findings.filter(f => f.ruleId === 'SEC_HEADER_CSP_MISSING');
console.log(`\nSEC_HEADER_CSP_MISSING: ${cspMissing.length} findings`);
console.log(
  'All 25 URLs:',
  cspMissing.map(f => f.targetUrl),
);

// 3. Check SEC_HEADER_HSTS_PRELOAD_ELIGIBLE
const hstsPreload = findings.filter(f => f.ruleId === 'SEC_HEADER_HSTS_PRELOAD_ELIGIBLE');
console.log(`\nSEC_HEADER_HSTS_PRELOAD_ELIGIBLE: ${hstsPreload.length} findings`);
console.log('Sample evidence:', hstsPreload[0].evidence);

// 4. Check SEO_BROKEN_INTERNAL_LINK
const brokenLinks = findings.filter(f => f.ruleId === 'SEO_BROKEN_INTERNAL_LINK');
console.log(`\nSEO_BROKEN_INTERNAL_LINK: ${brokenLinks.length} findings`);
for (const bl of brokenLinks) {
  console.log(
    `- On: ${bl.targetUrl} -> Target: ${bl.evidence?.targetUrl || bl.evidence?.href} (Status: ${bl.evidence?.statusCode})`,
  );
}

// 5. Check Cloudflare utility URL findings
const cdnCgiFindings = findings.filter(f => f.targetUrl?.includes('cdn-cgi'));
console.log(`\nFINDINGS ON cdn-cgi URL (${cdnCgiFindings.length} findings):`);
for (const c of cdnCgiFindings) {
  console.log(`- ${c.ruleId} (${c.title}) [${c.severity}]`);
}

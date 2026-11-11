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

console.log(`Analyzing ${findings.length} findings from report...`);

// Group by ruleId
const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
  byRule.get(f.ruleId).push(f);
}

console.log(`\nFound ${byRule.size} distinct rules:\n`);

for (const [ruleId, list] of byRule.entries()) {
  const f = list[0];
  const urls = list.map(item => item.targetUrl);
  const uniqueUrls = new Set(urls);

  console.log(`======================================================================`);
  console.log(`RULE: ${ruleId}`);
  console.log(`Title: ${f.title}`);
  console.log(
    `Category: ${f.category} | Severity: ${f.severity} | Status: ${f.status} | Confidence: ${f.confidence}`,
  );
  console.log(`Count: ${list.length} findings across ${uniqueUrls.size} unique URLs`);

  // Sample evidence
  console.log(`Sample Evidence for ${f.targetUrl}:`);
  console.log(JSON.stringify(f.evidence, null, 2).slice(0, 500));

  // Check if findings under this rule have identical descriptions / evidence
  if (list.length > 1) {
    const sampleDesc = list.map(item => item.description);
    const uniqueDesc = new Set(sampleDesc);
    console.log(`Unique descriptions across occurrences: ${uniqueDesc.size} of ${list.length}`);
  }
}

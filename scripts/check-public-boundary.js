'use strict';

const { execFileSync } = require('node:child_process');

const deleted = new Set(execFileSync('git', ['ls-files', '-z', '--deleted'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, '/')));
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((file) => file.replace(/\\/g, '/'))
  .filter((file) => !deleted.has(file));

const forbidden = [
  { pattern: /(^|\/)fundraising\//i, reason: 'fundraising material belongs in a private repository' },
  { pattern: /(^|\/)(investor|outreach|sales-pipeline)([-_.\/]|$)/i, reason: 'commercial pipeline material is private' },
  { pattern: /(^|\/)(production-setup|partner-application-setup|pricing-tiers|redesign_notes|frontend-freeze|website-layout)\.md$/i, reason: 'internal planning or operations documents are private' },
  { pattern: /(^|\/)(customer|customers|partner-deliverables)\//i, reason: 'customer and partner deliverables are private' },
  { pattern: /(^|\/)(incident|production|deploy)([-_.].*)?\.(log|txt|json)$/i, reason: 'runtime and incident artifacts are private' },
  { pattern: /\.(pem|key|p12|pfx)$/i, reason: 'private key material must never be tracked' },
];

const violations = [];
for (const file of files) {
  if (file === '.env.example') continue;
  if (/^\.env($|\.)/.test(file)) violations.push(`${file}: environment files are private`);
  for (const rule of forbidden) if (rule.pattern.test(file)) violations.push(`${file}: ${rule.reason}`);
}

if (violations.length) {
  console.error('Public repository boundary violations:\n' + violations.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log(`Public repository boundary passed for ${files.length} tracked files.`);

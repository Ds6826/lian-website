const test = require('node:test');
const assert = require('node:assert/strict');
const { createPartnerApplicationService, highFitApplication, validateApplication } = require('../partner-applications');

const valid = {
  work_email: 'buyer@example.com',
  company: 'Example Capital',
  role: 'VP Engineering',
  company_website: 'https://example.com',
  agent_workflow: 'Research agent',
  changing_facts: 'Filings and policies',
  audit_requirement: 'Reproduce prior answers',
  current_stage: 'Pilot',
  preferred_track: 'Implementation',
  deployment_requirement: 'Private cloud',
};

test('partner application validation accepts a complete application', () => {
  assert.deepEqual(validateApplication(valid), { ok: true });
});

test('partner application validation reports missing fields', () => {
  const result = validateApplication({ ...valid, work_email: '', company: '' });
  assert.equal(result.error, 'Complete every required field.');
  assert.deepEqual(result.missing, ['work_email', 'company']);
});

test('partner application validation rejects an invalid email', () => {
  assert.equal(validateApplication({ ...valid, work_email: 'not-an-email' }).error, 'Enter a valid work email.');
});

test('partner application validation rejects unsafe URLs and invented options', () => {
  assert.equal(validateApplication({ ...valid, company_website: 'javascript:alert(1)' }).error, 'Enter a valid company website.');
  assert.equal(validateApplication({ ...valid, current_stage: 'Anything' }).error, 'Choose one of the available application options.');
});

test('partner application validation restricts uploads by type and encoded size', () => {
  assert.equal(validateApplication({ ...valid, architecture_file: { name: 'payload.svg', type: 'image/svg+xml', data_url: 'data:image/svg+xml;base64,PHN2Zz4=' } }).error, 'The optional upload type is not supported.');
  assert.equal(validateApplication({ ...valid, architecture_file: { name: 'notes.txt', type: 'text/plain', data_url: `data:text/plain;base64,${'eA=='.repeat(70_000)}` } }).error, 'The optional upload is too large.');
});

test('high-fit logic only books implementation-ready applicants', () => {
  assert.equal(highFitApplication(valid), true);
  assert.equal(highFitApplication({ ...valid, current_stage: 'Prototype' }), false);
  assert.equal(highFitApplication({ ...valid, preferred_track: 'Evaluation' }), false);
});

test('database capture remains available when email delivery is not configured', async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join('?'));
    return [];
  };
  const service = createPartnerApplicationService({ env: {}, sql });

  assert.equal(service.configured(), true);
  assert.equal(service.emailConfigured(), false);
  const result = await service.submit(valid, '7ff33278-bffa-4ec0-9db8-06595bf1b0aa');

  assert.equal(result.notificationStatus, 'not_configured');
  assert.equal(result.highFit, true);
  assert.equal(statements.some((statement) => statement.includes('INSERT INTO partner_applications')), true);
  assert.equal(statements.some((statement) => statement.includes("status = 'stored'")), true);
});

test('email failure is recorded without discarding an accepted application', async () => {
  const statements = [];
  const sql = async (strings) => {
    statements.push(strings.join('?'));
    return [];
  };
  const service = createPartnerApplicationService({
    env: {},
    sql,
    sendEmail: async () => { throw new Error('mail unavailable'); },
  });

  const result = await service.submit(valid, '66b08a2d-cacf-48e5-b4a3-33992b17363d');

  assert.equal(result.notificationStatus, 'failed');
  assert.equal(statements.some((statement) => statement.includes("status = 'email_failed'")), true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { highFitApplication, validateApplication } = require('../partner-applications');

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

test('high-fit logic only books implementation-ready applicants', () => {
  assert.equal(highFitApplication(valid), true);
  assert.equal(highFitApplication({ ...valid, current_stage: 'Prototype' }), false);
  assert.equal(highFitApplication({ ...valid, preferred_track: 'Evaluation' }), false);
});


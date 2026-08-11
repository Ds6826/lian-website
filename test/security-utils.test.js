'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MAX_AUTHORIZATION_HEADER_LENGTH, parseBearerToken } = require('../security-utils');

test('parseBearerToken accepts a bounded JWT-style bearer token', () => {
  assert.equal(parseBearerToken('Bearer abc.DEF_123-xyz.signature'), 'abc.DEF_123-xyz.signature');
  assert.equal(parseBearerToken('bearer token'), 'token');
});

test('parseBearerToken rejects malformed and oversized authorization values', () => {
  for (const value of [null, [], '', 'Basic token', 'Bearer', 'Bearer  token', 'Bearer token!', `Bearer ${'a'.repeat(MAX_AUTHORIZATION_HEADER_LENGTH)}`]) {
    assert.equal(parseBearerToken(value), null);
  }
});

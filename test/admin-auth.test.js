'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, PERMISSIONS, hasPermission, canManageTarget } = require('../admin-auth');

const actor = (role, id = 'a') => ({ id, role, accountStatus: 'ACTIVE' });
test('role permissions follow least privilege', () => {
  assert.equal(hasPermission(ROLES.OWNER, PERMISSIONS.ROLE_MANAGE), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.USER_STATUS_WRITE), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.ROLE_MANAGE), false);
  assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.SYSTEM_READ), true);
  assert.equal(hasPermission(ROLES.DEVELOPER, PERMISSIONS.API_KEY_REVOKE), false);
  assert.equal(hasPermission(ROLES.MEMBER, PERMISSIONS.AUDIT_READ), false);
});
test('target rules prevent self-promotion and protect owners', () => {
  assert.equal(canManageTarget({ actor: actor(ROLES.OWNER), target: actor(ROLES.MEMBER, 'a'), operation: 'role', nextRole: ROLES.ADMIN }), false);
  assert.equal(canManageTarget({ actor: actor(ROLES.ADMIN), target: actor(ROLES.OWNER, 'o'), operation: 'status' }), false);
  assert.equal(canManageTarget({ actor: actor(ROLES.ADMIN), target: actor(ROLES.MEMBER, 'm'), operation: 'status' }), true);
  assert.equal(canManageTarget({ actor: actor(ROLES.DEVELOPER), target: actor(ROLES.MEMBER, 'm'), operation: 'status' }), false);
});

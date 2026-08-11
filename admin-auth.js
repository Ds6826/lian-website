'use strict';

const ROLES = Object.freeze({ OWNER: 'OWNER', ADMIN: 'ADMIN', DEVELOPER: 'DEVELOPER', MEMBER: 'MEMBER' });
const PERMISSIONS = Object.freeze({
  USER_READ: 'user:read', USER_STATUS_WRITE: 'user:status_write', ROLE_MANAGE: 'role:manage',
  API_KEY_READ: 'api_key:read', API_KEY_REVOKE: 'api_key:revoke', AUDIT_READ: 'audit:read',
  SYSTEM_READ: 'system:read', OPERATIONAL_READ: 'operational:read',
  FLAG_READ: 'flag:read', FLAG_WRITE: 'flag:write', USAGE_READ: 'usage:read', ERROR_READ: 'error:read',
  NOTE_READ: 'note:read', NOTE_WRITE: 'note:write', TAG_READ: 'tag:read', TAG_WRITE: 'tag:write',
  SUPPORT_READ: 'support:read', ENVIRONMENT_READ: 'environment:read', BUILD_READ: 'build:read',
  RATE_LIMIT_READ: 'rate_limit:read', RATE_LIMIT_WRITE: 'rate_limit:write',
});
const ROLE_PERMISSIONS = Object.freeze({
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set([PERMISSIONS.USER_READ, PERMISSIONS.USER_STATUS_WRITE, PERMISSIONS.API_KEY_READ, PERMISSIONS.API_KEY_REVOKE, PERMISSIONS.AUDIT_READ, PERMISSIONS.SYSTEM_READ, PERMISSIONS.OPERATIONAL_READ, PERMISSIONS.FLAG_READ, PERMISSIONS.FLAG_WRITE, PERMISSIONS.USAGE_READ, PERMISSIONS.ERROR_READ, PERMISSIONS.NOTE_READ, PERMISSIONS.NOTE_WRITE, PERMISSIONS.TAG_READ, PERMISSIONS.TAG_WRITE, PERMISSIONS.SUPPORT_READ, PERMISSIONS.ENVIRONMENT_READ, PERMISSIONS.BUILD_READ, PERMISSIONS.RATE_LIMIT_READ, PERMISSIONS.RATE_LIMIT_WRITE]),
  DEVELOPER: new Set([PERMISSIONS.AUDIT_READ, PERMISSIONS.SYSTEM_READ, PERMISSIONS.OPERATIONAL_READ, PERMISSIONS.FLAG_READ, PERMISSIONS.USAGE_READ, PERMISSIONS.ERROR_READ, PERMISSIONS.SUPPORT_READ, PERMISSIONS.ENVIRONMENT_READ, PERMISSIONS.BUILD_READ]),
  MEMBER: new Set(),
});

const hasPermission = (role, permission) => Boolean(ROLE_PERMISSIONS[role]?.has(permission));
const resolveFeatureFlag = ({ globalEnabled, internalOnly, overrideEnabled }, internalUser = false) => {
  if (internalOnly && !internalUser) return false;
  return overrideEnabled ?? globalEnabled;
};
const canManageTarget = ({ actor, target, operation, nextRole }) => {
  if (!actor || !target || actor.accountStatus !== 'ACTIVE') return false;
  if (actor.id === target.id && operation === 'role') return false;
  if (actor.role === ROLES.OWNER) {
    if (operation === 'role' && nextRole === ROLES.OWNER && target.role !== ROLES.OWNER) return false;
    return true;
  }
  if (actor.role !== ROLES.ADMIN) return false;
  if (target.role !== ROLES.MEMBER) return false;
  return operation === 'status';
};

module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS, hasPermission, canManageTarget, resolveFeatureFlag };

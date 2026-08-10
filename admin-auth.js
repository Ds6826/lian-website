'use strict';

const ROLES = Object.freeze({ OWNER: 'OWNER', ADMIN: 'ADMIN', DEVELOPER: 'DEVELOPER', MEMBER: 'MEMBER' });
const PERMISSIONS = Object.freeze({
  USER_READ: 'user:read', USER_STATUS_WRITE: 'user:status_write', ROLE_MANAGE: 'role:manage',
  API_KEY_READ: 'api_key:read', API_KEY_REVOKE: 'api_key:revoke', AUDIT_READ: 'audit:read',
  SYSTEM_READ: 'system:read', OPERATIONAL_READ: 'operational:read',
});
const ROLE_PERMISSIONS = Object.freeze({
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set([PERMISSIONS.USER_READ, PERMISSIONS.USER_STATUS_WRITE, PERMISSIONS.API_KEY_READ, PERMISSIONS.API_KEY_REVOKE, PERMISSIONS.AUDIT_READ, PERMISSIONS.SYSTEM_READ, PERMISSIONS.OPERATIONAL_READ]),
  DEVELOPER: new Set([PERMISSIONS.AUDIT_READ, PERMISSIONS.SYSTEM_READ, PERMISSIONS.OPERATIONAL_READ]),
  MEMBER: new Set(),
});

const hasPermission = (role, permission) => Boolean(ROLE_PERMISSIONS[role]?.has(permission));
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

module.exports = { ROLES, PERMISSIONS, ROLE_PERMISSIONS, hasPermission, canManageTarget };

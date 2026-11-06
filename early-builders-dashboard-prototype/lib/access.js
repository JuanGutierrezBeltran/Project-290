'use strict';

// Role registry and server-side projection of the dashboard payload.
// Everything is ALLOWLIST based: a field that is not listed here never
// leaves the server, so new PII columns from real connectors stay hidden
// until someone deliberately grants them to a role.

const Core = require('../public/dashboard-core.js');

const ROLES = Object.freeze({
  admin: Object.freeze({ label: 'Admin', recordAccess: 'full' }),
  program_manager: Object.freeze({ label: 'Program Manager', recordAccess: 'full' }),
  research: Object.freeze({ label: 'Research', recordAccess: 'pseudonymous' }),
  executive: Object.freeze({ label: 'Executive', recordAccess: 'none' }),
  marketing: Object.freeze({ label: 'Marketing', recordAccess: 'none', channels: true }),
});

const FULL_RECORD_FIELDS = Object.freeze([
  'id', 'email', 'profile', 'city', 'refKey', 'channel', 'stage',
  'invitedAt', 'signedUpAt', 'creditsGrantedAt', 'credits', 'lastSignIn',
  'signIns', 'projects', 'creditsUsed', 'contentUrl', 'contentAt',
]);
const PSEUDONYMOUS_RECORD_FIELDS = Object.freeze(FULL_RECORD_FIELDS.filter((f) => f !== 'email' && f !== 'city'));
const PROGRAM_FIELDS = Object.freeze(['name', 'signupTarget', 'accountCapacity', 'ceoTarget', 'country']);
const FUNNEL_FIELDS = Object.freeze(['key', 'label', 'value']);
const SOURCE_FIELDS = Object.freeze(['name', 'purpose', 'state', 'method', 'lastSync', 'needs']);

function pick(source, fields) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
  }
  return out;
}

function getRole(id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(ROLES, id)) return null;
  return ROLES[id];
}

function listRoles() {
  return Object.keys(ROLES).map((id) => ({ id, label: ROLES[id].label }));
}

function projectDashboard(data, roleId) {
  const role = getRole(roleId);
  if (!role) throw new Error(`Unknown role: ${roleId}`);
  const builders = Array.isArray(data.builders) ? data.builders : [];

  const out = {
    mode: data.mode,
    snapshotAt: data.snapshotAt,
    program: pick(data.program, PROGRAM_FIELDS),
    funnel: (Array.isArray(data.funnel) ? data.funnel : []).map((step) => pick(step, FUNNEL_FIELDS)),
    sources: (Array.isArray(data.sources) ? data.sources : []).map((s) => pick(s, SOURCE_FIELDS)),
    summary: Core.summarizeBuilders(builders, data.snapshotAt),
    access: { role: roleId, label: role.label, recordAccess: role.recordAccess },
  };

  if (role.recordAccess === 'full') {
    out.builders = builders.map((b) => pick(b, FULL_RECORD_FIELDS));
  } else if (role.recordAccess === 'pseudonymous') {
    out.builders = builders.map((b) => pick(b, PSEUDONYMOUS_RECORD_FIELDS));
  } else {
    out.restricted = true;
    if (role.channels) out.channels = Core.channelBreakdown(builders);
  }
  return out;
}

module.exports = { ROLES, FULL_RECORD_FIELDS, PSEUDONYMOUS_RECORD_FIELDS, getRole, listRoles, projectDashboard };

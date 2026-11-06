'use strict';

// Role registry and server-side projection of the dashboard payload.
// Everything is ALLOWLIST based: a field that is not listed here never
// leaves the server, so new PII columns from real connectors stay hidden
// until someone deliberately grants them to a role.
//
// Each role also carries a VIEW allowlist. The browser hides navigation for
// views a role cannot open, but the real control is here: data that only a
// withheld view needs (e.g. data sources) is not sent at all.

const Core = require('../public/dashboard-core.js');

const ALL_VIEWS = Object.freeze(['overview', 'builders', 'invitations', 'sources']);

// editContent: may record a builder's published content (POST api/builders/:code/content).
const ROLES = Object.freeze({
  admin: Object.freeze({ label: 'Admin', recordAccess: 'full', views: ALL_VIEWS, editContent: true }),
  program_manager: Object.freeze({ label: 'Program Manager', recordAccess: 'full', views: ALL_VIEWS, editContent: true }),
  research: Object.freeze({ label: 'Research', recordAccess: 'pseudonymous', views: ALL_VIEWS, editContent: false }),
  executive: Object.freeze({ label: 'Executive', recordAccess: 'none', views: Object.freeze(['overview']), editContent: false }),
  marketing: Object.freeze({ label: 'Marketing', recordAccess: 'none', views: Object.freeze(['overview', 'invitations']), editContent: false }),
});

const FULL_RECORD_FIELDS = Object.freeze([
  'id', 'email', 'profile', 'city', 'refKey', 'channel', 'stage',
  'invitedAt', 'signedUpAt', 'creditsGrantedAt', 'credits', 'lastSignIn',
  'signIns', 'projects', 'creditsUsed', 'contentUrl', 'contentAt', 'contentPlatform',
]);
const PSEUDONYMOUS_RECORD_FIELDS = Object.freeze(FULL_RECORD_FIELDS.filter((f) => f !== 'email' && f !== 'city'));
const PROGRAM_FIELDS = Object.freeze(['name', 'signupTarget', 'accountCapacity', 'ceoTarget', 'country']);
const FUNNEL_FIELDS = Object.freeze(['key', 'label', 'value', 'source', 'base', 'baseValue', 'pending']);
// Invitation states (HubSpot marketing emails): aggregate counts only.
const INVITATION_FIELDS = Object.freeze(['available', 'reason', 'invited', 'sent', 'delivered', 'opened', 'replied', 'closed', 'accepted', 'enrolled']);
const TRACKING_FIELDS = Object.freeze(['emailHash', 'creditsEvent', 'creditsEventName']);
const SOURCE_FIELDS = Object.freeze(['name', 'purpose', 'state', 'method', 'lastSync', 'needs']);
// Landing channels (HubSpot sessions and contacts per traffic source): aggregates only.
const CHANNEL_FIELDS = Object.freeze(['channel', 'sessions', 'contacts']);

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

function canView(roleId, view) {
  const role = getRole(roleId);
  return Boolean(role) && role.views.includes(view);
}

function canEditContent(roleId) {
  const role = getRole(roleId);
  return Boolean(role) && role.editContent === true;
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
    summary: Core.summarizeBuilders(builders, data.snapshotAt),
    tracking: pick(data.tracking, TRACKING_FIELDS),
    access: { role: roleId, label: role.label, recordAccess: role.recordAccess, views: [...role.views], canEditContent: role.editContent === true },
  };

  if (role.views.includes('sources')) {
    out.sources = (Array.isArray(data.sources) ? data.sources : []).map((s) => pick(s, SOURCE_FIELDS));
  }
  if (role.views.includes('invitations')) {
    out.channels = (Array.isArray(data.channels) ? data.channels : []).map((c) => pick(c, CHANNEL_FIELDS));
    out.invitations = pick(data.invitations, INVITATION_FIELDS);
  }

  if (role.recordAccess === 'full') {
    out.builders = builders.map((b) => pick(b, FULL_RECORD_FIELDS));
  } else if (role.recordAccess === 'pseudonymous') {
    out.builders = builders.map((b) => pick(b, PSEUDONYMOUS_RECORD_FIELDS));
  } else {
    out.restricted = true;
  }
  return out;
}

module.exports = {
  ROLES,
  ALL_VIEWS,
  FULL_RECORD_FIELDS,
  PSEUDONYMOUS_RECORD_FIELDS,
  CHANNEL_FIELDS,
  INVITATION_FIELDS,
  getRole,
  listRoles,
  canView,
  canEditContent,
  projectDashboard,
};

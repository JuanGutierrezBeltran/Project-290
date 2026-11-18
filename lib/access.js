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
  'id', 'recordId', 'email', 'profile', 'city', 'refKey', 'channel', 'channelKey', 'origin',
  'plan', 'planName', 'subscriptionStatus', 'stage',
  'invitedAt', 'signedUpAt', 'verifiedAt', 'dnSignupAt', 'creditsGrantedAt', 'credits', 'creditsPending',
  'lastSignIn', 'lastCreditUsedAt', 'signIns', 'projects', 'activeDays', 'creditsUsed',
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
    referral: Core.referralSteps(data.invitations).map((step) => pick(step, FUNNEL_FIELDS)),
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

  out.members = memberPayload(data.members, builders);
  out.signupDays = dayPayload(Array.isArray(data.signupDays) ? data.signupDays : Core.signupDays(builders, data.snapshotAt));
  out.signupChannels = channelPayload(Array.isArray(data.signupChannels) ? data.signupChannels : Core.signupChannels(builders));
  out.utm = utmPayload(data.utm);

  if (role.recordAccess === 'full') {
    out.builders = builders.map((b) => pick(b, FULL_RECORD_FIELDS));
  } else if (role.recordAccess === 'pseudonymous') {
    out.builders = builders.map((b) => pick(b, PSEUDONYMOUS_RECORD_FIELDS));
  } else {
    out.restricted = true;
  }
  return out;
}

function memberPayload(members, builders) {
  const src = members && typeof members === 'object' ? members : Core.memberCards(builders);
  return {
    signedUp: Number(src.signedUp) || 0,
    verified: Number(src.verified) || 0,
    notOnBuilderList: Number(src.notOnBuilderList) || 0,
    paidMedia: Number(src.paidMedia) || 0,
  };
}

function dayPayload(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row && row.date || ''))).map((row) => ({
    date: String(row.date),
    count: Number(row.count) || 0,
  }));
}

function channelPayload(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    key: String(row && row.key || ''),
    label: String(row && row.label || ''),
    count: Number(row && row.count) || 0,
  })).filter((row) => row.key && row.count > 0);
}

function utmPayload(utm) {
  const src = utm && typeof utm === 'object' ? utm : { available: false, reason: 'not_synced', rows: [] };
  const rows = (Array.isArray(src.rows) ? src.rows : []).map((row) => ({
    source: String(row && row.source || ''),
    medium: String(row && row.medium || ''),
    campaign: String(row && row.campaign || ''),
    sessions: Number(row && row.sessions) || 0,
  })).filter((row) => row.sessions > 0);
  return { available: src.available === true && rows.length > 0, reason: String(src.reason || ''), rows };
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

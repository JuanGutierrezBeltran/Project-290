'use strict';

// Official campaign links of the Early Builders program (landing go.think4ever.com/developer-network-co).
// A visit belongs to a link when utm_source + utm_medium + utm_campaign match (case-insensitive).
// Pauta Gmail and LinkedIn paid share utm_campaign, so source + medium tell them apart.
// utm_content is reported as the "piece" (ad or message) and is not required to match, so a new
// piece of the same link keeps counting in its channel.
//   Referidos     equipo   / referral    / developer-network
//   Pauta Gmail   google   / cpc         / early_builders_co_202611   (gmail_promo_01)
//   LinkedIn paid linkedin / paid_social / early_builders_co_202611   (sponsored_msg_01)
// The Developer Network emails sent from HubSpot (hs_email, hs_automation, or hubspot with medium email)
// also count as Referidos, as in the LATAM Growth dashboard (decided on 2026-11-17).
// Each builder's own referral link (any network / influencer / early_builders_co_202611, utm_content = the
// builder's public user) is its own channel, Influencers.
// Anything else with a UTM is "Otros UTM"; no UTM is "Sin UTM"; qa/test/prueba values are
// "Pruebas" and stay out of the program totals.

const CAMPAIGNS = Object.freeze([
  Object.freeze({ key: 'referral', label: 'Referidos', source: 'equipo', medium: 'referral', campaign: 'developer-network', content: '' }),
  Object.freeze({ key: 'gmail', label: 'Pauta Gmail', source: 'google', medium: 'cpc', campaign: 'early_builders_co_202611', content: 'gmail_promo_01' }),
  Object.freeze({ key: 'linkedin', label: 'LinkedIn paid', source: 'linkedin', medium: 'paid_social', campaign: 'early_builders_co_202611', content: 'sponsored_msg_01' }),
]);
const DN_EMAIL_SOURCES = new Set(['hs_email', 'hs_automation', 'hubspot']);
const PROGRAM_CAMPAIGN = 'early_builders_co_202611';
const EXTRA_LABELS = Object.freeze({ influencer: 'Influencers', other: 'Otros UTM', none: 'Sin UTM', test: 'Pruebas' });
const CHANNEL_ORDER = Object.freeze(['referral', 'gmail', 'linkedin', 'influencer', 'other', 'none', 'test']);
const CHANNEL_LABELS = Object.freeze(Object.assign({}, ...CAMPAIGNS.map((c) => ({ [c.key]: c.label })), EXTRA_LABELS));

const EMPTY = new Set(['', '(not set)', '(none)', 'null', 'undefined']);
const TEST_RE = /(^|[^a-z])(qa|test|tests|testing|prueba|pruebas)([^a-z]|$)/;

function norm(value) {
  const s = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return EMPTY.has(s) ? '' : s;
}

function clean(value) {
  return norm(value) ? String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';
}

// Reads utm_* (or first_utm_* with prefix 'first_') from an attributes object.
function utmFrom(attrs, prefix = '') {
  const a = attrs && typeof attrs === 'object' ? attrs : {};
  const p = prefix || '';
  return {
    source: a[`${p}utm_source`], medium: a[`${p}utm_medium`], campaign: a[`${p}utm_campaign`],
    content: a[`${p}utm_content`], term: a[`${p}utm_term`],
  };
}

function hasUtm(utm) {
  return Boolean(utm && (norm(utm.source) || norm(utm.medium) || norm(utm.campaign)));
}

// Returns { key, label, piece }. key is one of CHANNEL_ORDER.
function classify(utm) {
  const u = utm && typeof utm === 'object' ? utm : {};
  const source = norm(u.source);
  const medium = norm(u.medium);
  const campaign = norm(u.campaign);
  const content = norm(u.content);
  const piece = clean(u.content);
  if (!source && !medium && !campaign) return { key: 'none', label: CHANNEL_LABELS.none, piece: '' };
  if ([source, medium, campaign, content].some((v) => TEST_RE.test(v))) return { key: 'test', label: CHANNEL_LABELS.test, piece };
  const hit = CAMPAIGNS.find((c) => c.source === source && c.medium === medium && c.campaign === campaign);
  if (hit) return { key: hit.key, label: hit.label, piece };
  if (medium === 'email' && DN_EMAIL_SOURCES.has(source)) return { key: 'referral', label: CHANNEL_LABELS.referral, piece };
  if (medium === 'influencer' && campaign === PROGRAM_CAMPAIGN) return { key: 'influencer', label: CHANNEL_LABELS.influencer, piece };
  return { key: 'other', label: CHANNEL_LABELS.other, piece };
}

module.exports = { CAMPAIGNS, CHANNEL_ORDER, CHANNEL_LABELS, classify, utmFrom, hasUtm };

'use strict';
// Catalog of the data sources this dashboard connects to: HubSpot, GA4 and PostHog, plus
// Google Tag Manager as a documented reference (it has no data or connection of its own).
// `state` is only the initial value. The live state (Conectado / Pendiente / Error) and the
// last sync are kept in the data_sources table by lib/sync.js.
// `dashboard` is the row shown on the Data sources screen (Spanish UI): `name` matches
// data_sources.name, and `needs` lists only the REQUIRED variable names, never values.

module.exports = [
  {
    key: 'hubspot', name: 'HubSpot', area: 'Landing and CRM',
    provides: 'Landing sessions by source and day, contact attribution (UTM when configured), countries, pages, form entries and contacts, and invitation states per recipient from the marketing emails listed in HUBSPOT_INVITE_EMAIL_IDS',
    env: ['HUBSPOT_TOKEN', 'HUBSPOT_UTM_PROPERTIES', 'HUBSPOT_INVITE_EMAIL_IDS', 'EMAIL_HASH_KEY'],
    connect: 'Private app token with the scopes crm.objects.contacts.read, forms, business-intelligence and content (invitation emails), saved as the service variable HUBSPOT_TOKEN. HUBSPOT_INVITE_EMAIL_IDS = comma-separated marketing email ids used as invitations. EMAIL_HASH_KEY = secret for the HMAC email match (no email is stored).',
    state: 'pending', note: 'Pending until HUBSPOT_TOKEN is set on the service.',
    dashboard: {
      name: 'HubSpot',
      purpose: 'Sesiones de la landing por fuente, altas del formulario, atribución de contactos y estados de invitación',
      method: 'API de lectura (sincronización automática)',
      needs: 'HUBSPOT_TOKEN',
    },
  },
  {
    key: 'ga4', name: 'Google Analytics 4', area: 'Landing behaviour',
    provides: 'Users, engaged sessions, UTM campaign/piece, landing page, city, channels and landing events: form_start, sign_up, login, generate_lead',
    env: ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT'],
    connect: 'Service account with Viewer access on the property; save the property id as GA4_PROPERTY_ID and the key JSON as GA4_SERVICE_ACCOUNT.',
    state: 'pending', note: 'Pending until GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT are set on the service.',
    dashboard: {
      name: 'GA4',
      purpose: 'Usuarios, sesiones, canales, países, eventos y UTM de la landing',
      method: 'Data API con cuenta de servicio (sincronización automática)',
      needs: 'GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT',
    },
  },
  {
    key: 'gtm', name: 'Google Tag Manager', area: 'Event definitions',
    provides: 'Defines the landing events that Google Analytics records (sign-up, log-in, form start)',
    env: [],
    connect: 'No data of its own: it feeds Google Analytics. Listed so every event in this dashboard has a documented origin.',
    state: 'pending', note: 'Reference only: never synced.',
    reference: true,
    dashboard: null,
  },
  {
    key: 'posthog', name: 'PostHog', area: 'Platform',
    provides: 'Registration started, account created and account verified (first event per person; the 200 sign-up target counts account_verified), the builder roster per verified person (projects, signed_in, credits when POSTHOG_CREDITS_EVENT arrives), and last reported plan events when configured',
    env: ['POSTHOG_HOST', 'POSTHOG_PROJECT_ID', 'POSTHOG_API_KEY', 'POSTHOG_ACTIVATION_ACTION_ID', 'POSTHOG_PROJECT_CREATED_EVENT', 'POSTHOG_CREDITS_EVENT', 'POSTHOG_PLAN_PROPERTY', 'POSTHOG_EXECUTIVE_HOSTS', 'INTERNAL_DOMAINS', 'INTERNAL_COMPANIES', 'EMAIL_HASH_KEY'],
    connect: 'Personal API key with insight:read and query:read scopes for POSTHOG_PROJECT_ID, saved as POSTHOG_API_KEY, with POSTHOG_HOST. POSTHOG_PLAN_PROPERTY must be the exact event property carrying plan on signed_in/plan_changed. Configure POSTHOG_EXECUTIVE_HOSTS, INTERNAL_DOMAINS and INTERNAL_COMPANIES or use their defaults; exclude test accounts. Plan events identify only people reporting a plan, not all accounts or authoritative billing status.',
    state: 'pending', note: 'PostHog access confirmed on 13 Oct. Plan counts use the latest signed_in/plan_changed event and remain a reported-plan proxy until Billing/Product validates current status and trial/cancel/expiry handling.',
    dashboard: {
      name: 'PostHog',
      purpose: 'Inicio de registro, cuentas creadas y verificadas (meta de 200), builders por persona, eventos y UTM de primer toque',
      method: 'API de consulta HogQL (sincronización automática)',
      needs: 'POSTHOG_HOST + POSTHOG_PROJECT_ID + POSTHOG_API_KEY',
    },
  },
];

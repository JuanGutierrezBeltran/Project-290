
-- Early Builders Dashboard: seed data (recorded copy).
-- Only the program targets and the three real sources. There are no sample rows:
-- builders stay empty until the builder-portal source is connected, and the funnel,
-- channels and cut-off time are computed from what lib/sync.js stores for HubSpot,
-- GA4 and PostHog (source_metrics, source_events, sync_runs).
-- snapshot_at is not used by the dashboard: the cut-off is the last successful sync.

INSERT INTO programs (id, name, signup_target, account_capacity, ceo_target, country, `mode`, snapshot_at) VALUES (1, 'Early Builders / Developer Network', 200, 300, NULL, 'Colombia', 'live', '');

INSERT INTO data_sources (program_id, name, purpose, state, method, last_sync, needs, sort_order) VALUES
(1, 'HubSpot', 'Sesiones de la landing por fuente, altas del formulario y atribución de contactos', 'Pendiente', 'API de lectura (sincronización automática)', NULL, 'HUBSPOT_TOKEN', 1),
(1, 'PostHog', 'Cuentas creadas, registros, usuarios activos, eventos y UTM de primer toque', 'Pendiente', 'API de consulta HogQL (sincronización automática)', NULL, 'POSTHOG_HOST + POSTHOG_PROJECT_ID + POSTHOG_API_KEY', 2),
(1, 'GA4', 'Usuarios, sesiones, canales, países, eventos y UTM de la landing', 'Pendiente', 'Data API con cuenta de servicio (sincronización automática)', NULL, 'GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT', 6);

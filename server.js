'use strict';

// Thin entry point: read env config, build the request handler, listen on
// HOST:PORT. All routing, auth and access rules live in lib/.
//
// Platform-ready: PORT/HOST come from the environment (a hosted Node service
// such as Think injects PORT), `npm start` runs this file from the project
// root, and TRUST_PROXY=1 opts in to honouring X-Forwarded-* headers from the
// platform proxy. ACCESS_PASSWORD turns on the shared-password login
// (DEMO_PASSWORD is still read as a fallback so existing settings keep working).
// Dashboard data is read from MySQL using the injected DB_* variables; the
// server refuses to start if any of them is missing (no localhost fallback).
// HubSpot, GA4 and PostHog are synced into MySQL in the background (lib/sync.js)
// every SYNC_INTERVAL_HOURS; a source without its variables is simply skipped.

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { createApp } = require('./lib/app');
const { MIN_PASSWORD_LENGTH } = require('./lib/password-auth');
const { readDbConfig, createPool } = require('./lib/db');
const { createDashboardLoader, createContentSaver } = require('./lib/dashboard-repo');
const { connectors, configured, REQUIRED } = require('./lib/connectors');
const { createSync, startScheduler, syncIntervalMs, describeSources, INITIAL_DELAY_MS } = require('./lib/sync');

const MIN_SECRET_LENGTH = 32;
const SHUTDOWN_TIMEOUT_MS = 10000;

// PORT is always injected by the hosting runtime (Think assigns it). There is
// deliberately no fallback: a missing PORT is a misconfiguration and must fail
// loudly instead of silently listening somewhere the proxy cannot reach.
function parsePort(value) {
  if (value === undefined || value === '') {
    throw new Error('PORT is not set. The hosting runtime injects it; for a local run set it explicitly (e.g. PORT=3016 npm run dev).');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535 (got "${value}").`);
  }
  return port;
}

// Scope the session cookie to the public URL prefix the app is served under
// (BASE_PATH, e.g. /run/290) so it is never sent to the rest of the platform
// domain. Falls back to "/" when BASE_PATH is unset (local runs, tests).
function cookiePathFrom(basePath) {
  if (basePath === undefined || basePath === '' || basePath === '/') return '/';
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(basePath)) {
    throw new Error(`BASE_PATH must be a URL path starting with "/" (got "${basePath}").`);
  }
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
}

function readConfig(env = process.env) {
  const devLogin = env.AUTH_DEV_LOGIN === '1';
  const passwordVar = env.ACCESS_PASSWORD ? 'ACCESS_PASSWORD' : 'DEMO_PASSWORD';
  const accessPassword = env.ACCESS_PASSWORD || env.DEMO_PASSWORD || '';
  let sessionSecret = env.SESSION_SECRET || '';
  let ephemeralSecret = false;

  if (sessionSecret && sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`);
  }
  if (accessPassword && accessPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${passwordVar} must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  if (!sessionSecret && (devLogin || accessPassword)) {
    // Temporary secret: sessions end when the process restarts. Only used when
    // dev login or password login is explicitly enabled.
    sessionSecret = crypto.randomBytes(32).toString('hex');
    ephemeralSecret = true;
  }

  // Hosted services must accept connections from the platform proxy, so the
  // default bind is all interfaces. Dev login keeps the loopback default
  // unless HOST is set explicitly.
  const host = env.HOST || (devLogin ? '127.0.0.1' : '0.0.0.0');

  const ttlHours = Number(env.SESSION_TTL_HOURS || 8);
  return {
    port: parsePort(env.PORT),
    host,
    cookiePath: cookiePathFrom(env.BASE_PATH),
    trustProxy: env.TRUST_PROXY === '1',
    sessionSecret,
    ephemeralSecret,
    devLogin,
    passwordLogin: Boolean(accessPassword),
    accessPassword,
    sessionTtlSeconds: Math.round((Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 8) * 3600),
    secureCookies: env.COOKIE_SECURE === '1',
  };
}

function syncLog(level, message) {
  (level === 'error' ? process.stderr : process.stdout).write(`${message}\n`);
}

function displayUrl(host, port) {
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return `http://${shown.includes(':') ? `[${shown}]` : shown}:${port}`;
}

function main() {
  let config;
  let dbConfig;
  let syncInterval;
  try {
    config = readConfig();
    dbConfig = readDbConfig();
    syncInterval = syncIntervalMs(process.env.SYNC_INTERVAL_HOURS);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const pool = createPool(dbConfig);
  const sync = createSync({ pool, connectors, configured, log: syncLog });
  let scheduler = null;

  const app = createApp({
    publicDir: path.join(__dirname, 'public'),
    loadDashboard: createDashboardLoader(pool),
    saveContent: createContentSaver(pool),
    onError: (err) => process.stderr.write(`Dashboard data load failed: ${(err && (err.code || err.message)) || 'unknown error'}\n`),
    sessionSecret: config.sessionSecret,
    sessionTtlSeconds: config.sessionTtlSeconds,
    devLogin: config.devLogin,
    accessPassword: config.accessPassword,
    secureCookies: config.secureCookies,
    trustProxy: config.trustProxy,
    cookiePath: config.cookiePath,
  });
  const server = http.createServer(app);

  server.on('error', (err) => {
    process.stderr.write(`Server failed to start on ${config.host}:${config.port}: ${err.message}\n`);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const { port } = server.address();
    const base = displayUrl(config.host, port);
    process.stdout.write(`Early Builders dashboard listening on ${config.host}:${port} (${base})\n`);
    process.stdout.write(`Session cookie scoped to Path=${config.cookiePath}\n`);
    if (config.trustProxy) process.stdout.write('TRUST_PROXY=1: honouring X-Forwarded-For / X-Forwarded-Proto from the proxy.\n');
    if (!config.sessionSecret) {
      process.stdout.write('API locked (fail closed): set ACCESS_PASSWORD for the shared-password login, SESSION_SECRET plus SSO, or AUTH_DEV_LOGIN=1 locally.\n');
    }
    if (config.passwordLogin) {
      process.stdout.write('Password login enabled: visitors enter the shared access password, then pick a role.\n');
      if (!config.trustProxy) {
        process.stdout.write('Behind a proxy, set TRUST_PROXY=1 so failed logins are rate-limited per visitor instead of sharing one limit.\n');
      }
    } else {
      process.stdout.write('Password login disabled (ACCESS_PASSWORD is not set).\n');
    }
    if (config.devLogin) {
      process.stdout.write(`Dev login enabled (loopback clients only): ${base}/auth/dev-login?role=research\n`);
    }
    if (config.ephemeralSecret) {
      process.stderr.write('Warning: SESSION_SECRET is not set, so a temporary session secret is in use. Everyone is signed out when the server restarts.\n');
    }
    pool.query('SELECT COUNT(*) AS builders FROM builders').then(([rows]) => {
      process.stdout.write(`MySQL connected (database ${dbConfig.database}, ${rows[0].builders} builders).\n`);
    }, (err) => {
      process.stderr.write(`MySQL check failed: ${err.code || err.message}. api/dashboard answers 500 until the database is reachable.\n`);
    });
    process.stdout.write(`Data sync: every ${syncInterval / 36e5} h, first run in ${INITIAL_DELAY_MS / 1000} s.\n`);
    for (const line of describeSources(REQUIRED)) process.stdout.write(`  ${line}\n`);
    scheduler = startScheduler(sync, { intervalMs: syncInterval, log: syncLog });
  });

  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    process.stdout.write('Shutting down...\n');
    if (scheduler) scheduler.stop();
    server.close(() => {
      pool.end().catch(() => {}).finally(() => process.exit(0));
    });
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  return server;
}

if (require.main === module) main();

module.exports = { readConfig, main };

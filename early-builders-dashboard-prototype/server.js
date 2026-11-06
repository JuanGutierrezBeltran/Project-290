'use strict';

// Thin entry point: read env config, build the request handler, listen on
// loopback only. All routing, auth and access rules live in lib/.

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { createApp } = require('./lib/app');

const MIN_SECRET_LENGTH = 32;

function readConfig(env = process.env) {
  const devLogin = env.AUTH_DEV_LOGIN === '1';
  let sessionSecret = env.SESSION_SECRET || '';
  let ephemeralSecret = false;

  if (sessionSecret && sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`);
  }
  if (!sessionSecret && devLogin) {
    // Dev-only: sessions die when the process restarts. Never used unless AUTH_DEV_LOGIN=1.
    sessionSecret = crypto.randomBytes(32).toString('hex');
    ephemeralSecret = true;
  }

  const ttlHours = Number(env.SESSION_TTL_HOURS || 8);
  return {
    port: Number(env.PORT || 3016),
    sessionSecret,
    ephemeralSecret,
    devLogin,
    sessionTtlSeconds: Math.round((Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 8) * 3600),
    secureCookies: env.COOKIE_SECURE === '1',
  };
}

function main() {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }

  const app = createApp({
    publicDir: path.join(__dirname, 'public'),
    fixturePath: path.join(__dirname, 'data', 'dashboard.json'),
    sessionSecret: config.sessionSecret,
    sessionTtlSeconds: config.sessionTtlSeconds,
    devLogin: config.devLogin,
    secureCookies: config.secureCookies,
  });
  const server = http.createServer(app);

  server.listen(config.port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${config.port}`;
    process.stdout.write(`Early Builders demo: ${base}\n`);
    if (!config.sessionSecret) {
      process.stdout.write('API locked (fail closed): set SESSION_SECRET and connect SSO, or use AUTH_DEV_LOGIN=1 locally.\n');
    }
    if (config.devLogin) {
      process.stdout.write(`Dev login enabled (loopback only): ${base}/auth/dev-login?role=research\n`);
      if (config.ephemeralSecret) process.stdout.write('Using an ephemeral session secret; sessions end when the server stops.\n');
    }
  });

  function close() {
    server.close(() => process.exit(0));
  }
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  return server;
}

if (require.main === module) main();

module.exports = { readConfig, main };

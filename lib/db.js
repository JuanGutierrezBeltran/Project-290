'use strict';

// MySQL connection settings and pool.
//
// The hosting runtime injects DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and
// DB_NAME. There is deliberately NO localhost fallback: a missing variable is
// a misconfiguration and must stop the server with a clear message.
//
// mysql2 is required lazily inside createPool(), so the test suite (and CI)
// can load server.js and lib/ without the driver installed or a database.
//
// dateStrings: true makes DATE columns come back as plain 'YYYY-MM-DD'
// strings, so no timezone conversion can shift the day-14 maths.

const REQUIRED_VARS = Object.freeze(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']);

function readDbConfig(env = process.env) {
  // DB_PASSWORD must be present but may legitimately be an empty string.
  const missing = REQUIRED_VARS.filter((name) => env[name] === undefined || (name !== 'DB_PASSWORD' && env[name] === ''));
  if (missing.length) {
    throw new Error(`MySQL is not configured: missing ${missing.join(', ')}. The hosting runtime injects these; for a local run set them explicitly.`);
  }
  const port = Number(env.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DB_PORT must be an integer between 1 and 65535 (got "${env.DB_PORT}").`);
  }
  return {
    host: env.DB_HOST,
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };
}

function createPool(config) {
  // eslint-disable-next-line global-require
  const mysql = require('mysql2/promise');
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: 'utf8mb4',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 5,
    enableKeepAlive: true,
    connectTimeout: 10000,
  });
}

module.exports = { REQUIRED_VARS, readDbConfig, createPool };

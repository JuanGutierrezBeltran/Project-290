'use strict';

// Runs the configured connectors one by one and stores each load in MySQL.
// A source without its variables is left "Pendiente" and never called; a source that fails is
// marked "Error" and the others still run. Every attempt is recorded in sync_runs.
// The scheduler never blocks server start-up: the first run waits INITIAL_DELAY_MS.

const repo = require('./metrics-repo');
const catalog = require('./sources-catalog');

const STATE = Object.freeze({ connected: 'Conectado', pending: 'Pendiente', error: 'Error' });
const SOURCES = Object.freeze(catalog
  .filter((c) => c.dashboard && !c.reference)
  .map((c) => Object.freeze({ key: c.key, name: c.dashboard.name })));
const DEFAULT_INTERVAL_HOURS = 6;
const MIN_INTERVAL_HOURS = 0.25;
const MAX_INTERVAL_HOURS = 168;
const INITIAL_DELAY_MS = 15000;

const noop = () => {};

function syncIntervalMs(value) {
  if (value === undefined || value === '') return DEFAULT_INTERVAL_HOURS * 36e5;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < MIN_INTERVAL_HOURS || hours > MAX_INTERVAL_HOURS) {
    throw new Error(`SYNC_INTERVAL_HOURS must be a number between ${MIN_INTERVAL_HOURS} and ${MAX_INTERVAL_HOURS} (got "${value}").`);
  }
  return Math.round(hours * 36e5);
}

function stamp(date) {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// Variable NAMES only, never values.
function describeSources(required, env = process.env, sources = SOURCES) {
  return sources.map((s) => {
    const missing = (required[s.key] || []).filter((name) => !env[name]);
    return missing.length ? `${s.key}: pending, missing ${missing.join(', ')}` : `${s.key}: configured`;
  });
}

function createSync({ pool, connectors, configured, sources = SOURCES, log = noop, now = () => new Date() }) {
  let running = null;

  async function syncSource(programId, source) {
    if (!configured(source.key)) {
      await repo.setSourceState(pool, programId, source.name, { state: STATE.pending });
      return { source: source.key, status: 'skipped' };
    }
    const started = Date.now();
    let runId = null;
    try {
      runId = await repo.startRun(pool, programId, source.key);
      const load = await connectors[source.key]();
      if (!load || load.source !== source.key) throw new Error('connector returned an unexpected load');
      const counts = await repo.saveLoad(pool, programId, load);
      const durationMs = Date.now() - started;
      await repo.finishRun(pool, runId, { status: 'ok', durationMs, counts });
      await repo.setSourceState(pool, programId, source.name, { state: STATE.connected, lastSync: stamp(now()) });
      log('info', `sync ${source.key}: ok (${counts.metrics} metrics, ${counts.events} events, ${counts.snapshots} snapshots, ${durationMs} ms)`);
      return { source: source.key, status: 'ok', counts, durationMs };
    } catch (err) {
      const message = repo.errorText(err);
      log('error', `sync ${source.key}: failed: ${message}`);
      try {
        if (runId !== null) await repo.finishRun(pool, runId, { status: 'error', durationMs: Date.now() - started, error: message });
        await repo.setSourceState(pool, programId, source.name, { state: STATE.error });
      } catch (recordErr) {
        log('error', `sync ${source.key}: could not record the failure: ${repo.errorText(recordErr)}`);
      }
      return { source: source.key, status: 'error', error: message };
    }
  }

  // Overlapping calls share the run in progress instead of starting a second one.
  function runOnce() {
    if (running) return running;
    running = (async () => {
      const programId = await repo.findProgramId(pool);
      const results = [];
      for (const source of sources) results.push(await syncSource(programId, source));
      return results;
    })().finally(() => { running = null; });
    return running;
  }

  return { runOnce, isRunning: () => running !== null };
}

function startScheduler(sync, { intervalMs, initialDelayMs = INITIAL_DELAY_MS, log = noop } = {}) {
  let stopped = false;
  let interval = null;
  const tick = () => {
    if (stopped) return;
    sync.runOnce().catch((err) => log('error', `sync: run failed: ${repo.errorText(err)}`));
  };
  const first = setTimeout(() => {
    tick();
    if (stopped) return;
    interval = setInterval(tick, intervalMs);
    if (typeof interval.unref === 'function') interval.unref();
  }, initialDelayMs);
  if (typeof first.unref === 'function') first.unref();
  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}

module.exports = {
  STATE, SOURCES, INITIAL_DELAY_MS, DEFAULT_INTERVAL_HOURS,
  syncIntervalMs, describeSources, createSync, startScheduler,
};

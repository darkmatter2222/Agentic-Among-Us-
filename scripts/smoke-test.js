#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const HEALTH_URL = process.env.SMOKE_HEALTH_URL ?? 'http://localhost:4000/health';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? '45000');
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS ?? '1000');
const isWindows = process.platform === 'win32';

function launchDevAll() {
  const child = spawn('npm', ['run', 'dev:all'], {
    env: { ...process.env, SMOKE_TEST: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: isWindows,
  });
  child.on('error', (error) => {
    console.error('[smoke] Failed to launch dev:all:', error);
  });
  return child;
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const response = await fetch(HEALTH_URL, { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        console.log('[smoke] Health endpoint OK:', body);
        return true;
      }
    } catch (error) {
      console.log('[smoke] Waiting for health...', error.message ?? error);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function terminate(child) {
  if (!child || child.killed) {
    return;
  }

  const signal = isWindows ? 'SIGINT' : 'SIGTERM';
  child.kill(signal);

  const waited = await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(5000).then(() => null),
  ]);

  if (waited === null && !child.killed) {
    child.kill('SIGTERM');
  }
}

async function main() {
  const devProcess = launchDevAll();
  let manualShutdown = false;

  const exitPromise = new Promise((resolve, reject) => {
    devProcess.once('exit', (code) => {
      if (manualShutdown) {
        resolve(code ?? 0);
        return;
      }
      reject(new Error(`dev:all exited before health check (code ${code ?? 0})`));
    });
  });

  try {
    const healthReady = await Promise.race([
      waitForHealth(),
      exitPromise.then(() => false),
    ]);

    if (!healthReady) {
      throw new Error('health check timed out');
    }

    console.log('[smoke] Smoke test succeeded');
    manualShutdown = true;
    await terminate(devProcess);
    process.exit(0);
  } catch (error) {
    console.error('[smoke] Smoke test failed:', error instanceof Error ? error.message : error);
    manualShutdown = true;
    await terminate(devProcess);
    process.exit(1);
  }
}

await main();

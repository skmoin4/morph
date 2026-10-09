#!/usr/bin/env node
/**
 * Drive a headless Chrome and screenshot it, with no npm dependencies.
 *
 * Uses the DevTools Protocol over Node's built-in WebSocket (Node 22+), so
 * there is no Playwright/Puppeteer download and nothing added to the lockfile.
 * Enough to sign in and capture an authenticated screen while building.
 *
 *   node tools/shot.mjs --url http://localhost:5173/login \
 *     --out shot.png --width 1440 --height 900 \
 *     --type "input[type=email]::a@b.c" --type "input[type=password]::secret" \
 *     --click "button[type=submit]" --wait 2500
 *
 * Steps run in the order given on the command line.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** Parses argv into ordered steps plus named options. */
function parseArgs(argv) {
  const options = { width: 1440, height: 900, out: 'shot.png', wait: 0 };
  const steps = [];

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'type' || key === 'click' || key === 'wait' || key === 'goto') {
      steps.push({ key, value });
    }
    if (['url', 'out', 'width', 'height', 'fullPage'].includes(key)) {
      options[key] = ['width', 'height'].includes(key) ? Number(value) : value;
    }
  }
  return { options, steps };
}

const { options, steps } = parseArgs(process.argv.slice(2));
if (!options.url) {
  console.error('--url is required');
  process.exit(1);
}

const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chrome) {
  console.error('No Chrome or Edge found.');
  process.exit(1);
}

const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(path.join(tmpdir(), 'opsvera-cdp-'));

const browser = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${options.width},${options.height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Browser still starting.
    }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging target in time.');
}

async function main() {
  const wsUrl = await findTarget();
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  async function goto(url) {
    await send('Page.navigate', { url });
    // Wait for the SPA to settle rather than for the load event alone.
    for (let i = 0; i < 80; i += 1) {
      await sleep(150);
      const ready = await evaluate(
        `document.readyState === 'complete' && !!document.querySelector('#root')?.firstElementChild`,
      ).catch(() => false);
      if (ready) break;
    }
    await sleep(600);
  }

  await goto(options.url);

  for (const step of steps) {
    if (step.key === 'goto') {
      await goto(step.value);
    } else if (step.key === 'wait') {
      await sleep(Number(step.value));
    } else if (step.key === 'type') {
      // Split on '::' — a CSS selector such as input[type=email] contains '='.
      const splitAt = step.value.indexOf('::');
      if (splitAt === -1) throw new Error('--type expects "selector::value"');
      const selector = step.value.slice(0, splitAt);
      const text = step.value.slice(splitAt + 2);
      // React listens to the input event, so the native setter is used and the
      // event dispatched explicitly — assigning .value alone would not register.
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('not found: ' + ${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value',
        ).set;
        setter.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    } else if (step.key === 'click') {
      await evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(step.value)});
        if (!el) throw new Error('not found: ' + ${JSON.stringify(step.value)});
        el.click();
      })()`);
      await sleep(400);
    }
  }

  if (options.wait) await sleep(Number(options.wait));

  if (options.fullPage) {
    const metrics = await send('Page.getLayoutMetrics');
    const height = Math.ceil(metrics.cssContentSize.height);
    await send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(300);
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(options.out, Buffer.from(data, 'base64'));
  console.log(`saved ${options.out}`);

  socket.close();
  cleanup();
}

/**
 * Chrome holds the profile directory open for a moment after kill(), so the
 * removal is best-effort — a leftover temp folder is not worth failing over.
 */
function cleanup() {
  browser.kill();
  setTimeout(() => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Windows still had a handle open; the OS will clear temp eventually.
    }
    process.exit(0);
  }, 300);
}

main().catch((error) => {
  console.error(error.message);
  browser.kill();
  process.exit(1);
});

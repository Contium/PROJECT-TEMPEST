// TEMPEST launcher — what the Start Menu, Startup shortcut and tray icon run.
//
//   node launcher/tempest.js                 start server + tray if needed, open the GM window
//   node launcher/tempest.js --background    start server + tray if needed, no window (sign-in autostart)
//   node launcher/tempest.js --open <path>   start if needed, open an app window at #<path> (e.g. /player)
//   node launcher/tempest.js --restart       stop the server and start it again
//   node launcher/tempest.js --stop          shut the server down (tray stays, showing "stopped")
//   node launcher/tempest.js --quit          shut everything down: server and tray icon
//   add --no-tray to any start command to skip the tray icon
//
// Single instance: if a TEMPEST server already answers on the port it is reused,
// and the tray icon refuses to start twice.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const P = require('./paths');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const openPath = flags.has('--open') ? argv[argv.indexOf('--open') + 1] ?? '/' : null;
const HEALTH_URL = `${P.APP_URL}api/health`;
const BOOT_TIMEOUT_MS = 15000;
const STOP_TIMEOUT_MS = 5000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  fs.mkdirSync(path.dirname(P.LOG_FILE), { recursive: true });
  fs.appendFileSync(P.LOG_FILE, `[${new Date().toISOString()}] [launcher] ${msg}\n`);
}

const sameDir = (a, b) => path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();

/**
 * 'tempest' if our server answers, 'stranger' if a TEMPEST server answers but
 * with a different data folder (a sandboxed or other user's copy), 'foreign'
 * if something else holds the port, null if it's free.
 */
async function probe() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(800) });
    const body = await res.json().catch(() => null);
    if (body?.app !== 'tempest') return 'foreign';
    return body.dataDir && !sameDir(body.dataDir, P.DATA_DIR) ? 'stranger' : 'tempest';
  } catch (err) {
    return err.cause?.code === 'ECONNREFUSED' || err.name === 'TimeoutError' ? null : 'foreign';
  }
}

function startServer() {
  fs.mkdirSync(path.dirname(P.LOG_FILE), { recursive: true });
  const out = fs.openSync(P.LOG_FILE, 'a');
  const child = spawn(process.execPath, [P.SERVER_ENTRY], {
    cwd: P.ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  log(`server spawned (pid ${child.pid})`);
}

async function waitFor(state, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await probe()) === state) return true;
    await wait(250);
  }
  return false;
}

/** Start the server unless ours is already running. Returns false on failure. */
async function ensureServer() {
  let state = await probe();
  if (state === 'stranger') {
    log('a TEMPEST server with a different data folder holds the port; replacing it');
    await stopServer({ any: true });
    state = await probe();
  }
  if (state === 'foreign' || state === 'stranger') {
    log(`port ${P.PORT} is held by another program; set TEMPEST_PORT to change it`);
    return false;
  }
  if (state === 'tempest') return true;
  startServer();
  if (await waitFor('tempest', BOOT_TIMEOUT_MS)) return true;
  log(`server did not come up within ${BOOT_TIMEOUT_MS}ms — see log above`);
  return false;
}

/**
 * The tray icon is a hidden PowerShell process (tray.ps1) that exits by itself if
 * one is already running. It's started through tray.wsf: spawned detached from
 * Node, PowerShell has no console and quits; attached, it dies with the launcher.
 */
function ensureTray() {
  if (process.platform !== 'win32' || flags.has('--no-tray') || process.env.TEMPEST_NO_TRAY) return;
  fs.rmSync(P.TRAY_QUIT_FLAG, { force: true });
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  spawn(wscript, ['//B', '//Nologo', P.TRAY_RUNNER, P.ROOT, process.execPath, String(P.PORT)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

/** The first of these programs found on PATH (Linux, macOS). */
function onPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

// Prefer a chromeless app window (Edge ships with Windows; Chrome, Chromium or Edge
// elsewhere); fall back to the default browser.
function openWindow(hashPath = '/') {
  const url = hashPath === '/' ? P.APP_URL : `${P.APP_URL}#${hashPath}`;
  let browser;
  let fallback;
  if (process.platform === 'win32') {
    browser = [
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].find((p) => p && fs.existsSync(p));
    fallback = ['cmd.exe', ['/c', 'start', '""', url]];
  } else if (process.platform === 'darwin') {
    browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find((p) => fs.existsSync(p));
    fallback = ['open', [url]];
  } else {
    browser = onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']);
    fallback = ['xdg-open', [url]];
  }
  const [cmd, cmdArgs] = browser ? [browser, [`--app=${url}`, '--window-size=1440,900']] : fallback;
  spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore', windowsHide: true })
    .on('error', (err) => {
      log(`could not open a window (${err.message}); open ${url} in a browser`);
      console.log(`TEMPEST is running: open ${url} in a browser.`);
    })
    .unref();
  log(`window opened via ${path.basename(cmd)} at ${hashPath}`);
}

/** Ask the server to shut down and wait until the port is free. `any` also stops a stranger's TEMPEST. */
async function stopServer({ any = false } = {}) {
  const state = await probe();
  if (state !== 'tempest' && !(any && state === 'stranger')) return log('stop: no server running');
  await fetch(`${P.APP_URL}api/system/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);
  log((await waitFor(null, STOP_TIMEOUT_MS)) ? 'stop: server stopped' : 'stop: server did not stop in time');
}

async function main() {
  if (flags.has('--stop')) return stopServer({ any: true });

  if (flags.has('--quit')) {
    fs.mkdirSync(path.dirname(P.TRAY_QUIT_FLAG), { recursive: true });
    fs.writeFileSync(P.TRAY_QUIT_FLAG, new Date().toISOString()); // the tray polls for this and exits
    return stopServer({ any: true });
  }

  if (flags.has('--restart')) {
    await stopServer();
    if (!(await ensureServer())) process.exitCode = 1;
    else log('restart: server is back');
    return;
  }

  if (!(await ensureServer())) {
    process.exitCode = 1;
    return;
  }
  ensureTray();
  if (openPath) openWindow(openPath);
  else if (!flags.has('--background')) openWindow('/');
}

main().catch((err) => {
  log(`fatal: ${err.stack || err}`);
  process.exitCode = 1;
});

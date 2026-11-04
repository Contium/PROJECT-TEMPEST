// Windows .lnk management (Start Menu + Startup folder). Per-user, no admin.
// Shortcuts point at wscript.exe + hidden.wsf so launching never flashes a console.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const P = require('./paths');

const WSCRIPT = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
const AUTOSTART_MODES = ['background', 'window'];

// Values travel via environment variables, never interpolated into the script.
const CREATE_LNK = `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:TP_LNK)
$s.TargetPath = $env:TP_TARGET
$s.Arguments = $env:TP_ARGS
$s.WorkingDirectory = $env:TP_CWD
$s.IconLocation = $env:TP_ICON
$s.Description = $env:TP_DESC
$s.Save()`;

const READ_LNK_ARGS = `(New-Object -ComObject WScript.Shell).CreateShortcut($env:TP_LNK).Arguments`;

function powershell(script, env) {
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, ...env },
    windowsHide: true,
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`PowerShell failed: ${res.stderr || res.error?.message}`);
  return res.stdout.trim();
}

/** Create a shortcut that runs `launcher/tempest.js <launcherArgs>` with no console window. */
function createLauncherShortcut(lnkPath, launcherArgs, description) {
  fs.mkdirSync(path.dirname(lnkPath), { recursive: true });
  const args = ['//B', '//Nologo', `"${P.HIDDEN_RUNNER}"`, `"${process.execPath}"`, ...launcherArgs].join(' ');
  powershell(CREATE_LNK, {
    TP_LNK: lnkPath,
    TP_TARGET: WSCRIPT,
    TP_ARGS: args,
    TP_CWD: P.ROOT,
    TP_ICON: `${P.ICON},0`,
    TP_DESC: description,
  });
}

function removeFile(file) {
  fs.rmSync(file, { force: true });
}

// The autostart mode is remembered in a small file so status checks never have to
// start PowerShell to read the shortcut (slow, and it blocks the server meanwhile).
const AUTOSTART_STATE = path.join(P.DATA_DIR, 'autostart.json');

function rememberMode(mode) {
  fs.mkdirSync(path.dirname(AUTOSTART_STATE), { recursive: true });
  fs.writeFileSync(AUTOSTART_STATE, JSON.stringify({ mode }));
}

function getAutostart() {
  if (!fs.existsSync(P.STARTUP_LINK)) return { enabled: false, mode: null };
  try {
    const { mode } = JSON.parse(fs.readFileSync(AUTOSTART_STATE, 'utf8'));
    if (AUTOSTART_MODES.includes(mode)) return { enabled: true, mode };
  } catch {
    /* no cache yet (shortcut made before it existed): read the shortcut once below */
  }
  let args = '';
  try {
    args = powershell(READ_LNK_ARGS, { TP_LNK: P.STARTUP_LINK });
  } catch {
    /* unreadable link — report enabled with the default mode */
  }
  const mode = args.includes('--background') ? 'background' : 'window';
  rememberMode(mode);
  return { enabled: true, mode };
}

function setAutostart(enabled, mode = 'background') {
  if (!enabled) {
    removeFile(P.STARTUP_LINK);
    removeFile(AUTOSTART_STATE);
    return getAutostart();
  }
  if (!AUTOSTART_MODES.includes(mode)) throw new Error(`Unknown autostart mode "${mode}"`);
  createLauncherShortcut(P.STARTUP_LINK, mode === 'background' ? ['--background'] : [], 'Start TEMPEST when you sign in');
  rememberMode(mode);
  return getAutostart();
}

module.exports = { AUTOSTART_MODES, createLauncherShortcut, removeFile, getAutostart, setAutostart };

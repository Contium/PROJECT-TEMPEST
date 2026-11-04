// Shared locations for the launcher, installer and server.

const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const WINDOWS = process.platform === 'win32';
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const PROGRAMS = path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
// Where TEMPEST keeps its data and logs: %LOCALAPPDATA%\TEMPEST on Windows,
// $XDG_DATA_HOME/TEMPEST (usually ~/.local/share/TEMPEST) elsewhere.
const HOME_DIR = WINDOWS
  ? path.join(LOCALAPPDATA, 'TEMPEST')
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'TEMPEST');

const PORT = Number(process.env.TEMPEST_PORT) || 4077;
// The player screen on the local network (server/lan.js), when the GM shares it.
const LAN_PORT = Number(process.env.TEMPEST_LAN_PORT) || PORT + 1;

module.exports = {
  ROOT,
  PORT,
  LAN_PORT,
  HOST: '127.0.0.1',
  APP_URL: `http://127.0.0.1:${PORT}/`,
  ICON: path.join(ROOT, 'assets', 'tempest.ico'),
  SERVER_ENTRY: path.join(ROOT, 'server', 'index.js'),
  LAUNCHER_ENTRY: path.join(ROOT, 'launcher', 'tempest.js'),
  HIDDEN_RUNNER: path.join(ROOT, 'launcher', 'hidden.wsf'),
  TRAY_RUNNER: path.join(ROOT, 'launcher', 'tray.wsf'),
  TRAY_QUIT_FLAG: path.join(HOME_DIR, 'tray.quit'),
  ICON_PNG: path.join(ROOT, 'assets', 'tempest-256.png'),
  // TEMPEST_DATA_DIR points a server at another data folder (tests, sandboxed copies).
  DATA_DIR: process.env.TEMPEST_DATA_DIR || HOME_DIR,
  LOG_FILE: path.join(HOME_DIR, 'logs', 'server.log'),
  START_MENU_DIR: path.join(PROGRAMS, 'TEMPEST'),
  STARTUP_LINK: path.join(PROGRAMS, 'Startup', 'TEMPEST.lnk'),
};

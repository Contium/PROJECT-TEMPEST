// Installs / removes TEMPEST's Windows shortcuts (per-user, no admin).
//
//   node launcher/install.js                          Start Menu shortcuts only
//   node launcher/install.js --autostart              + start server at sign-in (background)
//   node launcher/install.js --autostart=window       + start and open the window at sign-in
//   node launcher/install.js --uninstall              remove all shortcuts

const fs = require('node:fs');
const path = require('node:path');
const P = require('./paths');
const { createLauncherShortcut, setAutostart, getAutostart } = require('./shortcuts');

const argv = process.argv.slice(2);
const autostartArg = argv.find((a) => a.startsWith('--autostart'));

if (process.platform !== 'win32') {
  console.error('Shortcut installation is Windows-only.');
  process.exit(1);
}

if (argv.includes('--uninstall')) {
  fs.rmSync(P.START_MENU_DIR, { recursive: true, force: true });
  setAutostart(false);
  console.log('Removed TEMPEST Start Menu and Startup shortcuts.');
  process.exit(0);
}

if (!fs.existsSync(P.ICON)) require('../scripts/make-icon.js');

createLauncherShortcut(path.join(P.START_MENU_DIR, 'TEMPEST.lnk'), [], 'TEMPEST world manager');
createLauncherShortcut(path.join(P.START_MENU_DIR, 'Quit TEMPEST.lnk'), ['--quit'], 'Stop the TEMPEST server and remove its tray icon');
fs.rmSync(path.join(P.START_MENU_DIR, 'Stop TEMPEST.lnk'), { force: true }); // replaced by Quit TEMPEST
console.log(`Start Menu: ${P.START_MENU_DIR}`);

if (autostartArg) {
  const mode = autostartArg.split('=')[1] || 'background';
  setAutostart(true, mode);
}
const auto = getAutostart();
console.log(`Start with Windows: ${auto.enabled ? `on (${auto.mode})` : 'off'}`);
console.log(`Using Node at: ${process.execPath}`);

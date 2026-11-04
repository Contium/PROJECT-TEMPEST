// Entry point baked into the standalone TEMPEST binaries (scripts/build-binaries.js).
//
// The binary is a Node.js runtime with this file inside it. The app itself (app/,
// server/, themes/ …) sits in the folder next to the binary and is loaded from disk,
// so the server and launcher run exactly as they do from a git checkout.
//
//   tempest                      start the server (if needed) and open the GM window
//   tempest --background | --open <path> | --restart | --stop | --quit | --no-tray
//                                the launcher's usual options (launcher/tempest.js)
//   tempest serve                run the server in this terminal (Ctrl+C stops it)
//   tempest setup [options]      Windows: Start Menu / Startup shortcuts (launcher/install.js)
//   tempest <file.js> [args]     run a script, as `node <file.js>` would; the launcher,
//                                tray icon and shortcuts start the server this way

const path = require('node:path');
const { createRequire } = require('node:module');

const ROOT = path.dirname(process.execPath);
const COMMANDS = { serve: 'server/index.js', setup: 'launcher/install.js' };

// In a single executable, process.argv is [binary, binary, ...user args].
const args = process.argv.slice(2);
let entry;
let rest;
if (args[0] && /\.c?js$/i.test(args[0])) {
  entry = path.resolve(args[0]);
  rest = args.slice(1);
} else if (COMMANDS[args[0]]) {
  entry = path.join(ROOT, COMMANDS[args[0]]);
  rest = args.slice(1);
} else if (args[0] === '--version' || args[0] === '-v') {
  console.log(require('node:fs').existsSync(path.join(ROOT, 'package.json'))
    ? `TEMPEST ${JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version} (Node ${process.version})`
    : `Node ${process.version}`);
  process.exit(0);
} else {
  entry = path.join(ROOT, 'launcher', 'tempest.js');
  rest = args;
}

// Make the script see the argv it would see under `node <entry> ...`.
process.argv = [process.execPath, entry, ...rest];
createRequire(entry)(entry);

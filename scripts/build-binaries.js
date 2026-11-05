// Builds standalone TEMPEST binaries: no Node.js install needed to run them.
//
//   node scripts/build-binaries.js                         Windows x64 + Linux x64
//   node scripts/build-binaries.js --targets=linux-arm64   any of: win-x64, linux-x64, linux-arm64
//   node scripts/build-binaries.js --no-installer          skip the Windows installer
//
// Built on Windows, win-x64 also gets dist/TEMPEST-Setup-<version>.exe, a per-user
// installer (scripts/build-installer.ps1, scripts/installer/Setup.cs).
//
// Each binary is an official Node.js runtime (the same version as the Node running
// this script, downloaded from nodejs.org and checked against its SHA-256 list) with
// launcher/binary.js injected as a Node "single executable application". The app's
// files ship next to it, so the result is one folder per platform, also packed as
// dist/tempest-<version>-win-x64.zip and dist/tempest-<version>-linux-x64.tar.gz.
//
// The one build tool, postject (the Node.js project's injector), is installed once
// into .build-cache/, which, like dist/, is not part of the repository. The Windows
// icon is set with Windows' own resource API (scripts/set-exe-icon.ps1).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = require('../package.json');
const CACHE = path.join(ROOT, '.build-cache');
const DIST = path.join(ROOT, 'dist');
const NODE_VERSION = process.version;
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const TOOLS = { postject: '1.0.0-alpha.6' };

const TARGETS = {
  'win-x64': { windows: true, file: 'win-x64/node.exe' },
  'linux-x64': { windows: false, file: `node-${NODE_VERSION}-linux-x64.tar.gz` },
  'linux-arm64': { windows: false, file: `node-${NODE_VERSION}-linux-arm64.tar.gz` },
};

// What a running TEMPEST needs. Reference material (the Atlas, the rulebook PDFs),
// tests, docs and old versions stay out of the binaries.
const SHIPPED = [
  'app',
  'server',
  'src',
  'themes',
  'launcher',
  'assets/maps',
  'assets/tempest.ico',
  'assets/tempest-256.png',
  'demo',
  'scripts/import_screamsheet.py',
  'scripts/make-icon.js',
  'package.json',
  'LICENSE',
  'README.md',
];
const WINDOWS_ONLY = /\.(wsf|ps1)$/i;

const argv = process.argv.slice(2);
const targetArg = argv.find((a) => a.startsWith('--targets='));
const targets = targetArg ? targetArg.split('=')[1].split(',').filter(Boolean) : ['win-x64', 'linux-x64'];
for (const t of targets) if (!TARGETS[t]) fail(`unknown target "${t}" (choose from ${Object.keys(TARGETS).join(', ')})`);

function fail(msg) {
  console.error(`build: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} failed${res.error ? `: ${res.error.message}` : ''}`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- Build tools --------------------------------------------------------------

function tools() {
  const dir = path.join(CACHE, 'tools');
  const have = (name) => {
    try {
      return require(path.join(dir, 'node_modules', name, 'package.json')).version === TOOLS[name];
    } catch {
      return false;
    }
  };
  if (!Object.keys(TOOLS).every(have)) {
    console.log('Installing the build tool (postject) into .build-cache/tools …');
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(path.join(dir, 'package.json'))) fs.writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const specs = Object.entries(TOOLS).map(([n, v]) => `${n}@${v}`);
    run(npm, ['install', '--no-audit', '--no-fund', '--save-exact', ...specs], { cwd: dir, shell: process.platform === 'win32' });
  }
  return { postject: require(path.join(dir, 'node_modules', 'postject')) };
}

// --- Node.js runtimes ---------------------------------------------------------

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

let sums;
async function checksums() {
  if (sums) return sums;
  const text = (await download(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).toString('utf8');
  sums = new Map(text.trim().split('\n').map((line) => line.trim().split(/\s+/).reverse()));
  return sums;
}

/** The official node binary for a target, downloaded once and verified. */
async function runtime(name) {
  const { file, windows } = TARGETS[name];
  const dir = path.join(CACHE, `node-${NODE_VERSION}`, name);
  const bin = path.join(dir, windows ? 'node.exe' : 'node');
  if (fs.existsSync(bin)) return bin;

  const expected = (await checksums()).get(file);
  if (!expected) fail(`nodejs.org lists no ${file} for ${NODE_VERSION}`);
  console.log(`Downloading Node ${NODE_VERSION} for ${name} …`);
  const data = await download(`https://nodejs.org/dist/${NODE_VERSION}/${file}`);
  if (sha256(data) !== expected) fail(`checksum mismatch for ${file}: refusing to use it`);
  fs.mkdirSync(dir, { recursive: true });
  if (windows) {
    fs.writeFileSync(bin, data);
  } else {
    const archive = path.join(dir, file);
    fs.writeFileSync(archive, data);
    run('tar', ['-xzf', archive, '-C', dir, '--strip-components=2', `${file.replace(/\.tar\.gz$/, '')}/bin/node`]);
    fs.rmSync(archive);
  }
  return bin;
}

// --- Windows executable tweaks -------------------------------------------------

function peHeader(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') fail('not a Windows executable');
  const optional = pe + 24;
  if (buf.readUInt16LE(optional) !== 0x20b) fail('expected a 64-bit Windows executable');
  return optional;
}

/** Drop node.exe's Authenticode signature: it no longer matches once the exe is changed. */
function stripSignature(file) {
  const buf = fs.readFileSync(file);
  const entry = peHeader(buf) + 112 + 4 * 8; // data directory 4: the certificate table
  const offset = buf.readUInt32LE(entry);
  const size = buf.readUInt32LE(entry + 4);
  if (!offset) return;
  buf.writeUInt32LE(0, entry);
  buf.writeUInt32LE(0, entry + 4);
  fs.writeFileSync(file, offset + size === buf.length ? buf.subarray(0, offset) : buf);
}

/** Mark the exe as a windowed app, so starting TEMPEST never flashes a console window. */
function windowedSubsystem(file) {
  const buf = fs.readFileSync(file);
  buf.writeUInt16LE(2, peHeader(buf) + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  fs.writeFileSync(file, buf);
}

// --- Staging and archives -------------------------------------------------------

function copyApp(dest, windows) {
  for (const rel of SHIPPED) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) fail(`missing ${rel}`);
    fs.cpSync(src, path.join(dest, rel), {
      recursive: true,
      filter: (p) => windows || !WINDOWS_ONLY.test(p),
    });
  }
}

/** A gzipped tar of `dir` (as `<name>/…`), keeping the binary executable. */
function tarGz(dir, name, out, executables) {
  const blocks = [];
  const header = (entryName, { size = 0, mode, type }) => {
    const h = Buffer.alloc(512);
    let prefix = '';
    let base = entryName;
    if (Buffer.byteLength(base) > 100) {
      const cut = entryName.lastIndexOf('/', 154);
      prefix = entryName.slice(0, cut);
      base = entryName.slice(cut + 1);
      if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) fail(`path too long for tar: ${entryName}`);
    }
    h.write(base, 0, 100);
    h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    h.write(prefix, 345, 155);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const walk = (abs, rel) => {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      blocks.push(header(`${rel}/`, { mode: 0o755, type: '5' }));
      for (const child of fs.readdirSync(abs).sort()) walk(path.join(abs, child), `${rel}/${child}`);
      return;
    }
    const data = fs.readFileSync(abs);
    blocks.push(header(rel, { size: data.length, mode: executables.has(rel) ? 0o755 : 0o644, type: '0' }));
    blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  walk(dir, name);
  blocks.push(Buffer.alloc(1024));
  fs.writeFileSync(out, zlib.gzipSync(Buffer.concat(blocks), { level: 9 }));
}

// --- Build -----------------------------------------------------------------------

async function main() {
  const [major, minor] = NODE_VERSION.slice(1).split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 6)) fail(`Node 20.6 or later is needed to build (this is ${NODE_VERSION})`);
  const { postject } = tools();

  // The app's entry point as a SEA blob. No code cache or snapshot: those only run on
  // the platform that made them, and the blob here serves every target.
  fs.mkdirSync(CACHE, { recursive: true });
  const blob = path.join(CACHE, 'tempest.blob');
  const config = path.join(CACHE, 'sea-config.json');
  fs.writeFileSync(config, JSON.stringify({
    main: path.join(ROOT, 'launcher', 'binary.js'),
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false,
  }, null, 2));
  run(process.execPath, ['--experimental-sea-config', config], { stdio: ['ignore', 'ignore', 'inherit'] });
  const blobData = fs.readFileSync(blob);

  fs.mkdirSync(DIST, { recursive: true });
  const built = [];
  for (const name of targets) {
    const { windows } = TARGETS[name];
    const folder = `tempest-${PKG.version}-${name}`;
    const stage = path.join(DIST, folder);
    console.log(`\nBuilding ${folder} …`);
    fs.rmSync(stage, { recursive: true, force: true });
    copyApp(stage, windows);

    const exe = path.join(stage, windows ? 'tempest.exe' : 'tempest');
    fs.copyFileSync(await runtime(name), exe);
    if (windows) {
      stripSignature(exe);
      // Windows' own resource API sets the icon, so building on Windows gives tempest.exe
      // the TEMPEST icon; built elsewhere it keeps Node's.
      if (process.platform === 'win32') {
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          path.join(__dirname, 'set-exe-icon.ps1'), '-Exe', exe, '-Icon', path.join(ROOT, 'assets', 'tempest.ico')]);
      } else {
        console.log('  (not on Windows: tempest.exe keeps the Node.js icon)');
      }
    }
    await postject.inject(exe, 'NODE_SEA_BLOB', blobData, { sentinelFuse: SEA_FUSE });
    if (windows) windowedSubsystem(exe);
    else fs.chmodSync(exe, 0o755);

    const archive = path.join(DIST, `${folder}${windows ? '.zip' : '.tar.gz'}`);
    fs.rmSync(archive, { force: true });
    if (windows) run('tar', ['-a', '-cf', archive, '-C', DIST, folder]);
    else tarGz(stage, folder, archive, new Set([`${folder}/tempest`]));
    built.push({ archive, exe });

    // On Windows, the Windows folder also becomes an installer (scripts/build-installer.ps1).
    if (windows && process.platform === 'win32' && !argv.includes('--no-installer')) {
      console.log('Building the installer …');
      const setup = path.join(DIST, `TEMPEST-Setup-${PKG.version}.exe`);
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'build-installer.ps1'), '-Stage', stage, '-Version', PKG.version, '-Out', setup]);
      built.push({ archive: setup, exe: setup });
    }
  }

  console.log('\nBuilt:');
  for (const { archive, exe } of built) {
    const mb = (f) => `${(fs.statSync(f).size / 1048576).toFixed(1)} MB`;
    console.log(`  ${path.relative(ROOT, archive)}  (${mb(archive)}; binary ${mb(exe)})`);
  }
}

main().catch((err) => fail(err.stack || err.message));

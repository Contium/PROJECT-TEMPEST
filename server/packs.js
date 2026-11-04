// Generator table packs (currently: screamsheets), carried over from v0.
//
//   GET  /api/packs/screamsheet           installed packs (full tables)
//   GET  /api/packs/screamsheet/sources   Screamsheet Generator PDFs found under official_references/
//   POST /api/packs/screamsheet/import    { path } → build a pack from that PDF (scripts/import_screamsheet.py)
//
// Packs live in the user's data folder (%LOCALAPPDATA%\TEMPEST\packs\screamsheet), shared by
// every project (and by v0): official tables are built from the user's own PDF and never ship
// with TEMPEST.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, DATA_DIR } = require('../launcher/paths');

const PACK_DIR = path.join(DATA_DIR, 'packs', 'screamsheet');
const REFERENCES = path.join(ROOT, 'official_references');
const IMPORTER = path.join(ROOT, 'scripts', 'import_screamsheet.py');

class PackError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function listPacks() {
  await fsp.mkdir(PACK_DIR, { recursive: true });
  const packs = [];
  for (const file of (await fsp.readdir(PACK_DIR)).filter((f) => f.endsWith('.json'))) {
    try {
      packs.push(JSON.parse(await fsp.readFile(path.join(PACK_DIR, file), 'utf8')));
    } catch (err) {
      console.warn(`[packs] skipped ${file}: ${err.message}`);
    }
  }
  return packs;
}

async function findSources(dir = REFERENCES, depth = 3) {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findSources(full, depth - 1)));
    else if (/screamsheet.*\.pdf$/i.test(entry.name)) out.push(full);
  }
  // The Generator PDF first: other screamsheet PDFs (ready-made issues) have no tables.
  return out.sort((a, b) => Number(/generator/i.test(b)) - Number(/generator/i.test(a)) || a.localeCompare(b));
}

/** Run the Python importer; tries `python`, then the `py` launcher. */
function runImporter(pdf) {
  const attempt = (cmd) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, [IMPORTER, pdf, PACK_DIR], { cwd: ROOT, windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject); // command not found
      child.on('close', () => {
        const last = out.trim().split('\n').at(-1) ?? '';
        try {
          resolve(JSON.parse(last));
        } catch {
          resolve({ error: (err || out || 'The importer produced no output').trim().split('\n').slice(-3).join(' ') });
        }
      });
    });
  return attempt('python').catch(() => attempt('py')).catch(() => ({ error: 'Python was not found. Install Python 3 and run: pip install pypdf' }));
}

async function importPack(body) {
  const pdf = typeof body?.path === 'string' ? path.resolve(body.path.trim().replace(/^"|"$/g, '')) : '';
  if (!pdf.toLowerCase().endsWith('.pdf')) throw new PackError(400, 'Choose the Screamsheet Generator PDF');
  if (!fs.existsSync(pdf)) throw new PackError(404, `No file at ${pdf}`);
  const result = await runImporter(pdf);
  if (result.error) throw new PackError(422, result.error);
  return result;
}

/** Handle /api/packs/screamsheet[...]. Returns true when it answered. */
async function handlePacks(req, res, rest, { readJson, sendJson }) {
  try {
    if (rest === '' && req.method === 'GET') return sendJson(res, 200, await listPacks()), true;
    if (rest === '/sources' && req.method === 'GET') return sendJson(res, 200, await findSources()), true;
    if (rest === '/import' && req.method === 'POST') return sendJson(res, 201, await importPack(await readJson(req))), true;
  } catch (err) {
    if (err instanceof PackError) return sendJson(res, err.status, { error: err.message }), true;
    throw err;
  }
  return false;
}

module.exports = { handlePacks };

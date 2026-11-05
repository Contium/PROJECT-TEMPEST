// Demo projects: complete projects shipped with TEMPEST in demo/projects/<id>/, so a
// new install (or anyone the GM shares the repository or a binary with) opens on
// a campaign that shows every section in use.
//
// When the server starts, each demo project is copied into the data folder unless
// a project with its id is already there, or it was installed before. Installed
// ids are recorded in <data>/v1/demo.json, so a demo the GM deletes stays deleted.
//
// Later versions of TEMPEST can ship more in a demo (e.g. the net cards and networks
// of Combat › Netrunning). Each file the demo has ever offered is listed in demo.json
// too, so an installed demo gets each new file once: never over a file of the same
// name, and never again after the GM deletes it. (For demos installed before that
// list existed, the files in folders that already hold files count as offered.)
//
// TEMPEST_NO_DEMO=1 skips this. scripts/build-demo.mjs rebuilds the shipped demo,
// and scripts/build-netrun-demo.mjs its Netrunning part.

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ID = /^proj_[0-9a-f]{8}$/;

/** Every file under `dir`, as forward-slash paths relative to it. */
function filesOf(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith('.tmp'))
    .map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'));
}

/** Install the shipped demo projects that are new to this data folder, and add new demo files to installed ones. Returns the ids installed. */
function installDemos({ root, v1Dir, log = console.log }) {
  if (process.env.TEMPEST_NO_DEMO) return [];
  const source = path.join(root, 'demo', 'projects');
  let ids;
  try {
    ids = fs.readdirSync(source).filter((id) => PROJECT_ID.test(id) && fs.existsSync(path.join(source, id, 'project.json')));
  } catch {
    return []; // no demo shipped
  }
  const markerFile = path.join(v1Dir, 'demo.json');
  let marker = { installed: [], offered: {} };
  try {
    const saved = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    marker = { installed: Array.isArray(saved.installed) ? saved.installed : [], offered: saved.offered && typeof saved.offered === 'object' ? saved.offered : {} };
  } catch {
    /* first run, or an unreadable marker: start a new one */
  }

  const installed = [];
  for (const id of ids) {
    const from = path.join(source, id);
    const target = path.join(v1Dir, 'projects', id);
    const files = filesOf(from);
    if (!marker.installed.includes(id)) {
      if (!fs.existsSync(target)) {
        try {
          fs.cpSync(from, target, { recursive: true, errorOnExist: true, force: false });
          installed.push(id);
          log(`[demo] installed the demo project ${id}`);
        } catch (err) {
          log(`[demo] could not install ${id}: ${err.message}`);
          fs.rmSync(target, { recursive: true, force: true }); // no half-copied project
          continue;
        }
      }
      // Already there counts too: never touch the GM's own project of that id.
      marker.installed.push(id);
      marker.offered[id] = files;
      continue;
    }
    if (!fs.existsSync(target)) continue; // deleted by the GM: it stays deleted

    // Before the list existed: what's in folders that hold files came with the first install
    // (empty folders don't count: TEMPEST makes them as soon as a tab is opened).
    const holdsFiles = (rel) => {
      try {
        return fs.readdirSync(path.join(target, rel), { withFileTypes: true }).some((e) => e.isFile());
      } catch {
        return false;
      }
    };
    const offered = Array.isArray(marker.offered[id])
      ? marker.offered[id]
      : files.filter((f) => holdsFiles(path.dirname(f)));
    const known = new Set(offered);
    let added = 0;
    for (const f of files) {
      if (known.has(f)) continue;
      known.add(f);
      offered.push(f);
      const dest = path.join(target, ...f.split('/'));
      if (fs.existsSync(dest)) continue;
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(from, ...f.split('/')), dest, fs.constants.COPYFILE_EXCL);
        added += 1;
      } catch (err) {
        log(`[demo] could not add ${f} to ${id}: ${err.message}`);
      }
    }
    marker.offered[id] = offered;
    if (added) log(`[demo] added ${added} new demo file${added === 1 ? '' : 's'} to ${id}`);
  }
  if (ids.some((id) => marker.installed.includes(id))) {
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.writeFileSync(markerFile, `${JSON.stringify(marker, null, 2)}\n`);
  }
  return installed;
}

module.exports = { installDemos };

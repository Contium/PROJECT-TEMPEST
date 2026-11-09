// Builds the demo campaign's Sessions (demo/projects/proj_91c43227): three game nights of the
// Static Saints (two played, with recaps the players have; the next one being planned) and
// the handouts given out at them. Ids are fixed, so a rebuild replaces rather than duplicates.
// Run it again after editing, then node scripts/build-demo-history.mjs.
//
//   node scripts/build-session-demo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSession, normalizeHandout } from '../app/sessions/session-model.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'demo', 'projects', 'proj_91c43227');
const STAMP = '2026-11-07T12:00:00.000Z';
const write = (folder, data) => {
  const file = path.join(PROJECT, folder, `${data.id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...data, createdAt: STAMP, updatedAt: STAMP }, null, 2)}\n`);
};
const beats = (...list) => list.map(([text, done], i) => ({ id: `b5e55${String(i).padStart(2, '0')}`, text, done: Boolean(done) }));

const S1 = 'sess_5e550001';
const S2 = 'sess_5e550002';
const S3 = 'sess_5e550003';

const sessions = [
  {
    id: S1, number: 1, title: 'The Halcyon Extraction', date: '2026-10-17', status: 'played',
    plan: beats(
      ['Cold open: Mama Ndiaye\'s note under the door', true],
      ['Meet at Mama Ndiaye\'s: the job, the pay, "no bodies"', true],
      ['Hand out the clinic floor plan', true],
      ['Tunnels under the Exec Zone; Chrome Vultures on guard', true],
      ['Shift change: get Dr. Hale out of the lab', true],
    ),
    cast: ['char_652e9dae', 'char_08fc73a4', 'story_c18274f7', 'fac_5ee40003', 'fac_5ee40002'],
    notes: 'Jinx sweet-talked the Vulture on the tunnel door instead of fighting: the Vultures remember her now.\n\nBrick took a round in the shoulder in the lab. Doc Haas patched him for free, and says he\'ll collect later.\n\nDr. Hale never let go of her briefcase. Nobody asked about it. Yet.',
    recap: 'Mama Ndiaye had a job: a Halcyon Biotics researcher, Dr. Imani Hale, wanted out, and Halcyon pays the NCPD too well for anyone to leave bodies.\n\nThe Static Saints went in under the Exec Zone through the old tunnels, talked their way past a Chrome Vulture on the door, and walked Dr. Hale out of her lab in the middle of a shift change. Brick caught a bullet on the way out; Doc Haas sewed him up next door.\n\nDr. Hale is safe at Mama Ndiaye\'s. She hasn\'t let go of her briefcase once.',
    recapShared: true,
  },
  {
    id: S2, number: 2, title: 'Patient Zero', date: '2026-10-31', status: 'played',
    plan: beats(
      ['Three days to keep Dr. Hale alive', true],
      ['Hale\'s shunt starts failing: the broadcast', true],
      ['Leak the Halcyon memo through Ledger', true],
      ['The Tin Man on the rooftops', true],
    ),
    cast: ['story_0ea5e98f', 'char_d692932b', 'item_092caff7', 'char_a14f1dad', 'fac_5ee40004'],
    notes: 'The party now knows the shunt is a beacon, not a medical implant. Dez wants to crack it; Patchwork wants it out of Hale\'s head.\n\nThe Tin Man got close enough to see. He didn\'t attack. Leave that hanging.\n\nLedger owes the crew a favour for the memo. He will pay it with the Cold Storage job.',
    recap: 'Keeping Dr. Hale alive for three days turned out to be the hard part. Her neural shunt began to fail, and as it failed it started to broadcast: Halcyon could hear it, and so could something else.\n\nLedger dug up a Halcyon memo that called Hale "Patient Zero" and her shunt "the asset". The crew read it twice.\n\nOn the third night the Tin Man came across the Watson rooftops, close enough to touch. He looked at Dr. Hale, and walked away.',
    recapShared: true,
  },
  {
    id: S3, number: 3, title: 'Cold Storage', date: '2026-11-14', status: 'planned',
    plan: beats(
      ['Ledger\'s contract: Dr. Imani Sato at the Port', false],
      ['Rumor at the docks: the ghosts of Yard 9', false],
      ['Intercepted message: decrypt it if Dez rolls well', false],
      ['A second crew arrives 20 minutes after the players', false],
      ['Who\'s in the reefer container? (don\'t say yet)', false],
    ),
    cast: ['char_a14f1dad', 'story_dfc2b605', 'story_48d99f92', 'fac_5ee40005', 'char_b91339e6'],
    notes: 'Prep: print the Yard 9 map, stat the second crew (use Hammerhead\'s block, minus the armor).\n\nIf they ask Ledger who the client is: he doesn\'t know, and that worries him.',
    recap: '',
    recapShared: false,
  },
].map(normalizeSession);

const handouts = [
  {
    id: 'hand_5e550001', title: 'Mama Ndiaye\'s note', style: 'note', session: S1, revealed: true,
    text: 'Got work for the Saints. Good money, clean hands.\n\nCome by after midnight. Use the back. Bring nobody.',
    from: '— Mama N.',
  },
  {
    id: 'hand_5e550002', title: 'Clinic floor plan', style: 'picture', session: S1, revealed: true,
    image: 'img_21ffa27c70a12b942a6a2f97', caption: 'Ground floor, the building over the tunnels. Doc Haas\'s clinic is next door.',
  },
  {
    id: 'hand_5e550003', title: 'Halcyon internal memo', style: 'document', session: S2, revealed: true,
    text: 'HALCYON BIOTICS · INTERNAL · RESTRICTED\n\nRE: Patient Zero\n\nThe asset left the Exec Zone facility at 02:14 with the subject. Recovery of the asset takes priority over recovery of the subject.\n\nThe asset\'s carrier signal will strengthen as the implant degrades. Field teams are to track it and wait. Do not engage third parties unless the asset is at risk.\n\nThis memo does not exist.',
    from: 'Office of the Director, Special Projects',
  },
  {
    id: 'hand_5e550004', title: 'Intercepted message', style: 'datapad', session: S3, revealed: false, obscure: 'encrypted',
    text: 'Second team green-lit for the Port. Arrive after the first crew, let them do the cutting. Take Sato and whatever she\'s carrying. Leave nobody who saw the container.',
    from: 'UNKNOWN SENDER',
  },
  {
    id: 'hand_5e550005', title: 'Ledger\'s contract', style: 'letter', session: S3, revealed: false,
    text: 'Saints,\n\nA client of mine, who prefers to stay a client, wants Dr. Imani Sato brought out of a cold-storage warehouse at the Port of Night City, alive, and delivered to a car waiting in Little China.\n\nNo corp security may tag her on the way out. Half up front, half on delivery.\n\nWe\'re square after this. Mostly.',
    from: 'Marcus "Ledger" Okonkwo',
  },
].map(normalizeHandout);

for (const s of sessions) write('sessions', s);
for (const h of handouts) write('handouts', h);
console.log(`${sessions.length} sessions, ${handouts.length} handouts`);

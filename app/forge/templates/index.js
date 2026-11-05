// Ready-made presets the designer can start from (New › template). Each template
// is { id, kind, name, description, build() }, where build() returns a preset that
// passes normalizePreset(). Opening one makes an unsaved copy with a fresh id.

import * as cyberpunkRedPlayer from './cyberpunk-red-player.js';
import { blackIce, demon, node } from './cyberpunk-red-net.js';

export const TEMPLATES = [cyberpunkRedPlayer, blackIce, demon, node];

/** The templates for one kind of preset. */
export const templatesFor = (kind) => TEMPLATES.filter((t) => t.kind === kind);

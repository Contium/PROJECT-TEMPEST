// Pushing views from the GM's window to the shared player screen.

import { el, panelHead, toast, toastError, confirmDialog } from './ui.js';

function pushed(ctx, label, view) {
  toast(`On screen: ${label}`, {
    tone: 'success',
    action: { label: 'Clear', run: () => ctx.api.push({ mode: 'ambient' }).catch(toastError) },
  });
  return view;
}

/** Push an entity's dossier. GM-only entities need revealing first (a tracked change). */
export async function pushEntity(ctx, entity) {
  try {
    if (entity.visibility === 'hidden') {
      const reveal = await confirmDialog({
        title: `Reveal ${entity.name}?`,
        body: `${entity.name} is GM only. Pushing it reveals it to players as Known (recorded in history, so you can undo it).`,
        confirmLabel: 'Reveal & push',
      });
      if (!reveal) return null;
      await ctx.api.batch({ note: `Revealed ${entity.name} on the player screen`, ops: [{ op: 'update', id: entity.id, patch: { visibility: 'known' } }] });
    }
    return pushed(ctx, entity.name, await ctx.api.push({ mode: 'entity', id: entity.id }));
  } catch (err) {
    toastError(err);
    return null;
  }
}

export async function pushRoster(ctx, typeId) {
  try {
    return pushed(ctx, ctx.typeLabel(typeId, true), await ctx.api.push({ mode: 'roster', type: typeId }));
  } catch (err) {
    toastError(err);
    return null;
  }
}

export async function pushImage(ctx, assetId, caption) {
  try {
    return pushed(ctx, caption ?? 'Handout', await ctx.api.push({ mode: 'handout', asset: assetId, caption }));
  } catch (err) {
    toastError(err);
    return null;
  }
}

export async function clearScreen(ctx) {
  try {
    await ctx.api.push({ mode: 'ambient' });
    toast('Player screen cleared', { tone: 'info' });
  } catch (err) {
    toastError(err);
  }
}

/** Dialog to compose and push a message / alert. */
export function pushMessageDialog(ctx) {
  const title = el('input', { class: 'tp-input', name: 'title', placeholder: 'e.g. INCOMING TRANSMISSION', maxlength: 120 });
  const text = el('textarea', { class: 'tp-textarea', name: 'text', required: true, placeholder: 'What the players see', maxlength: 2000 });
  const tone = el('select', { class: 'tp-select', name: 'tone' },
    el('option', { value: 'info' }, 'Info'), el('option', { value: 'success' }, 'Good news'),
    el('option', { value: 'warning' }, 'Warning'), el('option', { value: 'danger' }, 'Alert (flashing)'));
  const field = (label, input) => el('label', { class: 'tp-field' }, el('span', { class: 'tp-label' }, label), input);
  const dialog = el(
    'dialog',
    { class: 'tp-dialog' },
    el('form', { method: 'dialog', class: 'tp-frame tp-panel' },
      panelHead('Push a message'),
      el('div', { class: 'tp-panel__body' }, field('Heading (optional)', title), field('Message', text), field('Tone', tone)),
      el('footer', { class: 'tp-panel__foot app-actions' },
        el('button', { class: 'tp-frame tp-btn tp-btn--ghost', value: 'cancel', formnovalidate: true }, 'Cancel'),
        el('button', { class: 'tp-frame tp-btn tp-btn--primary', value: 'ok' }, 'Push to screen'))),
  );
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'ok' && text.value.trim()) {
      try {
        const view = await ctx.api.push({ mode: 'message', title: title.value, text: text.value, tone: tone.value });
        pushed(ctx, view.title ?? 'Message', view);
      } catch (err) {
        toastError(err);
      }
    }
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  text.focus();
}

/** Short label for what's on screen, for the GM's top bar. */
export function displayLabel(display, ctx, names) {
  switch (display?.mode) {
    case 'entity':
      return names?.get(display.id)?.name ?? ctx.typeLabel(display.type);
    case 'roster':
      return `${ctx.typeLabel(display.type, true)} (list)`;
    case 'handout':
      return display.caption ?? 'Handout image';
    case 'message':
      return display.title ?? display.text.slice(0, 40);
    default:
      return 'Default view';
  }
}

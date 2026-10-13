// Application state

type EntryView = 'tile' | 'table';

interface AppState {
  file: ArrayBuffer | null;
  filename: string;
  db: Kdbx | null;
  currentGroup: XmlElement | null;
  currentEntry: XmlElement | null;
  searchQuery: string;
  clipboardTimeout: number; // seconds
  curtainTimeout: number; // seconds idle before the curtain hides the page
  autoLockTimeout: number; // seconds idle before the database locks itself
  dirty: boolean; // unsaved edits exist
  baseVersion: string | null; // the stored version these edits build on, as the host names it (#74)
  sortField: EntrySortField;
  sortDir: EntrySortDirection;
  entryView: EntryView;
  columnVisibility: Record<EntryColumnKey, boolean>;
}

const app: AppState = {
  file: null,
  filename: '',
  db: null,
  currentGroup: null,
  currentEntry: null,
  searchQuery: '',
  clipboardTimeout: 30,
  curtainTimeout: 60,
  autoLockTimeout: 300,
  dirty: false,
  baseVersion: null,
  sortField: 'title',
  sortDir: 'asc',
  // Tile view reads better on narrow phones; this only sets the initial default.
  entryView: window.innerWidth <= 700 ? 'tile' : 'table',
  columnVisibility: {
    username: true,
    password: true,
    url: true,
    notes: false,
    attachments: false,
    modified: true,
    created: false,
  },
};

/* Whether a parent frame has handed this app a vault (see "Host integration").
Three states, not two: an embedded app whose host never answers resolves to
standalone rather than waiting forever (#83). */
type HostState = 'standalone' | 'awaiting' | 'hosted';
let hostState: HostState = 'standalone';

function isHosted(): boolean {
  return hostState === 'hosted';
}

// True while this tab holds a database: loaded, newly created, or locked (#66).
function hasDatabase(): boolean {
  return app.db !== null || app.file !== null;
}

// The one place app.dirty changes, so the persistent save indicator can never drift from it.
function setDirty(value: boolean): void {
  app.dirty = value;
  updateSaveIndicator();
}

// No-op off the entry list — the save button only exists in tpl-entry-list.
function updateSaveIndicator(): void {
  const btn = document.querySelector<HTMLButtonElement>('#root [data-action="save-database"]');
  if (!btn) return;
  btn.disabled = !app.dirty;
  btn.classList.toggle('unsaved', app.dirty);
}

// DOM helpers

// Unwrap a possibly-missing lookup, or fail loudly — a missing element means a real bug.
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return must(document.getElementById(id) as T | null);
}

// Clone a <template> and return the DocumentFragment.
function cloneTemplate(id: string): DocumentFragment {
  return byId<HTMLTemplateElement>(id).content.cloneNode(true) as DocumentFragment;
}

// Replace the #root content with the given fragment.
function setRoot(fragment: DocumentFragment): void {
  const root = byId('root');
  root.innerHTML = '';
  root.appendChild(fragment);
}

// Shorthand querySelector on #root.
function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  return must(byId('root').querySelector<T>(selector));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// A symbol from page.html's sprite, hidden from assistive tech so its control's title names it (#121).
function icon(symbol: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#icon-${symbol}`);
  svg.appendChild(use);
  return svg;
}

// An entry or group's own icon ahead of its name, outside the name's text (#121).
function labelWithIcon(target: HTMLElement, element: XmlElement, name: string): void {
  const lead = icon(iconName(elementIconId(element)));
  lead.classList.add('icon-lead');
  target.replaceChildren(lead, name);
}

// Icon button helper: this app's many small icon-only controls all share this exact shape.
function makeIconButton(
  className: string,
  title: string,
  symbol: string,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.title = title;
  btn.appendChild(icon(symbol));
  btn.addEventListener('click', onClick);
  return btn;
}

/* A pointer press moves focus to the button before the click lands, so a
control that acts on a field takes the caret out of that field; suppressing
the press's default leaves focus and caret exactly where they were, while a
keyboard user still reaches the button by tabbing to it (#72). */
function keepFieldFocus(button: HTMLElement): void {
  button.addEventListener('mousedown', (event) => event.preventDefault());
}

// Wire a dialog's ✕ button to close it, replacing a repeated line in every openXDialog.
function wireClose(dlg: HTMLDialogElement): void {
  must(dlg.querySelector<HTMLButtonElement>('[data-action="close"]')).onclick = () => dlg.close();
}

/** kdbx XML helpers and this file's own pure logic (entryField, etc. — see
logic.ts) are globals from bundle-iife's concatenation; see globals.d.ts. */

// Clipboard

let clipboardTimer: ReturnType<typeof setTimeout> | undefined;
let clipboardDeadline = 0; // Date.now() at which the copied value is cleared

/* Every clipboard write, copy or clear, takes its turn here and has its outcome
applied before the next one starts, so a late result can never undo a newer
one (#67, #88). */
let clipboardQueue: Promise<void> = Promise.resolve();

function writeClipboard(text: string, done: () => void, refused: (err: unknown) => void): void {
  clipboardQueue = clipboardQueue.then(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      refused(err);
      return;
    }
    done();
  });
}

const FIELD_LABELS: Record<string, string> = { UserName: 'Username' };

// KeePass's own field keys are not what the rest of the app calls them (#67).
function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/* Names the field, never the value (#67): the toast is a reminder that a secret
is on the clipboard, so it must not put that secret on screen as well. */
function showClipboardToast(label: string): void {
  byId('toast-message').textContent = `${label} copied to clipboard`;
  byId('toast-countdown').setAttribute('aria-hidden', 'true');
  byId('toast').hidden = false;
}

/* One timer drives both the countdown and the wipe (#67, #88), waking on each
whole second left so the toast is gone exactly when the clipboard is. */
function tickClipboard(): void {
  const left = clipboardDeadline - Date.now();
  if (left > 0) {
    byId('toast-countdown').textContent = `clears in ${Math.ceil(left / 1000)}s`;
    clipboardTimer = setTimeout(tickClipboard, left % 1000 || 1000);
    return;
  }
  clearClipboard();
}

/* Chromium refuses a clipboard write from an unfocused page, and Firefox and
Safari refuse one outside a click or keypress, so the timed clear can fail; it
then retries at the next of those rather than leaving the value behind (#88). */
const CLEAR_RETRY_EVENTS = ['focus', 'pointerdown', 'keydown'] as const;

function armClearRetry(armed: boolean): void {
  for (const type of CLEAR_RETRY_EVENTS) {
    if (armed) window.addEventListener(type, clearClipboard, true);
    else window.removeEventListener(type, clearClipboard, true);
  }
}

function clearClipboard(): void {
  writeClipboard(
    '',
    () => {
      armClearRetry(false);
      byId('toast').hidden = true;
    },
    () => {
      const countdown = byId('toast-countdown');
      countdown.setAttribute('aria-hidden', 'false'); // a one-off status, unlike the ticks, so it is announced (#88)
      countdown.textContent = 'clears when you next click or type';
      armClearRetry(true);
    },
  );
}

function clearClipboardNow(): void {
  if (byId('toast').hidden) return; // nothing of ours is on the clipboard
  clearTimeout(clipboardTimer);
  clearClipboard();
}

function copyToClipboard(text: string, label = 'Value'): void {
  writeClipboard(
    text,
    () => {
      clearTimeout(clipboardTimer);
      armClearRetry(false); // the new value restarts the clock
      showClipboardToast(label);
      clipboardDeadline = Date.now() + app.clipboardTimeout * 1000;
      tickClipboard();
    },
    (err) => console.error('Clipboard write failed', err),
  );
}

// Screen: Upload

function showUpload(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-upload'));
  publishTitle();

  const dropZone = qs('#drop-zone');
  const fileInput = qs<HTMLInputElement>('#file-input');

  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer?.files[0];
    if (f) handleFile(f);
  });

  qs('[data-action="create-database"]').addEventListener('click', () => showCreateDatabase());
}

async function handleFile(file: File): Promise<void> {
  app.filename = file.name;
  app.file = await file.arrayBuffer();
  showUnlock();
}

// Screen: Unlock

/** `relocking` is true only when arriving here from lockDatabase(), whose
edits were never actually persisted anywhere — everywhere else, unlocking
starts a database whose only state is what's on disk/the host, so nothing is
unsaved yet. Time away is also when a newer version may have been saved
elsewhere, so a relock asks the host first (#74). */
function showUnlock(relocking = false): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-unlock'));
  publishTitle();

  qs('#db-filename').textContent = app.filename;
  const passwordInput = qs<HTMLInputElement>('#master-password');
  passwordInput.focus();

  let keyfileData: Uint8Array | null = null;

  qs('[data-action="back"]').addEventListener('click', () => {
    app.file = null;
    app.filename = '';
    showUpload();
  });

  const togglePasswordBtn = qs('[data-action="toggle-password"]');
  keepFieldFocus(togglePasswordBtn);
  togglePasswordBtn.addEventListener('click', () => {
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
    togglePasswordBtn.replaceChildren(icon(passwordInput.type === 'password' ? 'eye' : 'eye-off'));
    passwordInput.focus(); // the next move is usually to type (#110)
  });

  const keyfileInput = qs<HTMLInputElement>('#keyfile-input');
  keyfileInput.addEventListener('change', async () => {
    const f = keyfileInput.files?.[0];
    if (f) {
      keyfileData = new Uint8Array(await f.arrayBuffer());
      qs('#keyfile-label').textContent = f.name;
    }
  });

  qs('#unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs<HTMLButtonElement>('#unlock-btn');
    const errorEl = qs('#unlock-error');
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    errorEl.hidden = true;

    try {
      const attempts = unlockAttempts(passwordInput.value, keyfileData).map(
        (input) => new Credentials(input),
      );
      const latest = relocking && isHosted() ? await requestCheck() : null;
      const notice =
        latest?.status === 'newer'
          ? await openNewer(attempts, latest)
          : await openHeld(attempts, latest?.status === 'gone');
      app.currentGroup = must(app.db).getRootGroup();
      app.searchQuery = '';
      setDirty(relocking && app.dirty);
      showEntryList();
      armIdleWatch();
      if (notice) showNotice(notice);
    } catch (err) {
      errorEl.textContent =
        err instanceof Error ? err.message : 'Incorrect credentials or corrupt file.';
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Unlock';
      passwordInput.focus();
    }
  });
}

// Screen: Create Database

function showCreateDatabase(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-create-database'));
  publishTitle();

  const nameInput = qs<HTMLInputElement>('#create-name');
  const passwordInput = qs<HTMLInputElement>('#create-password');
  const confirmInput = qs<HTMLInputElement>('#create-password-confirm');
  nameInput.focus();

  let keyfileData: Uint8Array | null = null;

  qs('[data-action="back"]').addEventListener('click', () => showUpload());

  const keyfileInput = qs<HTMLInputElement>('#create-keyfile-input');
  keyfileInput.addEventListener('change', async () => {
    const f = keyfileInput.files?.[0];
    if (f) {
      keyfileData = new Uint8Array(await f.arrayBuffer());
      qs('#create-keyfile-label').textContent = f.name;
    }
  });

  qs('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = qs<HTMLButtonElement>('#create-btn');
    const errorEl = qs('#create-error');
    errorEl.hidden = true;

    if (!passwordInput.value) {
      errorEl.textContent = 'Enter a master password.';
      errorEl.hidden = false;
      passwordInput.focus();
      return;
    }
    if (passwordInput.value !== confirmInput.value) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.hidden = false;
      confirmInput.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      const input: CredentialsInput = { password: passwordInput.value };
      if (keyfileData) input.keyFile = keyfileData;
      const creds = new Credentials(input);
      const databaseName = nameInput.value.trim() || 'Database';
      app.db = await Kdbx.create(creds, { databaseName });
      app.filename = `${databaseName}.kdbx`;
      app.currentGroup = app.db.getRootGroup();
      app.searchQuery = '';
      setDirty(true);
      showEntryList();
      armIdleWatch();
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : 'Could not create database.';
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Create';
    }
  });
}

// ============================================================
// Screen: Entry List
// ============================================================

function showEntryList(): void {
  document.body.classList.add('app-mode');
  setRoot(cloneTemplate('tpl-entry-list'));
  publishTitle();
  renderGroupTree();
  renderEntryPanel();
  wireEntryListEvents();
  updateSaveIndicator();
}

/** No-op outside the mobile drawer layout, where the sidebar toggle and
 * backdrop are invisible/unreachable — cheap to call unconditionally. */
function setSidebarOpen(open: boolean): void {
  qs('#sidebar').classList.toggle('sidebar-open', open);
  qs<HTMLElement>('#sidebar-backdrop').hidden = !open;
  const toggle = qs('[data-action="toggle-sidebar"]');
  toggle.replaceChildren(icon(open ? 'drawer-close' : 'drawer-open'));
  toggle.setAttribute('aria-label', open ? 'Hide groups' : 'Show groups');
}

const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 520;
const SIDEBAR_WIDTH_STEP = 16;

/* Null until the user adjusts the handle, so the rail opens at the CSS default
that fits 25 characters (#63); the width stays in memory because one silently
restored forever would be implicit state, yet it must survive a re-render. */
let sidebarWidth: number | null = null;

/* Sets the custom property rather than an inline width (#63); an inline width
outranks the drawer's own rule, so a rail widened on a desktop stayed that wide
once the viewport narrowed. */
function setSidebarWidth(px: number): void {
  sidebarWidth = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  qs('#sidebar-resize').setAttribute('aria-valuenow', String(sidebarWidth));
}

// The rail as rendered until the user picks a width; their choice after that (#63).
function currentSidebarWidth(): number {
  return sidebarWidth ?? qs('#sidebar').getBoundingClientRect().width;
}

/* Pointer events rather than mouse events (#63): one path covers mouse, touch
and pen, so the rail is resizable wherever it is visible. */
function wireSidebarResize(): void {
  const handle = qs<HTMLElement>('#sidebar-resize');
  handle.setAttribute('aria-valuemin', String(SIDEBAR_WIDTH_MIN));
  handle.setAttribute('aria-valuemax', String(SIDEBAR_WIDTH_MAX));
  if (sidebarWidth !== null) setSidebarWidth(sidebarWidth); // resync the fresh handle's aria

  handle.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    const startX = down.clientX;
    const startWidth = currentSidebarWidth();

    const onMove = (move: PointerEvent) => setSidebarWidth(startWidth + move.clientX - startX);
    const onDone = () => {
      handle.releasePointerCapture(down.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onDone);
      handle.removeEventListener('pointercancel', onDone);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onDone);
    handle.addEventListener('pointercancel', onDone);
  });

  handle.addEventListener('keydown', (key) => {
    if (key.key !== 'ArrowLeft' && key.key !== 'ArrowRight') return;
    key.preventDefault();
    const step = key.key === 'ArrowLeft' ? -SIDEBAR_WIDTH_STEP : SIDEBAR_WIDTH_STEP;
    setSidebarWidth(currentSidebarWidth() + step);
  });
}

/* The group whose ⋯ menu is open, not a flag (#63): the drawer shows ⋯ on every
row, so the menu belongs to a row rather than to the selection. */
let groupMenuFor: XmlElement | null = null;

function renderGroupTree(): void {
  const container = qs('#group-tree');
  container.innerHTML = '';
  const rootGroup = must(app.db).getRootGroup();
  const ul = document.createElement('ul');
  ul.className = 'group-list';
  ul.appendChild(buildGroupNode(rootGroup, true));
  container.appendChild(ul);
  // Deleting acts on the selection (#63); the root group is the database itself.
  const selected = must(app.currentGroup);
  qs<HTMLButtonElement>('#delete-group-btn').disabled =
    selected === rootGroup || isRecycleBinGroup(selected);
}

/* Opening ⋯ selects the row too (#63); the drawer shows ⋯ on every row, so
without this the header's delete could act on a different group than the menu
the user is looking at. */
function selectGroup(group: XmlElement): void {
  app.currentGroup = group;
  app.searchQuery = '';
  const searchInput = document.querySelector<HTMLInputElement>('#search-input');
  if (searchInput) searchInput.value = '';
  renderGroupTree();
  renderEntryPanel();
}

function buildGroupNode(group: XmlElement, isRoot: boolean): HTMLLIElement {
  const li = document.createElement('li');
  const row = document.createElement('div');
  const isActive = group === app.currentGroup;
  row.className = `group-row${isActive ? ' group-row-active' : ''}`;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `group-btn${isActive ? ' active' : ''}`;
  labelWithIcon(btn, group, groupName(group));
  btn.title = groupName(group); // the rail truncates; hover still gives the whole name (#63)
  btn.addEventListener('click', () => {
    groupMenuFor = null;
    selectGroup(group);
    setSidebarOpen(false);
  });
  row.appendChild(btn);

  // The root group represents the database itself — renamed via database
  // settings (its master password/name), not as an ordinary group, and
  // neither movable nor deletable.
  if (!isRoot) {
    row.appendChild(
      makeIconButton('icon-btn group-menu-btn', 'Group actions', 'more', () => {
        groupMenuFor = groupMenuFor === group ? null : group;
        selectGroup(group);
      }),
    );
  }

  li.appendChild(row);

  if (!isRoot && groupMenuFor === group) {
    li.appendChild(buildGroupMenu(group));
  }

  const subgroups = getChildren(group, 'Group');
  if (subgroups.length > 0) {
    const ul = document.createElement('ul');
    for (const sub of subgroups) {
      ul.appendChild(buildGroupNode(sub, false));
    }
    li.appendChild(ul);
  }

  return li;
}

function makeMenuItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'group-menu-item';
  btn.textContent = label;
  // Closing here, not in each action, also covers a dialog the user cancels (#63).
  btn.addEventListener('click', () => {
    groupMenuFor = null;
    renderGroupTree();
    onClick();
  });
  return btn;
}

function buildGroupMenu(group: XmlElement): HTMLDivElement {
  const menu = document.createElement('div');
  menu.className = 'group-menu';

  menu.appendChild(
    makeMenuItem('Rename', () => {
      openGroupDialog({ type: 'rename', group }, () => {
        renderGroupTree();
        renderEntryPanel();
      });
    }),
  );

  menu.appendChild(
    makeMenuItem('Move', () => {
      openMoveToDialog(
        'Move group to…',
        (candidate) => !isDescendantGroup(group, candidate),
        (destination) => moveGroupTo(group, destination),
      );
    }),
  );

  if (isTrashedGroup(group)) {
    menu.appendChild(makeMenuItem('Undelete', () => undeleteGroup(group)));
  }

  return menu;
}

/* The bin reports itself as inside itself (#63), so deleting it would take the
permanent branch and destroy every trashed item; it is never an ordinary
delete target. */
function isRecycleBinGroup(group: XmlElement): boolean {
  return isInRecycleBin(must(app.db).root, group) && !isTrashedGroup(group);
}

/* Tests the parent, not the group (#63): isInRecycleBin counts the bin as
containing itself, which would offer the bin an Undelete of its own. */
function isTrashedGroup(group: XmlElement): boolean {
  const db = must(app.db);
  const parent = findGroupParent(db.getRootGroup(), group);
  return parent !== null && isInRecycleBin(db.root, parent);
}

/* Restores to the root group (#63); KDBX records no previous location, so this
matches where a trashed entry is restored to. */
function undeleteGroup(group: XmlElement): void {
  moveGroupTo(group, must(app.db).getRootGroup());
}

/** Deselect (back to root) if the current selection is `group` or nested
 * inside it — used when a group is moved or trashed out from under the
 * user's current view. */
function resetSelectionIfAffected(rootGroup: XmlElement, group: XmlElement): void {
  if (app.currentGroup && isDescendantGroup(group, app.currentGroup)) {
    app.currentGroup = rootGroup;
    app.searchQuery = '';
  }
}

function moveGroupTo(group: XmlElement, destination: XmlElement): void {
  const rootGroup = must(app.db).getRootGroup();
  const parent = findGroupParent(rootGroup, group);
  if (parent && parent !== destination) {
    moveToGroup(group, parent, destination);
    setDirty(true);
  }
  renderGroupTree();
  renderEntryPanel();
}

function deleteGroupAction(group: XmlElement): void {
  // The row is about to move or vanish; its menu should not travel with it (#63).
  groupMenuFor = null;
  renderGroupTree();

  const db = must(app.db);
  const rootGroup = db.getRootGroup();

  // With the database's bin turned off, KeePass and KeePassXC delete outright (#132).
  if (isInRecycleBin(db.root, group) || !isRecycleBinEnabled(db.root)) {
    const entryCount = collectAllEntries(group).length;
    let entryWord = 'entries';
    if (entryCount === 1) {
      entryWord = 'entry';
    }
    openConfirmDelete(
      'Delete group?',
      `This group and its ${entryCount} ${entryWord} will be permanently deleted. This cannot be undone.`,
      () => {
        const parent = findGroupParent(rootGroup, group);
        if (parent) deletePermanently(db.root, group, parent);
        resetSelectionIfAffected(rootGroup, group);
        setDirty(true);
        renderGroupTree();
        renderEntryPanel();
      },
    );
    return;
  }

  /* Trashing is reversible, but a group carries its whole subtree with it, so
  it asks first (#63) where a single entry does not. */
  openConfirmDelete(
    'Move to Recycle Bin?',
    `"${groupName(group)}" and everything in it can be restored from the bin.`,
    () => {
      // Created inside the callback so cancelling leaves no empty bin behind.
      const bin = findOrCreateRecycleBin(db.root);
      resetSelectionIfAffected(rootGroup, group);
      moveGroupTo(group, bin);
    },
    'Move to Bin',
    false,
  );
}

function renderEntryPanel(): void {
  const panelTitle = qs('#panel-title');
  const listEl = qs('#entry-list');
  listEl.innerHTML = '';
  listEl.classList.toggle('entry-list--tile', app.entryView === 'tile');
  listEl.classList.toggle('entry-list--table', app.entryView === 'table');

  let rows: EntryWithGroup[];

  if (app.searchQuery) {
    panelTitle.textContent = `"${app.searchQuery}"`;
    const db = must(app.db);
    rows = filterEntriesByQuery(
      collectSearchableEntries(db.root, db.getRootGroup()),
      app.searchQuery,
    );
  } else {
    const currentGroup = must(app.currentGroup);
    panelTitle.textContent = groupName(currentGroup);
    rows = getChildren(currentGroup, 'Entry').map((entry) => ({
      entry,
      group: currentGroup,
    }));
  }

  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'entry-empty';
    empty.textContent = app.searchQuery ? 'No matches.' : 'No entries in this group.';
    listEl.appendChild(empty);
    return;
  }

  rows = sortEntries(rows, app.sortField, app.sortDir);

  if (app.entryView === 'table') {
    const table = buildEntryTable(rows);
    listEl.appendChild(table);
    publishColumnWidths(table);
  } else {
    for (const { entry, group } of rows) {
      listEl.appendChild(buildEntryRow(entry, group));
    }
  }
}

function buildEntryRow(entry: XmlElement, group: XmlElement): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'entry-row';

  const titleEl = document.createElement('div');
  titleEl.className = 'entry-row-title';
  labelWithIcon(titleEl, entry, entryTitle(entry));

  const metaEl = document.createElement('div');
  metaEl.className = 'entry-row-meta';

  if (app.searchQuery) {
    const path = groupPathTo(must(app.db).getRootGroup(), group);
    if (path) {
      const pathSpan = document.createElement('span');
      pathSpan.className = 'entry-row-path';
      pathSpan.textContent = path.join(' › ');
      metaEl.appendChild(pathSpan);
      metaEl.appendChild(document.createTextNode('  '));
    }
  }

  const username = entryField(entry, 'UserName');
  const url = entryField(entry, 'URL');
  metaEl.appendChild(document.createTextNode(username || url || ''));

  div.appendChild(titleEl);
  div.appendChild(metaEl);
  const href = openableUrl(url);
  if (href) div.appendChild(openUrlButton('open-hint', href));

  div.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.open-hint')) return; // opens the site, not the entry (#86)
    app.currentEntry = entry;
    showEntryDetail();
  });

  return div;
}

// ============================================================
// Entry list: table view
// ============================================================

const ENTRY_COLUMNS: ReadonlyArray<{ key: EntryColumnKey; label: string }> = [
  { key: 'username', label: 'Username' },
  { key: 'password', label: 'Password' },
  { key: 'url', label: 'URL' },
  { key: 'notes', label: 'Notes' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'modified', label: 'Modified' },
  { key: 'created', label: 'Created' },
];

/** Display text: dates formatted, password masked. entryColumnValue itself
 * (unmasked) is what a tap copies — see buildEntryTable. */
function entryColumnDisplayValue(entry: XmlElement, column: EntryColumnKey): string {
  const raw = entryColumnValue(entry, column);
  if (column === 'password') return raw ? '••••••••' : '';
  if (column === 'modified' || column === 'created') return formatDateTime(raw);
  return raw;
}

function openEntry(entry: XmlElement): void {
  app.currentEntry = entry;
  showEntryDetail();
}

/* A click copies (#67); opening the card is the row's own button instead. The
browser already decides what counts as a click, so a scroll that starts on a
cell copies nothing and a secondary button never reaches here at all. */
function wireCellCopy(cell: HTMLTableCellElement, value: string, label: string): void {
  cell.addEventListener('click', (event) => {
    // Anywhere but the cell's own buttons, which run their own handlers (#76, #86).
    if ((event.target as Element).closest('.copy-hint, .open-hint')) return;
    if (value) copyToClipboard(value, label);
  });
}

/* A button, not decoration (#67): dim at rest so hover only raises its emphasis,
and focusable so copying is reachable without a pointer at all. */
function copyHint(value: string, label: string): HTMLButtonElement {
  return makeIconButton('copy-hint', `Copy ${label.toLowerCase()}`, 'copy', () => {
    copyToClipboard(value, label);
  });
}

/* noopener and noreferrer, so the site neither learns where it was opened from
nor gets a handle back into this page (#86). */
function openUrlButton(className: string, href: string): HTMLButtonElement {
  return makeIconButton(className, 'Open URL in a new tab', 'open', () => {
    window.open(href, '_blank', 'noopener,noreferrer');
  });
}

/* The copy control leads, so it is plainly the value's own however short the
value is, and a long one can never push it out of the cell (#76, #87). The text
ellipsizes in its own box, so an open control after it stays in sight too. */
function buildEntryCell(
  display: string,
  value: string,
  label: string,
  action?: HTMLButtonElement,
): HTMLTableCellElement {
  const td = document.createElement('td');
  const inner = document.createElement('div');
  inner.className = 'entry-cell';
  if (value) inner.appendChild(copyHint(value, label));
  const text = document.createElement('span');
  text.className = 'entry-cell-text';
  text.textContent = display;
  inner.appendChild(text);
  if (action) inner.appendChild(action);
  td.appendChild(inner);
  wireCellCopy(td, value, label);
  return td;
}

const COLUMN_WIDTH_MIN = 80;
const COLUMN_WIDTH_MAX = 640;
const COLUMN_WIDTH_STEP = 16;

/* Widths stay in memory for the same reason the group rail's does (#63, #77):
one silently restored forever would be state nobody asked to keep, yet it has
to outlive the table, which is rebuilt from scratch on every render. */
const columnWidths = new Map<string, number>();

// The column as rendered until the user picks a width; their choice after that (#77).
function currentColumnWidth(th: HTMLTableCellElement): number {
  return columnWidths.get(must(th.dataset.column)) ?? th.getBoundingClientRect().width;
}

function setColumnWidth(th: HTMLTableCellElement, px: number): void {
  const width = Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, Math.round(px)));
  columnWidths.set(must(th.dataset.column), width);
  th.style.width = `${width}px`;
  must(th.querySelector<HTMLElement>('.col-resize')).setAttribute('aria-valuenow', String(width));
}

/* Pointer events rather than mouse events (#77), as the group rail does: one
path covers mouse, touch and pen, so a column resizes wherever it is visible. */
function addColumnHandle(th: HTMLTableCellElement, label: string): void {
  const handle = document.createElement('span');
  handle.className = 'col-resize';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', `Resize ${label} column`);
  handle.setAttribute('aria-valuemin', String(COLUMN_WIDTH_MIN));
  handle.setAttribute('aria-valuemax', String(COLUMN_WIDTH_MAX));

  handle.addEventListener('pointerdown', (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    const startX = down.clientX;
    const startWidth = currentColumnWidth(th);

    const onMove = (move: PointerEvent) => setColumnWidth(th, startWidth + move.clientX - startX);
    const onDone = () => {
      handle.releasePointerCapture(down.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onDone);
      handle.removeEventListener('pointercancel', onDone);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onDone);
    handle.addEventListener('pointercancel', onDone);
  });

  handle.addEventListener('keydown', (key) => {
    if (key.key !== 'ArrowLeft' && key.key !== 'ArrowRight') return;
    key.preventDefault();
    const step = key.key === 'ArrowLeft' ? -COLUMN_WIDTH_STEP : COLUMN_WIDTH_STEP;
    setColumnWidth(th, currentColumnWidth(th) + step);
  });

  th.appendChild(handle);
}

// Only as wide as its glyph, named for a screen reader, and not the user's to resize.
function narrowColumnHeader(className: string, label: string): HTMLTableCellElement {
  const th = document.createElement('th');
  th.className = className;
  const name = document.createElement('span');
  name.className = 'visually-hidden';
  name.textContent = label;
  th.appendChild(name);
  return th;
}

function buildColumnHeader(id: string, label: string): HTMLTableCellElement {
  const th = document.createElement('th');
  th.textContent = label;
  th.dataset.column = id;
  const chosen = columnWidths.get(id);
  if (chosen !== undefined) th.style.width = `${chosen}px`;
  addColumnHandle(th, label);
  return th;
}

/* A column only has a measurable width once the table is in the document, so
the starting value a screen reader reads out is published after it is attached
rather than while it is being built (#77). */
function publishColumnWidths(table: HTMLTableElement): void {
  for (const handle of table.querySelectorAll<HTMLElement>('.col-resize')) {
    const th = must(handle.parentElement) as HTMLTableCellElement;
    handle.setAttribute('aria-valuenow', String(Math.round(currentColumnWidth(th))));
  }
}

function buildEntryTable(rows: EntryWithGroup[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'entry-table';

  const visibleColumns = ENTRY_COLUMNS.filter((column) => app.columnVisibility[column.key]);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(narrowColumnHeader('entry-table-icon', 'Icon'));
  headRow.appendChild(buildColumnHeader('title', 'Title'));
  for (const column of visibleColumns) {
    headRow.appendChild(buildColumnHeader(column.key, column.label));
  }
  headRow.appendChild(narrowColumnHeader('entry-table-open', 'Open'));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const { entry } of rows) {
    const tr = document.createElement('tr');

    // The icon is the entry's, not the title's, so it keeps out of the copied text's cell (#87).
    const iconTd = document.createElement('td');
    iconTd.className = 'entry-table-icon';
    iconTd.appendChild(icon(iconName(elementIconId(entry))));
    tr.appendChild(iconTd);

    const titleTd = buildEntryCell(entryTitle(entry), entryTitle(entry), 'Title');
    titleTd.className = 'entry-table-title';
    tr.appendChild(titleTd);

    for (const column of visibleColumns) {
      const value = entryColumnValue(entry, column.key);
      const href = column.key === 'url' ? openableUrl(value) : null;
      const td = buildEntryCell(
        entryColumnDisplayValue(entry, column.key),
        value,
        column.label,
        href ? openUrlButton('open-hint', href) : undefined,
      );
      if (column.key === 'password') td.classList.add('entry-table-protected');
      tr.appendChild(td);
    }

    // The only way into the card, so opening to edit stays a deliberate act (#67).
    const openTd = document.createElement('td');
    openTd.className = 'entry-table-open';
    openTd.appendChild(makeIconButton('icon-btn', 'Open entry', 'chevron', () => openEntry(entry)));
    tr.appendChild(openTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  return table;
}

function buildColumnPickerMenu(): void {
  const menu = qs('#column-picker-menu');
  menu.innerHTML = '';
  for (const column of ENTRY_COLUMNS) {
    const label = document.createElement('label');
    label.className = 'column-picker-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = app.columnVisibility[column.key];
    checkbox.addEventListener('change', () => {
      app.columnVisibility[column.key] = checkbox.checked;
      renderEntryPanel();
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${column.label}`));
    menu.appendChild(label);
  }
}

function updateViewToggleUI(): void {
  qs('[data-action="view-tile"]').classList.toggle('active', app.entryView === 'tile');
  qs('[data-action="view-table"]').classList.toggle('active', app.entryView === 'table');
  qs<HTMLButtonElement>('#column-picker-btn').hidden = app.entryView !== 'table';
  qs<HTMLElement>('#column-picker-menu').hidden = true;
  qs<HTMLElement>('#panel-menu').classList.remove('panel-menu-open');
}

/* An unattended screen gets two responses (#84). After a short idle the curtain
hides the page from anyone glancing at it and lifts with a click; after a long
one the database locks, re-encrypting the current state with unsaved edits
included, so it can fire without asking anything of someone who has walked
away (#64). */
let lastActivity = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let locking = false; // re-encrypting, with the page about to give way to the unlock screen (#84)

function curtain(): HTMLDialogElement {
  return byId<HTMLDialogElement>('dlg-curtain');
}

function noteActivity(): void {
  if (!curtain().open) lastActivity = Date.now(); // behind the curtain, only lifting it counts (#84)
}

// Wakes at the next deadline and measures from the latest input, so input costs nothing (#84).
function checkIdle(): void {
  if (locking) return;
  const idle = Date.now() - lastActivity;
  const lockAt = app.autoLockTimeout * 1000;
  if (idle >= lockAt) {
    void lockDatabase();
    return;
  }
  const curtainAt = app.curtainTimeout < app.autoLockTimeout ? app.curtainTimeout * 1000 : lockAt;
  if (idle >= curtainAt && !curtain().open) curtain().showModal();
  idleTimer = setTimeout(checkIdle, (idle < curtainAt ? curtainAt : lockAt) - idle);
}

function rescheduleIdleCheck(): void {
  clearTimeout(idleTimer);
  checkIdle();
}

function armIdleWatch(): void {
  lastActivity = Date.now();
  rescheduleIdleCheck();
}

function liftCurtain(): void {
  if (locking) return; // the lock lifts it, once there is nothing left to show (#84)
  curtain().close();
  armIdleWatch();
}

// A background tab's timers can run late, so coming back checks at once (#84).
function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && app.db !== null) rescheduleIdleCheck();
}

/** Re-encrypts the current in-memory state (including anything not yet
saved) rather than reloading the original file, so locking never loses an
edit on its own — only choosing to discard at the prompt above does that. */
async function lockDatabase(): Promise<void> {
  if (locking) return;
  locking = true;
  clearTimeout(idleTimer);
  clearClipboardNow(); // a copied secret must not outlast the lock (#88)
  try {
    const bytes = await must(app.db).save();
    app.file = bytes.buffer as ArrayBuffer;
    Object.assign(app, { db: null, currentGroup: null, currentEntry: null, searchQuery: '' });
    showUnlock(true);
    curtain().close(); // only now, so the re-encrypting page never shows through (#84)
  } finally {
    locking = false;
  }
}

function closeDatabase(): void {
  clearTimeout(idleTimer);
  Object.assign(app, {
    db: null,
    file: null,
    filename: '',
    baseVersion: null,
    currentGroup: null,
    currentEntry: null,
    searchQuery: '',
  });
  setDirty(false);
  if (isHosted()) {
    closeToHost();
  } else {
    clearClipboardNow(); // a copied secret must not outlast the database (#88)
    showUpload();
  }
}

/* A copied secret must not outlast the database, and the host tears this frame
down on kw-close along with any clipboard write still in flight, so the close
waits for the clear to land (#88). */
function closeToHost(): void {
  clearClipboardNow();
  void clipboardQueue.then(() => postToHost(closeMessage()));
}

function wireEntryListEvents(): void {
  qs<HTMLInputElement>('#search-input').addEventListener('input', (e) => {
    app.searchQuery = (e.target as HTMLInputElement).value.trim();
    renderEntryPanel();
  });

  const sortSelect = qs<HTMLSelectElement>('#sort-select');
  sortSelect.value = `${app.sortField}:${app.sortDir}`;
  sortSelect.addEventListener('change', () => {
    const [field, direction] = sortSelect.value.split(':') as [EntrySortField, EntrySortDirection];
    app.sortField = field;
    app.sortDir = direction;
    renderEntryPanel();
  });

  qs('[data-action="save-database"]').addEventListener('click', openSaveDialog);

  qs('[data-action="lock"]').addEventListener('click', () => {
    confirmUnsavedChanges(
      {
        title: 'Lock without saving?',
        message:
          "Your edits will stay in this tab, but they still haven't been saved anywhere else.",
        discardLabel: 'Lock Anyway',
        discardDanger: false,
      },
      lockDatabase,
    );
  });

  qs('[data-action="close"]').addEventListener('click', () => {
    confirmUnsavedChanges(DISCARD_PROMPT, closeDatabase, CLOSE_PROMPT);
  });

  qs('[data-action="settings"]').addEventListener('click', openSettings);
  qs('[data-action="export"]').addEventListener('click', () => {
    confirmUnsavedChanges(
      {
        title: 'Export without saving?',
        message:
          'The export reflects your current edits, but the database itself has not been saved yet.',
        discardLabel: 'Export Anyway',
        discardDanger: false,
      },
      openExportDialog,
    );
  });

  qs('[data-action="add-entry"]').addEventListener('click', () => {
    const newEntry = createEntry({});
    appendChild(must(app.currentGroup), newEntry);
    app.currentEntry = newEntry;
    setDirty(true);
    showEntryEdit(true);
  });

  qs('[data-action="add-group"]').addEventListener('click', () => {
    openGroupDialog({ type: 'create', parent: must(app.currentGroup) }, () => showEntryList());
  });

  qs('[data-action="delete-group"]').addEventListener('click', () => {
    deleteGroupAction(must(app.currentGroup));
  });

  wireSidebarResize();

  qs('[data-action="view-tile"]').addEventListener('click', () => {
    app.entryView = 'tile';
    updateViewToggleUI();
    renderEntryPanel();
  });

  qs('[data-action="view-table"]').addEventListener('click', () => {
    app.entryView = 'table';
    updateViewToggleUI();
    renderEntryPanel();
  });

  qs('[data-action="toggle-columns"]').addEventListener('click', () => {
    const menu = qs<HTMLElement>('#column-picker-menu');
    menu.hidden = !menu.hidden;
  });

  qs('[data-action="toggle-sidebar"]').addEventListener('click', () => {
    setSidebarOpen(!qs('#sidebar').classList.contains('sidebar-open'));
  });

  qs('#sidebar-backdrop').addEventListener('click', () => setSidebarOpen(false));

  qs('[data-action="toggle-panel-menu"]').addEventListener('click', () => {
    qs('#panel-menu').classList.toggle('panel-menu-open');
  });

  buildColumnPickerMenu();
  updateViewToggleUI();
}

/* What someone pressing find wants is an entry, not a word on the screen in
front of them, and the search field looks through the whole database rather
than the page (#78). The edit screen keeps the browser's own find: it holds
typing nobody has committed, and leaving would throw it away. */
function startFind(): boolean {
  if (app.db === null) return false;
  // A dialog holds the keyboard while it is open, so the list behind it is not the subject.
  if (document.querySelector('dialog[open]') !== null) return false;
  if (document.querySelector('#root .screen-edit') !== null) return false;
  if (document.querySelector('#root .screen-detail') !== null) {
    app.currentEntry = null;
    showEntryList();
  }
  const search = qs<HTMLInputElement>('#search-input');
  search.focus();
  search.select();
  return true;
}

// ============================================================
// Screen: Entry Detail
// ============================================================

function formatDateTime(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function showEntryDetail(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-entry-detail'));

  const entry = must(app.currentEntry);
  labelWithIcon(qs('#detail-title'), entry, entryTitle(entry));

  const times = getEntryTimes(entry);
  const metaParts = [
    `Created ${formatDateTime(times.created)}`,
    `Modified ${formatDateTime(times.modified)}`,
  ];
  if (times.expires && times.expiryTime) {
    metaParts.push(`Expires ${formatDateTime(times.expiryTime)}`);
  }
  qs('#detail-meta').textContent = metaParts.join(' · ');

  const tagsEl = qs('#detail-tags');
  for (const tag of getEntryTags(entry)) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    tagsEl.appendChild(chip);
  }

  const fieldsEl = qs('#detail-fields');

  for (const string of getChildren(entry, 'String')) {
    const keyEl = getChild(string, 'Key');
    const valueEl = getChild(string, 'Value');
    if (!keyEl || !valueEl) continue;

    const key = getText(keyEl);
    const value = getText(valueEl);
    const isProtected = getAttribute(valueEl, 'Protected') === 'True';

    fieldsEl.appendChild(buildDetailField(key, value, isProtected));
  }

  const db = must(app.db);
  renderDetailAttachments(db, entry, qs('#detail-attachments'));
  renderDetailHistory(db, entry, qs('#detail-history'));

  qs('[data-action="back"]').addEventListener('click', () => {
    app.currentEntry = null;
    showEntryList();
  });

  qs('[data-action="edit"]').addEventListener('click', () => {
    showEntryEdit(false);
  });

  qs('[data-action="move-entry"]').addEventListener('click', () => {
    openMoveToDialog(
      'Move entry to…',
      () => true,
      (destination) => {
        const parent = findEntryParent(db.getRootGroup(), entry);
        if (parent && parent !== destination) {
          moveToGroup(entry, parent, destination);
          setDirty(true);
        }
        app.currentEntry = null;
        showEntryList();
      },
    );
  });

  qs('[data-action="print"]').addEventListener('click', () => window.print());

  // Deleting is "Trash" (reversible, moves into the recycle bin) unless the
  // entry is already inside the bin, where it's "Restore" or a permanent,
  // confirmed "Delete" instead; with the bin turned off, only "Delete" (#132).
  const parentGroup = findEntryParent(db.getRootGroup(), entry);
  const inBin = parentGroup !== null && isInRecycleBin(db.root, parentGroup);
  const permanent = inBin || !isRecycleBinEnabled(db.root);

  const trashBtn = qs<HTMLButtonElement>('[data-action="trash"]');
  const restoreBtn = qs<HTMLButtonElement>('[data-action="restore"]');
  const deleteBtn = qs<HTMLButtonElement>('[data-action="delete"]');
  trashBtn.hidden = permanent;
  restoreBtn.hidden = !inBin;
  deleteBtn.hidden = !permanent;

  trashBtn.addEventListener('click', () => {
    const bin = findOrCreateRecycleBin(db.root);
    const parent = findEntryParent(db.getRootGroup(), entry);
    if (parent && parent !== bin) {
      moveToGroup(entry, parent, bin);
      setDirty(true);
    }
    app.currentEntry = null;
    showEntryList();
  });

  restoreBtn.addEventListener('click', () => {
    const rootGroup = db.getRootGroup();
    const parent = findEntryParent(rootGroup, entry);
    if (parent && parent !== rootGroup) {
      moveToGroup(entry, parent, rootGroup);
      setDirty(true);
    }
    app.currentEntry = null;
    showEntryList();
  });

  deleteBtn.addEventListener('click', () => {
    openConfirmDelete('Delete entry?', 'This cannot be undone.', () => {
      const parent = findEntryParent(db.getRootGroup(), entry);
      if (parent) {
        deletePermanently(db.root, entry, parent);
        setDirty(true);
      }
      app.currentEntry = null;
      showEntryList();
    });
  });
}

function buildDetailField(key: string, value: string, isProtected: boolean): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'detail-field';

  const label = document.createElement('div');
  label.className = 'detail-label';
  label.textContent = key;

  const valueWrap = document.createElement('div');
  valueWrap.className = 'detail-value-wrap';

  const valueSpan = document.createElement('span');
  valueSpan.className = `detail-value${isProtected ? ' protected' : ''}`;
  valueSpan.textContent = isProtected ? '••••••••' : value;

  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  if (isProtected) {
    let revealed = false;
    const revealBtn = makeIconButton('icon-btn', 'Show / hide', 'eye', () => {
      revealed = !revealed;
      valueSpan.textContent = revealed ? value : '••••••••';
      revealBtn.replaceChildren(icon(revealed ? 'eye-off' : 'eye'));
    });
    actions.appendChild(revealBtn);
  }

  const href = key === 'URL' ? openableUrl(value) : null;
  if (href) actions.appendChild(openUrlButton('icon-btn', href));

  // Leads the value, as copy does everywhere, so it is plainly that value's (#87).
  const copyBtn = makeIconButton('icon-btn', 'Copy', 'copy', () => {
    copyToClipboard(value, fieldLabel(key));
  });

  valueWrap.appendChild(copyBtn);
  valueWrap.appendChild(valueSpan);
  valueWrap.appendChild(actions);
  row.appendChild(label);
  row.appendChild(valueWrap);
  return row;
}

function renderDetailAttachments(db: Kdbx, entry: XmlElement, container: HTMLElement): void {
  container.innerHTML = '';
  for (const [index, attachment] of getEntryAttachments(entry).entries()) {
    const row = document.createElement('div');
    row.className = 'attachment-row';

    const label = document.createElement('span');
    label.className = 'attachment-name';
    label.textContent = attachment.name;

    const downloadBtn = makeIconButton('icon-btn', 'Download', 'download', () => {
      /* Looked up on click: a save can renumber stored attachments under an open
      card, while anything that changes the attachments themselves redraws it (#119). */
      const { ref } = getEntryAttachments(entry)[index] as EntryAttachment;
      const data = db.getBinaryData(ref);
      if (!data) return;
      const blob = new Blob([new Uint8Array(data)]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    row.appendChild(label);
    row.appendChild(downloadBtn);
    container.appendChild(row);
  }
}

function renderDetailHistory(db: Kdbx, entry: XmlElement, container: HTMLElement): void {
  container.innerHTML = '';
  // Newest first: getEntryHistory() returns them in append (oldest-first) order.
  for (const snapshot of getEntryHistory(entry).slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'history-row';

    const label = document.createElement('span');
    label.className = 'history-label';
    const times = getEntryTimes(snapshot);
    label.textContent = `${formatDateTime(times.modified)} — ${entryTitle(snapshot)}`;

    const restoreBtn = makeIconButton('icon-btn', 'Restore this version', 'restore', () => {
      restoreHistoryEntry(db.root, entry, snapshot);
      setDirty(true);
      showEntryDetail();
    });

    const deleteBtn = makeIconButton('icon-btn', 'Delete this version', 'trash', () => {
      deleteHistoryEntry(entry, snapshot);
      setDirty(true);
      renderDetailHistory(db, entry, container);
    });

    row.appendChild(label);
    row.appendChild(restoreBtn);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  }
}

// ============================================================
// Screen: Entry Edit
// ============================================================

// A picked file stays bytes until Save adds it to the database (#109).
type EditAttachment = EntryAttachment | { name: string; data: Uint8Array };

function showEntryEdit(isNew: boolean): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-entry-edit'));

  const entry = must(app.currentEntry);
  qs('#edit-title').textContent = isNew ? 'New Entry' : 'Edit Entry';

  // Held until Save, like the fields, so Cancel changes nothing (#109).
  let pickedIconId: number | undefined;
  const attachments: EditAttachment[] = getEntryAttachments(entry);

  const iconBtn = qs<HTMLButtonElement>('#edit-icon-btn');
  iconBtn.replaceChildren(icon(iconName(elementIconId(entry))));
  iconBtn.addEventListener('click', () => {
    openIconPicker((iconId) => {
      pickedIconId = iconId;
      iconBtn.replaceChildren(icon(iconName(String(iconId))));
    });
  });

  qs<HTMLInputElement>('#edit-tags').value = getEntryTags(entry).join(', ');

  const expiresCheckbox = qs<HTMLInputElement>('#edit-expires');
  const expiryInput = qs<HTMLInputElement>('#edit-expiry-time');
  const times = getEntryTimes(entry);
  // ExpiryTime is always populated from creation (kx_createTimes()' own
  // default), even on an entry that has never actually expired — only show
  // it when Expires is genuinely on, so an old entry doesn't silently
  // prefill a stale, possibly past, date the moment the box is checked.
  expiresCheckbox.checked = times.expires;
  expiryInput.disabled = !times.expires;
  expiryInput.value =
    times.expires && times.expiryTime ? isoToLocalInputValue(times.expiryTime) : '';
  expiresCheckbox.addEventListener('change', () => {
    expiryInput.disabled = !expiresCheckbox.checked;
    if (expiresCheckbox.checked && !expiryInput.value) {
      expiryInput.value = defaultExpiryLocalInputValue();
    }
  });

  const fieldsEl = qs('#edit-fields');

  for (const string of getChildren(entry, 'String')) {
    const keyEl = getChild(string, 'Key');
    const valueEl = getChild(string, 'Value');
    if (!keyEl || !valueEl) continue;
    const key = getText(keyEl);
    const value = getText(valueEl);
    const isProtected = getAttribute(valueEl, 'Protected') === 'True';
    fieldsEl.appendChild(buildEditField(key, value, isProtected, isCustomField(key)));
  }
  if (isNew) must(fieldsEl.querySelector<HTMLElement>('.edit-value')).focus(); // Title, ready to type (#89)

  qs('[data-action="add-field"]').addEventListener('click', () => {
    fieldsEl.appendChild(buildEditField('', '', false, true));
  });

  const attachmentsList = qs('#edit-attachments');
  renderEditAttachments(attachments, attachmentsList);
  qs<HTMLInputElement>('#edit-attachment-input').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    attachments.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    renderEditAttachments(attachments, attachmentsList);
    input.value = '';
  });

  qs('[data-action="cancel"]').addEventListener('click', () => {
    if (isNew) {
      const parent = findEntryParent(must(app.db).getRootGroup(), entry);
      if (parent) parent.children = parent.children.filter((c) => c !== entry);
      app.currentEntry = null;
      showEntryList();
    } else {
      showEntryDetail();
    }
  });

  /* Everything Save writes, as the form shows it. An untouched form saves nothing, so
  no History copy or newer time makes a stale entry win a merge in another client (#134). */
  const formState = (): string =>
    JSON.stringify([
      Array.from(fieldsEl.querySelectorAll<HTMLElement>('.edit-field'), (row) => [
        must(row.querySelector<HTMLInputElement>('.edit-key')).value,
        must(row.querySelector<HTMLInputElement | HTMLTextAreaElement>('.edit-value')).value,
        row.dataset.protected,
      ]),
      String(pickedIconId ?? elementIconId(entry)),
      qs<HTMLInputElement>('#edit-tags').value,
      expiresCheckbox.checked,
      expiryInput.value,
      attachments.map((held) => [held.name, 'data' in held ? -1 : held.ref]),
    ]);
  const untouched = formState();

  qs('[data-action="save"]').addEventListener('click', () => {
    if (!isNew && formState() === untouched) {
      showEntryDetail();
      return;
    }
    commitEdits(entry, fieldsEl, isNew, pickedIconId, attachments);
  });
}

function renderEditAttachments(attachments: EditAttachment[], container: HTMLElement): void {
  container.innerHTML = '';
  for (const attachment of attachments) {
    const row = document.createElement('div');
    row.className = 'attachment-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'attachment-name';
    nameInput.value = attachment.name;
    nameInput.addEventListener('change', () => {
      const newName = nameInput.value.trim();
      if (newName) attachment.name = newName;
      renderEditAttachments(attachments, container);
    });

    const removeBtn = makeIconButton('icon-btn', 'Remove attachment', 'remove', () => {
      attachments.splice(attachments.indexOf(attachment), 1);
      renderEditAttachments(attachments, container);
    });

    row.appendChild(nameInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
  }
}

function buildEditField(
  key: string,
  value: string,
  isProtected: boolean,
  removable: boolean,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'edit-field';
  row.dataset.protected = isProtected ? '1' : '0';

  const keyInput = document.createElement('input');
  keyInput.className = 'edit-key';
  keyInput.type = 'text';
  keyInput.value = key;
  keyInput.placeholder = 'Field name';
  keyInput.readOnly = !removable;

  /* A single-line input drops line breaks, so Notes and custom fields (multi-line in KeePass
  and KeePassXC) and any value already holding one get a box that keeps them (#89, #126). */
  const lines = value.split(/\r\n|\r|\n/).length;
  const multiLine = key === 'Notes' || isCustomField(key) || lines > 1;
  const valueInput = document.createElement(multiLine ? 'textarea' : 'input');
  valueInput.className = 'edit-value';
  valueInput.value = value;
  valueInput.placeholder = 'Value';
  if (multiLine) {
    // Notes opens with room to write; any other box is as tall as its value.
    valueInput.setAttribute('rows', String(Math.max(lines, key === 'Notes' ? 5 : 1)));
  }
  if (multiLine && isProtected) {
    // What a password input gets on its own: no spell checker or autocorrect reads it.
    valueInput.setAttribute('spellcheck', 'false');
    valueInput.setAttribute('autocapitalize', 'off');
    valueInput.setAttribute('autocorrect', 'off');
  }

  // Kept apart from the row's own spacing so they sit close together (#89); copy
  // leads the value, as it does everywhere, and the rest follow it (#87).
  const lead = document.createElement('span');
  lead.className = 'edit-actions';
  const actions = document.createElement('span');
  actions.className = 'edit-actions';

  row.appendChild(keyInput);
  row.appendChild(lead);
  row.appendChild(valueInput);
  row.appendChild(actions);

  if (isProtected) {
    let concealed = false;
    const toggleConcealed = (): void => {
      concealed = !concealed;
      // A password input can't hold line breaks, so a multi-line box is masked by CSS (#126).
      if (multiLine) valueInput.classList.toggle('concealed', concealed);
      else valueInput.setAttribute('type', concealed ? 'password' : 'text');
    };
    toggleConcealed();
    const toggle = makeIconButton('icon-btn', 'Show / hide', 'eye', () => {
      toggleConcealed();
      toggle.replaceChildren(icon(concealed ? 'eye' : 'eye-off'));
      valueInput.focus(); // the next move is usually to edit the value (#110)
    });
    keepFieldFocus(toggle);
    actions.appendChild(toggle);
  }

  const copyBtn = makeIconButton('icon-btn', 'Copy', 'copy', () => {
    // Copies whatever is currently typed, not the value the field opened
    // with — the user may have already edited it.
    copyToClipboard(valueInput.value, fieldLabel(keyInput.value) || 'Value');
  });
  keepFieldFocus(copyBtn);
  lead.appendChild(copyBtn);

  if (key === 'Password') {
    const generateBtn = makeIconButton('icon-btn', 'Generate password', 'dice', () => {
      openPasswordGenerator((password) => {
        valueInput.value = password;
      });
    });
    keepFieldFocus(generateBtn);
    actions.appendChild(generateBtn);
  }

  if (removable) {
    const removeBtn = makeIconButton('icon-btn', 'Remove field', 'remove', () => row.remove());
    removeBtn.style.color = 'var(--danger)';
    actions.appendChild(removeBtn);
  }

  return row;
}

function commitEdits(
  entry: XmlElement,
  fieldsEl: HTMLElement,
  isNew: boolean,
  pickedIconId: number | undefined,
  attachments: EditAttachment[],
): void {
  const db = must(app.db);
  const rows = Array.from(fieldsEl.querySelectorAll<HTMLElement>('.edit-field'));
  const fields = rows.map((row) => ({
    key: must(row.querySelector<HTMLInputElement>('.edit-key')).value.trim(),
    value: must(row.querySelector<HTMLInputElement | HTMLTextAreaElement>('.edit-value')).value,
    protect: row.dataset.protected === '1',
  }));
  const duplicate = duplicateFieldName(fields);
  if (duplicate !== null) {
    const errorEl = qs('#edit-error');
    errorEl.textContent = `More than one field is named "${duplicate}". Rename or remove one, then save.`;
    errorEl.hidden = false;
    // The later one is likelier the one just added or renamed.
    const row = must(rows[fields.map((field) => field.key).lastIndexOf(duplicate)]);
    must(row.querySelector<HTMLInputElement>('.edit-key')).focus();
    return;
  }

  // A brand-new entry has no prior state worth keeping — only snapshot when
  // editing one that already existed, matching real KeePass.
  if (!isNew) {
    pushHistorySnapshot(db.root, entry);
  }
  applyEntryEdits(entry, fields);

  if (pickedIconId !== undefined) {
    // createEntry() always appends an IconID child, so this is always present.
    setText(getChild(entry, 'IconID') as XmlElement, String(pickedIconId));
  }
  for (const { name } of getEntryAttachments(entry)) removeEntryAttachment(entry, name);
  for (const held of attachments) {
    addEntryAttachment(entry, held.name, 'data' in held ? db.addBinary(held.data) : held.ref);
  }

  const tagsInput = qs<HTMLInputElement>('#edit-tags');
  setEntryTags(entry, tagsInput.value.split(/[,;]/));

  const expiresCheckbox = qs<HTMLInputElement>('#edit-expires');
  const expiryInput = qs<HTMLInputElement>('#edit-expiry-time');
  setEntryExpiry(
    entry,
    expiresCheckbox.checked,
    expiryInput.value ? localInputValueToIso(expiryInput.value) : '',
  );
  touchLastModified(entry);

  setDirty(true);

  // Return to detail, then prompt to save
  showEntryDetail();
  openSaveDialog();
}

// ============================================================
// Dialog: Settings
// ============================================================

function openSettings(): void {
  const dlg = byId<HTMLDialogElement>('dlg-settings');
  const timeoutInput = byId<HTMLInputElement>('clipboard-timeout');
  timeoutInput.value = String(app.clipboardTimeout);
  const curtainInput = byId<HTMLInputElement>('curtain-timeout');
  curtainInput.value = String(app.curtainTimeout);
  const autoLockInput = byId<HTMLInputElement>('auto-lock-timeout');
  autoLockInput.value = String(app.autoLockTimeout);

  const newPasswordInput = byId<HTMLInputElement>('settings-new-password');
  const confirmInput = byId<HTMLInputElement>('settings-new-password-confirm');
  const keyfileInput = byId<HTMLInputElement>('settings-keyfile-input');
  const keyfileLabel = byId('settings-keyfile-label');
  const errorEl = byId('settings-security-error');
  newPasswordInput.value = '';
  confirmInput.value = '';
  keyfileInput.value = '';
  keyfileLabel.textContent = 'No file chosen';
  errorEl.hidden = true;

  // The app never retains the original key file's bytes past unlock/create,
  // so changing the master key means re-supplying the whole credential set —
  // matching real KeePass's own "Change Master Key" dialog.
  let keyfileData: Uint8Array | null = null;
  keyfileInput.onchange = async () => {
    const f = keyfileInput.files?.[0];
    if (f) {
      keyfileData = new Uint8Array(await f.arrayBuffer());
      keyfileLabel.textContent = f.name;
    }
  };

  must(dlg.querySelector<HTMLButtonElement>('[data-action="save-settings"]')).onclick = () => {
    const v = Number.parseInt(timeoutInput.value, 10);
    if (isValidClipboardTimeout(v)) app.clipboardTimeout = v;
    const curtainDelay = Number.parseInt(curtainInput.value, 10);
    if (isValidCurtainTimeout(curtainDelay)) app.curtainTimeout = curtainDelay;
    const autoLock = Number.parseInt(autoLockInput.value, 10);
    if (isValidAutoLockTimeout(autoLock)) app.autoLockTimeout = autoLock;
    armIdleWatch(); // the new delays count from now (#84)

    if (newPasswordInput.value || confirmInput.value) {
      if (newPasswordInput.value !== confirmInput.value) {
        errorEl.textContent = 'Passwords do not match.';
        errorEl.hidden = false;
        return;
      }
      const input: CredentialsInput = { password: newPasswordInput.value };
      if (keyfileData) input.keyFile = keyfileData;
      must(app.db).setCredentials(new Credentials(input));
      setDirty(true);
    }

    dlg.close();
  };
  wireClose(dlg);
  dlg.showModal();
}

// ============================================================
// Dialog: Export
// ============================================================

function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openExportDialog(): void {
  const dlg = byId<HTMLDialogElement>('dlg-export');
  const baseName = app.filename.replace(/\.kdbx$/i, '') || 'entries';

  must(dlg.querySelector<HTMLButtonElement>('[data-action="export-csv"]')).onclick = () => {
    downloadTextFile(toCsv(must(app.db).getRootGroup()), `${baseName}.csv`, 'text/csv');
    dlg.close();
  };
  must(dlg.querySelector<HTMLButtonElement>('[data-action="export-xml"]')).onclick = () => {
    downloadTextFile(must(app.db).exportXml(), `${baseName}.xml`, 'application/xml');
    dlg.close();
  };
  wireClose(dlg);
  dlg.showModal();
}

// ============================================================
// Dialog: Save / Download
// ============================================================

// Escape closes a <dialog> on its own, which an expired session must not allow (#85).
function blockDismiss(event: Event): void {
  event.preventDefault();
}

function setSaveStatus(status: HTMLElement, text: string, kind?: 'ok' | 'error'): void {
  status.hidden = false;
  status.className = kind === undefined ? 'save-status' : `save-status ${kind}`;
  status.textContent = text;
}

/* Every state the save-capable dialogs can be in. Each dialog turns one of
these into its whole footer in a single pass, because every defect this flow
produced came from one path updating a subset of the controls and leaving the
rest as some earlier state had left them (#85). */
type DialogState =
  | 'normal'
  | 'saving'
  | 'retrying'
  | 'saved'
  | 'expired'
  | 'recovered'
  | 'locked-out'
  | 'conflict'
  | 'merging'
  | 'conflict-copied';

const EXPIRED_MESSAGE =
  'Your session with the storage provider expired. Reconnect to save, or download a copy.';
const LOCKED_OUT_MESSAGE = 'The database locked while this dialog was open. Unlock it to save.';
const CONFLICT_MESSAGE =
  'The stored file changed since it was opened here, and saving would overwrite that. Merge the change in, then save again, or download a copy.';

// Why a merge found nothing to merge, for each answer that isn't a newer version (#74).
const NOT_MERGED: Record<'unchanged' | 'gone' | 'unknown', string> = {
  unchanged: 'Nothing newer is stored now, so save again.',
  gone: 'The file was removed or replaced in storage. Download a copy to keep your changes.',
  unknown: 'Could not fetch the version saved elsewhere. Try again, or download a copy.',
};

interface ExpiredSession {
  status: HTMLElement;
  reconnectBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  mergeBtn: HTMLButtonElement;
  /** The only way this dialog's controls change, and total over all of them. */
  apply: (state: DialogState) => void;
  retrySave: () => Promise<void>;
}

function showExpired(session: ExpiredSession): void {
  setSaveStatus(session.status, EXPIRED_MESSAGE, 'error');
  session.apply('expired');
  session.reconnectBtn.focus(); // the control that had focus was just hidden
}

function showConflict(session: ExpiredSession): void {
  setSaveStatus(session.status, CONFLICT_MESSAGE, 'error');
  session.apply('conflict');
  session.mergeBtn.focus();
}

/** Merge in the version saved elsewhere that refused this save, by KeePass's
rules (packages/kdbx), leaving the result unsaved to review and save again (#74). */
async function runMerge(session: ExpiredSession, dlg: HTMLDialogElement): Promise<void> {
  setSaveStatus(session.status, 'Bringing in the version saved elsewhere…');
  session.apply('merging');
  const latest = await requestCheck();
  const db = app.db;
  if (db === null) {
    setSaveStatus(session.status, LOCKED_OUT_MESSAGE, 'error');
    session.apply('locked-out');
    return;
  }
  if (latest.status !== 'newer') {
    setSaveStatus(session.status, NOT_MERGED[latest.status], 'error');
    session.apply(latest.status === 'unchanged' ? 'normal' : 'conflict');
    return;
  }
  let summary: MergeSummary;
  try {
    summary = await db.mergeIn(new Uint8Array(latest.bytes));
  } catch {
    setSaveStatus(
      session.status,
      "The version saved elsewhere couldn't be opened or read with this database's credentials. Download a copy to keep your changes.",
      'error',
    );
    session.apply('conflict');
    return;
  }
  app.baseVersion = latest.version;
  setDirty(true);
  dlg.close();
  // What was on screen may have changed or gone, so the merged database is shown from the top.
  Object.assign(app, { currentGroup: db.getRootGroup(), currentEntry: null, searchQuery: '' });
  showEntryList();
  showNotice(mergeNotice(summary, latest.savedAt));
}

/** Renew the credential, then let the dialog's own save run again. Both
dialogs route through here so neither can answer an expired session its own
way (#85). */
async function runReconnect(session: ExpiredSession): Promise<void> {
  setSaveStatus(session.status, 'Reconnecting…');
  session.reconnectBtn.disabled = true;
  session.downloadBtn.disabled = true;
  const result = await requestReconnect();
  if (!result.ok) {
    setSaveStatus(
      session.status,
      result.error ? `Reconnect failed: ${result.error}` : 'Reconnect failed.',
      'error',
    );
    session.apply('expired');
    return;
  }
  if (app.db === null) {
    setSaveStatus(session.status, LOCKED_OUT_MESSAGE, 'error');
    session.apply('locked-out');
    return;
  }
  await session.retrySave();
}

/* Auto-lock runs off its own timer and does not care that a dialog is open, so
the database can be gone before either control is used; locking re-encrypted
the edits, leaving nothing here to save or copy (#85). */
async function runDownload(session: ExpiredSession, conflicted = false): Promise<void> {
  if (app.db === null) {
    setSaveStatus(session.status, LOCKED_OUT_MESSAGE, 'error');
    session.apply('locked-out');
    return;
  }
  try {
    downloadCopy(await must(app.db).save());
  } catch {
    // A throw here would leave the held dialog with no status and no way out (#85).
    setSaveStatus(session.status, 'Could not prepare a copy to download.', 'error');
    session.apply(conflicted ? 'conflict' : 'expired');
    return;
  }
  // A copy on disk means the edits are no longer stranded, so the dialog lets go.
  const next = conflicted ? 'Merge' : 'Reconnect';
  setSaveStatus(session.status, `Copy downloaded. ${next} to save back to the provider.`);
  session.apply(conflicted ? 'conflict-copied' : 'recovered');
}

function openSaveDialog(): void {
  const dlg = byId<HTMLDialogElement>('dlg-save');

  // In a host session (opened from the cloud connector), saving writes back to
  // the provider rather than downloading; the two destinations are mutually
  // exclusive so the flow stays unambiguous. Standalone, only Download shows.
  const localMsg = must(dlg.querySelector<HTMLElement>('[data-role="save-local"]'));
  const hostMsg = must(dlg.querySelector<HTMLElement>('[data-role="save-host"]'));
  const status = must(dlg.querySelector<HTMLElement>('[data-role="save-status"]'));
  const downloadBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="download"]'));
  const hostBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="save-host"]'));
  const reconnectBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="reconnect"]'));
  const mergeBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="merge"]'));
  const laterBtn = must(dlg.querySelector<HTMLButtonElement>('[data-role="save-later"]'));
  const dismissBtns = Array.from(dlg.querySelectorAll<HTMLButtonElement>('[data-action="close"]'));

  function apply(state: DialogState): void {
    const expired = state === 'expired';
    // A copy being out does not make the provider current, so recovery stays offered.
    const offeringRecovery = expired || state === 'recovered';
    const conflicted = state === 'conflict' || state === 'merging' || state === 'conflict-copied';
    /* Nothing may dismiss: while expired or in conflict the edits exist nowhere
    but this tab, and a save in flight reports here, including an expired
    session that only this dialog can recover (#85, #74). */
    const held =
      expired ||
      state === 'retrying' ||
      state === 'saving' ||
      state === 'conflict' ||
      state === 'merging';
    // Still asking its original question, rather than reporting an outcome.
    const asking = state === 'normal' || state === 'saving' || state === 'recovered';

    for (const btn of dismissBtns) {
      btn.hidden = held;
      btn.onclick = () => dlg.close();
    }
    // Retrying no longer makes sense once the save has landed, so the footer
    // collapses to a single acknowledgement.
    laterBtn.textContent = state === 'saved' ? 'Close' : 'Later';
    dlg.removeEventListener('cancel', blockDismiss);
    if (held) dlg.addEventListener('cancel', blockDismiss);

    hostBtn.hidden = !(asking && isHosted());
    hostBtn.disabled = state === 'saving';
    hostBtn.onclick = () => void saveToHost();

    reconnectBtn.hidden = !offeringRecovery;
    reconnectBtn.disabled = false;
    reconnectBtn.onclick = () => void runReconnect(session);

    mergeBtn.hidden = !conflicted;
    mergeBtn.disabled = state === 'merging';
    mergeBtn.onclick = () => void runMerge(session, dlg);

    const copying = offeringRecovery || conflicted;
    downloadBtn.hidden = copying ? false : !(asking && !isHosted());
    downloadBtn.disabled = state === 'merging';
    downloadBtn.textContent = copying ? 'Download a copy' : 'Download';
    downloadBtn.className = copying ? 'btn btn-secondary' : 'btn btn-primary';
    downloadBtn.onclick = copying
      ? () => void runDownload(session, conflicted)
      : () => void downloadAndClose();
  }

  async function downloadAndClose(): Promise<void> {
    await performSave();
    dlg.close();
  }

  async function saveToHost(held = false): Promise<void> {
    setSaveStatus(status, 'Saving…');
    apply(held ? 'retrying' : 'saving');
    const result = await performSave();
    if (result.ok) {
      setSaveStatus(status, 'Saved.', 'ok');
      apply('saved');
      return;
    }
    if (result.reason === 'auth-expired') {
      showExpired(session);
      return;
    }
    if (result.reason === 'conflict') {
      showConflict(session);
      return;
    }
    setSaveStatus(status, result.error ? `Save failed: ${result.error}` : 'Save failed.', 'error');
    apply('normal');
  }

  const session: ExpiredSession = {
    status,
    reconnectBtn,
    downloadBtn,
    mergeBtn,
    apply,
    retrySave: () => saveToHost(true),
  };

  status.hidden = true;
  status.textContent = '';
  status.className = 'save-status';
  localMsg.hidden = isHosted();
  hostMsg.hidden = !isHosted();
  apply('normal');

  dlg.showModal();
}

/** Persists the current database: a download standalone, a write-back to the
host when embedded. The host round trip is asynchronous (kw-save/kw-saved);
a download is not, but both are awaited here so every caller sees one
consistent, awaitable outcome regardless of destination. Never rejects —
failure comes back as `{ ok: false }` so callers can show it inline rather
than an unhandled rejection. */
function downloadCopy(bytes: Uint8Array): void {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = app.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* The held retry state removes every way out of the dialog, so a host that
never answers a save would seal it shut; same budget as the reconnect (#85). */
const SAVE_TIMEOUT_MS = 120_000;

async function performSave(): Promise<SaveResult> {
  let bytes: Uint8Array;
  try {
    bytes = await must(app.db).save();
  } catch {
    /* The held states hide every way out of the dialog, so a throw on this side
    would seal the edits in rather than report them; the timeout below only
    covers a host that goes quiet, not a failure here (#85). */
    return { ok: false, error: 'could not prepare the database' };
  }

  if (!isHosted()) {
    downloadCopy(bytes);
    setDirty(false);
    return { ok: true };
  }

  lastSaveId += 1;
  const id = lastSaveId;
  // Copy into a fresh, exactly-sized ArrayBuffer for the structured clone.
  const base = app.baseVersion ?? undefined; // the host refuses to replace any other version (#74)
  postToHost(saveMessage(id, app.filename, new Uint8Array(bytes).buffer, base));
  const result = await new Promise<SaveResult>((resolve) => {
    const settle = (value: SaveResult): void => {
      window.clearTimeout(timer);
      pendingSaves.delete(id);
      resolve(value);
    };
    const timer = window.setTimeout(
      () => settle({ ok: false, error: 'the provider did not answer' }),
      SAVE_TIMEOUT_MS,
    );
    pendingSaves.set(id, settle);
  });
  if (result.ok) {
    if (result.version !== undefined) app.baseVersion = result.version;
    setDirty(false);
  }
  return result;
}

// ============================================================
// Dialog: Generate Password
// ============================================================

function openPasswordGenerator(onUse: (password: string) => void): void {
  const dlg = byId<HTMLDialogElement>('dlg-generate-password');
  const lengthInput = byId<HTMLInputElement>('generator-length');
  const upperInput = byId<HTMLInputElement>('generator-upper');
  const lowerInput = byId<HTMLInputElement>('generator-lower');
  const digitsInput = byId<HTMLInputElement>('generator-digits');
  const symbolsInput = byId<HTMLInputElement>('generator-symbols');
  const preview = byId<HTMLElement>('generator-preview');
  const errorEl = byId<HTMLElement>('generator-error');

  function regenerate(): void {
    errorEl.hidden = true;
    try {
      preview.textContent = generatePassword({
        length: Number.parseInt(lengthInput.value, 10),
        upper: upperInput.checked,
        lower: lowerInput.checked,
        digits: digitsInput.checked,
        symbols: symbolsInput.checked,
      });
    } catch (err) {
      preview.textContent = '';
      errorEl.textContent = err instanceof Error ? err.message : 'Could not generate a password.';
      errorEl.hidden = false;
    }
  }

  for (const input of [lengthInput, upperInput, lowerInput, digitsInput, symbolsInput]) {
    input.oninput = regenerate;
  }
  must(dlg.querySelector<HTMLButtonElement>('[data-action="regenerate"]')).onclick = regenerate;
  must(dlg.querySelector<HTMLButtonElement>('[data-action="use-password"]')).onclick = () => {
    if (!preview.textContent) return;
    onUse(preview.textContent);
    dlg.close();
  };
  wireClose(dlg);

  regenerate();
  dlg.showModal();
}

// ============================================================
// Dialog: Confirm Discard
// ============================================================

interface UnsavedChangesPrompt {
  title: string;
  message: string;
  discardLabel: string;
  discardDanger: boolean; // true for an actual loss of edits (Close); false when nothing is lost (Lock, Export)
}

// Shared by every trigger where discarding really does throw the edits away.
const DISCARD_PROMPT: UnsavedChangesPrompt = {
  title: 'Discard unsaved changes?',
  message: 'You have unsaved changes that will be lost.',
  discardLabel: 'Discard',
  discardDanger: true,
};

/* Closing loses no data once everything is saved, so this asks without the
danger styling a real discard gets; it asks at all because reopening the
database can cost another sign-in or another hunt for the file (#66). */
const CLOSE_PROMPT: UnsavedChangesPrompt = {
  title: 'Close this database?',
  message: 'Opening it again means finding and unlocking the file.',
  discardLabel: 'Close',
  discardDanger: false,
};

/** Run `proceed` immediately when nothing is at stake. With unsaved edits,
ask: discard, save first, or cancel — reused by closing, locking, exporting,
and a host's close request. `cleanPrompt`, passed only by the paths that give
the database up, asks a cheaper question when nothing is unsaved but
reopening would still cost a sign-in or a hunt for the file (#66). */
function confirmUnsavedChanges(
  prompt: UnsavedChangesPrompt,
  proceed: () => void,
  cleanPrompt?: UnsavedChangesPrompt,
): void {
  let active = prompt;
  if (!app.dirty) {
    if (cleanPrompt === undefined || !hasDatabase()) {
      proceed();
      return;
    }
    active = cleanPrompt;
  }

  const dlg = byId<HTMLDialogElement>('dlg-confirm-discard');
  byId('confirm-discard-title').textContent = active.title;
  byId('confirm-discard-message').textContent = active.message;
  const status = must(dlg.querySelector<HTMLElement>('[data-role="confirm-discard-status"]'));
  status.hidden = true;
  status.textContent = '';
  status.className = 'save-status';

  const downloadBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="download"]'));
  const reconnectBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="reconnect"]'));
  const mergeBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="merge"]'));
  const cancelBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-discard"]'));
  const discardBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="confirm-discard"]'));
  const saveBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="confirm-save"]'));

  // With no Save beside it, confirming is the dialog's only affirmative action (#66).
  let discardStyle = app.dirty ? 'btn-secondary' : 'btn-primary';
  if (active.discardDanger) discardStyle = 'btn-danger';

  function apply(state: DialogState): void {
    const expired = state === 'expired';
    const offeringRecovery = expired || state === 'recovered';
    const conflicted = state === 'conflict' || state === 'merging' || state === 'conflict-copied';
    /* The same hold as the save dialog, with a second reason of its own: this
    prompt runs proceed() on success, so a cancel landing mid-save would close a
    database the user just backed out of (#85). */
    const held =
      expired ||
      state === 'retrying' ||
      state === 'saving' ||
      state === 'conflict' ||
      state === 'merging';
    const asking = state === 'normal' || state === 'saving' || state === 'recovered';

    cancelBtn.hidden = held;
    cancelBtn.onclick = () => dlg.close();
    dlg.removeEventListener('cancel', blockDismiss);
    if (held) dlg.addEventListener('cancel', blockDismiss);

    /* Discarding is what actually throws the edits away, so it waits with Save.
    A locked database keeps its edits in app.file behind the unlock screen, and
    proceeding would tear the frame down and take them with it (#85). */
    discardBtn.hidden = held || state === 'locked-out';
    discardBtn.disabled = state === 'saving';
    discardBtn.textContent = active.discardLabel;
    discardBtn.className = `btn ${discardStyle}`;
    discardBtn.onclick = () => {
      dlg.close();
      proceed();
    };

    // There is nothing to save when the prompt is only about closing.
    saveBtn.hidden = !(asking && app.dirty);
    saveBtn.disabled = state === 'saving';
    saveBtn.textContent = isHosted() ? 'Save' : 'Download';
    saveBtn.onclick = () => void saveThenProceed();

    reconnectBtn.hidden = !offeringRecovery;
    reconnectBtn.disabled = false;
    reconnectBtn.onclick = () => void runReconnect(session);

    // A merge leaves edits to review, so it ends this prompt rather than proceeding (#74).
    mergeBtn.hidden = !conflicted;
    mergeBtn.disabled = state === 'merging';
    mergeBtn.onclick = () => void runMerge(session, dlg);

    downloadBtn.hidden = !(offeringRecovery || conflicted);
    downloadBtn.disabled = state === 'merging';
    downloadBtn.textContent = 'Download a copy';
    downloadBtn.className = 'btn btn-secondary';
    downloadBtn.onclick = () => void runDownload(session, conflicted);
  }

  async function saveThenProceed(held = false): Promise<void> {
    setSaveStatus(status, 'Saving…');
    apply(held ? 'retrying' : 'saving');
    const result = await performSave();
    if (result.ok) {
      dlg.close();
      proceed();
      return;
    }
    if (result.reason === 'auth-expired') {
      showExpired(session);
      return;
    }
    if (result.reason === 'conflict') {
      showConflict(session);
      return;
    }
    setSaveStatus(status, result.error ? `Save failed: ${result.error}` : 'Save failed.', 'error');
    apply('normal');
  }

  const session: ExpiredSession = {
    status,
    reconnectBtn,
    downloadBtn,
    mergeBtn,
    apply,
    retrySave: () => saveThenProceed(true),
  };

  apply('normal');
  dlg.showModal();
  saveBtn.focus();
}

// ============================================================
// Newer versions saved elsewhere (#74)
// ============================================================

interface Notice {
  title: string;
  message: string;
  items?: string[];
}

function showNotice(notice: Notice): void {
  const dlg = byId<HTMLDialogElement>('dlg-notice');
  byId('notice-title').textContent = notice.title;
  byId('notice-message').textContent = notice.message;
  const list = byId('notice-list');
  list.innerHTML = '';
  for (const item of notice.items ?? []) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  list.hidden = list.children.length === 0;
  for (const btn of dlg.querySelectorAll<HTMLButtonElement>('[data-action="close"]')) {
    btn.onclick = () => dlg.close();
  }
  dlg.showModal();
}

function savedWhen(savedAt: string | undefined): string {
  return savedAt === undefined ? '' : ` at ${formatDateTime(savedAt)}`;
}

function mergeNotice(summary: MergeSummary, savedAt: string | undefined): Notice {
  const saved = `This database was also saved elsewhere${savedWhen(savedAt)}`;
  const changes =
    summary.changed === 1 ? '1 change from there is' : `${summary.changed} changes from there are`;
  const notice: Notice = {
    title: 'Merged with the version saved elsewhere',
    message:
      summary.changed === 0
        ? `${saved}, with nothing your copy here lacked. Save when ready.`
        : `${saved}. ${changes} now merged with your unsaved changes here; review them, then save.`,
  };
  if (summary.conflicts.length > 0) {
    notice.message +=
      ' These entries changed in both places, and each keeps the other version in its History:';
    notice.items = summary.conflicts.map((title) => title || '(untitled)');
  }
  return notice;
}

// Open with the first of these that works, which the database then keeps; the last one's error otherwise (#127).
async function loadWithAny(bytes: Uint8Array, attempts: Credentials[]): Promise<Kdbx> {
  const [first, ...rest] = attempts as [Credentials, ...Credentials[]];
  try {
    return await Kdbx.load(bytes, first);
  } catch (err) {
    if (rest.length === 0) throw err;
    return loadWithAny(bytes, rest);
  }
}

async function openHeld(attempts: Credentials[], gone: boolean): Promise<Notice | null> {
  app.db = await loadWithAny(new Uint8Array(must(app.file)), attempts);
  if (!gone) return null;
  return {
    title: 'This file is gone from storage',
    message:
      'It was removed or replaced since it was opened here, so saving back will fail. Download a copy to keep this database.',
  };
}

async function opens(bytes: Uint8Array, attempts: Credentials[]): Promise<boolean> {
  try {
    await loadWithAny(bytes, attempts);
    return true;
  } catch {
    return false;
  }
}

/** Open the version saved elsewhere while this tab was locked. With nothing
unsaved here it replaces this copy; with unsaved edits the two are merged by
KeePass's rules and the result left unsaved to review. Throws what the unlock
screen should say when these credentials can't do either. */
async function openNewer(
  attempts: Credentials[],
  newer: Extract<CheckResult, { status: 'newer' }>,
): Promise<Notice> {
  const bytes = new Uint8Array(newer.bytes);
  const when = savedWhen(newer.savedAt);
  if (!app.dirty) {
    try {
      app.db = await loadWithAny(bytes, attempts);
    } catch {
      throw new Error(`The version saved elsewhere${when} doesn't open with these credentials.`);
    }
    app.file = newer.bytes;
    app.baseVersion = newer.version;
    return {
      title: 'Opened the newer version',
      message: `This database was saved elsewhere${when}, so that version is open now.`,
    };
  }

  let db: Kdbx;
  try {
    db = await loadWithAny(new Uint8Array(must(app.file)), attempts);
  } catch (err) {
    if (await opens(bytes, attempts)) {
      throw new Error(
        `These credentials open the version saved elsewhere${when}, but your unsaved changes here are locked with the previous ones. Enter those to merge the two.`,
      );
    }
    throw err;
  }
  app.db = db;
  try {
    const summary = await db.mergeIn(bytes);
    app.baseVersion = newer.version;
    return mergeNotice(summary, newer.savedAt);
  } catch {
    return {
      title: 'Could not merge',
      message: `The version saved elsewhere${when} couldn't be opened or read with these credentials, so your unsaved changes here aren't merged into it, and saving here will be refused. Download a copy to keep them.`,
    };
  }
}

// ============================================================
// Dialog: Confirm Delete
// ============================================================

function openConfirmDelete(
  title: string,
  message: string,
  callback: () => void,
  confirmLabel = 'Delete',
  danger = true,
): void {
  const dlg = byId<HTMLDialogElement>('dlg-confirm-delete');
  byId('confirm-delete-title').textContent = title;
  byId('confirm-delete-message').textContent = message;

  const confirmBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]'));
  confirmBtn.textContent = confirmLabel;
  confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

  confirmBtn.onclick = () => {
    dlg.close();
    callback();
  };
  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-delete"]')).onclick = () =>
    dlg.close();

  dlg.showModal();
}

// ============================================================
// Dialog: Icon Picker
// ============================================================

function openIconPicker(onPick: (iconId: number) => void): void {
  const dlg = byId<HTMLDialogElement>('dlg-icon-picker');
  const grid = byId<HTMLElement>('icon-grid');
  grid.innerHTML = '';

  for (const [iconId, choice] of ICON_PALETTE.entries()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-grid-btn';
    btn.title = choice.label;
    btn.appendChild(icon(choice.icon));
    btn.addEventListener('click', () => {
      onPick(iconId);
      dlg.close();
    });
    grid.appendChild(btn);
  }

  wireClose(dlg);
  dlg.showModal();
}

// ============================================================
// Dialog: New Group
// ============================================================

type GroupDialogMode =
  | { type: 'create'; parent: XmlElement }
  | { type: 'rename'; group: XmlElement };

function openGroupDialog(mode: GroupDialogMode, onDone: () => void): void {
  const dlg = byId<HTMLDialogElement>('dlg-new-group');
  const nameInput = byId<HTMLInputElement>('new-group-name');
  const titleEl = byId('new-group-title');
  const submitBtn = must(dlg.querySelector<HTMLButtonElement>('[data-action="create-group"]'));

  // 48 is Folder, KeePass's own default for a new group (#121).
  let selectedIconId = mode.type === 'rename' ? Number.parseInt(elementIconId(mode.group), 10) : 48;
  if (mode.type === 'rename') {
    titleEl.textContent = 'Rename group';
    submitBtn.textContent = 'Save';
    nameInput.value = groupName(mode.group);
  } else {
    titleEl.textContent = 'New group';
    submitBtn.textContent = 'Create';
    nameInput.value = '';
  }

  const iconBtn = byId<HTMLButtonElement>('new-group-icon-btn');
  iconBtn.replaceChildren(icon(iconName(String(selectedIconId))));
  iconBtn.onclick = () => {
    openIconPicker((iconId) => {
      selectedIconId = iconId;
      iconBtn.replaceChildren(icon(iconName(String(selectedIconId))));
    });
  };

  submitBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    if (mode.type === 'rename') {
      // createGroup() always appends Name/IconID children, so both are always present.
      setText(getChild(mode.group, 'Name') as XmlElement, name);
      setText(getChild(mode.group, 'IconID') as XmlElement, String(selectedIconId));
      touchLastModified(mode.group);
    } else {
      const newGroup = createGroup(name);
      setText(getChild(newGroup, 'IconID') as XmlElement, String(selectedIconId));
      appendChild(mode.parent, newGroup);
      app.currentGroup = newGroup;
    }
    setDirty(true);
    dlg.close();
    onDone();
  };

  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-group"]')).onclick = () =>
    dlg.close();
  wireClose(dlg);

  // Allow Enter to submit
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      submitBtn.click();
    }
  };

  dlg.showModal();
  nameInput.focus();
}

function openMoveToDialog(
  title: string,
  isValidTarget: (candidate: XmlElement) => boolean,
  onPick: (destination: XmlElement) => void,
): void {
  const dlg = byId<HTMLDialogElement>('dlg-move-to');
  byId('move-to-title').textContent = title;
  const treeEl = byId('move-to-tree');
  treeEl.innerHTML = '';

  const buildNode = (group: XmlElement): HTMLLIElement => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'move-to-btn';
    labelWithIcon(btn, group, groupName(group));
    btn.disabled = !isValidTarget(group);
    btn.addEventListener('click', () => {
      dlg.close();
      onPick(group);
    });
    li.appendChild(btn);

    const subgroups = getChildren(group, 'Group');
    if (subgroups.length > 0) {
      const ul = document.createElement('ul');
      for (const sub of subgroups) ul.appendChild(buildNode(sub));
      li.appendChild(ul);
    }
    return li;
  };

  const rootUl = document.createElement('ul');
  rootUl.className = 'move-to-list';
  rootUl.appendChild(buildNode(must(app.db).getRootGroup()));
  treeEl.appendChild(rootUl);

  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-move"]')).onclick = () =>
    dlg.close();
  wireClose(dlg);

  dlg.showModal();
}

// ============================================================
// Host integration (optional)
// ============================================================
//
// This app is self-contained: opened directly, it never talks to another
// window, and everything below is dormant. When it is embedded in an
// equivalent-origin parent frame — any chooser page, e.g. the local-file page or
// the Google Drive connector — that parent can hand it a vault to open and
// receive the edited vault back, without the app reimplementing any of its
// own file handling.
//
// The message shapes and guards are shared with every host in
// packages/embed-protocol, rather than hand-checked here, so the app and host
// side of the protocol can't drift out of sync with each other:
//   app  → host : kw-ready          app booted, send a vault or a create instruction
//   host → app  : kw-open           open this vault (filename, bytes: ArrayBuffer, version?)
//   host → app  : kw-create         start a brand-new, empty vault
//   host → app  : kw-find           host saw the find keystroke; take it
//   app  → host : kw-save           user saved; please persist (id, filename, bytes, base?)
//   host → app  : kw-saved          result of the persist with that id (id, ok, error?, reason?, version?)
//   app  → host : kw-check          is a newer version than this one stored? (base?)
//   host → app  : kw-checked        unchanged, newer (bytes, version, savedAt?), gone, or unknown
//   app  → host : kw-reconnect      the host credential expired; please renew it
//   host → app  : kw-reconnected    result of that renewal (ok, error?)
//   host → app  : kw-close-request  host wants to remove this iframe; may I?
//   app  → host : kw-close-ack      request received; outcome follows as kw-close, or not at all
//   app  → host : kw-close          app is closing: its own ✕, or consent to a close request
//
// Every inbound message is checked to come from the parent frame at the origin
// peerOrigin accepts; anything else is ignored. Nothing here runs unless the
// app is actually framed, so standalone use is entirely unaffected.

const PEER = peerOrigin(window.location.protocol, window.location.origin);
const HOST_REPLY_GRACE_MS = 1000;

// This page's own title, kept so a closed database can hand the tab back (#65).
const BASE_TITLE = document.title;

interface SaveResult {
  ok: boolean;
  error?: string;
  reason?: 'auth-expired' | 'conflict';
  version?: string;
}

type CheckResult =
  | { status: 'unchanged' | 'gone' | 'unknown' }
  | { status: 'newer'; bytes: ArrayBuffer; version: string; savedAt?: string };

let pendingCheck: ((result: CheckResult) => void) | null = null;

/** Ask the host whether a newer version than the one these edits build on is
stored. A host that never answers counts as unknown, on the reconnect's budget
since the host may need to renew its credential first (#74). */
function requestCheck(): Promise<CheckResult> {
  pendingCheck?.({ status: 'unknown' }); // a newer check supersedes one still waiting
  postToHost(app.baseVersion === null ? checkMessage() : checkMessage(app.baseVersion));
  return new Promise<CheckResult>((resolve) => {
    const settle = (result: CheckResult): void => {
      window.clearTimeout(timer);
      pendingCheck = null;
      resolve(result);
    };
    const timer = window.setTimeout(() => settle({ status: 'unknown' }), RECONNECT_TIMEOUT_MS);
    pendingCheck = settle;
  });
}

/* Saves can overlap, so each waits under its own id and a kw-saved reply settles
only the save it names; a reply that outlived its wait finds nothing (#91). */
const pendingSaves = new Map<number, (result: SaveResult) => void>();
let lastSaveId = 0;

interface ReconnectResult {
  ok: boolean;
  error?: string;
}

let pendingReconnect: ((result: ReconnectResult) => void) | null = null;

/* Long enough for a real consent flow, since the expired dialog removes every
other way out and a host that never answers would seal it shut (#85). */
const RECONNECT_TIMEOUT_MS = 120_000;

/** Ask the host to renew the credential a save just failed on. Only the host
holds it, and the app re-sends its own save once this succeeds rather than
leaving database bytes parked over there for a user-paced reconnect (#85). */
function requestReconnect(): Promise<ReconnectResult> {
  postToHost(reconnectMessage());
  return new Promise<ReconnectResult>((resolve) => {
    const settle = (result: ReconnectResult): void => {
      window.clearTimeout(timer);
      pendingReconnect = null;
      resolve(result);
    };
    const timer = window.setTimeout(
      () => settle({ ok: false, error: 'the provider did not answer' }),
      RECONNECT_TIMEOUT_MS,
    );
    pendingReconnect = settle;
  });
}

function isEmbedded(): boolean {
  return window.parent !== window;
}

function postToHost(message: object): void {
  window.parent.postMessage(message, PEER.target);
}

/** The tab belongs to whichever document owns it: the host when embedded, this
page when standalone. Every screen announces itself, so the tab bar names the
open database and shows its lock state without being opened (#65, #73). */
function publishTitle(): void {
  const locked = app.db === null;
  if (isHosted()) {
    postToHost(titleMessage(app.filename, locked));
    return;
  }
  applyTabState(document, BASE_TITLE, app.filename, locked);
}

function handleHostMessage(event: MessageEvent): void {
  if (event.origin !== PEER.accept || event.source !== window.parent) return;

  if (isOpenMessage(event.data)) {
    hostState = 'hosted';
    app.filename = event.data.filename;
    app.file = event.data.bytes;
    app.baseVersion = event.data.version ?? null;
    showUnlock();
  } else if (isCreateMessage(event.data)) {
    hostState = 'hosted';
    app.baseVersion = null;
    showCreateDatabase();
  } else if (isSavedMessage(event.data)) {
    const { id, ok, error, reason, version } = event.data;
    const result: SaveResult = { ok };
    if (error !== undefined) result.error = error;
    if (reason !== undefined) result.reason = reason;
    if (version !== undefined) result.version = version;
    pendingSaves.get(id)?.(result);
  } else if (isCheckedMessage(event.data)) {
    const resolve = pendingCheck;
    pendingCheck = null;
    resolve?.(event.data as CheckResult);
  } else if (isReconnectedMessage(event.data)) {
    const resolve = pendingReconnect;
    pendingReconnect = null;
    const { ok, error } = event.data;
    resolve?.(error === undefined ? { ok } : { ok, error });
  } else if (isFindMessage(event.data)) {
    // The host already swallowed the keystroke, so its outcome is nothing to report.
    startFind();
  } else if (isCloseRequestMessage(event.data)) {
    postToHost(closeAckMessage());
    confirmUnsavedChanges(DISCARD_PROMPT, closeToHost, CLOSE_PROMPT);
  }
}

// ============================================================
// Boot
// ============================================================

if (isEmbedded()) {
  // The host's chrome is on screen whether or not it answers, so its footer wins (#83).
  document.body.classList.add('embedded');
  window.addEventListener('message', handleHostMessage);
  hostState = 'awaiting';
  // Announce readiness so the host knows it can send a vault or a create
  // instruction. Handshaking this way (rather than the host racing the
  // iframe's load event) means the host only sends once the listener above is
  // definitely attached.
  postToHost(readyMessage());
  /* A host replies to kw-ready in the same tick, so silence past this point
  means no host is coming and this app runs as it does standalone (#83). */
  window.setTimeout(() => {
    if (hostState !== 'awaiting') return;
    hostState = 'standalone';
    publishTitle();
  }, HOST_REPLY_GRACE_MS);
}

/* Runs even when embedded: a host that is there replaces this with kw-open or
kw-create in the same tick, and one that never answers leaves it standing, so
the app is usable rather than blank either way (#83). */
showUpload();

/* Closing the tab, reloading, or navigating away takes the whole session
with it: unsaved edits, which have no autosave to fall back on, and the file
itself, which cost a sign-in or a hunt for a USB stick to get here (#66).
This is the browser's own native prompt, not a custom dialog. */
window.addEventListener('beforeunload', (e) => {
  if (!hasDatabase()) return;
  e.preventDefault();
  e.returnValue = true;
});

document.addEventListener('visibilitychange', handleVisibilityChange);
for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'scroll']) {
  window.addEventListener(type, noteActivity, { capture: true, passive: true });
}
must(curtain().querySelector('button')).addEventListener('click', liftCurtain);
// Escape lifts it as a click does, rather than closing it past the idle watch (#84).
curtain().addEventListener('cancel', (e) => {
  e.preventDefault();
  liftCurtain();
});

/* Only taken when there is something to search; on the upload, unlock and edit
screens the browser's own find is still the right answer (#78). */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'f' || e.altKey || e.shiftKey || !(e.metaKey || e.ctrlKey)) return;
  if (startFind()) e.preventDefault();
});

// ============================================================
// Application state
// ============================================================

interface AppState {
  file: ArrayBuffer | null;
  filename: string;
  db: Kdbx | null;
  currentGroup: XmlElement | null;
  currentEntry: XmlElement | null;
  searchQuery: string;
  clipboardTimeout: number; // seconds
  dirty: boolean; // unsaved edits exist
}

const app: AppState = {
  file: null,
  filename: '',
  db: null,
  currentGroup: null,
  currentEntry: null,
  searchQuery: '',
  clipboardTimeout: 30,
  dirty: false,
};

/** True once a trusted same-origin parent frame has handed this app a vault to
 * open (see the "Host integration" section). Stays false in standalone use, so
 * every screen behaves exactly as it does without a host. */
let hostSession = false;

// ============================================================
// DOM helpers
// ============================================================

/** Unwrap a possibly-missing lookup, or fail loudly. The app's screens are
 * generated from its own templates, so a missing element means a real bug,
 * not a state to handle gracefully. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return must(document.getElementById(id) as T | null);
}

/** Clone a <template> and return the DocumentFragment. */
function cloneTemplate(id: string): DocumentFragment {
  return byId<HTMLTemplateElement>(id).content.cloneNode(true) as DocumentFragment;
}

/** Replace the #root content with the given fragment. */
function setRoot(fragment: DocumentFragment): void {
  const root = byId('root');
  root.innerHTML = '';
  root.appendChild(fragment);
}

/** Shorthand querySelector on #root. */
function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  return must(byId('root').querySelector<T>(selector));
}

// ============================================================
// kdbx XML model helpers
// (getChildren, getChild, getText, etc. are declared in globals.d.ts and are
//  in scope because bundle-iife concatenates this file with the kdbx library
//  into one script — see bundle-iife.json. entryField, entryTitle, groupName,
//  findEntryParent, collectAllEntries, groupPathTo, filterEntriesByQuery,
//  applyEntryEdits, isCustomField, and isValidClipboardTimeout are pure logic
//  and live in logic.ts instead, so they can be unit tested without a DOM;
//  they're likewise declared in globals.d.ts and concatenated in the same way.)
// ============================================================

// ============================================================
// Clipboard
// ============================================================

let clipboardTimer: ReturnType<typeof setTimeout> | null = null;

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    if (clipboardTimer) clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
      clipboardTimer = null;
    }, app.clipboardTimeout * 1000);
  } catch (err) {
    console.error('Clipboard write failed', err);
  }
}

// ============================================================
// Screen: Upload
// ============================================================

function showUpload(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-upload'));

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

// ============================================================
// Screen: Unlock
// ============================================================

function showUnlock(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-unlock'));

  qs('#db-filename').textContent = app.filename;
  const passwordInput = qs<HTMLInputElement>('#master-password');
  passwordInput.focus();

  let keyfileData: Uint8Array | null = null;

  qs('[data-action="back"]').addEventListener('click', () => {
    app.file = null;
    app.filename = '';
    showUpload();
  });

  qs('[data-action="toggle-password"]').addEventListener('click', () => {
    passwordInput.type = passwordInput.type === 'password' ? 'text' : 'password';
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
      const input: CredentialsInput = { password: passwordInput.value };
      if (keyfileData) input.keyFile = keyfileData;
      const creds = new Credentials(input);
      app.db = await Kdbx.load(new Uint8Array(must(app.file)), creds);
      app.currentGroup = app.db.getRootGroup();
      app.searchQuery = '';
      app.dirty = false;
      showEntryList();
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

// ============================================================
// Screen: Create Database
// ============================================================

function showCreateDatabase(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-create-database'));

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
      app.dirty = true;
      showEntryList();
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
  renderGroupTree();
  renderEntryPanel();
  wireEntryListEvents();
}

function renderGroupTree(): void {
  const container = qs('#group-tree');
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'group-list';
  ul.appendChild(buildGroupNode(must(app.db).getRootGroup()));
  container.appendChild(ul);
}

function buildGroupNode(group: XmlElement): HTMLLIElement {
  const li = document.createElement('li');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `group-btn${group === app.currentGroup ? ' active' : ''}`;
  btn.textContent = groupName(group);
  btn.addEventListener('click', () => {
    app.currentGroup = group;
    app.searchQuery = '';
    const searchInput = document.querySelector<HTMLInputElement>('#search-input');
    if (searchInput) searchInput.value = '';
    renderGroupTree();
    renderEntryPanel();
  });
  li.appendChild(btn);

  const subgroups = getChildren(group, 'Group');
  if (subgroups.length > 0) {
    const ul = document.createElement('ul');
    for (const sub of subgroups) {
      ul.appendChild(buildGroupNode(sub));
    }
    li.appendChild(ul);
  }

  return li;
}

function renderEntryPanel(): void {
  const panelTitle = qs('#panel-title');
  const listEl = qs('#entry-list');
  listEl.innerHTML = '';

  let rows: EntryWithGroup[];

  if (app.searchQuery) {
    panelTitle.textContent = `"${app.searchQuery}"`;
    const all = collectAllEntries(must(app.db).getRootGroup());
    rows = filterEntriesByQuery(all, app.searchQuery);
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

  for (const { entry, group } of rows) {
    listEl.appendChild(buildEntryRow(entry, group));
  }
}

function buildEntryRow(entry: XmlElement, group: XmlElement): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'entry-row';

  const titleEl = document.createElement('div');
  titleEl.className = 'entry-row-title';
  titleEl.textContent = entryTitle(entry);

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

  div.addEventListener('click', () => {
    app.currentEntry = entry;
    showEntryDetail();
  });

  return div;
}

function wireEntryListEvents(): void {
  qs<HTMLInputElement>('#search-input').addEventListener('input', (e) => {
    app.searchQuery = (e.target as HTMLInputElement).value.trim();
    renderEntryPanel();
  });

  qs('[data-action="lock"]').addEventListener('click', async () => {
    // Re-encrypt the current in-memory state (including anything not yet
    // saved) rather than reloading the original file, so locking never loses
    // an edit — only Close does that, and only with confirmation.
    const bytes = await must(app.db).save();
    app.file = bytes.buffer as ArrayBuffer;
    Object.assign(app, { db: null, currentGroup: null, currentEntry: null, searchQuery: '' });
    showUnlock();
  });

  qs('[data-action="close"]').addEventListener('click', () => {
    confirmDiscardIfDirty(() => {
      Object.assign(app, {
        db: null,
        file: null,
        filename: '',
        currentGroup: null,
        currentEntry: null,
        searchQuery: '',
        dirty: false,
      });
      showUpload();
    });
  });

  qs('[data-action="settings"]').addEventListener('click', openSettings);

  qs('[data-action="add-entry"]').addEventListener('click', () => {
    const newEntry = createEntry({ title: 'New Entry' });
    appendChild(must(app.currentGroup), newEntry);
    app.currentEntry = newEntry;
    app.dirty = true;
    showEntryEdit(true);
  });

  qs('[data-action="add-group"]').addEventListener('click', () => {
    openNewGroupDialog(must(app.currentGroup), () => showEntryList());
  });
}

// ============================================================
// Screen: Entry Detail
// ============================================================

function showEntryDetail(): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-entry-detail'));

  const entry = must(app.currentEntry);
  qs('#detail-title').textContent = entryTitle(entry);

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

  qs('[data-action="back"]').addEventListener('click', () => {
    app.currentEntry = null;
    showEntryList();
  });

  qs('[data-action="edit"]').addEventListener('click', () => {
    showEntryEdit(false);
  });

  qs('[data-action="delete"]').addEventListener('click', () => {
    openConfirmDelete(() => {
      const parent = findEntryParent(must(app.db).getRootGroup(), entry);
      if (parent) {
        parent.children = parent.children.filter((c) => c !== entry);
        app.dirty = true;
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
    const revealBtn = document.createElement('button');
    revealBtn.type = 'button';
    revealBtn.className = 'icon-btn';
    revealBtn.title = 'Show / hide';
    revealBtn.textContent = '👁';
    let revealed = false;
    revealBtn.addEventListener('click', () => {
      revealed = !revealed;
      valueSpan.textContent = revealed ? value : '••••••••';
    });
    actions.appendChild(revealBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'icon-btn';
  copyBtn.title = 'Copy';
  copyBtn.textContent = '📋';
  copyBtn.addEventListener('click', async () => {
    await copyToClipboard(value);
    copyBtn.textContent = '✓';
    setTimeout(() => {
      copyBtn.textContent = '📋';
    }, 1500);
  });
  actions.appendChild(copyBtn);

  valueWrap.appendChild(valueSpan);
  valueWrap.appendChild(actions);
  row.appendChild(label);
  row.appendChild(valueWrap);
  return row;
}

// ============================================================
// Screen: Entry Edit
// ============================================================

function showEntryEdit(isNew: boolean): void {
  document.body.classList.remove('app-mode');
  setRoot(cloneTemplate('tpl-entry-edit'));

  const entry = must(app.currentEntry);
  qs('#edit-title').textContent = isNew ? 'New Entry' : 'Edit Entry';

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

  qs('[data-action="add-field"]').addEventListener('click', () => {
    fieldsEl.appendChild(buildEditField('', '', false, true));
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

  qs('[data-action="save"]').addEventListener('click', () => {
    commitEdits(entry, fieldsEl);
  });
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

  const valueInput = document.createElement('input');
  valueInput.className = 'edit-value';
  valueInput.type = isProtected ? 'password' : 'text';
  valueInput.value = value;
  valueInput.placeholder = 'Value';

  row.appendChild(keyInput);
  row.appendChild(valueInput);

  if (isProtected) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn';
    toggle.title = 'Show / hide';
    toggle.textContent = '👁';
    toggle.addEventListener('click', () => {
      valueInput.type = valueInput.type === 'password' ? 'text' : 'password';
    });
    row.appendChild(toggle);
  }

  if (key === 'Password') {
    const generateBtn = document.createElement('button');
    generateBtn.type = 'button';
    generateBtn.className = 'icon-btn';
    generateBtn.title = 'Generate password';
    generateBtn.textContent = '🎲';
    generateBtn.addEventListener('click', () => {
      openPasswordGenerator((password) => {
        valueInput.value = password;
      });
    });
    row.appendChild(generateBtn);
  }

  if (removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn';
    removeBtn.title = 'Remove field';
    removeBtn.textContent = '✕';
    removeBtn.style.color = 'var(--danger)';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(removeBtn);
  }

  return row;
}

function commitEdits(entry: XmlElement, fieldsEl: HTMLElement): void {
  const fields = Array.from(fieldsEl.querySelectorAll<HTMLElement>('.edit-field')).map((row) => ({
    key: must(row.querySelector<HTMLInputElement>('.edit-key')).value.trim(),
    value: must(row.querySelector<HTMLInputElement>('.edit-value')).value,
    protect: row.dataset.protected === '1',
  }));
  applyEntryEdits(entry, fields);

  app.dirty = true;

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

  must(dlg.querySelector<HTMLButtonElement>('[data-action="save-settings"]')).onclick = () => {
    const v = Number.parseInt(timeoutInput.value, 10);
    if (isValidClipboardTimeout(v)) app.clipboardTimeout = v;
    dlg.close();
  };
  must(dlg.querySelector<HTMLButtonElement>('[data-action="close"]')).onclick = () => dlg.close();
  dlg.showModal();
}

// ============================================================
// Dialog: Save / Download
// ============================================================

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

  status.hidden = true;
  status.textContent = '';
  status.className = 'save-status';
  localMsg.hidden = hostSession;
  hostMsg.hidden = !hostSession;
  downloadBtn.hidden = hostSession;
  hostBtn.hidden = !hostSession;

  downloadBtn.onclick = async () => {
    await downloadDatabase();
    dlg.close();
  };

  hostBtn.onclick = async () => {
    await saveToHost(status, hostBtn);
  };

  // Both close buttons (Later + ✕) dismiss
  for (const btn of dlg.querySelectorAll<HTMLButtonElement>('[data-action="close"]')) {
    btn.onclick = () => dlg.close();
  }

  dlg.showModal();
}

async function downloadDatabase(): Promise<void> {
  const bytes = await must(app.db).save();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = app.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  app.dirty = false;
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
  must(dlg.querySelector<HTMLButtonElement>('[data-action="close"]')).onclick = () => dlg.close();

  regenerate();
  dlg.showModal();
}

// ============================================================
// Dialog: Confirm Discard
// ============================================================

/** Run `proceed` immediately if there's nothing unsaved to lose; otherwise
 * confirm first, since locking/closing here discards in-memory edits rather
 * than saving them (there's no autosave). */
function confirmDiscardIfDirty(proceed: () => void): void {
  if (!app.dirty) {
    proceed();
    return;
  }

  const dlg = byId<HTMLDialogElement>('dlg-confirm-discard');
  must(dlg.querySelector<HTMLButtonElement>('[data-action="confirm-discard"]')).onclick = () => {
    dlg.close();
    proceed();
  };
  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-discard"]')).onclick = () =>
    dlg.close();
  dlg.showModal();
}

// ============================================================
// Dialog: Confirm Delete
// ============================================================

function openConfirmDelete(callback: () => void): void {
  const dlg = byId<HTMLDialogElement>('dlg-confirm-delete');

  must(dlg.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')).onclick = () => {
    dlg.close();
    callback();
  };
  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-delete"]')).onclick = () =>
    dlg.close();

  dlg.showModal();
}

// ============================================================
// Dialog: New Group
// ============================================================

function openNewGroupDialog(parentGroup: XmlElement, onCreated: () => void): void {
  const dlg = byId<HTMLDialogElement>('dlg-new-group');
  const nameInput = byId<HTMLInputElement>('new-group-name');
  nameInput.value = '';

  must(dlg.querySelector<HTMLButtonElement>('[data-action="create-group"]')).onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const newGroup = createGroup(name);
    appendChild(parentGroup, newGroup);
    app.currentGroup = newGroup;
    app.dirty = true;
    dlg.close();
    onCreated();
  };

  must(dlg.querySelector<HTMLButtonElement>('[data-action="cancel-group"]')).onclick = () =>
    dlg.close();
  must(dlg.querySelector<HTMLButtonElement>('[data-action="close"]')).onclick = () => dlg.close();

  // Allow Enter to submit
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      must(dlg.querySelector<HTMLButtonElement>('[data-action="create-group"]')).click();
    }
  };

  dlg.showModal();
  nameInput.focus();
}

// ============================================================
// Host integration (optional)
// ============================================================
//
// This app is self-contained: opened directly, it never talks to another
// window, and everything below is dormant. When it is embedded in a
// same-origin parent frame — the cloud connector page — that parent can hand
// it a vault to open and receive the edited vault back, without the app
// reimplementing any of its own file handling.
//
// The protocol is four same-origin postMessage types:
//   app  → host : { type: 'kw-ready' }                     app booted, send a vault
//   host → app  : { type: 'kw-open', filename, bytes }     open this vault (bytes: ArrayBuffer)
//   app  → host : { type: 'kw-save', filename, bytes }     user saved; please persist (bytes: ArrayBuffer)
//   host → app  : { type: 'kw-saved', ok, error? }         result of that persist
//
// Every inbound message is checked to come from the parent frame at this
// page's own origin; anything else is ignored. Nothing here runs unless the
// app is actually framed, so standalone use is entirely unaffected.

const HOST_ORIGIN = window.location.origin;

/** The status element + button awaiting a `kw-saved` reply, or null. */
let pendingHostSave: { status: HTMLElement; button: HTMLButtonElement } | null = null;

function isEmbedded(): boolean {
  return window.parent !== window;
}

function postToHost(message: object): void {
  window.parent.postMessage(message, HOST_ORIGIN);
}

function handleHostMessage(event: MessageEvent): void {
  if (event.origin !== HOST_ORIGIN || event.source !== window.parent) return;
  const data = event.data as Record<string, unknown> | null;
  if (data === null || typeof data !== 'object') return;

  if (
    data.type === 'kw-open' &&
    typeof data.filename === 'string' &&
    data.bytes instanceof ArrayBuffer
  ) {
    hostSession = true;
    app.filename = data.filename;
    app.file = data.bytes;
    showUnlock();
  } else if (data.type === 'kw-saved') {
    notifyHostSaveResult(data.ok === true, typeof data.error === 'string' ? data.error : undefined);
  }
}

async function saveToHost(status: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const bytes = await must(app.db).save();
  status.hidden = false;
  status.className = 'save-status';
  status.textContent = 'Saving to Google Drive…';
  button.disabled = true;
  pendingHostSave = { status, button };
  // Copy into a fresh, exactly-sized ArrayBuffer for the structured clone.
  postToHost({ type: 'kw-save', filename: app.filename, bytes: new Uint8Array(bytes).buffer });
}

function notifyHostSaveResult(ok: boolean, error?: string): void {
  if (!pendingHostSave) return;
  const { status, button } = pendingHostSave;
  pendingHostSave = null;
  button.disabled = false;
  if (ok) {
    app.dirty = false;
    status.textContent = 'Saved to Google Drive.';
    status.classList.add('ok');
  } else {
    status.textContent = error ? `Save failed: ${error}` : 'Save failed.';
    status.classList.add('error');
  }
}

// ============================================================
// Boot
// ============================================================

if (isEmbedded()) {
  window.addEventListener('message', handleHostMessage);
  // Announce readiness so the host knows it can send the vault. Handshaking
  // this way (rather than the host racing the iframe's load event) means the
  // host only sends once the listener above is definitely attached.
  postToHost({ type: 'kw-ready' });
}

showUpload();

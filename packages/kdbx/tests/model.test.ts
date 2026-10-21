import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addEntryAttachment,
  appendChild,
  createDatabaseDocument,
  createElement,
  createEntry,
  createGroup,
  deleteHistoryEntry,
  deletePermanently,
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getEntryHistory,
  getEntryTags,
  getEntryTimes,
  getText,
  type InnerBinary,
  isInRecycleBin,
  isRecycleBinEnabled,
  moveToGroup,
  ProtectedValue,
  pushHistorySnapshot,
  restoreHistoryEntry,
  setAttribute,
  setEntryExpiry,
  setEntryTags,
  setText,
  touchLastModified,
  type XmlElement,
} from '../src/index.ts';

/** Read a standard field's value off an entry, for asserting on test fixtures. */
function fieldValue(entry: XmlElement, key: string): string {
  for (const string of getChildren(entry, 'String')) {
    if (getText(getChild(string, 'Key') as XmlElement) === key) {
      return getText(getChild(string, 'Value') as XmlElement);
    }
  }
  return '';
}

const LONG_AGO = '2000-01-01T00:00:00Z';

// The element holding one of an entry's or group's Times, or undefined if it has none.
function timeEl(element: XmlElement, name: string): XmlElement | undefined {
  const times = getChild(element, 'Times');
  return times && getChild(times, name);
}

function timeOf(element: XmlElement, name: string): string {
  return getText(timeEl(element, name) as XmlElement);
}

function setTimeOf(element: XmlElement, name: string, iso: string): void {
  setText(timeEl(element, name) as XmlElement, iso);
}

// The model writes whole-second UTC, so "now" can trail Date.now() by up to a second.
function assertJustNow(iso: string): void {
  const age = Date.now() - Date.parse(iso);
  assert.ok(age >= 0 && age < 60_000, `${iso} should be the current time`);
}

test('ProtectedValue wraps a string and exposes it via .text and toString()', () => {
  const value = ProtectedValue.fromString('s3cret');
  assert.equal(value.text, 's3cret');
  assert.equal(value.toString(), 's3cret');
  assert.equal(`${value}`, 's3cret');
});

test('getChild returns undefined when no matching child exists', () => {
  const element = createElement('Parent');
  assert.equal(getChild(element, 'Missing'), undefined);
});

test('setAttribute replaces an existing attribute rather than duplicating it', () => {
  const element = createElement('El');
  setAttribute(element, 'Foo', '1');
  setAttribute(element, 'Foo', '2'); // should replace, not append
  assert.equal(getAttribute(element, 'Foo'), '2');
  assert.equal(element.attributes.length, 1);
});

test('createEntry defaults an omitted title and password to an empty string', () => {
  const entry = createEntry({});
  const fields: Record<string, string> = {};
  for (const string of getChildren(entry, 'String')) {
    const key = getText(getChild(string, 'Key') as XmlElement);
    fields[key] = getText(getChild(string, 'Value') as XmlElement);
  }
  assert.equal(fields.Title, '');
  assert.equal(fields.Password, '');
});

test('createDatabaseDocument invokes the optional build callback with the root group', () => {
  const root = createDatabaseDocument('MyDb', (rootGroup) => {
    setAttribute(rootGroup, 'Marker', 'yes');
  });
  const rootElement = getChild(root, 'Root') as XmlElement;
  const rootGroup = getChild(rootElement, 'Group') as XmlElement;
  assert.equal(getAttribute(rootGroup, 'Marker'), 'yes');
});

test('createDatabaseDocument records when the master key was set, as other clients expect (#108)', () => {
  const meta = getChild(createDatabaseDocument('MyDb'), 'Meta') as XmlElement;
  assertJustNow(getText(getChild(meta, 'MasterKeyChanged') as XmlElement));
});

test('getEntryTimes reads a real entry’s Times, and returns empty/false defaults when Times is absent', () => {
  const entry = createEntry({ title: 'Timed' });
  const times = getEntryTimes(entry);
  assert.ok(times.created.length > 0);
  assert.ok(times.modified.length > 0);
  assert.equal(times.expires, false);
  assert.ok(times.expiryTime.length > 0);

  const bare = createElement('Entry');
  assert.deepEqual(getEntryTimes(bare), {
    created: '',
    modified: '',
    expires: false,
    expiryTime: '',
  });
});

test('setEntryExpiry updates Expires and, when given, ExpiryTime; an empty ExpiryTime leaves it as-is', () => {
  const entry = createEntry({ title: 'Timed' });
  const originalExpiry = getEntryTimes(entry).expiryTime;

  setEntryExpiry(entry, true, '2030-06-15T12:00:00Z');
  const updated = getEntryTimes(entry);
  assert.equal(updated.expires, true);
  assert.equal(updated.expiryTime, '2030-06-15T12:00:00Z');

  // Flipping Expires off without a new ExpiryTime leaves the existing one.
  setEntryExpiry(entry, false, '');
  const after = getEntryTimes(entry);
  assert.equal(after.expires, false);
  assert.equal(after.expiryTime, '2030-06-15T12:00:00Z');
  assert.notEqual(after.expiryTime, originalExpiry);
});

test('setEntryExpiry does nothing on an entry with no Times element, and skips missing Expires/ExpiryTime children', () => {
  const bare = createElement('Entry');
  setEntryExpiry(bare, true, '2030-01-01T00:00:00Z');
  assert.equal(getChild(bare, 'Times'), undefined);

  const partial = createElement('Entry');
  appendChild(partial, createElement('Times'));
  setEntryExpiry(partial, true, '2030-01-01T00:00:00Z');
  const times = getChild(partial, 'Times') as XmlElement;
  assert.equal(getChild(times, 'Expires'), undefined);
  assert.equal(getChild(times, 'ExpiryTime'), undefined);
});

test('touchLastModified bumps LastModificationTime to now, and does nothing without a Times element', () => {
  const entry = createEntry({ title: 'Timed' });
  const times = getChild(entry, 'Times') as XmlElement;
  const modEl = getChild(times, 'LastModificationTime') as XmlElement;
  modEl.children = [{ type: 'text', value: '2000-01-01T00:00:00Z', cdata: false }];

  touchLastModified(entry);
  const updated = getEntryTimes(entry).modified;
  assert.notEqual(updated, '2000-01-01T00:00:00Z');
  assert.ok(updated.startsWith(String(new Date().getUTCFullYear())));

  const bare = createElement('Entry');
  touchLastModified(bare); // no Times element: must not throw
  assert.equal(getChild(bare, 'Times'), undefined);
});

test('touchLastModified stamps a group too, and adds LastModificationTime when Times lacks it', () => {
  const group = createGroup('Renamed');
  setTimeOf(group, 'LastModificationTime', LONG_AGO);
  touchLastModified(group);
  assertJustNow(timeOf(group, 'LastModificationTime'));

  // A file from another writer may leave a time out; the edit still has to be recorded.
  const sparse = createElement('Entry');
  appendChild(sparse, createElement('Times'));
  touchLastModified(sparse);
  assertJustNow(timeOf(sparse, 'LastModificationTime'));
});

test('moveToGroup reparents an entry or group and stamps its LocationChanged, not LastModificationTime', () => {
  const from = createGroup('From');
  const to = createGroup('To');
  const entry = createEntry({ title: 'Moving' });
  const group = createGroup('Moving Group');
  appendChild(from, entry);
  appendChild(from, group);
  for (const element of [entry, group]) {
    setTimeOf(element, 'LocationChanged', LONG_AGO);
    setTimeOf(element, 'LastModificationTime', LONG_AGO);
  }

  moveToGroup(entry, from, to);
  moveToGroup(group, from, to);

  assert.deepEqual(getChildren(from, 'Entry'), []);
  assert.deepEqual(getChildren(from, 'Group'), []);
  assert.deepEqual(getChildren(to, 'Entry'), [entry]);
  assert.deepEqual(getChildren(to, 'Group'), [group]);
  for (const element of [entry, group]) {
    assertJustNow(timeOf(element, 'LocationChanged'));
    assert.equal(timeOf(element, 'LastModificationTime'), LONG_AGO, 'a move is not an edit');
  }
});

test('deletePermanently records the entry in Root/DeletedObjects, creating that list on first use', () => {
  const document = createDatabaseDocument('MyDb');
  const rootElement = getChild(document, 'Root') as XmlElement;
  const rootGroup = getChild(rootElement, 'Group') as XmlElement;
  const entry = createEntry({ title: 'Doomed' });
  appendChild(rootGroup, entry);
  assert.equal(getChild(rootElement, 'DeletedObjects'), undefined);

  deletePermanently(document, entry, rootGroup);

  assert.deepEqual(getChildren(rootGroup, 'Entry'), []);
  const deleted = getChild(rootElement, 'DeletedObjects') as XmlElement;
  const [record, ...rest] = getChildren(deleted, 'DeletedObject');
  assert.deepEqual(rest, []);
  assert.equal(
    getText(getChild(record as XmlElement, 'UUID') as XmlElement),
    getText(getChild(entry, 'UUID') as XmlElement),
  );
  assertJustNow(getText(getChild(record as XmlElement, 'DeletionTime') as XmlElement));
});

test('deletePermanently records a group and every group and entry under it, but not History versions', () => {
  const document = createDatabaseDocument('MyDb');
  const rootElement = getChild(document, 'Root') as XmlElement;
  const rootGroup = getChild(rootElement, 'Group') as XmlElement;
  const group = createGroup('Doomed Group');
  const entry = createEntry({ title: 'Inside' });
  pushHistorySnapshot(document, entry, []); // shares the entry's UUID, so it needs no record of its own
  const subgroup = createGroup('Nested');
  const nestedEntry = createEntry({ title: 'Deeper' });
  appendChild(subgroup, nestedEntry);
  appendChild(group, entry);
  appendChild(group, subgroup);
  // An object with no UUID can't be named in a record, but what's under it still is.
  const anonymous = createElement('Group');
  const underAnonymous = createEntry({ title: 'Under anonymous' });
  appendChild(anonymous, underAnonymous);
  appendChild(group, anonymous);
  appendChild(rootGroup, group);

  // A list already loaded from the file is appended to, not replaced.
  const existing = createElement('DeletedObjects');
  appendChild(existing, createElement('DeletedObject'));
  appendChild(rootElement, existing);

  deletePermanently(document, group, rootGroup);

  assert.deepEqual(getChildren(rootGroup, 'Group'), []);
  assert.equal(getChild(rootElement, 'DeletedObjects'), existing);
  const recorded = getChildren(existing, 'DeletedObject')
    .slice(1)
    .map((record) => getText(getChild(record, 'UUID') as XmlElement));
  const uuidOf = (element: XmlElement): string => getText(getChild(element, 'UUID') as XmlElement);
  assert.deepEqual(recorded, [
    uuidOf(group),
    uuidOf(entry),
    uuidOf(subgroup),
    uuidOf(nestedEntry),
    uuidOf(underAnonymous),
  ]);
});

test('deletePermanently throws on a document with no Root, before removing anything', () => {
  const parent = createGroup('Parent');
  const entry = createEntry({ title: 'Kept' });
  appendChild(parent, entry);
  assert.throws(
    () => deletePermanently(createElement('KeePassFile'), entry, parent),
    /missing a Root element/,
  );
  assert.deepEqual(getChildren(parent, 'Entry'), [entry]);
});

test('findOrCreateRecycleBin creates the bin once, under the root group, and reuses it after', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  assert.equal(getChild(meta, 'RecycleBinUUID'), undefined);

  const bin = findOrCreateRecycleBin(document);
  assert.equal(getText(getChild(bin, 'Name') as XmlElement), 'Recycle Bin');
  assert.deepEqual(
    getChildren(bin, 'IconID').map(getText),
    ['43'],
    "one IconID, KeePass's TrashBin, as KeePass gives its own bin (#121)",
  );
  // KeePass and KeePassXC leave their own bins out of search and auto-type (#132).
  assert.equal(getText(getChild(bin, 'EnableSearching') as XmlElement), 'false');
  assert.equal(getText(getChild(bin, 'EnableAutoType') as XmlElement), 'false');
  const uuidEl = getChild(meta, 'RecycleBinUUID') as XmlElement;
  assert.equal(getText(uuidEl), getText(getChild(bin, 'UUID') as XmlElement));
  const changedEl = getChild(meta, 'RecycleBinChanged') as XmlElement;
  assertJustNow(getText(changedEl));

  const rootGroup = getChild(getChild(document, 'Root') as XmlElement, 'Group') as XmlElement;
  assert.ok(getChildren(rootGroup, 'Group').includes(bin));

  // Second call returns the same group rather than creating another, and leaves its time alone.
  setText(changedEl, LONG_AGO);
  const again = findOrCreateRecycleBin(document);
  assert.equal(again, bin);
  assert.equal(getChildren(rootGroup, 'Group').length, 1);
  assert.equal(getText(changedEl), LONG_AGO);
});

test('isRecycleBinEnabled follows Meta/RecycleBinEnabled, on unless it says False, as in KeePass (#132)', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  const enabled = getChild(meta, 'RecycleBinEnabled') as XmlElement;
  assert.equal(isRecycleBinEnabled(document), true);
  setText(enabled, 'False');
  assert.equal(isRecycleBinEnabled(document), false);
  setText(enabled, ' false ');
  assert.equal(isRecycleBinEnabled(document), false);
  meta.children = meta.children.filter((child) => child !== enabled);
  assert.equal(isRecycleBinEnabled(document), true, 'a file that leaves it out has it on');
  document.children = document.children.filter((child) => child !== meta);
  assert.equal(isRecycleBinEnabled(document), true);
});

test('findOrCreateRecycleBin replaces a stale RecycleBinUUID that no longer matches any group', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  appendChild(meta, createElement('RecycleBinUUID', 'not-a-real-group-uuid'));
  appendChild(meta, createElement('RecycleBinChanged', LONG_AGO));

  const bin = findOrCreateRecycleBin(document);
  const uuidEl = getChild(meta, 'RecycleBinUUID') as XmlElement;
  assert.equal(getText(uuidEl), getText(getChild(bin, 'UUID') as XmlElement));
  assert.equal(
    getChild(meta, 'RecycleBinUUID'),
    uuidEl,
    'the existing element is reused, not duplicated',
  );
  assert.equal(getChildren(meta, 'RecycleBinChanged').length, 1);
  assertJustNow(getText(getChild(meta, 'RecycleBinChanged') as XmlElement));
});

test('findOrCreateRecycleBin throws on a document missing Meta or a root group', () => {
  const malformed = createElement('KeePassFile');
  assert.throws(() => findOrCreateRecycleBin(malformed), /missing Meta or a root group/);
});

test('getEntryTags returns [] when Tags is absent, and splits/trims/drops empties when present', () => {
  const entry = createEntry({ title: 'No tags yet' });
  assert.deepEqual(getEntryTags(entry), []);

  appendChild(entry, createElement('Tags', ' Work ;; Personal ;Urgent'));
  assert.deepEqual(getEntryTags(entry), ['Work', 'Personal', 'Urgent']);
});

test('getEntryTags reads the commas KeePassXC writes, and the tabs it also splits on (#130)', () => {
  const entry = createEntry({ title: 'Tagged in KeePassXC' });
  appendChild(entry, createElement('Tags', 'Finance,Personal'));
  assert.deepEqual(getEntryTags(entry), ['Finance', 'Personal']);

  setText(getChild(entry, 'Tags') as XmlElement, 'Finance, Personal;Work\tTravel');
  assert.deepEqual(getEntryTags(entry), ['Finance', 'Personal', 'Work', 'Travel']);
});

test('setEntryTags creates, updates, and removes the Tags element as appropriate', () => {
  const entry = createEntry({ title: 'Tag me' });

  // No existing element, non-empty tags: creates one.
  setEntryTags(entry, ['Work', 'Urgent']);
  assert.equal(getText(getChild(entry, 'Tags') as XmlElement), 'Work;Urgent');

  // Existing element, non-empty tags: updates in place rather than duplicating.
  setEntryTags(entry, ['Personal']);
  const tagsElements = getChildren(entry, 'Tags');
  assert.equal(tagsElements.length, 1);
  assert.equal(getText(tagsElements[0] as XmlElement), 'Personal');

  // Existing element, empty (or all-blank) tags: removes it entirely.
  setEntryTags(entry, ['  ', '']);
  assert.equal(getChild(entry, 'Tags'), undefined);

  // No existing element, empty tags: stays absent (no-op).
  setEntryTags(entry, []);
  assert.equal(getChild(entry, 'Tags'), undefined);
});

test('isInRecycleBin is true for the bin itself and anything nested inside it, false otherwise', () => {
  const document = createDatabaseDocument('MyDb');
  const rootGroup = getChild(getChild(document, 'Root') as XmlElement, 'Group') as XmlElement;
  const other = createGroup('Other');
  appendChild(rootGroup, other);

  // No recycle bin exists yet.
  assert.equal(isInRecycleBin(document, rootGroup), false);

  const bin = findOrCreateRecycleBin(document);
  const nested = createGroup('Nested');
  appendChild(bin, nested);

  assert.equal(isInRecycleBin(document, bin), true);
  assert.equal(isInRecycleBin(document, nested), true);
  assert.equal(isInRecycleBin(document, rootGroup), false);
  assert.equal(isInRecycleBin(document, other), false);
});

test('getEntryHistory returns [] when History is absent, and the pushed snapshots otherwise', () => {
  const entry = createEntry({ title: 'Original' });
  assert.deepEqual(getEntryHistory(entry), []);

  const document = createDatabaseDocument('MyDb');
  pushHistorySnapshot(document, entry, []);
  const history = getEntryHistory(entry);
  assert.equal(history.length, 1);
  assert.equal(fieldValue(history[0] as XmlElement, 'Title'), 'Original');
});

test('pushHistorySnapshot clones the pre-edit state, not the state after the caller has since changed it', () => {
  const document = createDatabaseDocument('MyDb');
  const entry = createEntry({ title: 'Before' });
  pushHistorySnapshot(document, entry, []);
  const titleValueEl = getChild(
    getChildren(entry, 'String')[0] as XmlElement,
    'Value',
  ) as XmlElement;
  setText(titleValueEl, 'After'); // mutate the live entry, not the already-pushed snapshot

  const history = getEntryHistory(entry);
  assert.equal(fieldValue(entry, 'Title'), 'After');
  assert.equal(fieldValue(history[0] as XmlElement, 'Title'), 'Before');
  // The snapshot itself must not carry its own nested History.
  assert.equal(getChild(history[0] as XmlElement, 'History'), undefined);
});

test('pushHistorySnapshot trims to Meta/HistoryMaxItems, dropping the oldest first', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  setText(getChild(meta, 'HistoryMaxItems') as XmlElement, '2');

  const entry = createEntry({ title: 'v1' });
  pushHistorySnapshot(document, entry, []);
  pushHistorySnapshot(document, entry, []);
  pushHistorySnapshot(document, entry, []);

  const history = getEntryHistory(entry);
  assert.equal(history.length, 2, 'trimmed down to HistoryMaxItems');
});

test('pushHistorySnapshot defaults to 10 when HistoryMaxItems is absent, and skips trimming on a malformed value', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  meta.children = meta.children.filter(
    (child) => !(child.type === 'element' && child.name === 'HistoryMaxItems'),
  );

  const entry = createEntry({ title: 'v1' });
  for (let i = 0; i < 11; i++) {
    pushHistorySnapshot(document, entry, []);
  }
  assert.equal(getEntryHistory(entry).length, 10, 'defaults to 10 when HistoryMaxItems is absent');

  appendChild(meta, createElement('HistoryMaxItems', 'not-a-number'));
  pushHistorySnapshot(document, entry, []);
  assert.equal(getEntryHistory(entry).length, 11, 'a malformed max leaves trimming disabled');
});

// --- HistoryMaxSize, counted as KeePassXC counts it (#135) ---

/** An entry carrying one attachment of `bytes` bytes, and the store that holds its data. */
function entryWithAttachment(bytes: number): { entry: XmlElement; binaries: InnerBinary[] } {
  const entry = createEntry({ title: 'T' }); // 30 bytes of field names and values
  addEntryAttachment(entry, 'a.bin', 0); // 5 bytes of name
  return { entry, binaries: [{ flags: 0, data: new Uint8Array(bytes) }] };
}

test('pushHistorySnapshot keeps the newest versions that fit Meta/HistoryMaxSize, dropping the rest', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  // Each version is 30 + 5 + 1000 = 1035 bytes, so two fit and a third does not.
  setText(getChild(meta, 'HistoryMaxSize') as XmlElement, '2500');
  const { entry, binaries } = entryWithAttachment(1000);
  for (let i = 0; i < 3; i++) pushHistorySnapshot(document, entry, binaries);
  assert.equal(getEntryHistory(entry).length, 2, 'the oldest no longer fits');
});

test('pushHistorySnapshot counts a shared attachment once per version, and defaults to 6 MiB', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  meta.children = meta.children.filter(
    (child) => !(child.type === 'element' && child.name === 'HistoryMaxSize'),
  );
  // Two versions sharing one 4 MiB attachment count as 8 MiB, past the 6 MiB default.
  const { entry, binaries } = entryWithAttachment(4 * 1024 * 1024);
  pushHistorySnapshot(document, entry, binaries);
  pushHistorySnapshot(document, entry, binaries);
  assert.equal(getEntryHistory(entry).length, 1);

  // A negative or malformed limit means none, as in KeePass and KeePassXC.
  appendChild(meta, createElement('HistoryMaxSize', '-1'));
  pushHistorySnapshot(document, entry, binaries);
  pushHistorySnapshot(document, entry, binaries);
  assert.equal(getEntryHistory(entry).length, 3);
  setText(getChild(meta, 'HistoryMaxSize') as XmlElement, 'lots');
  pushHistorySnapshot(document, entry, binaries);
  assert.equal(getEntryHistory(entry).length, 4);
});

test('pushHistorySnapshot sizes a version in UTF-8 bytes of its fields, attachments, tags, auto-type and custom data', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  const element = (name: string, children: Array<[string, string]>): XmlElement => {
    const el = createElement(name);
    for (const [childName, text] of children) appendChild(el, createElement(childName, text));
    return el;
  };
  const version = createElement('Entry');
  appendChild(version, createElement('UUID', 'AAAAAAAAAAAAAAAAAAAAAA==')); // not counted
  appendChild(
    version,
    element('String', [
      ['Key', 'é'],
      ['Value', '€'],
    ]),
  ); // 2 + 3 bytes
  appendChild(version, element('String', [['Key', 'x']])); // 1, with no Value
  addEntryAttachment(version, 'n', 9); // 1 for the name; no data behind a stale reference
  appendChild(version, createElement('Tags', 'ab;c')); // 3
  const association = element('Association', [
    ['Window', 'w'],
    ['KeystrokeSequence', 'seq'],
  ]);
  appendChild(version, appendChild(createElement('AutoType'), association)); // 4
  const item = element('Item', [
    ['Key', 'k'],
    ['Value', 'vv'],
  ]);
  appendChild(version, appendChild(createElement('CustomData'), item)); // 3
  const total = 2 + 3 + 1 + 1 + 3 + 4 + 3;

  setText(getChild(meta, 'HistoryMaxSize') as XmlElement, String(total));
  pushHistorySnapshot(document, version, []);
  assert.equal(getEntryHistory(version).length, 1, 'exactly at the limit, it stays');

  const tooBig = createElement('Entry');
  tooBig.children = version.children.filter(
    (child) => !(child.type === 'element' && child.name === 'History'),
  );
  setText(getChild(meta, 'HistoryMaxSize') as XmlElement, String(total - 1));
  pushHistorySnapshot(document, tooBig, []);
  assert.equal(getEntryHistory(tooBig).length, 0, 'one byte over, it goes');
});

test('createDatabaseDocument records the 6 MiB History size limit, as KeePass does', () => {
  const meta = getChild(createDatabaseDocument('MyDb'), 'Meta') as XmlElement;
  assert.equal(getText(getChild(meta, 'HistoryMaxSize') as XmlElement), String(6 * 1024 * 1024));
});

test('restoreHistoryEntry snapshots the current state, then adopts the historical fields under the same UUID', () => {
  const document = createDatabaseDocument('MyDb');
  const entry = createEntry({ title: 'Original', username: 'alice' });
  const originalUuid = getText(getChild(entry, 'UUID') as XmlElement);
  pushHistorySnapshot(document, entry, []);

  const oldValueEl = getChild(getChildren(entry, 'String')[0] as XmlElement, 'Value') as XmlElement;
  setText(oldValueEl, 'Edited');
  const [snapshot] = getEntryHistory(entry);

  restoreHistoryEntry(document, entry, snapshot as XmlElement, []);

  assert.equal(fieldValue(entry, 'Title'), 'Original', 'live entry adopts the historical fields');
  assert.equal(getText(getChild(entry, 'UUID') as XmlElement), originalUuid, 'UUID is unchanged');

  const history = getEntryHistory(entry);
  assert.equal(history.length, 2, 'the pre-restore state was itself snapshotted');
  assert.equal(
    fieldValue(history[1] as XmlElement, 'Title'),
    'Edited',
    'the just-replaced state is the newest history entry',
  );
});

test('restoreHistoryEntry is a new edit, and keeps the current LocationChanged rather than the snapshot’s', () => {
  const document = createDatabaseDocument('MyDb');
  const entry = createEntry({ title: 'Original' });
  setTimeOf(entry, 'LastModificationTime', LONG_AGO);
  setTimeOf(entry, 'LocationChanged', LONG_AGO);
  pushHistorySnapshot(document, entry, []);
  const movedAt = '2020-06-01T12:00:00Z'; // moved after the snapshot was taken
  setTimeOf(entry, 'LocationChanged', movedAt);
  const [snapshot] = getEntryHistory(entry);

  restoreHistoryEntry(document, entry, snapshot as XmlElement, []);

  assertJustNow(timeOf(entry, 'LastModificationTime'));
  assert.equal(timeOf(entry, 'LocationChanged'), movedAt);
  assert.equal(
    timeOf(snapshot as XmlElement, 'LastModificationTime'),
    LONG_AGO,
    'history untouched',
  );

  // An entry whose file left LocationChanged out gets none invented for it.
  const sparse = createEntry({ title: 'Sparse' });
  const times = getChild(sparse, 'Times') as XmlElement;
  times.children = times.children.filter(
    (child) => !(child.type === 'element' && child.name === 'LocationChanged'),
  );
  pushHistorySnapshot(document, sparse, []);
  restoreHistoryEntry(document, sparse, getEntryHistory(sparse)[0] as XmlElement, []);
  assert.equal(timeEl(sparse, 'LocationChanged'), undefined);
});

test('deleteHistoryEntry removes one snapshot, and does nothing without a History element', () => {
  const entry = createEntry({ title: 'v1' });
  deleteHistoryEntry(entry, entry); // no History element yet: no-op, no throw

  const document = createDatabaseDocument('MyDb');
  pushHistorySnapshot(document, entry, []);
  pushHistorySnapshot(document, entry, []);
  const [first, second] = getEntryHistory(entry);

  deleteHistoryEntry(entry, first as XmlElement);
  assert.deepEqual(getEntryHistory(entry), [second]);
});

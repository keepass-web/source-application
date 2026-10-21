import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addEntryAttachment,
  appendChild,
  cloneElement,
  createDatabaseDocument,
  createElement,
  createEntry,
  createGroup,
  getAttribute,
  getChild,
  getChildren,
  getEntryHistory,
  getText,
  mergeDocuments,
  pushHistorySnapshot,
  setAttribute,
  setText,
  type XmlElement,
} from '../src/index.ts';

/* Two copies of one database diverge, then merge by KeePass's synchronization
rules (#74). Times are whole seconds a month apart, so "newer" is never a
question of clock resolution. */

const T1 = '2026-01-01T00:00:00Z';
const T2 = '2026-02-01T00:00:00Z';
const T3 = '2026-03-01T00:00:00Z';
const T4 = '2026-04-01T00:00:00Z';
const identity = (ref: number): number => ref;

function rootGroupOf(document: XmlElement): XmlElement {
  return getChild(getChild(document, 'Root') as XmlElement, 'Group') as XmlElement;
}

function uuidOf(element: XmlElement): string {
  return getText(getChild(element, 'UUID') as XmlElement);
}

function timeOf(element: XmlElement, name: string): string {
  return getText(getChild(getChild(element, 'Times') as XmlElement, name) as XmlElement);
}

function setTime(element: XmlElement, name: string, iso: string): void {
  setText(getChild(getChild(element, 'Times') as XmlElement, name) as XmlElement, iso);
}

function removeTime(element: XmlElement, name: string): void {
  const times = getChild(element, 'Times') as XmlElement;
  times.children = times.children.filter((c) => !(c.type === 'element' && c.name === name));
}

function field(entry: XmlElement, key: string): string | undefined {
  for (const string of getChildren(entry, 'String')) {
    if (getText(getChild(string, 'Key') as XmlElement) === key) {
      return getText(getChild(string, 'Value') as XmlElement);
    }
  }
  return undefined;
}

function setField(entry: XmlElement, key: string, value: string): void {
  for (const string of getChildren(entry, 'String')) {
    if (getText(getChild(string, 'Key') as XmlElement) === key) {
      setText(getChild(string, 'Value') as XmlElement, value);
    }
  }
}

// Every live group and entry in a document, by UUID.
function objects(document: XmlElement): Map<string, XmlElement> {
  const found = new Map<string, XmlElement>();
  const walk = (group: XmlElement): void => {
    found.set(uuidOf(group), group);
    for (const entry of getChildren(group, 'Entry')) found.set(uuidOf(entry), entry);
    for (const sub of getChildren(group, 'Group')) walk(sub);
  };
  walk(rootGroupOf(document));
  return found;
}

function find(document: XmlElement, uuid: string): XmlElement {
  return objects(document).get(uuid) as XmlElement;
}

function parentOf(document: XmlElement, uuid: string): XmlElement | undefined {
  for (const group of objects(document).values()) {
    if (group.name !== 'Group') continue;
    for (const child of [...getChildren(group, 'Entry'), ...getChildren(group, 'Group')]) {
      if (uuidOf(child) === uuid) return group;
    }
  }
  return undefined;
}

function deletedUuids(document: XmlElement): string[] {
  const list = getChild(getChild(document, 'Root') as XmlElement, 'DeletedObjects');
  return list
    ? getChildren(list, 'DeletedObject').map((r) => getText(getChild(r, 'UUID') as XmlElement))
    : [];
}

function recordDeletion(document: XmlElement, uuid: string, iso: string): void {
  const rootElement = getChild(document, 'Root') as XmlElement;
  let list = getChild(rootElement, 'DeletedObjects');
  if (!list) {
    list = createElement('DeletedObjects');
    appendChild(rootElement, list);
  }
  const record = createElement('DeletedObject');
  appendChild(record, createElement('UUID', uuid));
  appendChild(record, createElement('DeletionTime', iso));
  appendChild(list, record);
}

function detach(document: XmlElement, uuid: string): void {
  const parent = parentOf(document, uuid) as XmlElement;
  parent.children = parent.children.filter(
    (c) => !(c.type === 'element' && getChild(c, 'UUID') && uuidOf(c) === uuid),
  );
}

function move(document: XmlElement, uuid: string, to: XmlElement, iso: string): void {
  const element = find(document, uuid);
  detach(document, uuid);
  appendChild(to, element);
  setTime(element, 'LocationChanged', iso);
}

// An edit as the app makes it: snapshot first, then change, then stamp the time.
function edit(document: XmlElement, entry: XmlElement, title: string, iso: string): void {
  pushHistorySnapshot(document, entry, []);
  setField(entry, 'Title', title);
  setTime(entry, 'LastModificationTime', iso);
}

/* A base database whose every group and entry was last changed and moved at
T1, copied twice: `local` is this tab's copy and `other` the one saved elsewhere. */
function diverge(build: (root: XmlElement) => void): { local: XmlElement; other: XmlElement } {
  const base = createDatabaseDocument('Vault', build);
  for (const object of objects(base).values()) {
    setTime(object, 'LastModificationTime', T1);
    setTime(object, 'LocationChanged', T1);
  }
  return { local: cloneElement(base), other: cloneElement(base) };
}

function oneEntry(): { local: XmlElement; other: XmlElement; id: string } {
  const entry = createEntry({ title: 'GitHub', username: 'octocat' });
  const copies = diverge((root) => appendChild(root, entry));
  return { ...copies, id: uuidOf(entry) };
}

test('an entry only the other copy changed comes in, keeping this version in History, and is no conflict', () => {
  const { local, other, id } = oneEntry();
  edit(other, find(other, id), 'GitHub (work)', T2);

  const summary = mergeDocuments(local, other, identity, []);

  const entry = find(local, id);
  assert.equal(field(entry, 'Title'), 'GitHub (work)');
  assert.equal(timeOf(entry, 'LastModificationTime'), T2);
  assert.deepEqual(
    getEntryHistory(entry).map((v) => field(v, 'Title')),
    ['GitHub'],
    'the shared starting version appears once',
  );
  assert.deepEqual(summary, { changed: 1, conflicts: [] });
});

test('an entry only this copy changed stays as it is, and is no conflict', () => {
  const { local, other, id } = oneEntry();
  edit(local, find(local, id), 'GitHub (mine)', T2);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(field(find(local, id), 'Title'), 'GitHub (mine)');
  assert.equal(getEntryHistory(find(local, id)).length, 1);
  assert.deepEqual(summary, { changed: 0, conflicts: [] });
});

test('an entry both copies changed keeps the newer version, the older one going into History', () => {
  const { local, other, id } = oneEntry();
  edit(local, find(local, id), 'Edited here', T2);
  edit(other, find(other, id), 'Edited there', T3);

  const summary = mergeDocuments(local, other, identity, []);

  const entry = find(local, id);
  assert.equal(field(entry, 'Title'), 'Edited there');
  assert.deepEqual(
    getEntryHistory(entry).map((v) => field(v, 'Title')),
    ['GitHub', 'Edited here'],
    'oldest first: the starting version, then this copy’s',
  );
  assert.deepEqual(summary, { changed: 1, conflicts: ['Edited there'] });
});

test('when this copy’s change is the newer, it stays and the other copy’s goes into History', () => {
  const { local, other, id } = oneEntry();
  edit(other, find(other, id), 'Edited there', T2);
  edit(local, find(local, id), 'Edited here', T3);

  const summary = mergeDocuments(local, other, identity, []);

  const entry = find(local, id);
  assert.equal(field(entry, 'Title'), 'Edited here');
  assert.deepEqual(
    getEntryHistory(entry).map((v) => field(v, 'Title')),
    ['GitHub', 'Edited there'],
  );
  assert.deepEqual(summary, { changed: 0, conflicts: ['Edited here'] });
});

test('two different changes in the same second: this copy stays current and the other is kept in History', () => {
  const { local, other, id } = oneEntry();
  edit(local, find(local, id), 'Here', T2);
  edit(other, find(other, id), 'There', T2);

  const summary = mergeDocuments(local, other, identity, []);

  const entry = find(local, id);
  assert.equal(field(entry, 'Title'), 'Here');
  const versions = getEntryHistory(entry).map((v) => field(v, 'Title'));
  assert.ok(versions.includes('There'), 'neither change is lost');
  assert.deepEqual(summary.conflicts, ['Here']);
});

test('copies that differ only in layout, access times, location or empty fields are the same entry', () => {
  const { local, other, id } = oneEntry();
  const there = find(other, id);
  there.children.reverse(); // another writer's element order
  setTime(there, 'LastAccessTime', T4);
  setTime(there, 'LocationChanged', T1);
  setText(getChild(getChild(there, 'Times') as XmlElement, 'UsageCount') as XmlElement, '7');
  // An empty standard field, and one with no Value at all, are the same as no field.
  there.children = there.children.filter(
    (c) =>
      !(
        c.type === 'element' &&
        c.name === 'String' &&
        getText(getChild(c, 'Key') as XmlElement) === 'URL'
      ),
  );
  const keyOnly = createElement('String');
  appendChild(keyOnly, createElement('Key', 'Orphan'));
  appendChild(there, keyOnly);

  const summary = mergeDocuments(local, other, identity, []);

  assert.deepEqual(summary, { changed: 0, conflicts: [] });
  assert.equal(getChild(find(local, id), 'History'), undefined, 'no History invented');
});

test('entries and groups only the other copy has come in where it keeps them', () => {
  const work = createGroup('Work');
  const copies = diverge((root) => appendChild(root, work));
  const { local, other } = copies;
  const there = find(other, uuidOf(work));
  const added = createEntry({ title: 'Jira' });
  appendChild(there, added);
  const nested = createGroup('Servers');
  const deep = createEntry({ title: 'db01' });
  appendChild(nested, deep);
  appendChild(there, nested);
  const mine = createEntry({ title: 'Only here' });
  appendChild(rootGroupOf(local), mine);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(parentOf(local, uuidOf(added)), find(local, uuidOf(work)));
  assert.equal(parentOf(local, uuidOf(nested)), find(local, uuidOf(work)));
  assert.equal(parentOf(local, uuidOf(deep)), find(local, uuidOf(nested)));
  assert.ok(find(local, uuidOf(mine)), 'what only this copy has stays');
  assert.deepEqual(summary, { changed: 3, conflicts: [] });
});

test('another database’s root lands inside this one, as KeePass places it', () => {
  const local = createDatabaseDocument('Mine');
  const other = createDatabaseDocument('Theirs');
  const entry = createEntry({ title: 'Theirs only' });
  appendChild(rootGroupOf(other), entry);

  mergeDocuments(local, other, identity, []);

  const imported = getChildren(rootGroupOf(local), 'Group')[0] as XmlElement;
  assert.equal(getText(getChild(imported, 'Name') as XmlElement), 'Theirs');
  assert.equal(parentOf(local, uuidOf(entry)), imported);
});

test('a group’s newer name comes in and its contents stay; an older one does not', () => {
  const renamed = createGroup('Work');
  const kept = createGroup('Home');
  const copies = diverge((root) => {
    appendChild(renamed, createEntry({ title: 'Inside' }));
    appendChild(root, renamed);
    appendChild(root, kept);
  });
  const { local, other } = copies;
  const there = find(other, uuidOf(renamed));
  setText(getChild(there, 'Name') as XmlElement, 'Office');
  setTime(there, 'LastModificationTime', T2);
  removeTime(find(local, uuidOf(renamed)), 'LocationChanged'); // a writer that left it out
  const older = find(other, uuidOf(kept));
  setText(getChild(older, 'Name') as XmlElement, 'Stale');
  const newerHere = find(local, uuidOf(kept));
  setText(getChild(newerHere, 'Name') as XmlElement, 'House');
  setTime(newerHere, 'LastModificationTime', T3);

  const summary = mergeDocuments(local, other, identity, []);

  const group = find(local, uuidOf(renamed));
  assert.equal(getText(getChild(group, 'Name') as XmlElement), 'Office');
  assert.equal(getChildren(group, 'Entry').length, 1, 'its entries stay');
  assert.equal(getText(getChild(find(local, uuidOf(kept)), 'Name') as XmlElement), 'House');
  assert.equal(summary.changed, 1);
});

test('an object goes where the copy that moved it last put it, keeping that time', () => {
  const a = createGroup('A');
  const b = createGroup('B');
  const mover = createEntry({ title: 'Mover' });
  const stayer = createEntry({ title: 'Stayer' });
  const { local, other } = diverge((root) => {
    appendChild(a, mover);
    appendChild(a, stayer);
    appendChild(root, a);
    appendChild(root, b);
  });
  move(other, uuidOf(mover), find(other, uuidOf(b)), T3);
  move(other, uuidOf(stayer), rootGroupOf(other), T2);
  move(local, uuidOf(stayer), find(local, uuidOf(b)), T3); // moved here after its move there

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(parentOf(local, uuidOf(mover)), find(local, uuidOf(b)), 'moved as it was there');
  assert.equal(timeOf(find(local, uuidOf(mover)), 'LocationChanged'), T3);
  assert.equal(parentOf(local, uuidOf(stayer)), find(local, uuidOf(b)), 'the later move wins');
  assert.equal(summary.changed, 1);
});

test('a later move to the same group only takes the time, and a group is never moved into itself', () => {
  const outer = createGroup('Outer');
  const inner = createGroup('Inner');
  const entry = createEntry({ title: 'Same place' });
  const copies = diverge((root) => {
    appendChild(outer, inner);
    appendChild(root, outer);
    appendChild(root, entry);
  });
  const { local, other } = copies;
  setTime(find(other, uuidOf(entry)), 'LocationChanged', T2);
  setTime(rootGroupOf(other), 'LocationChanged', T2); // the root has nowhere to move
  // There, Outer was moved inside Inner, which is inside Outer here.
  const thereOuter = find(other, uuidOf(outer));
  const thereInner = find(other, uuidOf(inner));
  thereOuter.children = thereOuter.children.filter((c) => c !== thereInner);
  detach(other, uuidOf(outer));
  appendChild(rootGroupOf(other), thereInner);
  appendChild(thereInner, thereOuter);
  setTime(thereOuter, 'LocationChanged', T3);
  // A copy that left LocationChanged out moves nothing.
  removeTime(thereInner, 'LocationChanged');

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(timeOf(find(local, uuidOf(entry)), 'LocationChanged'), T2);
  assert.equal(timeOf(rootGroupOf(local), 'LocationChanged'), T2);
  assert.equal(parentOf(local, uuidOf(outer)), rootGroupOf(local), 'not moved into its own child');
  assert.equal(parentOf(local, uuidOf(inner)), find(local, uuidOf(outer)));
  assert.equal(summary.changed, 0);
});

test('a deletion from either copy removes what was not edited after it, and the records combine', () => {
  const doomed = createEntry({ title: 'Doomed' });
  const revived = createEntry({ title: 'Edited after' });
  const goneHere = createEntry({ title: 'Deleted here' });
  const copies = diverge((root) => {
    appendChild(root, doomed);
    appendChild(root, revived);
    appendChild(root, goneHere);
  });
  const { local, other } = copies;
  detach(other, uuidOf(doomed));
  recordDeletion(other, uuidOf(doomed), T2);
  detach(other, uuidOf(revived));
  recordDeletion(other, uuidOf(revived), T2);
  edit(local, find(local, uuidOf(revived)), 'Edited after', T3);
  detach(local, uuidOf(goneHere));
  recordDeletion(local, uuidOf(goneHere), T2);
  // Two records for one object: the later stands.
  recordDeletion(local, uuidOf(doomed), T1);
  recordDeletion(other, uuidOf(goneHere), T1);
  recordDeletion(other, 'no-such-object', T2);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(objects(local).has(uuidOf(doomed)), false);
  assert.ok(objects(local).has(uuidOf(revived)), 'an edit after the deletion keeps it');
  assert.equal(objects(local).has(uuidOf(goneHere)), false, 'not brought back');
  assert.deepEqual(
    deletedUuids(local).sort(),
    [uuidOf(doomed), uuidOf(goneHere), uuidOf(revived), 'no-such-object'].sort(),
  );
  const doomedRecord = getChildren(
    getChild(getChild(local, 'Root') as XmlElement, 'DeletedObjects') as XmlElement,
    'DeletedObject',
  ).find((r) => getText(getChild(r, 'UUID') as XmlElement) === uuidOf(doomed)) as XmlElement;
  assert.equal(getText(getChild(doomedRecord, 'DeletionTime') as XmlElement), T2);
  assert.deepEqual(summary, { changed: 1, conflicts: [] });
});

test('a deleted group goes once empty and unedited since; one still holding something stays', () => {
  const emptied = createGroup('Emptied');
  const child = createEntry({ title: 'Child' });
  const held = createGroup('Held');
  const keeper = createEntry({ title: 'Keeper' });
  const renamedLater = createGroup('Renamed later');
  const copies = diverge((root) => {
    appendChild(emptied, child);
    appendChild(root, emptied);
    appendChild(held, keeper);
    appendChild(root, held);
    appendChild(root, renamedLater);
  });
  const { local, other } = copies;
  for (const uuid of [uuidOf(emptied), uuidOf(child), uuidOf(held), uuidOf(renamedLater)]) {
    recordDeletion(other, uuid, T2);
  }
  detach(other, uuidOf(emptied));
  detach(other, uuidOf(held));
  detach(other, uuidOf(renamedLater));
  setTime(find(local, uuidOf(renamedLater)), 'LastModificationTime', T3);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(objects(local).has(uuidOf(emptied)), false);
  assert.equal(objects(local).has(uuidOf(child)), false);
  assert.ok(objects(local).has(uuidOf(held)), 'Keeper has no record, so its group stays');
  assert.ok(objects(local).has(uuidOf(renamedLater)));
  assert.equal(summary.changed, 2);
});

test('what the other copy added and this copy already deleted does not come in, nor count', () => {
  const { local, other } = diverge(() => {});
  const added = createEntry({ title: 'Added there' });
  appendChild(rootGroupOf(other), added);
  const addedGroup = createGroup('Added group there');
  appendChild(rootGroupOf(other), addedGroup);
  recordDeletion(local, uuidOf(added), T4);
  recordDeletion(local, uuidOf(addedGroup), T4);
  setTime(added, 'LastModificationTime', T1);
  setTime(addedGroup, 'LastModificationTime', T1);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(objects(local).has(uuidOf(added)), false);
  assert.equal(objects(local).has(uuidOf(addedGroup)), false);
  assert.deepEqual(summary, { changed: 0, conflicts: [] });
});

test('attachments are re-pointed into this database’s pool, History included', () => {
  const entry = createEntry({ title: 'With file' });
  const { local, other } = diverge((root) => appendChild(root, entry));
  const there = find(other, uuidOf(entry));
  addEntryAttachment(there, 'old.txt', 0);
  pushHistorySnapshot(other, there, []);
  addEntryAttachment(there, 'new.txt', 1);
  setTime(there, 'LastModificationTime', T2);
  const malformed = createElement('Binary');
  appendChild(malformed, createElement('Key', 'no-value'));
  appendChild(there, malformed);
  const noRef = createElement('Binary');
  appendChild(noRef, createElement('Value'));
  appendChild(there, noRef);
  const seen: number[] = [];

  mergeDocuments(
    local,
    other,
    (ref) => {
      seen.push(ref);
      return ref + 10;
    },
    [],
  );

  assert.deepEqual(seen.sort(), [0, 0, 1]);
  const refs = getChildren(find(local, uuidOf(entry)), 'Binary').flatMap((b) => {
    const value = getChild(b, 'Value');
    const ref = value && getAttribute(value, 'Ref');
    return ref === undefined ? [] : [ref];
  });
  assert.deepEqual(refs, ['10', '11']);
});

test('merged History keeps the database’s limit; a negative or unreadable limit keeps everything', () => {
  for (const [limit, expected] of [
    ['2', 2],
    ['-1', 4],
    ['many', 4],
    [undefined, 4],
  ] as const) {
    const { local, other, id } = oneEntry();
    const meta = getChild(local, 'Meta') as XmlElement;
    meta.children = meta.children.filter(
      (c) => !(c.type === 'element' && c.name === 'HistoryMaxItems'),
    );
    if (limit !== undefined) appendChild(meta, createElement('HistoryMaxItems', limit));
    edit(local, find(local, id), 'Here 1', '2026-01-02T00:00:00Z');
    edit(local, find(local, id), 'Here 2', '2026-01-03T00:00:00Z');
    edit(other, find(other, id), 'There 1', '2026-01-04T00:00:00Z');
    edit(other, find(other, id), 'There 2', '2026-01-05T00:00:00Z');

    mergeDocuments(local, other, identity, []);

    const versions = getEntryHistory(find(local, id)).map((v) => field(v, 'Title'));
    assert.equal(versions.length, expected, `limit ${String(limit)}`);
    assert.equal(versions.at(-1), 'There 1', 'the newest versions are the ones kept');
  }
});

test('merged History keeps within the database’s size limit too, newest versions first (#166)', () => {
  // Each version carries a 1000-byte attachment, so 2500 bytes holds two of the four.
  const { local, other, id } = oneEntry();
  const meta = getChild(local, 'Meta') as XmlElement;
  setText(getChild(meta, 'HistoryMaxSize') as XmlElement, '2500');
  const binaries = [{ flags: 0, data: new Uint8Array(1000) }];
  addEntryAttachment(find(local, id), 'big.bin', 0);
  addEntryAttachment(find(other, id), 'big.bin', 0);
  edit(local, find(local, id), 'Here 1', '2026-01-02T00:00:00Z');
  edit(local, find(local, id), 'Here 2', '2026-01-03T00:00:00Z');
  edit(other, find(other, id), 'There 1', '2026-01-04T00:00:00Z');
  edit(other, find(other, id), 'There 2', '2026-01-05T00:00:00Z');

  mergeDocuments(local, other, identity, binaries);

  const versions = getEntryHistory(find(local, id)).map((v) => field(v, 'Title'));
  assert.deepEqual(versions, ['Here 2', 'There 1']);
});

test('database settings follow their own newer change times, and icons and custom data combine', () => {
  const { local, other } = diverge(() => {});
  const localMeta = getChild(local, 'Meta') as XmlElement;
  const otherMeta = getChild(other, 'Meta') as XmlElement;
  // Renamed there later: comes in.
  setText(getChild(localMeta, 'DatabaseNameChanged') as XmlElement, T1);
  setText(getChild(otherMeta, 'DatabaseName') as XmlElement, 'Renamed there');
  setText(getChild(otherMeta, 'DatabaseNameChanged') as XmlElement, T3);
  // A newer bin setting there that names a bin but leaves RecycleBinEnabled out.
  otherMeta.children = otherMeta.children.filter(
    (c) => !(c.type === 'element' && c.name === 'RecycleBinEnabled'),
  );
  appendChild(otherMeta, createElement('RecycleBinUUID', 'bin-there'));
  appendChild(otherMeta, createElement('RecycleBinChanged', T3));
  appendChild(localMeta, createElement('RecycleBinUUID', 'bin-here'));
  appendChild(localMeta, createElement('RecycleBinChanged', T2));
  // An older default user name there: stays as it is here.
  appendChild(otherMeta, createElement('DefaultUserName', 'stale'));
  appendChild(otherMeta, createElement('DefaultUserNameChanged', T1));
  appendChild(localMeta, createElement('DefaultUserName', 'current'));
  appendChild(localMeta, createElement('DefaultUserNameChanged', T2));

  const item = (key: string, value: string, iso?: string): XmlElement => {
    const el = createElement('Item');
    appendChild(el, createElement('Key', key));
    appendChild(el, createElement('Value', value));
    if (iso) appendChild(el, createElement('LastModificationTime', iso));
    return el;
  };
  const localData = createElement('CustomData');
  appendChild(localData, item('shared-newer-there', 'old', T1));
  appendChild(localData, item('shared-newer-here', 'mine', T3));
  appendChild(localMeta, localData);
  const otherData = createElement('CustomData');
  appendChild(otherData, item('shared-newer-there', 'new', T2));
  appendChild(otherData, item('shared-newer-here', 'theirs', T2));
  appendChild(otherData, item('only-there', 'x'));
  const keyless = createElement('Item');
  appendChild(keyless, createElement('Value', ''));
  appendChild(otherData, keyless);
  appendChild(otherMeta, otherData);
  const icons = createElement('CustomIcons');
  const icon = createElement('Icon');
  appendChild(icon, createElement('UUID', 'icon-there'));
  appendChild(icon, createElement('Data', 'iVBORw0KGgo='));
  appendChild(icons, icon);
  appendChild(otherMeta, icons);

  mergeDocuments(local, other, identity, []);

  const text = (name: string): string => getText(getChild(localMeta, name) as XmlElement);
  assert.equal(text('DatabaseName'), 'Renamed there');
  assert.equal(text('DatabaseNameChanged'), T3);
  assert.equal(text('RecycleBinUUID'), 'bin-there');
  assert.equal(text('RecycleBinEnabled'), 'True', 'a setting the other copy left out stays');
  assert.equal(text('DefaultUserName'), 'current');
  const data = getChildren(getChild(localMeta, 'CustomData') as XmlElement, 'Item').map((i) => {
    const keyEl = getChild(i, 'Key');
    return [keyEl ? getText(keyEl) : '', getText(getChild(i, 'Value') as XmlElement)];
  });
  assert.deepEqual(data, [
    ['shared-newer-there', 'new'],
    ['shared-newer-here', 'mine'],
    ['only-there', 'x'],
    ['', ''],
  ]);
  const localIcons = getChild(localMeta, 'CustomIcons') as XmlElement;
  assert.deepEqual(
    getChildren(localIcons, 'Icon').map((i) => getText(getChild(i, 'UUID') as XmlElement)),
    ['icon-there'],
  );
});

test('objects without a UUID can’t be matched, so the other copy’s come in as new', () => {
  const { local, other } = diverge(() => {});
  const anonymous = createElement('Entry');
  appendChild(anonymous, createElement('String'));
  appendChild(rootGroupOf(other), anonymous);
  const anonymousGroup = createElement('Group');
  appendChild(anonymousGroup, createElement('Name', 'Nameless'));
  appendChild(rootGroupOf(other), anonymousGroup);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(getChildren(rootGroupOf(local), 'Entry').length, 1);
  assert.equal(getChildren(rootGroupOf(local), 'Group').length, 1);
  assert.equal(summary.changed, 2);
});

test('an untitled conflict is reported with an empty title', () => {
  const entry = createEntry({});
  const { local, other } = diverge((root) => appendChild(root, entry));
  const here = find(local, uuidOf(entry));
  here.children = here.children.filter((c) => !(c.type === 'element' && c.name === 'String'));
  setTime(here, 'LastModificationTime', T3);
  setField(find(other, uuidOf(entry)), 'UserName', 'changed');
  setTime(find(other, uuidOf(entry)), 'LastModificationTime', T2);

  const summary = mergeDocuments(local, other, identity, []);

  assert.deepEqual(summary.conflicts, [''], 'the copy here stays, and it has no Title');
});

test('documents without Meta still merge their entries', () => {
  const { local, other, id } = oneEntry();
  local.children = local.children.filter((c) => !(c.type === 'element' && c.name === 'Meta'));
  other.children = other.children.filter((c) => !(c.type === 'element' && c.name === 'Meta'));
  edit(other, find(other, id), 'There', T2);

  mergeDocuments(local, other, identity, []);

  assert.equal(field(find(local, id), 'Title'), 'There');
});

test('a document with no root group cannot be merged', () => {
  const good = createDatabaseDocument('Vault');
  const bad = createElement('KeePassFile');
  assert.throws(() => mergeDocuments(good, bad, identity, []), /no root group/);
  assert.throws(() => mergeDocuments(bad, good, identity, []), /no root group/);
});

test('an entry changed there gains a History element here when it had none', () => {
  const { local, other, id } = oneEntry();
  const there = find(other, id);
  setField(there, 'Title', 'No snapshot there');
  setTime(there, 'LastModificationTime', T2);

  mergeDocuments(local, other, identity, []);

  assert.deepEqual(
    getEntryHistory(find(local, id)).map((v) => field(v, 'Title')),
    ['GitHub'],
  );
});

test('an attribute difference, such as protection, counts as a change', () => {
  const { local, other, id } = oneEntry();
  const there = find(other, id);
  const value = getChild(getChildren(there, 'String')[1] as XmlElement, 'Value') as XmlElement;
  setAttribute(value, 'Protected', 'True');
  setTime(there, 'LastModificationTime', T2);

  const summary = mergeDocuments(local, other, identity, []);

  assert.equal(summary.changed, 1);
});

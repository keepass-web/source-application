import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChild,
  createElement,
  createEntry,
  createGroup,
  type XmlElement,
} from '../../packages/kdbx/src/index.ts';
import {
  collectAllEntries,
  entryField,
  entryTitle,
  findEntryParent,
  groupName,
  groupPathTo,
} from '../0x67/logic.ts';

test('entryField returns the value of a matching field, or "" when absent', () => {
  const entry = createEntry({ title: 'GitHub', username: 'octocat' });
  assert.equal(entryField(entry, 'Title'), 'GitHub');
  assert.equal(entryField(entry, 'UserName'), 'octocat');
  assert.equal(entryField(entry, 'Nonexistent'), '');
});

test('entryField returns "" for a String field whose Value element is missing', () => {
  // Hand-build a <String><Key>Foo</Key></String> with no <Value> at all, to
  // exercise the `v ? getText(v) : ''` branch where the key matches but
  // there's no value element to read.
  const entry = createElement('Entry');
  const string = createElement('String');
  appendChild(string, createElement('Key', 'Foo'));
  appendChild(entry, string);
  assert.equal(entryField(entry, 'Foo'), '');
});

test('entryTitle falls back to "(no title)" when the title field is empty', () => {
  assert.equal(entryTitle(createEntry({ title: 'GitHub' })), 'GitHub');
  assert.equal(entryTitle(createEntry({})), '(no title)');
});

test('groupName falls back to "(unnamed)" when there is no Name element', () => {
  assert.equal(groupName(createGroup('Passwords')), 'Passwords');
  assert.equal(groupName(createElement('Group')), '(unnamed)');
});

test('findEntryParent finds the direct parent, searches subgroups, and returns null if absent', () => {
  const root = createGroup('Root');
  const sub = createGroup('Sub');
  appendChild(root, sub);

  const directEntry = createEntry({ title: 'Direct' });
  appendChild(root, directEntry);
  const nestedEntry = createEntry({ title: 'Nested' });
  appendChild(sub, nestedEntry);
  const orphanEntry = createEntry({ title: 'Orphan' });

  assert.equal(findEntryParent(root, directEntry), root);
  assert.equal(findEntryParent(root, nestedEntry), sub);
  assert.equal(findEntryParent(root, orphanEntry), null);
});

test('collectAllEntries gathers every entry in the tree, paired with its group', () => {
  const root = createGroup('Root');
  const sub = createGroup('Sub');
  appendChild(root, sub);

  const rootEntry = createEntry({ title: 'RootEntry' });
  appendChild(root, rootEntry);
  const subEntry = createEntry({ title: 'SubEntry' });
  appendChild(sub, subEntry);

  const all = collectAllEntries(root);
  assert.deepEqual(
    all.map(({ entry, group }) => ({ entry, group })),
    [
      { entry: rootEntry, group: root },
      { entry: subEntry, group: sub },
    ],
  );
});

test('collectAllEntries returns an empty array for a group with no entries', () => {
  assert.deepEqual(collectAllEntries(createGroup('Empty')), []);
});

test('groupPathTo returns the path to a group, or null if it is not in the tree', () => {
  const root = createGroup('Root');
  const child = createGroup('Child');
  const grandchild = createGroup('Grandchild');
  appendChild(root, child);
  appendChild(child, grandchild);

  assert.deepEqual(groupPathTo(root, root), ['Root']);
  assert.deepEqual(groupPathTo(root, grandchild), ['Root', 'Child', 'Grandchild']);
  assert.equal(groupPathTo(root, createGroup('Elsewhere')), null);
});

// Sanity check that fixtures really are the ambient XmlElement shape logic.ts
// expects, not a structurally-different lookalike.
test('fixtures are real XmlElement values', () => {
  const group: XmlElement = createGroup('Check');
  assert.equal(group.type, 'element');
});

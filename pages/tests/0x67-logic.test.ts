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
  applyEntryEdits,
  collectAllEntries,
  elementIconId,
  entryField,
  entryTitle,
  filterEntriesByQuery,
  findEntryParent,
  generatePassword,
  groupName,
  groupPathTo,
  iconEmoji,
  isCustomField,
  isValidClipboardTimeout,
} from '../0x67/logic.ts';

const GENERATOR_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GENERATOR_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const GENERATOR_DIGITS = '0123456789';
const GENERATOR_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';

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

test('filterEntriesByQuery matches case-insensitively against any String value', () => {
  const root = createGroup('Root');
  const github = createEntry({ title: 'GitHub', username: 'octocat' });
  const gitlab = createEntry({ title: 'GitLab', username: 'tanuki' });
  appendChild(root, github);
  appendChild(root, gitlab);
  const all = collectAllEntries(root);

  assert.deepEqual(
    filterEntriesByQuery(all, 'GIT').map(({ entry }) => entry),
    [github, gitlab],
  );
  assert.deepEqual(
    filterEntriesByQuery(all, 'octo').map(({ entry }) => entry),
    [github],
  );
  assert.deepEqual(filterEntriesByQuery(all, 'nonexistent'), []);
});

test('filterEntriesByQuery also matches against tags', () => {
  const root = createGroup('Root');
  const tagged = createEntry({ title: 'Tagged Entry' });
  appendChild(tagged, createElement('Tags', 'Work;Urgent'));
  const untagged = createEntry({ title: 'Untagged Entry' });
  appendChild(root, tagged);
  appendChild(root, untagged);
  const all = collectAllEntries(root);

  assert.deepEqual(
    filterEntriesByQuery(all, 'urg').map(({ entry }) => entry),
    [tagged],
  );
});

test('filterEntriesByQuery skips String fields with no Value element', () => {
  const entry = createElement('Entry');
  const string = createElement('String');
  appendChild(string, createElement('Key', 'Foo'));
  appendChild(entry, string);
  const root = createGroup('Root');
  appendChild(root, entry);

  assert.deepEqual(filterEntriesByQuery(collectAllEntries(root), 'anything'), []);
});

test('applyEntryEdits replaces all String fields with the given key/value/protect triples', () => {
  const entry = createEntry({ title: 'Old', username: 'old-user' });
  applyEntryEdits(entry, [
    { key: 'Title', value: 'New', protect: false },
    { key: 'Password', value: 'secret', protect: true },
  ]);
  assert.equal(entryField(entry, 'Title'), 'New');
  assert.equal(entryField(entry, 'Password'), 'secret');
  // The old UserName field is gone entirely, not just left empty.
  assert.equal(entryField(entry, 'UserName'), '');
});

test('applyEntryEdits skips rows with a blank key', () => {
  const entry = createElement('Entry');
  applyEntryEdits(entry, [{ key: '', value: 'ignored', protect: false }]);
  assert.deepEqual(entry.children, []);
});

test('isCustomField is false for the five standard fields and true otherwise', () => {
  for (const key of ['Title', 'UserName', 'Password', 'URL', 'Notes']) {
    assert.equal(isCustomField(key), false);
  }
  assert.equal(isCustomField('API Key'), true);
});

test('isValidClipboardTimeout requires a real number of at least 5 seconds', () => {
  assert.equal(isValidClipboardTimeout(5), true);
  assert.equal(isValidClipboardTimeout(30), true);
  assert.equal(isValidClipboardTimeout(4), false);
  assert.equal(isValidClipboardTimeout(Number.NaN), false);
});

test('generatePassword produces a password of the requested length', () => {
  const password = generatePassword({
    length: 32,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
  });
  assert.equal(password.length, 32);
});

test('generatePassword only draws from the selected character classes', () => {
  const upperOnly = generatePassword({ length: 40, upper: true });
  assert.ok([...upperOnly].every((c) => GENERATOR_UPPER.includes(c)));

  const lowerOnly = generatePassword({ length: 40, lower: true });
  assert.ok([...lowerOnly].every((c) => GENERATOR_LOWER.includes(c)));

  const digitsOnly = generatePassword({ length: 40, digits: true });
  assert.ok([...digitsOnly].every((c) => GENERATOR_DIGITS.includes(c)));

  const symbolsOnly = generatePassword({ length: 40, symbols: true });
  assert.ok([...symbolsOnly].every((c) => GENERATOR_SYMBOLS.includes(c)));
});

test('generatePassword draws from every selected class given enough length', () => {
  // Long enough that, statistically, the chance any eligible class is
  // entirely absent (or that rejection sampling's redraw branch never
  // fires once across the whole run) is astronomically small — the same
  // trust placed in this repo's real KDF/cipher tests elsewhere, not a
  // mocked RNG.
  const password = generatePassword({
    length: 200,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
  });
  const all = GENERATOR_UPPER + GENERATOR_LOWER + GENERATOR_DIGITS + GENERATOR_SYMBOLS;
  assert.ok([...password].every((c) => all.includes(c)));
  assert.ok([...password].some((c) => GENERATOR_UPPER.includes(c)));
  assert.ok([...password].some((c) => GENERATOR_LOWER.includes(c)));
  assert.ok([...password].some((c) => GENERATOR_DIGITS.includes(c)));
  assert.ok([...password].some((c) => GENERATOR_SYMBOLS.includes(c)));
});

test('generatePassword throws when no character class is selected', () => {
  assert.throws(() => generatePassword({ length: 10 }), /select at least one/i);
  assert.throws(
    () =>
      generatePassword({ length: 10, upper: false, lower: false, digits: false, symbols: false }),
    /select at least one/i,
  );
});

test('generatePassword throws for a non-positive or non-integer length', () => {
  assert.throws(() => generatePassword({ length: 0, upper: true }), /positive whole number/i);
  assert.throws(() => generatePassword({ length: -5, upper: true }), /positive whole number/i);
  assert.throws(() => generatePassword({ length: 3.5, upper: true }), /positive whole number/i);
});

test('elementIconId reads the IconID child, or falls back to "0" when absent', () => {
  const entry = createEntry({ title: 'Has an icon' });
  assert.equal(elementIconId(entry), '0');

  const bare = createElement('Entry');
  assert.equal(elementIconId(bare), '0');
});

test('iconEmoji maps known IDs and falls back to a generic icon for unknown ones', () => {
  assert.equal(iconEmoji('0'), '🔑');
  assert.equal(iconEmoji('49'), '📁');
  assert.equal(iconEmoji('9999'), '❔');
});

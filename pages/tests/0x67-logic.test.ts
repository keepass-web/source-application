import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addEntryAttachment,
  appendChild,
  createDatabaseDocument,
  createElement,
  createEntry,
  createGroup,
  findOrCreateRecycleBin,
  getChild,
  getChildren,
  getEntryTimes,
  getText,
  moveToGroup,
  setText,
  type XmlElement,
} from '../../packages/kdbx/src/index.ts';
import {
  applyEntryEdits,
  collectAllEntries,
  collectSearchableEntries,
  defaultExpiryLocalInputValue,
  duplicateName,
  elementIconId,
  entryColumnValue,
  entryField,
  entryTitle,
  entryUuid,
  type FieldReader,
  filterEntriesByQuery,
  findEntryParent,
  findGroupParent,
  generatePassword,
  groupName,
  groupPathTo,
  hasTotp,
  holdLockedEdit,
  ICON_PALETTE,
  iconName,
  isCustomField,
  isDescendantGroup,
  isGroupFurled,
  isoToLocalInputValue,
  isValidAutoLockTimeout,
  isValidClipboardTimeout,
  isValidCurtainTimeout,
  type LockedEdit,
  localInputValueToIso,
  openableUrl,
  readTotp,
  setGroupFurled,
  sortEntries,
  takeLockedEdit,
  toCsv,
  totpCode,
  totpSecondsLeft,
  totpSettings,
  totpStep,
  unlockAttempts,
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

test('findGroupParent finds the direct parent, searches subgroups, and returns null for the root itself', () => {
  const root = createGroup('Root');
  const sub = createGroup('Sub');
  appendChild(root, sub);
  const nested = createGroup('Nested');
  appendChild(sub, nested);
  const orphan = createGroup('Orphan');

  assert.equal(findGroupParent(root, sub), root);
  assert.equal(findGroupParent(root, nested), sub);
  assert.equal(findGroupParent(root, orphan), null);
  assert.equal(findGroupParent(root, root), null);
});

test('isDescendantGroup is true for the group itself and anything nested inside it, false otherwise', () => {
  const root = createGroup('Root');
  const sub = createGroup('Sub');
  appendChild(root, sub);
  const nested = createGroup('Nested');
  appendChild(sub, nested);
  const sibling = createGroup('Sibling');
  appendChild(root, sibling);

  assert.equal(isDescendantGroup(sub, sub), true);
  assert.equal(isDescendantGroup(sub, nested), true);
  assert.equal(isDescendantGroup(sub, sibling), false);
  assert.equal(isDescendantGroup(sub, root), false);
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

test("filterEntriesByQuery matches case-insensitively against an entry's fields", () => {
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

test('filterEntriesByQuery never matches a password or protected value, but does an unprotected custom field (#131)', () => {
  // KeePass and KeePassXC leave passwords out of search, so typing part of one finds nothing.
  const root = createGroup('Root');
  const entry = createEntry({
    title: 'Bank',
    password: 'hunter2',
    url: 'https://bank.example',
    notes: 'branch on Main St',
    fields: [
      { key: 'Account', value: '12345678' },
      { key: 'PIN', value: '9876', protect: true },
    ],
  });
  appendChild(root, entry);
  const all = collectAllEntries(root);
  const matches = (query: string) => filterEntriesByQuery(all, query).length === 1;

  assert.equal(matches('hunter'), false, 'the password');
  assert.equal(matches('9876'), false, 'a protected custom field');
  assert.equal(matches('bank.example'), true, 'the URL');
  assert.equal(matches('main st'), true, 'the notes');
  assert.equal(matches('345'), true, 'an unprotected custom field');

  // A password left unprotected by its file is still left out.
  const unprotected = createElement('Entry');
  applyEntryEdits(unprotected, [{ key: 'Password', value: 'plain-secret', protect: false }]);
  assert.deepEqual(filterEntriesByQuery([{ entry: unprotected, group: root }], 'plain'), []);

  // A malformed field with no Key or no Value matches nothing, rather than throwing.
  const malformed = createElement('Entry');
  appendChild(malformed, appendChild(createElement('String'), createElement('Key', 'Lonely')));
  appendChild(malformed, appendChild(createElement('String'), createElement('Value', 'orphan')));
  assert.deepEqual(filterEntriesByQuery([{ entry: malformed, group: root }], 'orphan'), []);
});

test('collectSearchableEntries skips the recycle bin and groups with searching off, as KeePass does (#131)', () => {
  const document = createDatabaseDocument('Db');
  const rootGroup = getChild(getChild(document, 'Root') as XmlElement, 'Group') as XmlElement;
  const top = createEntry({ title: 'Top' });
  const hidden = createGroup('Hidden');
  const hiddenChild = createGroup('Hidden child'); // inherits searching off
  const shownAgain = createGroup('Shown again'); // turns it back on
  const inheritsNull = createGroup('Says null'); // "null" means inherit, as KeePass writes it
  appendChild(hidden, createElement('EnableSearching', 'false'));
  appendChild(shownAgain, createElement('EnableSearching', 'true'));
  appendChild(inheritsNull, createElement('EnableSearching', 'null'));
  appendChild(rootGroup, top);
  appendChild(rootGroup, hidden);
  appendChild(hidden, createEntry({ title: 'In hidden' }));
  appendChild(hidden, hiddenChild);
  appendChild(hiddenChild, createEntry({ title: 'In hidden child' }));
  appendChild(hidden, shownAgain);
  appendChild(shownAgain, createEntry({ title: 'In shown again' }));
  appendChild(rootGroup, inheritsNull);
  appendChild(inheritsNull, createEntry({ title: 'In null' }));

  // A bin this app made before it set searching off on it is still left out.
  const trashed = createEntry({ title: 'Trashed' });
  appendChild(rootGroup, trashed);
  moveToGroup(trashed, rootGroup, findOrCreateRecycleBin(document));

  const titles = collectSearchableEntries(document, rootGroup).map(({ entry }) =>
    entryTitle(entry),
  );
  assert.deepEqual(titles, ['Top', 'In shown again', 'In null']);
});

test('a group is furled through its IsExpanded, read and written as KeePass does (#183)', () => {
  const group = createGroup('Work');
  const modified = (): string =>
    getText(getChild(getChild(group, 'Times') as XmlElement, 'LastModificationTime') as XmlElement);
  const before = modified();
  const settings = (): string[] => getChildren(group, 'IsExpanded').map(getText);

  // A group this app made has no IsExpanded, which KeePass reads as expanded.
  assert.equal(isGroupFurled(group), false);

  setGroupFurled(group, true);
  assert.deepEqual(settings(), ['False'], 'written as KeePass writes it');
  assert.equal(isGroupFurled(group), true);
  setGroupFurled(group, false);
  assert.deepEqual(settings(), ['True'], 'the one setting is rewritten, never repeated');
  assert.equal(isGroupFurled(group), false);
  assert.equal(modified(), before, 'furling is not a modification, so merges ignore it');

  // As KeePass and KeePassXC write it, and as KeePassXC also reads lowercase; anything else is expanded.
  const read = (value: string): boolean => {
    const other = createGroup('Other');
    appendChild(other, createElement('IsExpanded', value));
    return isGroupFurled(other);
  };
  assert.equal(read('False'), true);
  assert.equal(read('false'), true);
  assert.equal(read('True'), false);
  assert.equal(read(''), false);
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

test('sortEntries orders by title or username, case-insensitively, in either direction', () => {
  const root = createGroup('Root');
  const bob = createEntry({ title: 'bob', username: 'Zeta' });
  const alice = createEntry({ title: 'Alice', username: 'alpha' });
  appendChild(root, bob);
  appendChild(root, alice);
  const all = collectAllEntries(root);

  assert.deepEqual(
    sortEntries(all, 'title', 'asc').map(({ entry }) => entry),
    [alice, bob],
    '"Alice" sorts before "bob" case-insensitively',
  );
  assert.deepEqual(
    sortEntries(all, 'title', 'desc').map(({ entry }) => entry),
    [bob, alice],
  );
  assert.deepEqual(
    sortEntries(all, 'username', 'asc').map(({ entry }) => entry),
    [alice, bob],
    '"alpha" sorts before "Zeta" case-insensitively',
  );
  assert.deepEqual(
    sortEntries(all, 'username', 'desc').map(({ entry }) => entry),
    [bob, alice],
  );
});

test('sortEntries orders by LastModificationTime, and does not mutate the input array', () => {
  const root = createGroup('Root');
  const older = createEntry({ title: 'Older' });
  const newer = createEntry({ title: 'Newer' });
  appendChild(root, older);
  appendChild(root, newer);
  const setModified = (entry: XmlElement, iso: string): void => {
    const times = getChild(entry, 'Times') as XmlElement;
    setText(getChild(times, 'LastModificationTime') as XmlElement, iso);
  };
  setModified(older, '2020-01-01T00:00:00Z');
  setModified(newer, '2024-06-15T00:00:00Z');
  const all = collectAllEntries(root);

  assert.deepEqual(
    sortEntries(all, 'modified', 'asc').map(({ entry }) => entry),
    [older, newer],
  );
  assert.deepEqual(
    sortEntries(all, 'modified', 'desc').map(({ entry }) => entry),
    [newer, older],
  );
  assert.deepEqual(
    all.map(({ entry }) => entry),
    [older, newer],
    'the input array is untouched',
  );
});

test('entryColumnValue reads username/password/url/notes verbatim', () => {
  const entry = createEntry({
    title: 'GitHub',
    username: 'octocat',
    password: 'hunter2',
    url: 'https://github.com',
    notes: 'work account',
  });
  assert.equal(entryColumnValue(entry, 'username'), 'octocat');
  assert.equal(entryColumnValue(entry, 'password'), 'hunter2');
  assert.equal(entryColumnValue(entry, 'url'), 'https://github.com');
  assert.equal(entryColumnValue(entry, 'notes'), 'work account');
});

test('entryColumnValue reports the attachment count as text, or "" when there are none', () => {
  const entry = createEntry({ title: 'No attachments' });
  assert.equal(entryColumnValue(entry, 'attachments'), '');
  addEntryAttachment(entry, 'id.png', 0);
  assert.equal(entryColumnValue(entry, 'attachments'), '1');
  addEntryAttachment(entry, 'passport.pdf', 1);
  assert.equal(entryColumnValue(entry, 'attachments'), '2');
});

test('entryColumnValue reads modified/created straight from entry times', () => {
  const entry = createEntry({ title: 'Timed' });
  const times = getEntryTimes(entry);
  assert.equal(entryColumnValue(entry, 'modified'), times.modified);
  assert.equal(entryColumnValue(entry, 'created'), times.created);
});

test('toCsv writes a header row, quotes fields only when needed, and joins tags with ";"', () => {
  const root = createGroup('Personal');
  const plain = createEntry({ title: 'GitHub', username: 'octocat', password: 'hunter2' });
  appendChild(plain, createElement('Tags', 'Work;Urgent'));
  const quoted = createEntry({ title: 'Say "hi", bye', notes: 'Line one\nLine two' });
  appendChild(root, plain);
  appendChild(root, quoted);

  const csv = toCsv(root);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Group,Title,UserName,Password,URL,Notes,Tags');
  assert.equal(lines[1], 'Personal,GitHub,octocat,hunter2,,,Work;Urgent');
  assert.equal(lines[2], 'Personal,"Say ""hi"", bye",,,,"Line one\nLine two",');
  assert.equal(lines.length, 3);
});

test('toCsv writes just the header row for a database with no entries', () => {
  assert.equal(toCsv(createGroup('Root')), 'Group,Title,UserName,Password,URL,Notes,Tags');
});

test('toCsv writes every value exactly as stored, so another client imports it unchanged (#137)', () => {
  const root = createGroup('Personal');
  appendChild(
    root,
    createEntry({
      title: '=1+1',
      username: '+15555550100',
      password: '-x7@k',
      url: '@example.com',
    }),
  );
  appendChild(root, createEntry({ password: '=SUM(A1,"x")' }));

  const lines = toCsv(root).split('\r\n');
  assert.equal(lines[1], 'Personal,=1+1,+15555550100,-x7@k,@example.com,,');
  // Only RFC 4180 quoting, and an empty title stays empty.
  assert.equal(lines[2], 'Personal,,,"=SUM(A1,""x"")",,,');
});

test('toCsv names each group by its path from the root, as KeePassXC does (#137)', () => {
  const root = createGroup('Root');
  const banking = createGroup('Banking');
  const cards = createGroup('Cards');
  appendChild(root, createEntry({ title: 'Top' }));
  appendChild(root, banking);
  appendChild(banking, createEntry({ title: 'Checking' }));
  appendChild(banking, cards);
  appendChild(cards, createEntry({ title: 'Visa' }));

  const groups = toCsv(root)
    .split('\r\n')
    .slice(1)
    .map((line) => line.split(',').slice(0, 2).join(','));
  assert.deepEqual(groups, ['Root,Top', 'Root/Banking,Checking', 'Root/Banking/Cards,Visa']);
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

test('unlockAttempts tries a key file alone before an empty password with it, and nothing else twice (#127)', () => {
  const keyFile = new Uint8Array([1, 2, 3]);
  assert.deepEqual(unlockAttempts('secret', null), [{ password: 'secret' }]);
  assert.deepEqual(unlockAttempts('', null), [{ password: '' }]);
  assert.deepEqual(unlockAttempts('secret', keyFile), [{ password: 'secret', keyFile }]);
  assert.deepEqual(unlockAttempts('', keyFile), [{ keyFile }, { password: '', keyFile }]);
});

test('duplicateName finds a name given twice, and nothing when all differ (#125, #120)', () => {
  assert.equal(duplicateName(['Title', 'Password', 'PIN']), null);
  // A custom field named after a standard one clashes with it.
  assert.equal(duplicateName(['Title', 'Password', 'Password']), 'Password');
  assert.equal(duplicateName(['PIN', 'Title', 'PIN']), 'PIN');
  assert.equal(duplicateName(['scan.pdf', 'photo.jpg', 'scan.pdf']), 'scan.pdf');
  // Names are compared exactly, as KeePass and KeePassXC compare them.
  assert.equal(duplicateName(['Password', 'password']), null);
  assert.equal(duplicateName(['scan.pdf', 'Scan.pdf']), null);
  // Blank-named field rows are dropped on save, so two of them clash with nothing.
  assert.equal(duplicateName(['', 'Title', '']), null);
});

test('isCustomField is false for the five standard fields and true otherwise', () => {
  for (const key of ['Title', 'UserName', 'Password', 'URL', 'Notes']) {
    assert.equal(isCustomField(key), false);
  }
  assert.equal(isCustomField('API Key'), true);
});

test('openableUrl opens only web addresses, reading a bare host as https', () => {
  assert.equal(openableUrl('https://github.com'), 'https://github.com/');
  assert.equal(openableUrl('  http://example.com/login  '), 'http://example.com/login');
  assert.equal(openableUrl('github.com/login'), 'https://github.com/login');

  // Anything else a database might hold would run in, or leave, this app.
  assert.equal(openableUrl('javascript:alert(1)'), null);
  assert.equal(openableUrl('data:text/html,<p>hi</p>'), null);
  assert.equal(openableUrl('cmd://notepad.exe'), null);
  assert.equal(openableUrl('file:///etc/passwd'), null);

  assert.equal(openableUrl(''), null);
  assert.equal(openableUrl('   '), null);
  assert.equal(openableUrl('http://'), null, 'not an address at all');
});

test('isValidClipboardTimeout requires a real number of at least 5 seconds', () => {
  assert.equal(isValidClipboardTimeout(5), true);
  assert.equal(isValidClipboardTimeout(30), true);
  assert.equal(isValidClipboardTimeout(4), false);
  assert.equal(isValidClipboardTimeout(Number.NaN), false);
});

test('isValidCurtainTimeout requires a real number from 15 seconds to an hour', () => {
  assert.equal(isValidCurtainTimeout(15), true);
  assert.equal(isValidCurtainTimeout(3600), true);
  assert.equal(isValidCurtainTimeout(14), false);
  assert.equal(isValidCurtainTimeout(3601), false);
  assert.equal(isValidCurtainTimeout(Number.NaN), false);
});

// The lock has to come, since unlocking is when a version saved elsewhere is checked for (#74).
test('isValidAutoLockTimeout requires a real number from 30 seconds to an hour', () => {
  assert.equal(isValidAutoLockTimeout(30), true);
  assert.equal(isValidAutoLockTimeout(3600), true);
  assert.equal(isValidAutoLockTimeout(29), false);
  assert.equal(isValidAutoLockTimeout(3601), false);
  assert.equal(isValidAutoLockTimeout(Number.NaN), false);
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

/* KeePass's PwIcon enum (KeePassLib/PwEnums.cs), whose position is the IconID
every KeePass app writes, beside the symbol drawn for it (#121). The enum names
the meaning, which is what a choice made here has to carry into other apps,
whatever picture each app draws for it. */
const KEEPASS_ICONS: ReadonlyArray<[string, string]> = [
  ['Key', 'key'],
  ['World', 'web'],
  ['Warning', 'warning'],
  ['NetworkServer', 'server'],
  ['MarkedDirectory', 'folder-marked'],
  ['UserCommunication', 'conversation'],
  ['Parts', 'parts'],
  ['Notepad', 'notepad'],
  ['WorldSocket', 'network'],
  ['Identity', 'identity'],
  ['PaperReady', 'document-ready'],
  ['Digicam', 'camera'],
  ['IRCommunication', 'wireless'],
  ['MultiKeys', 'keys'],
  ['Energy', 'energy'],
  ['Scanner', 'scanner'],
  ['WorldStar', 'favorite-site'],
  ['CDRom', 'disc'],
  ['Monitor', 'monitor'],
  ['EMail', 'email'],
  ['Configuration', 'configuration'],
  ['ClipboardReady', 'clipboard'],
  ['PaperNew', 'document-new'],
  ['Screen', 'window'],
  ['EnergyCareful', 'high-voltage'],
  ['EMailBox', 'inbox'],
  ['Disk', 'save'],
  ['Drive', 'drive'],
  ['PaperQ', 'document-question'],
  ['TerminalEncrypted', 'terminal-encrypted'],
  ['Console', 'console'],
  ['Printer', 'printer'],
  ['ProgramIcons', 'programs'],
  ['Run', 'run'],
  ['Settings', 'settings'],
  ['WorldComputer', 'web-computer'],
  ['Archive', 'archive'],
  ['Homebanking', 'bank'],
  ['DriveWindows', 'drive-system'],
  ['Clock', 'clock'],
  ['EMailSearch', 'email-search'],
  ['PaperFlag', 'document-flagged'],
  ['Memory', 'memory'],
  ['TrashBin', 'trash'],
  ['Note', 'note'],
  ['Expired', 'expired'],
  ['Info', 'info'],
  ['Package', 'package'],
  ['Folder', 'folder'],
  ['FolderOpen', 'folder-open'],
  ['FolderPackage', 'folder-package'],
  ['LockOpen', 'lock-open'],
  ['PaperLocked', 'document-locked'],
  ['Checked', 'checked'],
  ['Pen', 'pen'],
  ['Thumbnail', 'picture'],
  ['Book', 'book'],
  ['List', 'list'],
  ['UserKey', 'user-key'],
  ['Tool', 'tool'],
  ['Home', 'home'],
  ['Star', 'star'],
  ['Tux', 'linux'],
  ['Feather', 'feather'],
  ['Apple', 'apple'],
  ['Wiki', 'wiki'],
  ['Money', 'money'],
  ['Certificate', 'certificate'],
  ['BlackBerry', 'phone'],
];

test("iconName draws each of KeePass's standard IconIDs by its KeePass meaning", () => {
  assert.equal(ICON_PALETTE.length, KEEPASS_ICONS.length, 'one choice per KeePass icon');
  for (const [iconId, [pwIcon, symbol]] of KEEPASS_ICONS.entries()) {
    assert.equal(iconName(String(iconId)), symbol, `IconID ${iconId} is KeePass's ${pwIcon}`);
  }
});

test("iconName falls back to a generic icon outside KeePass's standard set", () => {
  assert.equal(iconName('69'), 'unknown');
  assert.equal(iconName('-1'), 'unknown');
  assert.equal(iconName('not a number'), 'unknown');
});

test('isoToLocalInputValue / localInputValueToIso round-trip an ISO-UTC timestamp through datetime-local format', () => {
  const iso = '2030-06-15T12:00:00Z';
  const localValue = isoToLocalInputValue(iso);
  assert.match(localValue, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(localInputValueToIso(localValue), iso);
});

test('defaultExpiryLocalInputValue is about one year from now, in datetime-local format', () => {
  const value = defaultExpiryLocalInputValue();
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  const diffMs = Math.abs(new Date(value).getTime() - oneYearFromNow.getTime());
  assert.ok(diffMs < 60_000, 'should be within a minute of exactly one year from now');
});

test("entryUuid reads an entry's UUID, or '' for an entry without one", () => {
  const entry = createEntry({ title: 'Anything' });
  assert.equal(entryUuid(entry), getText(getChild(entry, 'UUID') as XmlElement));
  entry.children = entry.children.filter((c) => !(c.type === 'element' && c.name === 'UUID'));
  assert.equal(entryUuid(entry), '');
});

// #185: what an edit screen held rides through a lock inside the database and comes back out whole.
test('a locked edit goes into Meta CustomData and comes back out whole, once', () => {
  const document = createDatabaseDocument('Vault');
  const meta = getChild(document, 'Meta') as XmlElement;
  assert.equal(takeLockedEdit(document), null, 'nothing held, and no CustomData to look in');

  const edit: LockedEdit = {
    uuid: 'abc',
    isNew: false,
    modified: '2026-01-02T03:04:05Z',
    form: {
      fields: [
        { key: 'Title', value: 'Bank <&> "quotes"', protect: false },
        { key: 'Password', value: 'line one\nline two', protect: true },
      ],
      iconId: 43,
      tags: 'money, home',
      expires: true,
      expiry: '2030-01-02T03:04',
      attachments: [
        { name: 'statement.pdf', data: new Uint8Array([0, 1, 2, 250, 255]) },
        { name: 'ghost.pdf', ref: 99 }, // a stale Ref travels as it is
      ],
    },
  };
  holdLockedEdit(document, edit);
  const customData = getChild(meta, 'CustomData') as XmlElement;
  assert.equal(getChildren(customData, 'Item').length, 1, 'CustomData made to carry it');
  assert.deepEqual(takeLockedEdit(document), edit);
  assert.equal(getChildren(customData, 'Item').length, 0, 'taken out, not copied');
  assert.equal(takeLockedEdit(document), null, 'and only once');

  // An untouched form carries no values at all.
  const untouched: LockedEdit = { uuid: 'def', isNew: true, modified: '', form: null };
  holdLockedEdit(document, untouched);
  assert.deepEqual(takeLockedEdit(document), untouched);
});

test("a locked edit leaves other apps' CustomData items where they are", () => {
  const document = createDatabaseDocument('Vault');
  const meta = getChild(document, 'Meta') as XmlElement;
  const customData = createElement('CustomData');
  const other = createElement('Item');
  appendChild(other, createElement('Key', 'KPXC_autosaveDelayMin'));
  appendChild(other, createElement('Value', '5'));
  appendChild(customData, other);
  const keyless = createElement('Item'); // no Key at all, as a careless writer might leave
  appendChild(customData, keyless);
  appendChild(meta, customData);
  assert.equal(takeLockedEdit(document), null, 'none of these is a locked edit');

  holdLockedEdit(document, { uuid: 'abc', isNew: false, modified: '', form: null });
  assert.equal(getChildren(customData, 'Item').length, 3, 'added beside them');
  assert.deepEqual(takeLockedEdit(document), {
    uuid: 'abc',
    isNew: false,
    modified: '',
    form: null,
  });
  const [first, second, ...rest] = getChildren(customData, 'Item');
  assert.ok(first === other && second === keyless && rest.length === 0, 'the others untouched');
});

test('taking a locked edit removes every copy, and a damaged one reads back as none', () => {
  const document = createDatabaseDocument('Vault');
  holdLockedEdit(document, { uuid: 'first', isNew: false, modified: '', form: null });
  holdLockedEdit(document, { uuid: 'second', isNew: false, modified: '', form: null });
  const meta = getChild(document, 'Meta') as XmlElement;
  const customData = getChild(meta, 'CustomData') as XmlElement;
  assert.deepEqual(takeLockedEdit(document), {
    uuid: 'first',
    isNew: false,
    modified: '',
    form: null,
  });
  assert.equal(getChildren(customData, 'Item').length, 0, 'the second went with it');

  const damaged = createElement('Item');
  appendChild(damaged, createElement('Key', 'KeePassWeb_LockedEdit'));
  appendChild(damaged, createElement('Value', '{"form": {"attachments": 7}}'));
  appendChild(customData, damaged);
  assert.equal(takeLockedEdit(document), null, 'unreadable, so nothing comes back');
  assert.equal(getChildren(customData, 'Item').length, 0, 'and it is gone all the same');
});

test('a database with no Meta has nowhere to carry a locked edit, and holds none', () => {
  const document = createElement('KeePassFile');
  holdLockedEdit(document, { uuid: 'abc', isNew: false, modified: '', form: null });
  assert.deepEqual(document.children, []);
  assert.equal(takeLockedEdit(document), null);
});

// ============================================================
// One-time codes (#138)
// ============================================================

// RFC 6238 Appendix B's secrets (ASCII, one per hash) and times, in Unix seconds.
const RFC_SHA1 = '12345678901234567890';
const RFC_SHA256 = '12345678901234567890123456789012';
const RFC_SHA512 = '1234567890123456789012345678901234567890123456789012345678901234';
const RFC_TIMES = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
// KeePassXC's own example secret (Base32 of RFC_SHA1) and its Steam test secret.
const RFC_SHA1_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const STEAM_SECRET = '63BEDWCQZKTQWPESARIERL5DTTQFCJTK';

/** A test's own Base32 encoder (RFC 4648, unpadded), independent of the one under test. */
function toBase32(text: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of new TextEncoder().encode(text)) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += alphabet.charAt(Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2));
  }
  return out;
}

const fields =
  (values: Record<string, string>): FieldReader =>
  (key) =>
    values[key] ?? '';

/** The code these fields give at a Unix time in seconds, or null when they can't be read. */
async function codeAt(values: Record<string, string>, seconds: number): Promise<string | null> {
  const totp = await readTotp(fields(values));
  return totp && totpCode(totp, totpStep(totp, seconds * 1000));
}

const link = (query: string): string => `otpauth://totp/ACME%20Co:john@example.com?${query}`;

test("TOTP codes match RFC 6238's own test vectors, for each of its three hashes (#138)", async () => {
  const vectors: Array<[string, string, string[]]> = [
    [
      'HMAC-SHA-1',
      RFC_SHA1,
      ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
    ],
    [
      'HMAC-SHA-256',
      RFC_SHA256,
      ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
    ],
    [
      'HMAC-SHA-512',
      RFC_SHA512,
      ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826'],
    ],
  ];
  for (const [algorithm, secret, expected] of vectors) {
    const values = {
      'TimeOtp-Secret': secret,
      'TimeOtp-Algorithm': algorithm,
      'TimeOtp-Length': '8',
    };
    const codes = await Promise.all(RFC_TIMES.map((seconds) => codeAt(values, seconds)));
    assert.deepEqual(codes, expected, algorithm);
  }
});

test("a KeePassXC otp link gives the codes KeePassXC's own tests expect (#138)", async () => {
  assert.equal(toBase32(RFC_SHA1), RFC_SHA1_BASE32, 'the test encoder agrees with KeePassXC');
  const otp = link(`secret=${RFC_SHA1_BASE32}&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30`);
  assert.equal(await codeAt({ otp }, 1234567890), '005924');
  assert.equal(await codeAt({ otp }, 1111111109), '081804');
  const eight = link(`secret=${RFC_SHA1_BASE32}&digits=8`);
  assert.equal(await codeAt({ otp: eight }, 1111111111), '14050471');
  assert.equal(await codeAt({ otp: eight }, 2000000000), '69279037');

  // Only the secret is needed: six digits, every 30 seconds, by SHA-1.
  assert.equal(await codeAt({ otp: link(`secret=${RFC_SHA1_BASE32}`) }, 1234567890), '005924');
  // The rest are read as given, the hash in either case, and so is the link's scheme.
  assert.equal(
    await codeAt({ otp: link(`secret=${RFC_SHA1_BASE32}&period=60`) }, 1234567890),
    '713351',
  );
  assert.equal(
    await codeAt(
      { otp: link(`secret=${toBase32(RFC_SHA256)}&algorithm=sha256&digits=8`) },
      1234567890,
    ),
    '91819424',
  );
  assert.equal(
    await codeAt(
      { otp: link(`secret=${toBase32(RFC_SHA512)}&algorithm=SHA512&digits=8`) },
      20000000000,
    ),
    '47863826',
  );
  assert.equal(
    await codeAt({ otp: `OTPAUTH://TOTP/x?secret=${RFC_SHA1_BASE32}` }, 1234567890),
    '005924',
  );
  assert.equal(
    await codeAt({ otp: `otpauth://totp?secret=${RFC_SHA1_BASE32}` }, 1234567890),
    '005924',
  );
});

test("a Steam link gives Steam's five-character codes, as KeePassXC's tests expect (#138)", async () => {
  const otp = `otpauth://totp/test:test@example.com?secret=${STEAM_SECRET}&issuer=Valve&algorithm=SHA1&digits=5&period=30&encoder=steam`;
  assert.equal(await codeAt({ otp }, 1511200518), 'FR8RV');
  assert.equal(await codeAt({ otp }, 1511200714), '9P3VP');
  // Five characters whatever digits the link names.
  const six = `otpauth://totp/Steam?secret=${STEAM_SECRET}&digits=6&encoder=steam`;
  assert.equal(await codeAt({ otp: six }, 1511200518), 'FR8RV');
});

test("each of KeePass's secret encodings gives the same code, spacing, case and padding aside (#138)", async () => {
  const expected = '005924'; // RFC_SHA1 at 1234567890, by KeePass's defaults
  const secrets: Record<string, string[]> = {
    'TimeOtp-Secret': [RFC_SHA1],
    'TimeOtp-Secret-Hex': [
      '3132333435363738393031323334353637383930',
      '31 32 33 34 35 36 37 38 39 30 31 32 33 34 35 36 37 38 39 30',
      '3132333435363738393031323334353637383930'.toUpperCase(),
    ],
    'TimeOtp-Secret-Base32': [
      RFC_SHA1_BASE32,
      'gezd gnbv gy3t qojq gezd gnbv gy3t qojq',
      `${RFC_SHA1_BASE32}====`,
    ],
    'TimeOtp-Secret-Base64': ['MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=', 'MTIzNDU2Nzg5 MDEyMzQ1Njc4OTA='],
  };
  for (const [key, values] of Object.entries(secrets)) {
    for (const value of values) {
      assert.equal(await codeAt({ [key]: value }, 1234567890), expected, `${key}: ${value}`);
    }
  }
  // Length, period and hash are read as KeePass names them, the hash in either case.
  assert.equal(
    await codeAt(
      {
        'TimeOtp-Secret': RFC_SHA256,
        'TimeOtp-Algorithm': 'hmac-sha-256',
        'TimeOtp-Length': '8',
        'TimeOtp-Period': '30',
      },
      1234567890,
    ),
    '91819424',
  );
  assert.equal(
    await codeAt({ 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Period': '60' }, 1234567890),
    '713351',
  );
});

test("the otp link is read first, as KeePassXC reads it, and anything else in otp isn't TOTP (#138)", async () => {
  const other = 'JBSWY3DPEHPK3PXP';
  // The link's secret, not the TimeOtp one beside it.
  assert.equal(
    await codeAt({ otp: link(`secret=${other}`), 'TimeOtp-Secret': RFC_SHA1 }, 1234567890),
    '742275',
  );
  // A counter-based link, or KeeOTP's settings, are not TOTP links, so TimeOtp fields still count.
  for (const otp of [`otpauth://hotp/x?secret=${other}&counter=0`, `key=${other}&step=30&size=6`]) {
    assert.equal(hasTotp(fields({ otp })), false, otp);
    assert.equal(await readTotp(fields({ otp })), null, otp);
    assert.equal(await codeAt({ otp, 'TimeOtp-Secret': RFC_SHA1 }, 1234567890), '005924', otp);
  }
  assert.equal(hasTotp(fields({})), false);
  assert.equal(await readTotp(fields({})), null);
  assert.equal(hasTotp(fields({ 'TimeOtp-Length': '8', 'TimeOtp-Period': '60' })), false);
  for (const key of [
    'TimeOtp-Secret',
    'TimeOtp-Secret-Hex',
    'TimeOtp-Secret-Base32',
    'TimeOtp-Secret-Base64',
  ]) {
    assert.equal(hasTotp(fields({ [key]: 'x' })), true, key);
  }
  // Settings it carries, readable or not.
  assert.equal(hasTotp(fields({ otp: link('secret=1') })), true);
});

test("settings that can't be read give no code, rather than a guess at one (#138)", async () => {
  const otpLinks = [
    link(''), // no secret
    link('secret='),
    link('secret=A'), // fewer bits than a byte
    link('secret=GEZDGNBV1Y3TQOJQ'), // 1 is no Base32 character
    link(`secret=${RFC_SHA1_BASE32}&algorithm=MD5`),
    link(`secret=${RFC_SHA1_BASE32}&algorithm=SHA-256`),
    link(`secret=${RFC_SHA1_BASE32}&digits=0`),
    link(`secret=${RFC_SHA1_BASE32}&digits=11`),
    link(`secret=${RFC_SHA1_BASE32}&digits=6x`),
    link(`secret=${RFC_SHA1_BASE32}&period=0`),
    link(`secret=${RFC_SHA1_BASE32}&period=-30`),
    link(`secret=${RFC_SHA1_BASE32}&period=thirty`),
  ];
  for (const otp of otpLinks) assert.equal(await readTotp(fields({ otp })), null, otp);

  const timeOtp: Array<Record<string, string>> = [
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Secret-Base32': RFC_SHA1_BASE32 }, // KeePass wants one
    { 'TimeOtp-Secret-Hex': 'abc' },
    { 'TimeOtp-Secret-Hex': 'zz' },
    { 'TimeOtp-Secret-Base32': '8888' },
    { 'TimeOtp-Secret-Base64': '!!!!' },
    { 'TimeOtp-Secret-Base64': 'A' },
    { 'TimeOtp-Secret-Base64': 'MT=IzNDU2' },
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Algorithm': 'SHA-256' },
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Length': '0' },
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Length': '11' },
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Length': 'six' },
    { 'TimeOtp-Secret': RFC_SHA1, 'TimeOtp-Period': '0' },
  ];
  for (const values of timeOtp) {
    assert.equal(await readTotp(fields(values)), null, JSON.stringify(values));
  }
});

test('a link the URL parser refuses gives no code, rather than an error (#138)', async () => {
  // Spaces left unescaped in the label, as some exporters write them, still parse.
  const spaced = `otpauth://totp/ACME Co:john@example.com?secret=${RFC_SHA1_BASE32}`;
  assert.equal(await codeAt({ otp: spaced }, 1234567890), '005924');
  // No link the otpauth pattern accepts is known to make URL throw, so a stand-in refuses it.
  const RealURL = globalThis.URL;
  globalThis.URL = class {
    constructor() {
      throw new TypeError('Invalid URL');
    }
  } as unknown as typeof URL;
  try {
    assert.equal(await readTotp(fields({ otp: spaced })), null);
  } finally {
    globalThis.URL = RealURL;
  }
});

test('a time step lasts its period, counted in whole Unix seconds (#138)', async () => {
  const totp = await readTotp(fields({ 'TimeOtp-Secret': RFC_SHA1 }));
  assert.ok(totp);
  const step = 1234567890 / 30;
  assert.equal(totpStep(totp, 1234567890_000), step);
  assert.equal(totpSecondsLeft(totp, 1234567890_000), 30);
  assert.equal(totpStep(totp, 1234567919_999), step);
  assert.equal(totpSecondsLeft(totp, 1234567919_999), 1);
  assert.equal(totpStep(totp, 1234567920_000), step + 1);
  assert.equal(totpSecondsLeft(totp, 1234567920_000), 30);
});

test('totpSettings changes with each field TOTP reads, and with nothing else (#138)', () => {
  const base = {
    otp: 'a',
    'TimeOtp-Secret': 'b',
    'TimeOtp-Secret-Hex': 'c',
    'TimeOtp-Secret-Base32': 'd',
    'TimeOtp-Secret-Base64': 'e',
    'TimeOtp-Length': 'f',
    'TimeOtp-Period': 'g',
    'TimeOtp-Algorithm': 'h',
  };
  const seen = totpSettings(fields(base));
  for (const key of Object.keys(base)) {
    assert.notEqual(totpSettings(fields({ ...base, [key]: 'changed' })), seen, key);
  }
  assert.equal(totpSettings(fields({ ...base, Notes: 'changed' })), seen);
  // A line break can't make two different sets of values read the same.
  assert.notEqual(
    totpSettings(fields({ otp: 'a\n', 'TimeOtp-Secret': 'b' })),
    totpSettings(fields({ otp: 'a', 'TimeOtp-Secret': '\nb' })),
  );
});

test('the decoded secret and each HMAC are zeroed once used, whether the key is made or not (#138)', async (t) => {
  const subtle = crypto.subtle as unknown as {
    importKey(...args: unknown[]): Promise<CryptoKey>;
    sign(...args: unknown[]): Promise<ArrayBuffer>;
  };
  const realImport = subtle.importKey.bind(crypto.subtle);
  const realSign = subtle.sign.bind(crypto.subtle);
  const imported: Uint8Array[] = [];
  const signed: ArrayBuffer[] = [];
  let refuse = false;
  t.mock.method(subtle, 'importKey', (...args: unknown[]) => {
    imported.push(args[1] as Uint8Array);
    return refuse ? Promise.reject(new Error('simulated refusal')) : realImport(...args);
  });
  t.mock.method(subtle, 'sign', async (...args: unknown[]) => {
    const mac = await realSign(...args);
    signed.push(mac);
    return mac;
  });
  const zeroed = (bytes: ArrayBufferLike | Uint8Array): boolean =>
    new Uint8Array(bytes instanceof Uint8Array ? bytes.buffer : bytes).every((byte) => byte === 0);

  const values: Array<Record<string, string>> = [
    { otp: link(`secret=${RFC_SHA1_BASE32}`) },
    { 'TimeOtp-Secret': RFC_SHA1 },
    { 'TimeOtp-Secret-Hex': '3132333435363738393031323334353637383930' },
    { 'TimeOtp-Secret-Base32': RFC_SHA1_BASE32 },
    { 'TimeOtp-Secret-Base64': 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=' },
  ];
  for (const value of values) {
    assert.equal(await codeAt(value, 1234567890), '005924', 'the key still works');
  }
  assert.equal(imported.length, values.length);
  assert.ok(imported.every((bytes) => bytes.length === 20 && zeroed(bytes)));
  assert.equal(signed.length, values.length);
  assert.ok(signed.every((mac) => mac.byteLength === 20 && zeroed(mac)));

  refuse = true;
  await assert.rejects(readTotp(fields({ 'TimeOtp-Secret': RFC_SHA1 })), /simulated refusal/);
  assert.ok(zeroed(imported[imported.length - 1] as Uint8Array), 'zeroed when refused too');
});

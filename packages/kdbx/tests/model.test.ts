import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChild,
  createDatabaseDocument,
  createElement,
  createEntry,
  createGroup,
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getEntryTags,
  getText,
  isInRecycleBin,
  ProtectedValue,
  setAttribute,
  setEntryTags,
  type XmlElement,
} from '../src/index.ts';

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

test('findOrCreateRecycleBin creates the bin once, under the root group, and reuses it after', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  assert.equal(getChild(meta, 'RecycleBinUUID'), undefined);

  const bin = findOrCreateRecycleBin(document);
  assert.equal(getText(getChild(bin, 'Name') as XmlElement), 'Recycle Bin');
  const uuidEl = getChild(meta, 'RecycleBinUUID') as XmlElement;
  assert.equal(getText(uuidEl), getText(getChild(bin, 'UUID') as XmlElement));

  const rootGroup = getChild(getChild(document, 'Root') as XmlElement, 'Group') as XmlElement;
  assert.ok(getChildren(rootGroup, 'Group').includes(bin));

  // Second call returns the same group rather than creating another.
  const again = findOrCreateRecycleBin(document);
  assert.equal(again, bin);
  assert.equal(getChildren(rootGroup, 'Group').length, 1);
});

test('findOrCreateRecycleBin replaces a stale RecycleBinUUID that no longer matches any group', () => {
  const document = createDatabaseDocument('MyDb');
  const meta = getChild(document, 'Meta') as XmlElement;
  appendChild(meta, createElement('RecycleBinUUID', 'not-a-real-group-uuid'));

  const bin = findOrCreateRecycleBin(document);
  const uuidEl = getChild(meta, 'RecycleBinUUID') as XmlElement;
  assert.equal(getText(uuidEl), getText(getChild(bin, 'UUID') as XmlElement));
  assert.equal(
    getChild(meta, 'RecycleBinUUID'),
    uuidEl,
    'the existing element is reused, not duplicated',
  );
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBase64 } from '../src/bytes.ts';
import { gzip } from '../src/crypto.ts';
import {
  readMetaBinaries,
  remapEntryBinaryRefs,
  removeMetaBinariesElement,
  writeMetaBinaries,
} from '../src/meta-binaries.ts';
import {
  appendChild,
  createElement,
  createGroup,
  getAttribute,
  getChild,
  getChildren,
  getText,
  setAttribute,
} from '../src/model.ts';
import type { XmlElement } from '../src/xml.ts';

function documentWith(meta: XmlElement | undefined, rootGroup: XmlElement | undefined): XmlElement {
  const doc = createElement('KeePassFile');
  if (meta) appendChild(doc, meta);
  if (rootGroup) {
    const rootEl = createElement('Root');
    appendChild(rootEl, rootGroup);
    appendChild(doc, rootEl);
  }
  return doc;
}

function binaryRef(id: string): XmlElement {
  const binaryEl = createElement('Binary');
  appendChild(binaryEl, createElement('Key', 'file.txt'));
  const valueEl = createElement('Value');
  setAttribute(valueEl, 'Ref', id);
  appendChild(binaryEl, valueEl);
  return binaryEl;
}

// --- readMetaBinaries --------------------------------------------------------

test('readMetaBinaries: no Meta/Binaries element yields an empty pool', async () => {
  const doc = documentWith(createElement('Meta'), undefined);
  const { binaries, idToIndex } = await readMetaBinaries(doc);
  assert.deepEqual(binaries, []);
  assert.equal(idToIndex.size, 0);
});

test('readMetaBinaries: decodes plain Base64 content, keyed by ID', async () => {
  const meta = createElement('Meta');
  const binariesEl = createElement('Binaries');
  const binaryEl = createElement('Binary', toBase64(new Uint8Array([1, 2, 3])));
  setAttribute(binaryEl, 'ID', '0');
  appendChild(binariesEl, binaryEl);
  appendChild(meta, binariesEl);

  const { binaries, idToIndex } = await readMetaBinaries(documentWith(meta, undefined));
  assert.equal(binaries.length, 1);
  assert.deepEqual(binaries[0], { flags: 0, data: new Uint8Array([1, 2, 3]) });
  assert.equal(idToIndex.get(0), 0);
});

test('readMetaBinaries: gunzips content marked Compressed="True"', async () => {
  const raw = new Uint8Array(2000).map((_, i) => i & 0xff);
  const compressed = await gzip(raw);

  const meta = createElement('Meta');
  const binariesEl = createElement('Binaries');
  const binaryEl = createElement('Binary', toBase64(compressed));
  setAttribute(binaryEl, 'ID', '7');
  setAttribute(binaryEl, 'Compressed', 'True');
  appendChild(binariesEl, binaryEl);
  appendChild(meta, binariesEl);

  const { binaries, idToIndex } = await readMetaBinaries(documentWith(meta, undefined));
  assert.deepEqual(binaries[0]?.data, raw);
  assert.equal(idToIndex.get(7), 0);
});

test('readMetaBinaries: a Binary with no ID attribute is skipped', async () => {
  const meta = createElement('Meta');
  const binariesEl = createElement('Binaries');
  appendChild(binariesEl, createElement('Binary', toBase64(new Uint8Array([9]))));
  appendChild(meta, binariesEl);

  const { binaries, idToIndex } = await readMetaBinaries(documentWith(meta, undefined));
  assert.deepEqual(binaries, []);
  assert.equal(idToIndex.size, 0);
});

// --- removeMetaBinariesElement -----------------------------------------------

test('removeMetaBinariesElement: no-op when there is no Meta at all', () => {
  const doc = documentWith(undefined, undefined);
  removeMetaBinariesElement(doc); // must not throw
  assert.equal(getChild(doc, 'Meta'), undefined);
});

test('removeMetaBinariesElement: strips Binaries but leaves other Meta children', () => {
  const meta = createElement('Meta');
  appendChild(meta, createElement('Generator', 'test'));
  appendChild(meta, createElement('Binaries'));
  const doc = documentWith(meta, undefined);

  removeMetaBinariesElement(doc);
  assert.equal(getChild(meta, 'Binaries'), undefined);
  assert.equal(getText(getChild(meta, 'Generator') as XmlElement), 'test');
});

// --- remapEntryBinaryRefs -----------------------------------------------------

test('remapEntryBinaryRefs: no-op when there is no Root/Group', () => {
  const doc = documentWith(createElement('Meta'), undefined);
  remapEntryBinaryRefs(doc, new Map([[0, 5]])); // must not throw
});

test('remapEntryBinaryRefs: rewrites a matching Ref, including inside History', () => {
  const rootGroup = createGroup('Root');
  const entry = createElement('Entry');
  appendChild(entry, binaryRef('3'));
  const historyEl = createElement('History');
  const historyEntry = createElement('Entry');
  appendChild(historyEntry, binaryRef('3'));
  appendChild(historyEl, historyEntry);
  appendChild(entry, historyEl);
  appendChild(rootGroup, entry);

  const doc = documentWith(createElement('Meta'), rootGroup);
  remapEntryBinaryRefs(doc, new Map([[3, 0]]));

  const liveValue = getChild(getChildren(entry, 'Binary')[0] as XmlElement, 'Value') as XmlElement;
  assert.equal(getAttribute(liveValue, 'Ref'), '0');
  const historyValue = getChild(
    getChildren(historyEntry, 'Binary')[0] as XmlElement,
    'Value',
  ) as XmlElement;
  assert.equal(getAttribute(historyValue, 'Ref'), '0');
});

test('remapEntryBinaryRefs: a stale Ref with no matching ID is left untouched', () => {
  const rootGroup = createGroup('Root');
  const entry = createElement('Entry');
  appendChild(entry, binaryRef('99'));
  appendChild(rootGroup, entry);

  const doc = documentWith(createElement('Meta'), rootGroup);
  remapEntryBinaryRefs(doc, new Map([[3, 0]]));

  const valueEl = getChild(getChildren(entry, 'Binary')[0] as XmlElement, 'Value') as XmlElement;
  assert.equal(getAttribute(valueEl, 'Ref'), '99');
});

test('remapEntryBinaryRefs: a Binary child missing Value/Ref is skipped', () => {
  const rootGroup = createGroup('Root');
  const entry = createElement('Entry');
  const binaryEl = createElement('Binary');
  appendChild(binaryEl, createElement('Key', 'no-value'));
  appendChild(entry, binaryEl);
  appendChild(rootGroup, entry);

  const doc = documentWith(createElement('Meta'), rootGroup);
  remapEntryBinaryRefs(doc, new Map([[0, 1]])); // must not throw
  assert.equal(getChild(binaryEl, 'Value'), undefined);
});

// --- writeMetaBinaries ---------------------------------------------------------

test('writeMetaBinaries: an empty pool removes any existing Binaries element', () => {
  const meta = createElement('Meta');
  appendChild(meta, createElement('Binaries'));
  const doc = documentWith(meta, undefined);

  writeMetaBinaries(doc, []);
  assert.equal(getChild(meta, 'Binaries'), undefined);
});

test('writeMetaBinaries: throws when the database has no Meta at all', () => {
  const doc = documentWith(undefined, undefined);
  assert.throws(() => writeMetaBinaries(doc, [{ flags: 0, data: new Uint8Array([1]) }]), /Meta/);
});

test('writeMetaBinaries: writes uncompressed Base64 keyed by array index', () => {
  const doc = documentWith(createElement('Meta'), undefined);
  writeMetaBinaries(doc, [
    { flags: 0, data: new Uint8Array([1, 2, 3]) },
    { flags: 1, data: new Uint8Array([4, 5]) },
  ]);

  const binariesEl = getChild(getChild(doc, 'Meta') as XmlElement, 'Binaries') as XmlElement;
  const written = getChildren(binariesEl, 'Binary');
  assert.equal(written.length, 2);
  assert.equal(getAttribute(written[0] as XmlElement, 'ID'), '0');
  assert.equal(getAttribute(written[0] as XmlElement, 'Compressed'), undefined);
  assert.equal(getText(written[0] as XmlElement), toBase64(new Uint8Array([1, 2, 3])));
  assert.equal(getAttribute(written[1] as XmlElement, 'ID'), '1');
  assert.equal(getText(written[1] as XmlElement), toBase64(new Uint8Array([4, 5])));
});

test('writeMetaBinaries then readMetaBinaries round-trips', async () => {
  const doc = documentWith(createElement('Meta'), undefined);
  const binaries = [
    { flags: 0, data: new Uint8Array([10, 20, 30]) },
    { flags: 0, data: new Uint8Array(0) },
  ];
  writeMetaBinaries(doc, binaries);

  const { binaries: reread } = await readMetaBinaries(doc);
  assert.deepEqual(reread, binaries);
});

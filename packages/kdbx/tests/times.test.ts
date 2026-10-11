import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getChild, getText } from '../src/model.ts';
import { binaryTimesToIso, isoTimesToBinary } from '../src/times.ts';
import { parseXml, type XmlElement } from '../src/xml.ts';

/* Base64 and ISO forms of the same instants; the last two are DatabaseNameChanged
values in the V4-AES-AES and KeePassXC Argon2 fixtures (#95). */
const KNOWN: Array<[string, string]> = [
  ['AAAAAAAAAAA=', '0001-01-01T00:00:00Z'],
  ['APeRdw4AAAA=', '1970-01-01T00:00:00Z'],
  ['mNL70Q4AAAA=', '2018-01-25T13:28:56Z'],
  ['55uB1A4AAAA=', '2019-05-30T09:39:51Z'],
];

// A DateTime at each depth the schema allows, plus a non-time element holding Base64 (#95).
function documentWith(time: string): XmlElement {
  return parseXml(`<KeePassFile>
  <Meta><DatabaseNameChanged>${time}</DatabaseNameChanged></Meta>
  <Root>
    <Group>
      <UUID>AAAAAAAAAAA=</UUID>
      <Times><CreationTime>${time}</CreationTime></Times>
      <Entry><History><Entry><Times><LastModificationTime>${time}</LastModificationTime></Times></Entry></History></Entry>
    </Group>
    <DeletedObjects><DeletedObject><DeletionTime>${time}</DeletionTime></DeletedObject></DeletedObjects>
  </Root>
</KeePassFile>`);
}

function textAt(root: XmlElement, ...path: string[]): string {
  let element = root;
  for (const name of path) element = getChild(element, name) as XmlElement;
  return getText(element);
}

function timesIn(root: XmlElement): string[] {
  return [
    textAt(root, 'Meta', 'DatabaseNameChanged'),
    textAt(root, 'Root', 'Group', 'Times', 'CreationTime'),
    textAt(root, 'Root', 'Group', 'Entry', 'History', 'Entry', 'Times', 'LastModificationTime'),
    textAt(root, 'Root', 'DeletedObjects', 'DeletedObject', 'DeletionTime'),
  ];
}

for (const [binary, iso] of KNOWN) {
  test(`binaryTimesToIso decodes ${binary} to ${iso} wherever a DateTime element sits`, () => {
    const root = documentWith(binary);
    binaryTimesToIso(root);
    assert.deepEqual(timesIn(root), [iso, iso, iso, iso]);
  });

  test(`isoTimesToBinary encodes ${iso} to ${binary} wherever a DateTime element sits`, () => {
    const root = documentWith(iso);
    isoTimesToBinary(root);
    assert.deepEqual(timesIn(root), [binary, binary, binary, binary]);
  });
}

test('binaryTimesToIso leaves non-time elements alone, even when they hold 8-byte Base64', () => {
  const root = documentWith('AAAAAAAAAAA=');
  binaryTimesToIso(root);
  assert.equal(textAt(root, 'Root', 'Group', 'UUID'), 'AAAAAAAAAAA=');
});

test('binaryTimesToIso keeps ISO text (as older KeePass Web saves wrote) and out-of-range values', () => {
  const iso = documentWith('2026-10-11T00:18:51Z');
  binaryTimesToIso(iso);
  assert.equal(timesIn(iso)[0], '2026-10-11T00:18:51Z');

  const maxInt64 = documentWith('/////////38=');
  binaryTimesToIso(maxInt64);
  assert.equal(timesIn(maxInt64)[0], '/////////38=');
});

test('isoTimesToBinary leaves text that is not a valid ISO timestamp alone', () => {
  for (const text of ['', 'not a date', '2026-13-45T99:99:99Z']) {
    const root = documentWith(text);
    isoTimesToBinary(root);
    assert.equal(timesIn(root)[0], text);
  }
});

test('isoTimesToBinary drops sub-second precision, as the format stores whole seconds', () => {
  const precise = documentWith('2018-01-25T13:28:56.999Z');
  isoTimesToBinary(precise);
  assert.equal(timesIn(precise)[0], 'mNL70Q4AAAA=');
});

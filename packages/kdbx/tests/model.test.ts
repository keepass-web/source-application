import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDatabaseDocument,
  createElement,
  createEntry,
  getAttribute,
  getChild,
  getChildren,
  getText,
  ProtectedValue,
  setAttribute,
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

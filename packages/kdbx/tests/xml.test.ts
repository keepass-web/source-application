import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAttribute,
  getChild,
  getText,
  parseXml,
  serializeXml,
  type XmlElement,
} from '../src/index.ts';

interface PlainNode {
  name: string;
  attributes: Array<[string, string]>;
  children: Array<PlainNode | string>;
}

function normalize(element: XmlElement): PlainNode {
  return {
    name: element.name,
    attributes: element.attributes,
    children: element.children.map((child) =>
      child.type === 'element' ? normalize(child) : child.value,
    ),
  };
}

test('parses elements, attributes, and text', () => {
  const root = parseXml('<a x="1" y="two"><b>hi</b><c/></a>');
  assert.equal(root.name, 'a');
  assert.equal(getAttribute(root, 'x'), '1');
  assert.equal(getAttribute(root, 'y'), 'two');
  assert.equal(getText(getChild(root, 'b') as XmlElement), 'hi');
  assert.deepEqual((getChild(root, 'c') as XmlElement).children, []);
});

test('decodes entities in text and attributes', () => {
  const root = parseXml('<v note="a &amp; b &lt;c&gt;">x &amp; y &lt; z &#65; &#x42;</v>');
  assert.equal(getAttribute(root, 'note'), 'a & b <c>');
  assert.equal(getText(root), 'x & y < z A B');
});

test('reads CDATA sections verbatim', () => {
  const root = parseXml('<v><![CDATA[<not> & parsed]]></v>');
  assert.equal(getText(root), '<not> & parsed');
});

test('round-trips through serialize/parse (canonical form is stable)', () => {
  const xml =
    '<KeePassFile><Meta><Generator>kw</Generator></Meta>' +
    '<Root><Group><Name>G</Name>' +
    '<Entry><String><Key>Password</Key><Value Protected="True">c2VjcmV0</Value></String></Entry>' +
    '</Group></Root></KeePassFile>';
  const once = parseXml(xml);
  const twice = parseXml(serializeXml(once));
  assert.deepEqual(normalize(twice), normalize(once));
});

test('escapes special characters on serialize', () => {
  const root = parseXml('<v>a &amp; b &lt; c &gt; d</v>');
  const xml = serializeXml(root);
  assert.ok(xml.includes('a &amp; b &lt; c &gt; d'));
  assert.equal(getText(parseXml(xml)), 'a & b < c > d');
});

test('preserves significant whitespace in text-only elements', () => {
  const root = parseXml('<v>  spaced value  </v>');
  assert.equal(getText(parseXml(serializeXml(root))), '  spaced value  ');
});

test('preserves the Protected attribute marker', () => {
  const root = parseXml('<Value Protected="True">abc</Value>');
  const reparsed = parseXml(serializeXml(root));
  assert.equal(getAttribute(reparsed, 'Protected'), 'True');
});

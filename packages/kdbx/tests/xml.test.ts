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

test('escapes special characters in attribute values on serialize', () => {
  const root = parseXml('<v note="&amp; &lt; &quot;">x</v>');
  const xml = serializeXml(root);
  assert.ok(xml.includes('note="&amp; &lt; &quot;"'));
  assert.equal(getAttribute(parseXml(xml), 'note'), '& < "');
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

test('decodes &quot; and &apos; entities', () => {
  const root = parseXml('<v note="&quot;q&quot; &apos;a&apos;">&quot;x&quot; &apos;y&apos;</v>');
  assert.equal(getAttribute(root, 'note'), '"q" \'a\'');
  assert.equal(getText(root), '"x" \'y\'');
});

test('skips comments and doctype-like tags in the prolog', () => {
  const root = parseXml(
    '<?xml version="1.0"?><!-- a leading comment --><!DOCTYPE foo><root>ok</root>',
  );
  assert.equal(root.name, 'root');
  assert.equal(getText(root), 'ok');
});

test("skips comments among an element's children, not just the prolog", () => {
  const root = parseXml('<a><!-- inner comment --><b/></a>');
  assert.equal(root.children.length, 1);
  assert.equal((getChild(root, 'b') as XmlElement).name, 'b');
});

test('parse throws on malformed input', () => {
  assert.throws(() => parseXml('not xml'), /expected '<' at offset/);
  assert.throws(() => parseXml('<tag'), /malformed start tag/);
  assert.throws(() => parseXml('<a b c="1"></a>'), /expected '=' after attribute b/);
  assert.throws(() => parseXml('<a b=1></a>'), /expected quoted value for attribute b/);
  assert.throws(() => parseXml('<a b="unterminated></a>'), /unterminated attribute value for b/);
  assert.throws(() => parseXml('<a>'), /unexpected end of document inside <a>/);
  assert.throws(() => parseXml('<a></b>'), /mismatched closing tag <\/b> for <a>/);
});

test('serializes an element with mixed element and non-whitespace text children', () => {
  const root = parseXml('<foo>text<bar/></foo>');
  const xml = serializeXml(root);
  assert.ok(xml.includes('text'));
  assert.ok(xml.includes('<bar/>'));
  const reparsed = parseXml(xml);
  assert.equal(getText(reparsed).trim(), 'text');
  assert.equal((getChild(reparsed, 'bar') as XmlElement).name, 'bar');
});

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Manifest } from './types.ts';

const STYLES_SENTINEL = '<!--STYLES-->';
const SCRIPTS_SENTINEL = '<!--SCRIPTS-->';

/**
 * Reads the manifest at `manifestPath`, inlines all styles and scripts into the
 * HTML template in the order listed, writes the output file, and returns its
 * SHA-256 checksum (hex-encoded).
 *
 * Throws if either sentinel is absent from the template, or if any listed file
 * cannot be read.
 */
export function build(manifestPath: string): string {
  const base = dirname(resolve(manifestPath));
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

  const template = readFileSync(join(base, manifest.template), 'utf8');

  if (!template.includes(STYLES_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${STYLES_SENTINEL}`);
  }
  if (!template.includes(SCRIPTS_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${SCRIPTS_SENTINEL}`);
  }

  const css = manifest.styles.map((f) => readFileSync(join(base, f), 'utf8')).join('\n');
  const js = manifest.scripts.map((f) => readFileSync(join(base, f), 'utf8')).join('\n');

  const html = template
    .replace(STYLES_SENTINEL, `<style>\n${css}\n</style>`)
    .replace(SCRIPTS_SENTINEL, `<script>\n${js}\n</script>`);

  const outputPath = join(base, manifest.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');

  return createHash('sha256').update(html, 'utf8').digest('hex');
}

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Manifest } from './types.ts';
import { computeVersionLabel, renderVersionFragment } from './version-label.ts';

const STYLES_SENTINEL = '<!--STYLES-->';
const SCRIPTS_SENTINEL = '<!--SCRIPTS-->';
const FOOTER_SENTINEL = '<!--FOOTER-->';
const VERSION_SENTINEL = '<!--VERSION-->';

/**
 * Reads the manifest at `manifestPath`, inlines all styles and scripts plus the
 * shared footer partial into the HTML template in the order listed, writes the
 * output file, and returns its SHA-256 checksum (hex-encoded) alongside the
 * resolved output path.
 *
 * Throws if any sentinel is absent from the template, or if any listed file
 * cannot be read.
 */
export function build(manifestPath: string): { checksum: string; outputPath: string } {
  const base = dirname(resolve(manifestPath));
  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;

  const template = readFileSync(join(base, manifest.template), 'utf8');

  if (!template.includes(STYLES_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${STYLES_SENTINEL}`);
  }
  if (!template.includes(SCRIPTS_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${SCRIPTS_SENTINEL}`);
  }
  if (!template.includes(FOOTER_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${FOOTER_SENTINEL}`);
  }

  const css = manifest.styles.map((f) => readFileSync(join(base, f), 'utf8')).join('\n');
  const js = manifest.scripts.map((f) => readFileSync(join(base, f), 'utf8')).join('\n');
  const footer = readFileSync(join(base, manifest.footer), 'utf8');

  const withFooter = template
    .replace(STYLES_SENTINEL, `<style>\n${css}\n</style>`)
    .replace(SCRIPTS_SENTINEL, `<script>\n${js}\n</script>`)
    .replace(FOOTER_SENTINEL, footer);

  // VERSION may live directly in the template or inside the just-inlined
  // footer partial (the real page templates only carry it via the footer),
  // so this check runs after FOOTER inlining rather than alongside the rest.
  if (!withFooter.includes(VERSION_SENTINEL)) {
    throw new Error(`Template is missing the required sentinel: ${VERSION_SENTINEL}`);
  }

  const version = renderVersionFragment(
    computeVersionLabel({
      refType: process.env.GITHUB_REF_TYPE,
      refName: process.env.GITHUB_REF_NAME,
      sha: process.env.GITHUB_SHA,
    }),
    process.env.KEEPASS_WEB_COMMIT_DATE,
  );

  const html = withFooter.replace(VERSION_SENTINEL, version);

  const outputPath = join(base, manifest.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');

  const checksum = createHash('sha256').update(html, 'utf8').digest('hex');
  return { checksum, outputPath };
}

import { build } from './build.ts';

const [, , manifestPath] = process.argv;

if (!manifestPath) {
  process.stderr.write(
    'Usage: node --experimental-strip-types src/index.ts <path/to/build.json>\n',
  );
  process.exit(1);
}

const checksum = build(manifestPath);
process.stdout.write(`sha256:${checksum}\n`);

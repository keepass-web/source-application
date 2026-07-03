import { bundle } from './bundle.ts';

const [, , configPath] = process.argv;

if (!configPath) {
  process.stderr.write(
    'Usage: node --experimental-strip-types src/index.ts <path/to/bundle-iife.json>\n',
  );
  process.exit(1);
}

const { count, outputPath } = bundle(configPath);
process.stdout.write(`Bundled ${count} files to ${outputPath}\n`);

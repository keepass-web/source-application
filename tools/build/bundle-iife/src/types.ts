/**
 * Bundle config schema.
 *
 * One config file lives alongside the source tree of each application being
 * built. File paths in `files` are resolved relative to `packagesDir`;
 * `packagesDir` and `output` are resolved relative to the config file.
 */
export interface BundleConfig {
  /**
   * Path to the workspace packages directory, relative to this config file.
   * Example: `"../../packages"`
   */
  readonly packagesDir: string;

  /**
   * Dist files to concatenate, in dependency order, as package-relative paths.
   * Example: `"chacha20/dist/src/index.js"`
   *
   * Index / re-export files should be omitted: all declarations are in scope
   * from the individual source files.
   */
  readonly files: readonly string[];

  /**
   * Module-scope symbol names to hoist onto `globalThis` after concatenation,
   * so that code outside the IIFE can reference them.
   */
  readonly exports: readonly string[];

  /**
   * Output path for the generated bundle, relative to this config file.
   */
  readonly output: string;
}

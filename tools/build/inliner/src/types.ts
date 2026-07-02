/**
 * Build manifest schema.
 *
 * One manifest lives alongside the source tree of each application being built.
 * All file paths are resolved relative to the directory containing the manifest.
 *
 * The inliner reads files in the order listed and concatenates them. Order is
 * load order — it is the author's responsibility to list dependencies first.
 */
export interface Manifest {
  /** HTML template. Must contain exactly one <!--STYLES--> and one <!--SCRIPTS--> sentinel. */
  readonly template: string;
  /** CSS files, concatenated in order and inlined at <!--STYLES-->. */
  readonly styles: readonly string[];
  /** JS files, concatenated in order and inlined at <!--SCRIPTS-->. */
  readonly scripts: readonly string[];
  /** Output path for the produced distributable, relative to the manifest. */
  readonly output: string;
}

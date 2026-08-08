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
  /**
   * HTML template. Must contain exactly one <!--STYLES-->, one <!--SCRIPTS-->,
   * and one <!--FOOTER--> sentinel. A <!--VERSION--> sentinel must appear
   * exactly once across the template and/or the inlined footer partial —
   * it's resolved after FOOTER inlining, so the footer partial may supply it
   * instead of the template.
   */
  readonly template: string;
  /** CSS files, concatenated in order and inlined at <!--STYLES-->. */
  readonly styles: readonly string[];
  /** JS files, concatenated in order and inlined at <!--SCRIPTS-->. */
  readonly scripts: readonly string[];
  /** HTML partial inlined at <!--FOOTER-->, before <!--VERSION--> is resolved. */
  readonly footer: string;
  /** Output path for the produced distributable, relative to the manifest. */
  readonly output: string;
}

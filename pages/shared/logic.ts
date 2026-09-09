/** Tab chrome for every page that can hold a database: the name a tab carries
and the icon it shows. The document that owns the tab is not always the one
that knows the state — an embedded app reports it back over embed-protocol —
so the connector pages and the app itself both end up here, and the icons are
defined once instead of once per page. */

/* Hue and silhouette rather than an open versus closed shackle (#73): a tab
gives an icon 16 pixels, where a shackle's gap is about two of them and the two
states are indistinguishable. Unlocked is a different color and shows rows,
because rows are what clicking that tab is about to put on screen. */
const LOCKED_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.4' fill='%230e7c5a'/%3E%3Cpath d='M6 8.4V7a2 2 0 0 1 4 0v1.4' fill='none' stroke='%23fff' stroke-width='1.35' stroke-linecap='round'/%3E%3Crect x='4.5' y='8.4' width='7' height='4.5' rx='1.1' fill='%23fff'/%3E%3C/svg%3E";
const UNLOCKED_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.4' fill='%238a5a1e'/%3E%3Crect x='3.7' y='4.4' width='8.6' height='1.9' rx='.95' fill='%23fff'/%3E%3Crect x='3.7' y='7.05' width='8.6' height='1.9' rx='.95' fill='%23fff'/%3E%3Crect x='3.7' y='9.7' width='8.6' height='1.9' rx='.95' fill='%23fff'/%3E%3C/svg%3E";

/** The tab's name. It spells the state out as well as showing it, because 🔒
and 🔓 are as hard to tell apart in a title as they are in a tab (#73). */
export function tabTitle(baseTitle: string, filename: string, locked: boolean): string {
  if (!filename) return baseTitle;
  return `${locked ? '🔒' : '🔓'} ${filename} - ${locked ? 'Locked' : 'Unlocked'} - ${baseTitle}`;
}

/** Name the tab and mark it with the database's state; no filename means no
database, which leaves the page's own icon alone. */
export function applyTabState(
  doc: Document,
  baseTitle: string,
  filename: string,
  locked: boolean,
): void {
  doc.title = tabTitle(baseTitle, filename, locked);

  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;

  /* Kept on the element rather than in this module, so it is captured once per
  document and before anything overwrites it: giving a database up has to hand
  the tab back the icon its own page shipped with (#73). */
  if (link.dataset.pageIcon === undefined) link.dataset.pageIcon = link.getAttribute('href') ?? '';

  let icon = link.dataset.pageIcon;
  if (filename) icon = locked ? LOCKED_ICON : UNLOCKED_ICON;
  link.setAttribute('href', icon);
}

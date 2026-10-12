/** Merges another copy of a database into this one by KeePass's synchronization
rules, so the result matches what KeePass and KeePassXC make of the same two
files (#74). See SPEC.md, "Merging". */

import {
  appendChild,
  cloneElement,
  createElement,
  getAttribute,
  getChild,
  getChildren,
  getEntryHistory,
  getText,
  setAttribute,
  setChildText,
} from './model.ts';
import type { XmlElement } from './xml.ts';

// What a merge brought in, for telling the user.
export interface MergeSummary {
  // Entries and groups the other copy added, changed, moved or removed here.
  changed: number;
  // Titles of entries both copies changed; each keeps the other version in its History.
  conflicts: string[];
}

interface KX_Placed {
  element: XmlElement;
  parent: XmlElement | null;
}

// Times a merge ignores when deciding whether two copies of an entry differ, as KeePass does.
const KX_UNCOMPARED_TIMES = new Set(['LastAccessTime', 'UsageCount', 'LocationChanged']);

// Database settings that travel together, each pair decided by its own *Changed time.
const KX_META_SETTINGS: Array<[string[], string]> = [
  [['DatabaseName'], 'DatabaseNameChanged'],
  [['DatabaseDescription'], 'DatabaseDescriptionChanged'],
  [['DefaultUserName'], 'DefaultUserNameChanged'],
  [['RecycleBinEnabled', 'RecycleBinUUID'], 'RecycleBinChanged'],
  [['EntryTemplatesGroup'], 'EntryTemplatesGroupChanged'],
];

function kx_elements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => child.type === 'element');
}

function kx_uuidOf(element: XmlElement): string {
  const uuidEl = getChild(element, 'UUID');
  return uuidEl ? getText(uuidEl) : '';
}

// A named time under `parent`, in whole seconds (the files' own resolution); 0 when absent.
function kx_secondsIn(parent: XmlElement | undefined, name: string): number {
  const field = parent && getChild(parent, name);
  const ms = field ? Date.parse(getText(field)) : Number.NaN;
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

function kx_seconds(element: XmlElement, name: string): number {
  return kx_secondsIn(getChild(element, 'Times'), name);
}

function kx_title(entry: XmlElement): string {
  for (const string of getChildren(entry, 'String')) {
    const keyEl = getChild(string, 'Key');
    const valueEl = getChild(string, 'Value');
    if (keyEl && valueEl && getText(keyEl) === 'Title') return getText(valueEl);
  }
  return '';
}

function kx_track(
  index: Map<string, KX_Placed>,
  element: XmlElement,
  parent: XmlElement | null,
): void {
  const uuid = kx_uuidOf(element);
  if (uuid) index.set(uuid, { element, parent });
}

// Every live group and entry under `group` by UUID, with its parent; History versions aren't live.
function kx_index(
  group: XmlElement,
  parent: XmlElement | null,
  index: Map<string, KX_Placed>,
): Map<string, KX_Placed> {
  kx_track(index, group, parent);
  for (const entry of getChildren(group, 'Entry')) {
    kx_track(index, entry, group);
  }
  for (const sub of getChildren(group, 'Group')) {
    kx_index(sub, group, index);
  }
  return index;
}

// Element content in an order-free form, so copies that differ only in layout compare equal.
function kx_canonical(element: XmlElement): string {
  const attributes = element.attributes.map(([name, value]) => `${name}=${JSON.stringify(value)}`);
  const children = kx_elements(element);
  const body =
    children.length > 0
      ? children.map(kx_canonical).sort().join('')
      : JSON.stringify(getText(element));
  return `<${element.name} ${attributes.sort().join(' ')}>${body}</${element.name}>`;
}

/* An entry's content as KeePass compares it when merging: without its History,
access count or location, and with an empty field the same as a missing one. */
function kx_entryContent(entry: XmlElement): string {
  const children = kx_elements(entry).flatMap((child): XmlElement[] => {
    if (child.name === 'History') return [];
    if (child.name === 'String') {
      const valueEl = getChild(child, 'Value');
      return valueEl && getText(valueEl) !== '' ? [child] : [];
    }
    if (child.name === 'Times') {
      const kept = kx_elements(child).filter((time) => !KX_UNCOMPARED_TIMES.has(time.name));
      return [{ ...child, children: kept }];
    }
    return [child];
  });
  return kx_canonical({ ...entry, children });
}

function kx_snapshot(entry: XmlElement): XmlElement {
  const copy = cloneElement(entry);
  copy.children = copy.children.filter(
    (child) => !(child.type === 'element' && child.name === 'History'),
  );
  return copy;
}

// One version per modification time, this copy's winning a tie, oldest first, trimmed to the limit.
function kx_mergeHistory(local: XmlElement[], other: XmlElement[], maxItems: number): XmlElement[] {
  const byTime = new Map<number, XmlElement>();
  for (const version of [...other, ...local]) {
    byTime.set(kx_seconds(version, 'LastModificationTime'), version);
  }
  const merged = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, version]) => version);
  return maxItems >= 0 ? merged.slice(Math.max(0, merged.length - maxItems)) : merged;
}

function kx_setHistory(entry: XmlElement, versions: XmlElement[]): void {
  let historyEl = getChild(entry, 'History');
  if (!historyEl) {
    if (versions.length === 0) return;
    historyEl = createElement('History');
    appendChild(entry, historyEl);
  }
  historyEl.children = versions;
}

/* Take the other copy's fields. `keep` names this copy's children that merge
separately, and its LocationChanged stays, since placement merges separately too. */
function kx_adoptFields(local: XmlElement, other: XmlElement, keep: Set<string>): void {
  const uuidEl = getChild(local, 'UUID') as XmlElement; // only objects matched by UUID get here
  const localTimes = getChild(local, 'Times');
  const location = localTimes && getChild(localTimes, 'LocationChanged');
  const kept = kx_elements(local).filter((child) => child !== uuidEl && keep.has(child.name));
  const taken = kx_elements(other)
    .filter((child) => child.name !== 'UUID' && !keep.has(child.name))
    .map(cloneElement);
  local.children = [uuidEl, ...taken, ...kept];
  const times = getChild(local, 'Times');
  if (location && times) setChildText(times, 'LocationChanged', getText(location));
}

// Point the other copy's attachment references into this database's pool.
function kx_adoptBinaries(element: XmlElement, adoptBinary: (ref: number) => number): void {
  for (const child of kx_elements(element)) {
    const valueEl = child.name === 'Binary' ? getChild(child, 'Value') : undefined;
    const ref = valueEl && getAttribute(valueEl, 'Ref');
    if (valueEl && ref !== undefined) {
      setAttribute(valueEl, 'Ref', String(adoptBinary(Number.parseInt(ref, 10))));
    }
    kx_adoptBinaries(child, adoptBinary);
  }
}

// Whether `candidate` is `element` or sits inside it, so a group is never moved into itself.
function kx_isInside(
  element: XmlElement,
  candidate: XmlElement,
  index: Map<string, KX_Placed>,
): boolean {
  for (let at: XmlElement | null = candidate; at; at = index.get(kx_uuidOf(at))?.parent ?? null) {
    if (at === element) return true;
  }
  return false;
}

function kx_detach(placed: KX_Placed): void {
  const { element, parent } = placed;
  if (parent) parent.children = parent.children.filter((child) => child !== element);
}

/* Union of keyed items (custom icons, custom data) under a Meta child, an item
the other copy changed later replacing this copy's. */
function kx_mergeItems(
  localMeta: XmlElement,
  otherMeta: XmlElement,
  listName: string,
  keyName: string,
): void {
  const otherList = getChild(otherMeta, listName);
  if (!otherList) return;
  let localList = getChild(localMeta, listName);
  if (!localList) {
    localList = createElement(listName);
    appendChild(localMeta, localList);
  }
  const keyOf = (item: XmlElement): string => {
    const keyEl = getChild(item, keyName);
    return keyEl ? getText(keyEl) : '';
  };
  for (const item of kx_elements(otherList)) {
    const existing = kx_elements(localList).find((local) => keyOf(local) === keyOf(item));
    if (!existing) {
      appendChild(localList, cloneElement(item));
    } else if (
      kx_secondsIn(item, 'LastModificationTime') > kx_secondsIn(existing, 'LastModificationTime')
    ) {
      localList.children = localList.children.map((child) =>
        child === existing ? cloneElement(item) : child,
      );
    }
  }
}

function kx_mergeMeta(localMeta: XmlElement, otherMeta: XmlElement): void {
  for (const [fields, changed] of KX_META_SETTINGS) {
    if (kx_secondsIn(otherMeta, changed) <= kx_secondsIn(localMeta, changed)) continue;
    for (const field of [...fields, changed]) {
      const otherField = getChild(otherMeta, field);
      if (otherField) setChildText(localMeta, field, getText(otherField));
    }
  }
  kx_mergeItems(localMeta, otherMeta, 'CustomIcons', 'UUID');
  kx_mergeItems(localMeta, otherMeta, 'CustomData', 'Key');
}

function kx_deletedObjects(document: XmlElement): XmlElement[] {
  const rootElement = getChild(document, 'Root');
  const list = rootElement && getChild(rootElement, 'DeletedObjects');
  return list ? getChildren(list, 'DeletedObject') : [];
}

function kx_rootGroup(document: XmlElement): XmlElement {
  const rootElement = getChild(document, 'Root');
  const group = rootElement && getChild(rootElement, 'Group');
  if (!group) {
    throw new Error('database has no root group');
  }
  return group;
}

/** Merge `other` into `local`, both whole `<KeePassFile>` documents of the same
database. `other` is consumed: its attachment references are rewritten through
`adoptBinary`, which maps one of its pool indexes to one in `local`'s pool. */
export function mergeDocuments(
  local: XmlElement,
  other: XmlElement,
  adoptBinary: (ref: number) => number,
): MergeSummary {
  const localRoot = kx_rootGroup(local);
  const otherRoot = kx_rootGroup(other);
  const index = kx_index(localRoot, null, new Map());
  const added = new Set<XmlElement>();
  // Each of the other copy's groups by its counterpart here, so children land under the right parent.
  const counterpart = new Map<XmlElement, XmlElement>();
  const summary: MergeSummary = { changed: 0, conflicts: [] };
  const localMeta = getChild(local, 'Meta');
  const maxItemsEl = localMeta && getChild(localMeta, 'HistoryMaxItems');
  const maxItems = maxItemsEl ? Number.parseInt(getText(maxItemsEl), 10) : 10;
  kx_adoptBinaries(otherRoot, adoptBinary);

  // An object both copies hold goes where the copy that moved it last put it.
  const place = (
    placed: KX_Placed,
    otherObject: XmlElement,
    otherParent: XmlElement | null,
  ): void => {
    const otherTimes = getChild(otherObject, 'Times');
    const otherLocation = otherTimes && getChild(otherTimes, 'LocationChanged');
    const localTimes = getChild(placed.element, 'Times');
    if (
      !otherLocation ||
      !localTimes ||
      kx_seconds(otherObject, 'LocationChanged') <= kx_seconds(placed.element, 'LocationChanged')
    ) {
      return;
    }
    const destination = otherParent ? counterpart.get(otherParent) : undefined;
    if (
      destination &&
      placed.parent &&
      destination !== placed.parent &&
      !kx_isInside(placed.element, destination, index)
    ) {
      kx_detach(placed);
      appendChild(destination, placed.element);
      placed.parent = destination;
      summary.changed += 1;
    }
    setChildText(localTimes, 'LocationChanged', getText(otherLocation));
  };

  const mergeGroup = (otherGroup: XmlElement, otherParent: XmlElement | null): void => {
    const placed = index.get(kx_uuidOf(otherGroup));
    let group: XmlElement;
    if (placed) {
      group = placed.element;
      const otherIsNewer =
        kx_seconds(otherGroup, 'LastModificationTime') > kx_seconds(group, 'LastModificationTime');
      if (otherIsNewer) {
        kx_adoptFields(group, otherGroup, new Set(['Entry', 'Group']));
        summary.changed += 1;
      }
      place(placed, otherGroup, otherParent);
    } else {
      group = cloneElement(otherGroup);
      group.children = group.children.filter(
        (child) =>
          !(child.type === 'element' && (child.name === 'Entry' || child.name === 'Group')),
      );
      // A root that isn't this database's own lands inside it, as KeePass places it.
      const parent = otherParent ? (counterpart.get(otherParent) as XmlElement) : localRoot;
      appendChild(parent, group);
      kx_track(index, group, parent);
      added.add(group);
    }
    counterpart.set(otherGroup, group);

    for (const otherEntry of getChildren(otherGroup, 'Entry')) {
      mergeEntry(otherEntry, otherGroup);
    }
    for (const sub of getChildren(otherGroup, 'Group')) {
      mergeGroup(sub, otherGroup);
    }
  };

  const mergeEntry = (otherEntry: XmlElement, otherParent: XmlElement): void => {
    const placed = index.get(kx_uuidOf(otherEntry));
    if (!placed) {
      const entry = cloneElement(otherEntry);
      const parent = counterpart.get(otherParent) as XmlElement;
      appendChild(parent, entry);
      kx_track(index, entry, parent);
      added.add(entry);
      return;
    }

    const entry = placed.element;
    let localHistory = getEntryHistory(entry);
    let otherHistory = getEntryHistory(otherEntry);
    if (kx_entryContent(entry) !== kx_entryContent(otherEntry)) {
      /* The newer copy stays current and the older goes into History. KeePass
      drops the other copy when both changed within the same second; keeping it
      here means neither is lost. */
      const localTime = kx_seconds(entry, 'LastModificationTime');
      const otherTime = kx_seconds(otherEntry, 'LastModificationTime');
      const otherIsNewer = otherTime > localTime;
      const olderTime = otherIsNewer ? localTime : otherTime;
      const newerHistory = otherIsNewer ? otherHistory : localHistory;
      const seen = newerHistory.some((v) => kx_seconds(v, 'LastModificationTime') === olderTime);
      if (otherIsNewer) {
        localHistory = [...localHistory, kx_snapshot(entry)];
        kx_adoptFields(entry, otherEntry, new Set(['History']));
        summary.changed += 1;
      } else {
        otherHistory = [...otherHistory, kx_snapshot(otherEntry)];
      }
      if (!seen) summary.conflicts.push(kx_title(entry));
    }
    kx_setHistory(entry, kx_mergeHistory(localHistory, otherHistory, maxItems));
    place(placed, otherEntry, otherParent);
  };

  mergeGroup(otherRoot, null);

  // Deletions from either copy, the later of two records for the same object winning.
  const records = new Map<string, XmlElement>();
  for (const record of [...kx_deletedObjects(local), ...kx_deletedObjects(other)]) {
    const uuid = kx_uuidOf(record);
    const known = records.get(uuid);
    if (!known || kx_secondsIn(record, 'DeletionTime') > kx_secondsIn(known, 'DeletionTime')) {
      records.set(uuid, record);
    }
  }
  // An object edited after its deletion survives it, and a group survives while it holds anything.
  const remove = (placed: KX_Placed): void => {
    kx_detach(placed);
    if (!added.delete(placed.element)) summary.changed += 1;
  };
  for (const [uuid, record] of records) {
    const placed = index.get(uuid);
    if (
      placed?.element.name === 'Entry' &&
      kx_seconds(placed.element, 'LastModificationTime') < kx_secondsIn(record, 'DeletionTime')
    ) {
      remove(placed);
      index.delete(uuid);
    }
  }
  const removeEmptyGroups = (group: XmlElement): void => {
    for (const sub of getChildren(group, 'Group')) {
      removeEmptyGroups(sub);
      const record = records.get(kx_uuidOf(sub));
      const empty =
        getChildren(sub, 'Entry').length === 0 && getChildren(sub, 'Group').length === 0;
      if (
        record &&
        empty &&
        kx_seconds(sub, 'LastModificationTime') < kx_secondsIn(record, 'DeletionTime')
      ) {
        remove({ element: sub, parent: group });
      }
    }
  };
  removeEmptyGroups(localRoot);
  const rootElement = getChild(local, 'Root') as XmlElement;
  let deletedObjects = getChild(rootElement, 'DeletedObjects');
  if (records.size > 0 && !deletedObjects) {
    deletedObjects = createElement('DeletedObjects');
    appendChild(rootElement, deletedObjects);
  }
  if (deletedObjects) deletedObjects.children = [...records.values()];

  const otherMeta = getChild(other, 'Meta');
  if (localMeta && otherMeta) kx_mergeMeta(localMeta, otherMeta);

  summary.changed += added.size;
  return summary;
}

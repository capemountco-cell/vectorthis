// Recent results, kept only in this browser. Every access is guarded: storage can be
// unavailable (private mode, blocked site data), and the app must work without it.
export type RecentItem = { id: string; name: string; mode: string; svg: string; createdAt: number };

const KEY = "vectorthis.recent.v1";
const LIMIT = 8;
const MAX_SVG = 400_000;

export function loadRecent(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): RecentItem[] {
  try {
    const raw = storage?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (x): x is RecentItem =>
        typeof x === "object" && x !== null && typeof x.id === "string" && typeof x.name === "string" &&
        typeof x.mode === "string" && typeof x.svg === "string" && x.svg.startsWith("<svg") && typeof x.createdAt === "number",
    ).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function addRecent(
  item: Omit<RecentItem, "id" | "createdAt">,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): RecentItem[] {
  if (item.svg.length > MAX_SVG) return loadRecent(storage);
  const entry: RecentItem = { ...item, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() };
  // Same name and mode replaces the older entry instead of piling up duplicates.
  const list = [entry, ...loadRecent(storage).filter((r) => !(r.name === item.name && r.mode === item.mode))].slice(0, LIMIT);
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota or blocked storage: the list still works for this session.
  }
  return list;
}

function save(list: RecentItem[], storage: Pick<Storage, "setItem"> | undefined) {
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: the change still applies for this session.
  }
  return list;
}

/**
 * Removes one saved logo; returns the remaining list. Works from the list on screen
 * when given, so a session without storage can still delete its items.
 */
export function removeRecent(
  id: string,
  current?: RecentItem[],
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
): RecentItem[] {
  return save((current ?? loadRecent(storage)).filter((r) => r.id !== id), storage);
}

/** Removes every saved logo from this device. */
export function clearRecent(storage: Pick<Storage, "removeItem"> | undefined = globalThis.localStorage): RecentItem[] {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing else to do: the in-memory list is cleared either way.
  }
  return [];
}

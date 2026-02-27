export type ClockMode = '12h' | '24h';

export type LinkIconKey =
  | 'youtube'
  | 'linkedin'
  | 'gmail'
  | 'github'
  | 'notion'
  | 'calendar'
  | 'drive'
  | 'chatgpt'
  | 'x'
  | 'whatsapp'
  | 'globe';

export interface QuickLink {
  id: string;
  name: string;
  url: string;
  icon: LinkIconKey;
  useSiteFavicon: boolean;
  tags: string[];
  order: number;
  createdAt: number;
  accessLog: number[];
}

export interface AppSettings {
  clockMode: ClockMode;
  showSeconds: boolean;
  clockScale: number;
  linksSortMode: 'manual' | 'most_accessed';
  gridCols: number;
  gridRows: number;
  iconSize: number;
}

interface AppMeta {
  linksSeeded: boolean;
}

const EXTENSION_SETTINGS_KEY = 'settings';
const EXTENSION_LINKS_KEY = 'links';
const EXTENSION_FAVICON_PREFS_KEY = 'faviconPrefs';
const EXTENSION_META_KEY = 'meta';

const LOCAL_SETTINGS_KEY = 'focustab.settings';
const LOCAL_LINKS_KEY = 'focustab.links';
const LOCAL_FAVICON_PREFS_KEY = 'focustab.faviconPrefs';
const LOCAL_META_KEY = 'focustab.meta';

export const DEFAULT_SETTINGS: AppSettings = {
  clockMode: '24h',
  showSeconds: false,
  clockScale: 100,
  linksSortMode: 'manual',
  gridCols: 5,
  gridRows: 2,
  iconSize: 68,
};

const DEFAULT_META: AppMeta = {
  linksSeeded: false,
};

const RECENT_ACCESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SEEDED_LINKS: Array<Pick<QuickLink, 'name' | 'url' | 'icon' | 'tags'>> = [
  {
    name: 'YouTube',
    url: 'https://youtube.com',
    icon: 'youtube',
    tags: ['video', 'music'],
  },
  {
    name: 'LinkedIn',
    url: 'https://linkedin.com',
    icon: 'linkedin',
    tags: ['network', 'jobs'],
  },
  {
    name: 'Gmail',
    url: 'https://mail.google.com',
    icon: 'gmail',
    tags: ['email'],
  },
  {
    name: 'GitHub',
    url: 'https://github.com',
    icon: 'github',
    tags: ['code', 'repo'],
  },
  {
    name: 'Notion',
    url: 'https://notion.so',
    icon: 'notion',
    tags: ['docs', 'notes'],
  },
  {
    name: 'Google Calendar',
    url: 'https://calendar.google.com',
    icon: 'calendar',
    tags: ['agenda'],
  },
  {
    name: 'Google Drive',
    url: 'https://drive.google.com',
    icon: 'drive',
    tags: ['files'],
  },
  {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    icon: 'chatgpt',
    tags: ['ai'],
  },
  {
    name: 'X',
    url: 'https://x.com',
    icon: 'x',
    tags: ['social', 'twitter'],
  },
  {
    name: 'WhatsApp Web',
    url: 'https://web.whatsapp.com',
    icon: 'whatsapp',
    tags: ['chat'],
  },
  {
    name: 'Reddit',
    url: 'https://reddit.com',
    icon: 'globe',
    tags: ['community'],
  },
  {
    name: 'Google',
    url: 'https://google.com',
    icon: 'globe',
    tags: ['search'],
  },
];

function hasExtensionStorage() {
  return typeof browser !== 'undefined' && !!browser.storage?.local;
}

function localRead<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localWrite<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore private mode and quota issues.
  }
}

function sortLinks(links: QuickLink[]) {
  return [...links].sort((a, b) => a.order - b.order);
}

function createLinkId(seedName?: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const prefix = seedName?.toLowerCase().replace(/[^a-z0-9]/g, '-') ?? 'link';
  return `${prefix}-${Date.now()}-${suffix}`;
}

function createSeedLinks() {
  const now = Date.now();

  return SEEDED_LINKS.map((link, index) => ({
    id: createLinkId(link.name),
    name: link.name,
    url: link.url,
    icon: link.icon,
    useSiteFavicon: true,
    tags: link.tags,
    order: index,
    createdAt: now + index,
    accessLog: [],
  }));
}

function normalizeAccessLog(rawLog: unknown, legacyCount: unknown, now = Date.now()) {
  const minTs = now - RECENT_ACCESS_WINDOW_MS;
  const normalized =
    Array.isArray(rawLog)
      ? rawLog
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          .map((value) => Math.round(value))
          .filter((value) => value >= minTs && value <= now + 60_000)
      : [];

  if (normalized.length > 0) {
    return normalized;
  }

  // Migration for old schema (accessedCount only): keep one recent event if count was positive.
  if (typeof legacyCount === 'number' && legacyCount > 0 && Number.isFinite(legacyCount)) {
    return [now];
  }

  return [];
}

function normalizeLinks(rawLinks: unknown): QuickLink[] {
  if (!Array.isArray(rawLinks)) {
    return [];
  }

  const now = Date.now();

  return rawLinks
    .filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null)
    .filter(
      (value) =>
        typeof value.id === 'string' &&
        typeof value.name === 'string' &&
        typeof value.url === 'string' &&
        typeof value.icon === 'string' &&
        Array.isArray(value.tags) &&
        typeof value.order === 'number' &&
        typeof value.createdAt === 'number',
    )
    .map((link) => ({
      id: link.id as string,
      name: link.name as string,
      url: link.url as string,
      icon: link.icon as LinkIconKey,
      useSiteFavicon:
        typeof link.useSiteFavicon === 'boolean' ? link.useSiteFavicon : true,
      tags: (link.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string'),
      order: Math.round(link.order as number),
      createdAt: Math.round(link.createdAt as number),
      accessLog: normalizeAccessLog(
        link.accessLog,
        link.accessedCount,
        now,
      ),
    }));
}

export function sanitizeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    if (!url.hostname) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export async function getSettings(): Promise<AppSettings> {
  if (!hasExtensionStorage()) {
    const localValue = localRead<Partial<AppSettings>>(LOCAL_SETTINGS_KEY, DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...localValue };
  }

  const data = await browser.storage.local.get(EXTENSION_SETTINGS_KEY);
  const fromStorage = data?.[EXTENSION_SETTINGS_KEY] as Partial<AppSettings> | undefined;

  return { ...DEFAULT_SETTINGS, ...(fromStorage ?? {}) };
}

export async function saveSettings(nextPatch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...nextPatch };

  if (!hasExtensionStorage()) {
    localWrite(LOCAL_SETTINGS_KEY, next);
    return next;
  }

  await browser.storage.local.set({ [EXTENSION_SETTINGS_KEY]: next });
  return next;
}

async function getMeta(): Promise<AppMeta> {
  if (!hasExtensionStorage()) {
    const localMeta = localRead<Partial<AppMeta>>(LOCAL_META_KEY, DEFAULT_META);
    return { ...DEFAULT_META, ...localMeta };
  }

  const data = await browser.storage.local.get(EXTENSION_META_KEY);
  const fromStorage = data?.[EXTENSION_META_KEY] as Partial<AppMeta> | undefined;
  return { ...DEFAULT_META, ...(fromStorage ?? {}) };
}

async function saveMeta(nextPatch: Partial<AppMeta>): Promise<AppMeta> {
  const current = await getMeta();
  const next = { ...current, ...nextPatch };

  if (!hasExtensionStorage()) {
    localWrite(LOCAL_META_KEY, next);
    return next;
  }

  await browser.storage.local.set({ [EXTENSION_META_KEY]: next });
  return next;
}

export async function getLinks(): Promise<QuickLink[]> {
  const meta = await getMeta();

  if (!hasExtensionStorage()) {
    const localLinks = normalizeLinks(localRead<unknown>(LOCAL_LINKS_KEY, []));

    if (!meta.linksSeeded || localLinks.length === 0) {
      const seeded = createSeedLinks();
      localWrite(LOCAL_LINKS_KEY, seeded);
      await saveMeta({ linksSeeded: true });
      return seeded;
    }

    return sortLinks(localLinks);
  }

  const data = await browser.storage.local.get(EXTENSION_LINKS_KEY);
  const storedLinks = normalizeLinks(data?.[EXTENSION_LINKS_KEY]);

  if (!meta.linksSeeded || storedLinks.length === 0) {
    const seeded = createSeedLinks();
    await browser.storage.local.set({ [EXTENSION_LINKS_KEY]: seeded });
    await saveMeta({ linksSeeded: true });
    return seeded;
  }

  return sortLinks(storedLinks);
}

export async function saveLinks(nextLinks: QuickLink[]): Promise<QuickLink[]> {
  const sorted = sortLinks(nextLinks);

  if (!hasExtensionStorage()) {
    localWrite(LOCAL_LINKS_KEY, sorted);
    return sorted;
  }

  await browser.storage.local.set({ [EXTENSION_LINKS_KEY]: sorted });
  return sorted;
}

function normalizeFaviconPrefs(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [linkId, value] of entries) {
    if (typeof linkId !== 'string' || !linkId) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    normalized[linkId] = trimmed;
  }

  return normalized;
}

export async function getFaviconPrefs(): Promise<Record<string, string>> {
  if (!hasExtensionStorage()) {
    return normalizeFaviconPrefs(localRead<unknown>(LOCAL_FAVICON_PREFS_KEY, {}));
  }

  const data = await browser.storage.local.get(EXTENSION_FAVICON_PREFS_KEY);
  return normalizeFaviconPrefs(data?.[EXTENSION_FAVICON_PREFS_KEY]);
}

export async function saveFaviconPrefs(
  nextPrefs: Record<string, string>,
): Promise<Record<string, string>> {
  const normalized = normalizeFaviconPrefs(nextPrefs);

  if (!hasExtensionStorage()) {
    localWrite(LOCAL_FAVICON_PREFS_KEY, normalized);
    return normalized;
  }

  await browser.storage.local.set({ [EXTENSION_FAVICON_PREFS_KEY]: normalized });
  return normalized;
}

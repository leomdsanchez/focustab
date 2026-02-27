import {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  ArrowUpDown,
  Bot,
  CalendarDays,
  ChevronRight,
  Clock3,
  Folder,
  Github,
  Globe,
  GripVertical,
  Grid3x3,
  Image as ImageIcon,
  Linkedin,
  Link2,
  Mail,
  MessageCircle,
  MoreVertical,
  Pin,
  PinOff,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Shuffle,
  Trash2,
  Twitter,
  X,
  Youtube,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  getFaviconPrefs,
  getLinks,
  getSettings,
  sanitizeUrl,
  saveFaviconPrefs,
  saveLinks,
  saveSettings,
  type AppSettings,
  type ClockMode,
  type LinkIconKey,
  type QuickLink,
} from '../../src/lib/storage';

type SettingsView = 'menu' | 'clock' | 'grid' | 'background' | 'links';

interface LinkDraft {
  name: string;
  url: string;
  icon: LinkIconKey;
  useSiteFavicon: boolean;
}

type AddFlowStep = 'url' | 'name' | 'favicon' | 'icon';

interface GridContextMenuState {
  linkId: string;
  x: number;
  y: number;
}

interface BackgroundItem {
  id: string;
  full: string;
  thumb: string;
}

const ICON_BY_KEY: Record<LinkIconKey, LucideIcon> = {
  youtube: Youtube,
  linkedin: Linkedin,
  gmail: Mail,
  github: Github,
  notion: Folder,
  calendar: CalendarDays,
  drive: Folder,
  chatgpt: Bot,
  x: Twitter,
  whatsapp: MessageCircle,
  globe: Globe,
};

const ICON_OPTIONS: Array<{ key: LinkIconKey; icon: LucideIcon; label: string }> = [
  { key: 'globe', icon: Globe, label: 'Web' },
  { key: 'youtube', icon: Youtube, label: 'YouTube' },
  { key: 'linkedin', icon: Linkedin, label: 'LinkedIn' },
  { key: 'gmail', icon: Mail, label: 'Email' },
  { key: 'github', icon: Github, label: 'GitHub' },
  { key: 'notion', icon: Folder, label: 'Docs' },
  { key: 'calendar', icon: CalendarDays, label: 'Agenda' },
  { key: 'chatgpt', icon: Bot, label: 'AI' },
  { key: 'x', icon: Twitter, label: 'X' },
  { key: 'whatsapp', icon: MessageCircle, label: 'Chat' },
];

const BACKGROUND_CACHE_KEY = 'focustab.backgroundCache.v1';
const BACKGROUND_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BACKGROUND_ROTATE_INTERVAL_MS = 3 * 60 * 1000;

function createGradientBackground(seed: string, from: string, to: string, glow: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1200' viewBox='0 0 1920 1200'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='${from}'/><stop offset='100%' stop-color='${to}'/></linearGradient><radialGradient id='r' cx='0.75' cy='0.2' r='0.7'><stop offset='0%' stop-color='${glow}' stop-opacity='0.32'/><stop offset='100%' stop-color='${glow}' stop-opacity='0'/></radialGradient></defs><rect width='1920' height='1200' fill='url(#g)'/><rect width='1920' height='1200' fill='url(#r)'/><text x='1880' y='1160' fill='#0d1118' fill-opacity='0.2' font-size='24' text-anchor='end' font-family='Arial, sans-serif'>${seed}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const FALLBACK_BACKGROUNDS: BackgroundItem[] = [
  {
    id: 'fallback-graphite-1',
    full: createGradientBackground('FocusTab-01', '#0f1117', '#181c24', '#4f86a4'),
    thumb: createGradientBackground('FocusTab-01', '#0f1117', '#181c24', '#4f86a4'),
  },
  {
    id: 'fallback-graphite-2',
    full: createGradientBackground('FocusTab-02', '#0b0d12', '#1b2029', '#3e6b57'),
    thumb: createGradientBackground('FocusTab-02', '#0b0d12', '#1b2029', '#3e6b57'),
  },
  {
    id: 'fallback-graphite-3',
    full: createGradientBackground('FocusTab-03', '#101216', '#1a1f28', '#7b5b3e'),
    thumb: createGradientBackground('FocusTab-03', '#101216', '#1a1f28', '#7b5b3e'),
  },
  {
    id: 'fallback-graphite-4',
    full: createGradientBackground('FocusTab-04', '#0d1015', '#171b22', '#5b5f8f'),
    thumb: createGradientBackground('FocusTab-04', '#0d1015', '#171b22', '#5b5f8f'),
  },
];

function normalizeBackgroundItems(raw: unknown): BackgroundItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const items: BackgroundItem[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const payload = entry as Record<string, unknown>;
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const full = typeof payload.full === 'string' ? payload.full.trim() : '';
    const thumb =
      typeof payload.thumb === 'string' && payload.thumb.trim()
        ? payload.thumb.trim()
        : full;

    if (!id || !full || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    items.push({ id, full, thumb });
  }

  return items;
}

function readBackgroundCache(): { updatedAt: number; items: BackgroundItem[] } {
  try {
    const raw = window.localStorage.getItem(BACKGROUND_CACHE_KEY);
    if (!raw) {
      return { updatedAt: 0, items: [] };
    }

    const parsed = JSON.parse(raw) as { updatedAt?: unknown; items?: unknown };
    const updatedAt = typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
      ? Math.round(parsed.updatedAt)
      : 0;
    const items = normalizeBackgroundItems(parsed.items);
    return { updatedAt, items };
  } catch {
    return { updatedAt: 0, items: [] };
  }
}

function saveBackgroundCache(items: BackgroundItem[]) {
  try {
    window.localStorage.setItem(
      BACKGROUND_CACHE_KEY,
      JSON.stringify({
        updatedAt: Date.now(),
        items,
      }),
    );
  } catch {
    // Ignore storage quota and private mode failures.
  }
}

async function fetchPexelsBackgrounds(signal?: AbortSignal): Promise<BackgroundItem[]> {
  const env = import.meta.env as Record<string, string | undefined>;
  const apiKey = (env.PEXELS_API_KEY ?? env.VITE_PEXELS_API_KEY ?? '').trim();
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      'https://api.pexels.com/v1/search?query=dark%20minimal%20wallpaper&orientation=landscape&size=large&per_page=30',
      {
        headers: {
          Authorization: apiKey,
        },
        signal,
      },
    );
    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      photos?: Array<{
        id?: number;
        src?: Record<string, string | undefined>;
      }>;
    };

    if (!Array.isArray(payload.photos)) {
      return [];
    }

    const items: BackgroundItem[] = [];
    const seen = new Set<string>();
    for (const photo of payload.photos) {
      if (!photo || typeof photo !== 'object') {
        continue;
      }

      const idNumber = typeof photo.id === 'number' && Number.isFinite(photo.id) ? Math.round(photo.id) : null;
      const id = idNumber !== null ? `pexels-${idNumber}` : '';
      const src = photo.src ?? {};
      const full = (src.landscape ?? src.large2x ?? src.large ?? src.original ?? '').trim();
      const thumb = (src.medium ?? src.small ?? src.tiny ?? full).trim();
      if (!id || !full || seen.has(id)) {
        continue;
      }

      seen.add(id);
      items.push({ id, full, thumb });
    }

    return items;
  } catch {
    return [];
  }
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function toSafeInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function getTimeLabel(date: Date, settings: AppSettings) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: settings.showSeconds ? '2-digit' : undefined,
    hour12: settings.clockMode === '12h',
  }).format(date);
}

function isBottomRightZone(clientX: number, clientY: number) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const col = Math.min(3, Math.floor((clientX / width) * 4));
  const row = Math.min(2, Math.floor((clientY / height) * 3));

  return col === 3 && row === 2;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
}

function createLinkId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getFaviconCandidates(url: string) {
  const sanitized = sanitizeUrl(url) ?? url;
  const hostname = getHostname(sanitized);
  let origin = '';
  try {
    origin = new URL(sanitized).origin;
  } catch {
    origin = `https://${hostname}`;
  }

  const candidates = [
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `${origin}/favicon.svg`,
    `${origin}/apple-touch-icon.png`,
    `${origin}/assets/favicons/favicon2.ico`,
    `${origin}/assets/favicons/apple-touch-icon.webp`,
    `${origin}/assets/favicons/android-chrome-192x192.webp`,
    `${origin}/assets/favicons/android-chrome-512x512.webp`,
    `${origin}/vite.svg`,
    `https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(sanitized)}`,
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(sanitized)}&size=256`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
  ];

  return Array.from(new Set(candidates.filter(Boolean)));
}

function getRenderableFaviconCandidates(url: string, preferredFaviconUrl?: string) {
  const base = getFaviconCandidates(url);
  const preferred = preferredFaviconUrl?.trim();
  if (!preferred) {
    return base;
  }

  return Array.from(new Set([preferred, ...base]));
}

function withCacheBuster(url: string, refreshKey: number, attempt: number) {
  if (refreshKey <= 0) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}v=${refreshKey}-${attempt}`;
}

function scoreFaviconCandidate(url: string, width: number, height: number, targetHostname: string) {
  const isSvg = /\.svg(\?|$)/i.test(url);
  const safeWidth = width > 0 ? width : isSvg ? 64 : 0;
  const safeHeight = height > 0 ? height : isSvg ? 64 : 0;

  if (safeWidth < 12 || safeHeight < 12) {
    return -1000;
  }

  const min = Math.min(safeWidth, safeHeight);
  const max = Math.max(safeWidth, safeHeight);
  const ratio = min / max;
  let score = min * 2 + ratio * 40;

  const candidateHostname = getHostname(url);
  const sameDomain =
    candidateHostname === targetHostname ||
    candidateHostname.endsWith(`.${targetHostname}`) ||
    targetHostname.endsWith(`.${candidateHostname}`);

  if (sameDomain) {
    score += 90;
  }
  if (/favicon(\.|-|$)/i.test(url)) {
    score += 16;
  }
  if (/apple-touch-icon|icon-192|icon-512|maskable/i.test(url)) {
    score += 18;
  }
  if (/vite\.svg(\?|$)/i.test(url)) {
    score += 12;
  }
  if (isSvg) {
    score += 6;
  }
  if (/google\.com\/s2\/favicons/i.test(url) && /[?&]domain_url=/i.test(url)) {
    score += 24;
  }
  if (/gstatic\.com\/faviconV2/i.test(url) && /[?&]url=/i.test(url)) {
    score += 24;
  }
  if (/google\.com\/s2\/favicons/i.test(url) && /[?&]domain=/i.test(url)) {
    score -= 20;
  }
  if (/google\.com\/s2|duckduckgo\.com\/ip3/i.test(url)) {
    score -= 70;
  }
  if (/favicon\.ico(\?|$)/i.test(url)) {
    score -= 4;
  }

  return score;
}

function loadImageDimensions(url: string, timeoutMs = 2500) {
  return new Promise<{ ok: boolean; width: number; height: number }>((resolve) => {
    const image = new Image();
    let done = false;

    const finish = (ok: boolean, width = 0, height = 0) => {
      if (done) {
        return;
      }
      done = true;
      window.clearTimeout(timer);
      resolve({ ok, width, height });
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = () => finish(true, image.naturalWidth || 0, image.naturalHeight || 0);
    image.onerror = () => finish(false);
    image.referrerPolicy = 'no-referrer';
    image.src = url;
  });
}

function isLowQualityGoogleDomainFavicon(url: string) {
  return /google\.com\/s2\/favicons/i.test(url) && /[?&]domain=/.test(url) && !/[?&]domain_url=/.test(url);
}

function isLowQualityProviderFavicon(url: string, width: number, height: number) {
  const minSide = Math.min(width, height);
  if (minSide <= 0) {
    return false;
  }

  if (/google\.com\/s2\/favicons|gstatic\.com\/faviconV2|duckduckgo\.com\/ip3/i.test(url)) {
    return minSide <= 20;
  }

  return false;
}

function parseClipboardLink(raw: string): { url: string; name?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const urlPattern =
    /(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)/i;
  const fromRegex = trimmed.match(urlPattern)?.[0];

  const urlCandidate =
    lines.find((line) => sanitizeUrl(line)) ??
    fromRegex ??
    trimmed.split(/\s+/).find((token) => sanitizeUrl(token));

  if (!urlCandidate) {
    return null;
  }

  const sanitized = sanitizeUrl(urlCandidate);
  if (!sanitized) {
    return null;
  }

  const firstLine = lines[0];
  const name =
    firstLine && sanitizeUrl(firstLine) === null
      ? firstLine.slice(0, 60)
      : undefined;

  return { url: sanitized, name };
}

function chunkByRows<T>(items: T[], rowsPerColumn: number) {
  if (rowsPerColumn <= 0 || items.length === 0) {
    return [] as T[][];
  }

  const columns: T[][] = [];
  for (let index = 0; index < items.length; index += rowsPerColumn) {
    columns.push(items.slice(index, index + rowsPerColumn));
  }

  return columns;
}

const RECENT_ACCESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function pruneRecentAccessLog(accessLog: number[], nowTs: number) {
  const minTs = nowTs - RECENT_ACCESS_WINDOW_MS;
  return accessLog.filter((value) => Number.isFinite(value) && value >= minTs && value <= nowTs + 60_000);
}

function getRecentAccessCount(link: QuickLink, nowTs: number) {
  return pruneRecentAccessLog(link.accessLog, nowTs).length;
}

function orderLinksByMode(links: QuickLink[], mode: AppSettings['linksSortMode'], nowTs: number) {
  if (mode === 'most_accessed') {
    return [...links].sort(
      (a, b) =>
        getRecentAccessCount(b, nowTs) - getRecentAccessCount(a, nowTs) ||
        a.order - b.order ||
        a.createdAt - b.createdAt,
    );
  }

  return [...links].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function reorderById(items: QuickLink[], draggedId: string, targetId: string) {
  const fromIndex = items.findIndex((item) => item.id === draggedId);
  const toIndex = items.findIndex((item) => item.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('menu');
  const [showSettingsTrigger, setShowSettingsTrigger] = useState(false);
  const [query, setQuery] = useState('');
  const [faviconFallbackOffsetByLink, setFaviconFallbackOffsetByLink] = useState<Record<string, number>>({});
  const [faviconChoiceByLink, setFaviconChoiceByLink] = useState<Record<string, string>>({});
  const [faviconRefreshKey, setFaviconRefreshKey] = useState(0);
  const [faviconRefreshState, setFaviconRefreshState] = useState<'idle' | 'loading' | 'done'>(
    'idle',
  );
  const [faviconRefreshProgress, setFaviconRefreshProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft>({
    name: '',
    url: '',
    icon: 'globe',
    useSiteFavicon: true,
  });
  const [linkFormError, setLinkFormError] = useState('');
  const [draggedLinkId, setDraggedLinkId] = useState<string | null>(null);
  const [linksPanelMode, setLinksPanelMode] = useState<'overview' | 'add' | 'manage'>('overview');
  const [addFlowStep, setAddFlowStep] = useState<AddFlowStep>('url');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [openLinkMenuId, setOpenLinkMenuId] = useState<string | null>(null);
  const [pendingDeleteLinkId, setPendingDeleteLinkId] = useState<string | null>(null);
  const [gridContextMenu, setGridContextMenu] = useState<GridContextMenuState | null>(null);
  const [backgroundItems, setBackgroundItems] = useState<BackgroundItem[]>(() => {
    const cached = readBackgroundCache();
    return cached.items.length > 0 ? cached.items : FALLBACK_BACKGROUNDS;
  });
  const [backgroundIndex, setBackgroundIndex] = useState(0);
  const [backgroundFeedState, setBackgroundFeedState] = useState<'idle' | 'loading' | 'error'>('idle');

  const queryTimerRef = useRef<number | null>(null);
  const faviconFeedbackTimerRef = useRef<number | null>(null);
  const deleteConfirmTimerRef = useRef<number | null>(null);
  const linkMenuRootRef = useRef<HTMLDivElement | null>(null);
  const gridContextMenuRef = useRef<HTMLDivElement | null>(null);
  const linksViewportRef = useRef<HTMLDivElement | null>(null);
  const scrollTargetRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const lastWheelTsRef = useRef(0);
  const lastWheelDeltaRef = useRef(0);
  const snapPointsRef = useRef<number[]>([0]);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(0);

  useEffect(() => {
    const intervalMs = settings.showSeconds ? 1000 : 15000;
    const tick = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(tick);
  }, [settings.showSeconds]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      const [savedSettings, savedLinks, savedFaviconPrefs] = await Promise.all([
        getSettings(),
        getLinks(),
        getFaviconPrefs(),
      ]);
      if (!mounted) {
        return;
      }

      const sanitizedFaviconPrefs = Object.fromEntries(
        Object.entries(savedFaviconPrefs).filter(([, value]) => !isLowQualityGoogleDomainFavicon(value)),
      );

      setSettings(savedSettings);
      setLinks(savedLinks);
      setFaviconChoiceByLink(sanitizedFaviconPrefs);
      if (Object.keys(sanitizedFaviconPrefs).length !== Object.keys(savedFaviconPrefs).length) {
        void saveFaviconPrefs(sanitizedFaviconPrefs);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const cached = readBackgroundCache();
    if (cached.items.length > 0) {
      setBackgroundItems(cached.items);
    }

    const stale = !cached.updatedAt || Date.now() - cached.updatedAt > BACKGROUND_CACHE_TTL_MS;
    if (!stale) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setBackgroundFeedState('loading');
    void (async () => {
      const fetched = await fetchPexelsBackgrounds(controller.signal);
      if (cancelled) {
        return;
      }

      if (fetched.length > 0) {
        setBackgroundItems(fetched);
        saveBackgroundCache(fetched);
        setBackgroundFeedState('idle');
        return;
      }

      setBackgroundFeedState(cached.items.length > 0 ? 'idle' : 'error');
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(
    () => () => {
      if (faviconFeedbackTimerRef.current !== null) {
        window.clearTimeout(faviconFeedbackTimerRef.current);
      }
      if (deleteConfirmTimerRef.current !== null) {
        window.clearTimeout(deleteConfirmTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (deleteConfirmTimerRef.current !== null) {
      window.clearTimeout(deleteConfirmTimerRef.current);
      deleteConfirmTimerRef.current = null;
    }

    if (!pendingDeleteLinkId) {
      return;
    }

    deleteConfirmTimerRef.current = window.setTimeout(() => {
      setPendingDeleteLinkId((current) => (current === pendingDeleteLinkId ? null : current));
      deleteConfirmTimerRef.current = null;
    }, 2000);
  }, [pendingDeleteLinkId]);

  useEffect(() => {
    if (!openLinkMenuId) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const root = linkMenuRootRef.current;
      if (!root) {
        return;
      }

      const rect = root.getBoundingClientRect();
      const dx =
        event.clientX < rect.left
          ? rect.left - event.clientX
          : event.clientX > rect.right
            ? event.clientX - rect.right
            : 0;
      const dy =
        event.clientY < rect.top
          ? rect.top - event.clientY
          : event.clientY > rect.bottom
            ? event.clientY - rect.bottom
            : 0;

      if (Math.hypot(dx, dy) > 120) {
        setOpenLinkMenuId(null);
        setPendingDeleteLinkId(null);
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      const root = linkMenuRootRef.current;
      if (!root || !(event.target instanceof Node)) {
        return;
      }

      if (!root.contains(event.target)) {
        setOpenLinkMenuId(null);
        setPendingDeleteLinkId(null);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [openLinkMenuId]);

  useEffect(() => {
    if (!gridContextMenu) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const menu = gridContextMenuRef.current;
      if (!menu || !(event.target instanceof Node)) {
        return;
      }

      if (!menu.contains(event.target)) {
        setGridContextMenu(null);
      }
    };

    const onGlobalContext = (event: MouseEvent) => {
      const menu = gridContextMenuRef.current;
      if (!menu || !(event.target instanceof Node)) {
        return;
      }

      if (!menu.contains(event.target)) {
        setGridContextMenu(null);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGridContextMenu(null);
      }
    };

    const close = () => setGridContextMenu(null);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('contextmenu', onGlobalContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('resize', close);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('contextmenu', onGlobalContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
    };
  }, [gridContextMenu]);

  useEffect(() => {
    if (settingsOpen) {
      setGridContextMenu(null);
    }
  }, [settingsOpen]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      setShowSettingsTrigger(isBottomRightZone(event.clientX, event.clientY));
    };

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'v' &&
        !settingsOpen &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        if (navigator.clipboard?.readText) {
          void navigator.clipboard
            .readText()
            .then((text) => {
              startAddFlowFromRaw(text, true);
            })
            .catch(() => {
              // Ignore clipboard permission errors.
            });
        }
        return;
      }

      if (event.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false);
          setSettingsView('menu');
          return;
        }

        setQuery('');
        return;
      }

      if (settingsOpen || isTypingTarget(event.target)) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'Enter') {
        const queryNormalized = normalizeText(query.trim());
        const orderedForLookup = orderLinksByMode(
          links,
          settings.linksSortMode ?? DEFAULT_SETTINGS.linksSortMode,
          now.getTime(),
        );
        const topMatch =
          queryNormalized.length > 0
            ? orderedForLookup.find((link) => {
                const searchable = `${link.name} ${getHostname(link.url)} ${link.tags.join(' ')}`;
                return normalizeText(searchable).includes(queryNormalized);
              })
            : null;
        if (query.trim() && topMatch) {
          event.preventDefault();
          void onOpenLink(topMatch);
          return;
        }

        const queryAsUrl = sanitizeUrl(query.trim());
        if (query.trim() && queryAsUrl) {
          event.preventDefault();
          openAddLinkFlow({
            initialUrl: queryAsUrl,
            initialName: '',
            skipUrlStep: true,
          });
          setQuery('');
        }
        return;
      }

      if (event.key === 'Backspace') {
        setQuery((current) => {
          if (!current) {
            return current;
          }

          event.preventDefault();
          return current.slice(0, -1);
        });
        return;
      }

      if (event.key.length === 1 && /[a-zA-Z0-9 ._-]/.test(event.key)) {
        event.preventDefault();
        setQuery((current) => `${current}${event.key}`.slice(0, 36));

        if (queryTimerRef.current) {
          window.clearTimeout(queryTimerRef.current);
        }

        queryTimerRef.current = window.setTimeout(() => {
          setQuery('');
        }, 2200);
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      if (settingsOpen || isTypingTarget(event.target)) {
        return;
      }

      const text = event.clipboardData?.getData('text')?.trim() ?? '';
      if (!text) {
        return;
      }

      event.preventDefault();
      startAddFlowFromRaw(text, true);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('paste', onPaste);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onGlobalKeyDown);
      window.removeEventListener('paste', onPaste);
      if (queryTimerRef.current) {
        window.clearTimeout(queryTimerRef.current);
      }
    };
  }, [settingsOpen, links, query, settings.linksSortMode, now]);

  const clockText = useMemo(() => getTimeLabel(now, settings), [now, settings]);

  const displayLinks = useMemo(
    () =>
      orderLinksByMode(links, settings.linksSortMode ?? DEFAULT_SETTINGS.linksSortMode, now.getTime()),
    [links, settings.linksSortMode, now],
  );

  const filteredLinks = useMemo(() => {
    const queryNormalized = normalizeText(query.trim());
    if (!queryNormalized) {
      return displayLinks;
    }

    return displayLinks.filter((link) => {
      const searchable = `${link.name} ${getHostname(link.url)} ${link.tags.join(' ')}`;
      return normalizeText(searchable).includes(queryNormalized);
    });
  }, [displayLinks, query]);

  useEffect(() => {
    const validIds = new Set(links.map((link) => link.id));
    const entries = Object.entries(faviconChoiceByLink).filter(([linkId]) => validIds.has(linkId));
    if (entries.length === Object.keys(faviconChoiceByLink).length) {
      return;
    }

    const pruned = Object.fromEntries(entries);
    void persistFaviconChoices(pruned);
  }, [links, faviconChoiceByLink]);

  const safeGridRows = toSafeInt(settings.gridRows, 1, 8, DEFAULT_SETTINGS.gridRows);
  const safeGridCols = toSafeInt(settings.gridCols, 1, 12, DEFAULT_SETTINGS.gridCols);
  const safeIconSize = toSafeInt(settings.iconSize, 40, 140, DEFAULT_SETTINGS.iconSize);
  const safeClockScale = toSafeInt(settings.clockScale, 60, 150, DEFAULT_SETTINGS.clockScale);
  const safeBackgroundOpacity = toSafeInt(
    settings.backgroundOpacity,
    35,
    92,
    DEFAULT_SETTINGS.backgroundOpacity,
  );
  const safeBackgroundMode = settings.backgroundMode === 'pinned' ? 'pinned' : 'rotating';
  const activeBackground =
    backgroundItems[Math.max(0, Math.min(backgroundIndex, backgroundItems.length - 1))] ?? null;
  const isCurrentBackgroundPinned =
    safeBackgroundMode === 'pinned' && !!activeBackground && settings.pinnedBackgroundId === activeBackground.id;

  useEffect(() => {
    if (backgroundItems.length === 0) {
      setBackgroundIndex(0);
      return;
    }

    setBackgroundIndex((current) => Math.min(current, backgroundItems.length - 1));
  }, [backgroundItems.length]);

  useEffect(() => {
    if (safeBackgroundMode !== 'rotating' || backgroundItems.length < 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setBackgroundIndex((current) => (current + 1) % backgroundItems.length);
    }, BACKGROUND_ROTATE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [safeBackgroundMode, backgroundItems.length]);

  useEffect(() => {
    if (safeBackgroundMode !== 'pinned' || backgroundItems.length === 0) {
      return;
    }

    if (settings.pinnedBackgroundId) {
      const pinnedIndex = backgroundItems.findIndex((item) => item.id === settings.pinnedBackgroundId);
      if (pinnedIndex >= 0) {
        if (pinnedIndex !== backgroundIndex) {
          setBackgroundIndex(pinnedIndex);
        }
        return;
      }
    }

    const fallback = backgroundItems[Math.min(backgroundIndex, backgroundItems.length - 1)] ?? backgroundItems[0];
    if (fallback && settings.pinnedBackgroundId !== fallback.id) {
      void persistSettings({ pinnedBackgroundId: fallback.id });
    }
  }, [safeBackgroundMode, settings.pinnedBackgroundId, backgroundItems, backgroundIndex]);

  const linkColumns = useMemo(
    () => chunkByRows(filteredLinks, safeGridRows),
    [filteredLinks, safeGridRows],
  );

  const tileWidth = Math.max(94, safeIconSize + 34);
  const gridGapX = 10;
  const columnStep = tileWidth + gridGapX;
  const totalColumns = linkColumns.length;
  const usedCols = Math.max(1, Math.min(safeGridCols, Math.max(totalColumns, 1)));
  const contentWidth =
    totalColumns > 0
      ? totalColumns * tileWidth + Math.max(0, totalColumns - 1) * gridGapX
      : tileWidth;
  const visibleWidth = usedCols * tileWidth + Math.max(0, usedCols - 1) * gridGapX;
  const viewportHintWidth = Math.min(contentWidth, visibleWidth);

  const findNearestSnapIndex = useCallback((left: number) => {
    const points = snapPointsRef.current;
    if (points.length <= 1) {
      return 0;
    }

    let nearest = 0;
    let nearestDistance = Math.abs(points[0] - left);
    for (let index = 1; index < points.length; index += 1) {
      const distance = Math.abs(points[index] - left);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }

    return nearest;
  }, []);

  const findDirectionalSnapIndex = useCallback(
    (left: number, direction: number) => {
      const points = snapPointsRef.current;
      if (points.length <= 1 || direction === 0) {
        return findNearestSnapIndex(left);
      }

      if (direction > 0) {
        for (let index = 0; index < points.length; index += 1) {
          if (points[index] >= left) {
            return index;
          }
        }

        return points.length - 1;
      }

      for (let index = points.length - 1; index >= 0; index -= 1) {
        if (points[index] <= left) {
          return index;
        }
      }

      return 0;
    },
    [findNearestSnapIndex],
  );

  const recalcSnapPoints = useCallback(() => {
    const viewport = linksViewportRef.current;
    if (!viewport) {
      snapPointsRef.current = [0];
      setPageCount(1);
      setActivePage(0);
      return [0];
    }

    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (!Number.isFinite(columnStep) || columnStep <= 0 || !Number.isFinite(maxLeft) || maxLeft <= 0) {
      snapPointsRef.current = [0];
      setPageCount(1);
      setActivePage(0);
      return [0];
    }

    const columnsPerPage = Math.max(1, Math.round(viewport.clientWidth / columnStep));
    const pageStep = Math.max(columnStep, columnsPerPage * columnStep);
    const points: number[] = [];
    if (!Number.isFinite(pageStep) || pageStep <= 0) {
      snapPointsRef.current = [0];
      setPageCount(1);
      setActivePage(0);
      return [0];
    }

    let safety = 0;
    for (let left = 0; left <= maxLeft && safety < 5000; left += pageStep) {
      points.push(Math.min(maxLeft, left));
      safety += 1;
    }

    if (Math.abs(points[points.length - 1] - maxLeft) > 0.5) {
      points.push(maxLeft);
    }

    snapPointsRef.current = points;
    setPageCount(points.length);
    setActivePage(findNearestSnapIndex(viewport.scrollLeft));
    return points;
  }, [columnStep, findNearestSnapIndex]);

  useEffect(() => {
    const viewport = linksViewportRef.current;
    if (!viewport) {
      return;
    }

    if (scrollRafRef.current) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }

    recalcSnapPoints();
    scrollTargetRef.current = 0;
    viewport.scrollLeft = 0;
    setActivePage(0);
  }, [query, safeGridRows, safeIconSize, safeGridCols, filteredLinks.length, recalcSnapPoints]);

  useEffect(() => {
    const animateScroll = () => {
      const viewport = linksViewportRef.current;
      if (!viewport) {
        scrollRafRef.current = null;
        return;
      }

      const currentLeft = viewport.scrollLeft;
      const targetLeft = scrollTargetRef.current;
      const delta = targetLeft - currentLeft;

      if (Math.abs(delta) < 0.4) {
        viewport.scrollLeft = targetLeft;

        const idleMs = performance.now() - lastWheelTsRef.current;
        if (idleMs <= 85) {
          scrollRafRef.current = window.requestAnimationFrame(animateScroll);
          return;
        }

        const points = recalcSnapPoints();
        const direction = Math.sign(lastWheelDeltaRef.current);
        const snappedIndex =
          direction === 0
            ? findNearestSnapIndex(targetLeft)
            : findDirectionalSnapIndex(targetLeft, direction);
        const snappedLeft = points[snappedIndex] ?? 0;

        if (Math.abs(snappedLeft - targetLeft) > 0.4) {
          scrollTargetRef.current = snappedLeft;
          setActivePage(snappedIndex);
          scrollRafRef.current = window.requestAnimationFrame(animateScroll);
          return;
        }

        setActivePage(snappedIndex);
        lastWheelDeltaRef.current = 0;
        scrollRafRef.current = null;
        return;
      }

      viewport.scrollLeft = currentLeft + delta * 0.26;
      scrollRafRef.current = window.requestAnimationFrame(animateScroll);
    };

    const onGlobalWheel = (event: WheelEvent) => {
      if (settingsOpen) {
        return;
      }

      const viewport = linksViewportRef.current;
      if (!viewport) {
        return;
      }

      if (viewport.scrollWidth <= viewport.clientWidth + 2) {
        setPageCount(1);
        setActivePage(0);
        return;
      }

      const rawDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      const deltaMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientWidth
            : 1;
      const normalizedDelta = rawDelta * deltaMultiplier;

      if (Math.abs(normalizedDelta) < 0.5) {
        return;
      }

      const points = recalcSnapPoints();
      const baseTarget =
        scrollRafRef.current !== null ? scrollTargetRef.current : viewport.scrollLeft;
      const direction = Math.sign(normalizedDelta);
      const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const freeTarget = Math.min(maxLeft, Math.max(0, baseTarget + normalizedDelta * 0.16));

      const nearestIndex = findNearestSnapIndex(freeTarget);
      const nearestPoint = points[nearestIndex] ?? 0;
      const directionalIndex = findDirectionalSnapIndex(freeTarget, direction);
      const directionalPoint = points[directionalIndex] ?? nearestPoint;
      const magnetRadius = Math.max(28, columnStep * 0.22);

      let nextTarget = freeTarget;
      if (Math.abs(nearestPoint - freeTarget) <= magnetRadius) {
        nextTarget = nearestPoint;
      } else if (Math.abs(directionalPoint - freeTarget) <= magnetRadius * 1.5) {
        nextTarget = directionalPoint;
      }

      event.preventDefault();
      lastWheelTsRef.current = performance.now();
      lastWheelDeltaRef.current = normalizedDelta;
      scrollTargetRef.current = nextTarget;
      setActivePage(findNearestSnapIndex(nextTarget));

      if (scrollRafRef.current === null) {
        scrollRafRef.current = window.requestAnimationFrame(animateScroll);
      }
    };

    window.addEventListener('wheel', onGlobalWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onGlobalWheel);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [
    settingsOpen,
    columnStep,
    recalcSnapPoints,
    findNearestSnapIndex,
    findDirectionalSnapIndex,
  ]);

  useEffect(() => {
    const viewport = linksViewportRef.current;
    if (!viewport) {
      return;
    }

    let rafId: number | null = null;
    const onViewportScroll = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      rafId = window.requestAnimationFrame(() => {
        setActivePage(findNearestSnapIndex(viewport.scrollLeft));
      });
    };

    const onResize = () => {
      recalcSnapPoints();
    };

    viewport.addEventListener('scroll', onViewportScroll, { passive: true });
    window.addEventListener('resize', onResize);
    recalcSnapPoints();

    return () => {
      viewport.removeEventListener('scroll', onViewportScroll);
      window.removeEventListener('resize', onResize);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [findNearestSnapIndex, recalcSnapPoints]);

  function scrollToPage(pageIndex: number) {
    const points = snapPointsRef.current;
    if (points.length === 0) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(pageIndex, points.length - 1));
    const target = points[clampedIndex] ?? 0;

    lastWheelTsRef.current = 0;
    scrollTargetRef.current = target;
    setActivePage(clampedIndex);

    if (scrollRafRef.current === null) {
      const animate = () => {
        const viewport = linksViewportRef.current;
        if (!viewport) {
          scrollRafRef.current = null;
          return;
        }

        const delta = scrollTargetRef.current - viewport.scrollLeft;
        if (Math.abs(delta) < 0.4) {
          viewport.scrollLeft = scrollTargetRef.current;
          scrollRafRef.current = null;
          return;
        }

        viewport.scrollLeft += delta * 0.22;
        scrollRafRef.current = window.requestAnimationFrame(animate);
      };

      scrollRafRef.current = window.requestAnimationFrame(animate);
    }
  }

  async function persistSettings(nextPatch: Partial<AppSettings>) {
    const next = await saveSettings(nextPatch);
    setSettings(next);
  }

  async function persistLinks(nextLinks: QuickLink[]) {
    const ordered = nextLinks.map((link, index) => ({ ...link, order: index }));
    const saved = await saveLinks(ordered);
    setLinks(saved);
  }

  async function persistFaviconChoices(nextChoices: Record<string, string>) {
    const saved = await saveFaviconPrefs(nextChoices);
    setFaviconChoiceByLink(saved);
  }

  async function refreshBackgrounds() {
    if (backgroundFeedState === 'loading') {
      return;
    }

    const controller = new AbortController();
    setBackgroundFeedState('loading');
    const fetched = await fetchPexelsBackgrounds(controller.signal);
    if (fetched.length === 0) {
      setBackgroundFeedState('error');
      return;
    }

    setBackgroundItems(fetched);
    saveBackgroundCache(fetched);
    setBackgroundFeedState('idle');
  }

  function showNextBackground() {
    if (backgroundItems.length < 2) {
      return;
    }

    const nextIndex = (backgroundIndex + 1) % backgroundItems.length;
    setBackgroundIndex(nextIndex);

    if (safeBackgroundMode === 'pinned') {
      const nextItem = backgroundItems[nextIndex];
      if (nextItem) {
        void persistSettings({ pinnedBackgroundId: nextItem.id });
      }
    }
  }

  function setBackgroundMode(mode: 'rotating' | 'pinned') {
    if (mode === 'pinned') {
      const pinId = activeBackground?.id ?? backgroundItems[0]?.id ?? null;
      void persistSettings({ backgroundMode: 'pinned', pinnedBackgroundId: pinId });
      return;
    }

    void persistSettings({ backgroundMode: 'rotating' });
  }

  function onFaviconError(linkId: string, candidateCount: number) {
    setFaviconFallbackOffsetByLink((current) => {
      const currentOffset = current[linkId] ?? 0;
      const maxOffset = Math.max(0, candidateCount - 1);
      const nextOffset = Math.min(currentOffset + 1, maxOffset);
      if (nextOffset === currentOffset) {
        return current;
      }
      return { ...current, [linkId]: nextOffset };
    });
  }

  function onFaviconLoad(
    linkId: string,
    resolvedFaviconUrl: string,
    candidateCount: number,
    width: number,
    height: number,
  ) {
    if (isLowQualityProviderFavicon(resolvedFaviconUrl, width, height)) {
      onFaviconError(linkId, candidateCount);
      return;
    }

    const hadFallback = (faviconFallbackOffsetByLink[linkId] ?? 0) > 0;
    const previousChoice = faviconChoiceByLink[linkId];

    setFaviconFallbackOffsetByLink((current) => {
      if (!current[linkId]) {
        return current;
      }

      const next = { ...current };
      delete next[linkId];
      return next;
    });

    if (!hadFallback && !previousChoice) {
      return;
    }

    if (previousChoice === resolvedFaviconUrl) {
      return;
    }

    const nextChoices = { ...faviconChoiceByLink, [linkId]: resolvedFaviconUrl };
    void persistFaviconChoices(nextChoices);
  }

  async function resolveBestFaviconUrl(link: QuickLink, refreshSeed: number) {
    const candidates = getRenderableFaviconCandidates(link.url, faviconChoiceByLink[link.id]);
    const targetHostname = getHostname(link.url);
    let bestUrl: string | null = null;
    let bestScore = -Infinity;

    for (let index = 0; index < candidates.length; index += 1) {
      const source = withCacheBuster(candidates[index], refreshSeed, index);
      const result = await loadImageDimensions(source, 2200);
      if (!result.ok) {
        continue;
      }

      const score = scoreFaviconCandidate(candidates[index], result.width, result.height, targetHostname);
      if (score > bestScore) {
        bestScore = score;
        bestUrl = candidates[index];
      }
    }

    return bestUrl;
  }

  async function refreshFavicons() {
    if (faviconRefreshState === 'loading') {
      return;
    }

    if (faviconFeedbackTimerRef.current !== null) {
      window.clearTimeout(faviconFeedbackTimerRef.current);
    }

    const refreshableLinks = links.filter((link) => link.useSiteFavicon !== false);
    setFaviconRefreshState('loading');
    setFaviconRefreshProgress({ done: 0, total: refreshableLinks.length });
    setFaviconFallbackOffsetByLink({});
    const refreshSeed = Date.now();
    setFaviconRefreshKey(refreshSeed);

    const nextChoices = { ...faviconChoiceByLink };
    for (let index = 0; index < refreshableLinks.length; index += 1) {
      const link = refreshableLinks[index];
      const bestUrl = await resolveBestFaviconUrl(link, refreshSeed);
      if (bestUrl !== null) {
        nextChoices[link.id] = bestUrl;
      }

      setFaviconRefreshProgress({ done: index + 1, total: refreshableLinks.length });
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    }

    await persistFaviconChoices(nextChoices);
    setFaviconRefreshState('done');
    setFaviconRefreshProgress({
      done: refreshableLinks.length,
      total: refreshableLinks.length,
    });

    faviconFeedbackTimerRef.current = window.setTimeout(() => {
      setFaviconRefreshState('idle');
      setFaviconRefreshProgress(null);
      faviconFeedbackTimerRef.current = null;
    }, 900);
  }

  useEffect(() => {
    if (faviconRefreshState === 'loading') {
      return;
    }

    const pendingLinks = links.filter(
      (link) => link.useSiteFavicon !== false && !faviconChoiceByLink[link.id],
    );
    if (pendingLinks.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const nextChoices = { ...faviconChoiceByLink };
      let changed = false;

      for (const link of pendingLinks) {
        if (cancelled) {
          return;
        }

        const bestUrl = await resolveBestFaviconUrl(link, 0);
        if (bestUrl && nextChoices[link.id] !== bestUrl) {
          nextChoices[link.id] = bestUrl;
          changed = true;
        }
      }

      if (!cancelled && changed) {
        await persistFaviconChoices(nextChoices);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [links, faviconChoiceByLink, faviconRefreshState]);

  function resetLinkDraft() {
    setLinkDraft({ name: '', url: '', icon: 'globe', useSiteFavicon: true });
  }

  function openAddLinkFlow(params: {
    initialUrl?: string;
    initialName?: string;
    skipUrlStep: boolean;
  }) {
    const sanitizedUrl = params.initialUrl ? sanitizeUrl(params.initialUrl) : null;
    const fallbackName = sanitizedUrl ? getHostname(sanitizedUrl) : '';
    const initialName = params.initialName?.trim() ?? '';

    setSettingsOpen(true);
    setSettingsView('links');
    setLinksPanelMode('add');
    setEditingLinkId(null);
    setOpenLinkMenuId(null);
    setPendingDeleteLinkId(null);
    setLinkFormError('');
    setLinkDraft({
      name: initialName || fallbackName,
      url: sanitizedUrl ?? '',
      icon: 'globe',
      useSiteFavicon: true,
    });
    setAddFlowStep(params.skipUrlStep && sanitizedUrl ? 'name' : 'url');
  }

  function startAddFlowFromRaw(raw: string, skipUrlStep: boolean) {
    const parsed = parseClipboardLink(raw);
    if (!parsed) {
      return;
    }

    openAddLinkFlow({
      initialUrl: parsed.url,
      initialName: parsed.name ?? '',
      skipUrlStep,
    });
  }

  function goToAddStep(step: AddFlowStep) {
    setLinkFormError('');
    setAddFlowStep(step);
  }

  function onAddFlowUrlNext() {
    const sanitizedUrl = sanitizeUrl(linkDraft.url);
    if (!sanitizedUrl) {
      setLinkFormError('URL invalida');
      return;
    }

    const fallbackName = getHostname(sanitizedUrl);
    setLinkDraft((current) => ({
      ...current,
      url: sanitizedUrl,
      name: current.name.trim() || fallbackName,
    }));
    goToAddStep('name');
  }

  function onAddFlowNameNext() {
    const sanitizedUrl = sanitizeUrl(linkDraft.url);
    if (!sanitizedUrl) {
      setLinkFormError('URL invalida');
      goToAddStep('url');
      return;
    }

    const finalName = linkDraft.name.trim() || getHostname(sanitizedUrl);
    setLinkDraft((current) => ({ ...current, url: sanitizedUrl, name: finalName }));
    goToAddStep('favicon');
  }

  async function saveDraftLink() {
    const sanitizedUrl = sanitizeUrl(linkDraft.url);
    if (!sanitizedUrl) {
      setLinkFormError('URL invalida');
      return false;
    }

    const fallbackName = getHostname(sanitizedUrl);
    const finalName = linkDraft.name.trim() || fallbackName;
    const duplicate = links.some(
      (link) => link.id !== editingLinkId && link.url === sanitizedUrl,
    );
    if (duplicate) {
      setLinkFormError('Link ja existe');
      return false;
    }

    if (editingLinkId) {
      const updated = links.map((link) =>
        link.id === editingLinkId
          ? {
              ...link,
              name: finalName,
              url: sanitizedUrl,
              icon: linkDraft.icon,
              useSiteFavicon: linkDraft.useSiteFavicon,
              tags: [fallbackName],
            }
          : link,
      );

      await persistLinks(updated);
      setEditingLinkId(null);
      setLinksPanelMode('manage');
    } else {
      const nextLink: QuickLink = {
        id: createLinkId(),
        name: finalName,
        url: sanitizedUrl,
        icon: linkDraft.icon,
        useSiteFavicon: linkDraft.useSiteFavicon,
        tags: [fallbackName],
        order: links.length,
        createdAt: Date.now(),
        accessLog: [],
      };

      await persistLinks([...links, nextLink]);
      setLinksPanelMode('manage');
    }

    setLinkFormError('');
    resetLinkDraft();
    setAddFlowStep('url');
    return true;
  }

  async function onCreateLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraftLink();
  }

  async function onAddFlowFaviconNext() {
    if (linkDraft.useSiteFavicon) {
      await saveDraftLink();
      return;
    }

    goToAddStep('icon');
  }

  async function onAddFlowIconSave() {
    await saveDraftLink();
  }

  async function onDeleteLink(linkId: string) {
    await persistLinks(links.filter((link) => link.id !== linkId));
    if (editingLinkId === linkId) {
      setEditingLinkId(null);
      resetLinkDraft();
      setLinkFormError('');
      setAddFlowStep('url');
    }
  }

  async function onOpenLink(link: QuickLink) {
    const nowTs = Date.now();
    try {
      const nextLinks = links.map((item) => {
        const prunedLog = pruneRecentAccessLog(item.accessLog, nowTs);
        if (item.id === link.id) {
          return { ...item, accessLog: [...prunedLog, nowTs] };
        }

        if (prunedLog.length !== item.accessLog.length) {
          return { ...item, accessLog: prunedLog };
        }

        return item;
      });
      await persistLinks(nextLinks);
    } finally {
      window.location.assign(link.url);
    }
  }

  async function onDropLink(targetId: string) {
    if (!draggedLinkId || draggedLinkId === targetId) {
      setDraggedLinkId(null);
      return;
    }

    const reordered = reorderById(links, draggedLinkId, targetId);
    setDraggedLinkId(null);
    await persistLinks(reordered);
  }

  function onOpenGridContextMenu(event: ReactMouseEvent, linkId: string) {
    event.preventDefault();
    event.stopPropagation();
    setGridContextMenu({ linkId, x: event.clientX, y: event.clientY });
  }

  function closeSettings() {
    setSettingsOpen(false);
    setSettingsView('menu');
    setOpenLinkMenuId(null);
    setPendingDeleteLinkId(null);
    setGridContextMenu(null);
    if (!editingLinkId) {
      setAddFlowStep('url');
      setLinkFormError('');
    }
  }

  function onToggleLinkMenu(linkId: string) {
    setOpenLinkMenuId((current) => (current === linkId ? null : linkId));
    setPendingDeleteLinkId(null);
  }

  function onStartEditLink(link: QuickLink) {
    setEditingLinkId(link.id);
    setLinkDraft({
      name: link.name,
      url: link.url,
      icon: link.icon,
      useSiteFavicon: link.useSiteFavicon,
    });
    setAddFlowStep('name');
    setLinkFormError('');
    setLinksPanelMode('add');
    setOpenLinkMenuId(null);
    setPendingDeleteLinkId(null);
  }

  function onCancelEditLink() {
    setEditingLinkId(null);
    resetLinkDraft();
    setAddFlowStep('url');
    setLinkFormError('');
  }

  function onRequestDeleteLink(linkId: string) {
    if (pendingDeleteLinkId === linkId) {
      setPendingDeleteLinkId(null);
      setOpenLinkMenuId(null);
      void onDeleteLink(linkId);
      return;
    }

    setPendingDeleteLinkId(linkId);
  }

  function onGridContextEdit(linkId: string) {
    const link = links.find((item) => item.id === linkId);
    if (!link) {
      setGridContextMenu(null);
      return;
    }

    setGridContextMenu(null);
    onStartEditLink(link);
    setSettingsOpen(true);
    setSettingsView('links');
  }

  function onGridContextDelete(linkId: string) {
    setGridContextMenu(null);
    void onDeleteLink(linkId);
  }

  const clockStyle = {
    '--clock-scale': `${safeClockScale / 100}`,
  } as CSSProperties;
  const backgroundLayerStyle = activeBackground
    ? ({ backgroundImage: `url("${activeBackground.full}")` } as CSSProperties)
    : undefined;
  const backgroundPreviewStyle = activeBackground
    ? ({ backgroundImage: `url("${activeBackground.thumb}")` } as CSSProperties)
    : undefined;
  const backgroundDimStyle = {
    opacity: safeBackgroundOpacity / 100,
  } as CSSProperties;
  const faviconRefreshPercent =
    faviconRefreshProgress && faviconRefreshProgress.total > 0
      ? Math.round((faviconRefreshProgress.done / faviconRefreshProgress.total) * 100)
      : 0;
  const gridContextLink = gridContextMenu
    ? links.find((item) => item.id === gridContextMenu.linkId) ?? null
    : null;
  const gridContextStyle = useMemo(() => {
    if (!gridContextMenu) {
      return null;
    }

    const menuWidth = 168;
    const menuHeight = 96;
    const pad = 8;
    const left = Math.max(
      pad,
      Math.min(gridContextMenu.x, window.innerWidth - menuWidth - pad),
    );
    const top = Math.max(
      pad,
      Math.min(gridContextMenu.y, window.innerHeight - menuHeight - pad),
    );

    return { left, top } as CSSProperties;
  }, [gridContextMenu]);

  return (
    <main className="screen">
      <div className="screen-background" aria-hidden="true">
        <div className="screen-background-image" style={backgroundLayerStyle} />
        <div className="screen-background-dim" style={backgroundDimStyle} />
      </div>

      <header className="top-area">
        <div className="clock-center" aria-live="polite" style={clockStyle}>
          {clockText}
        </div>
        <div className={query ? 'query-chip is-active' : 'query-chip'}>
          {query ? `Filtro: ${query}` : 'Digite para filtrar links'}
        </div>
      </header>

      <section className="links-area" aria-label="Atalhos">
        <div
          className="links-viewport"
          ref={linksViewportRef}
          style={{ maxWidth: viewportHintWidth, marginInline: 'auto' }}
        >
          {filteredLinks.length === 0 ? (
            <div className="empty-links">Nenhum link encontrado</div>
          ) : (
            <div className="links-viewport-inner">
              <div
                className="links-track"
                style={{ gap: gridGapX }}
              >
                {linkColumns.map((column, columnIndex) => (
                  <div
                    key={`column-${columnIndex}`}
                    className="link-column"
                    style={{
                      width: tileWidth,
                      gridTemplateRows: `repeat(${safeGridRows}, max-content)`,
                    }}
                  >
                    {column.map((link) => {
                      const Icon = ICON_BY_KEY[link.icon] ?? Globe;
                      const useSiteFavicon = link.useSiteFavicon !== false;
                      const faviconCandidates = getRenderableFaviconCandidates(
                        link.url,
                        faviconChoiceByLink[link.id],
                      );
                      const fallbackOffset = faviconFallbackOffsetByLink[link.id] ?? 0;
                      const resolvedIndex = Math.min(
                        fallbackOffset,
                        Math.max(0, faviconCandidates.length - 1),
                      );
                      const useFallbackIcon =
                        !useSiteFavicon || faviconCandidates.length === 0;
                      const faviconSrc = useFallbackIcon
                        ? ''
                        : withCacheBuster(
                            faviconCandidates[resolvedIndex],
                            faviconRefreshKey,
                            resolvedIndex,
                          );
                      return (
                        <a
                          key={link.id}
                          className="link-tile"
                          href={link.url}
                          aria-label={link.name}
                          onContextMenu={(event) => onOpenGridContextMenu(event, link.id)}
                          onClick={(event) => {
                            event.preventDefault();
                            void onOpenLink(link);
                          }}
                        >
                          <span
                            className="link-icon"
                            style={{ width: safeIconSize, height: safeIconSize }}
                          >
                            {useFallbackIcon ? (
                              <Icon size={Math.round(safeIconSize * 0.46)} strokeWidth={1.85} />
                            ) : (
                                <img
                                  src={faviconSrc}
                                  alt=""
                                  loading="lazy"
                                  onLoad={(event) =>
                                    onFaviconLoad(
                                      link.id,
                                      faviconCandidates[resolvedIndex],
                                      faviconCandidates.length,
                                      event.currentTarget.naturalWidth || 0,
                                      event.currentTarget.naturalHeight || 0,
                                    )
                                  }
                                  onError={() => onFaviconError(link.id, faviconCandidates.length)}
                              />
                            )}
                          </span>
                          <span className="link-tooltip" aria-hidden="true">
                            {link.name}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="links-footer">
          <div className="page-dots" role="tablist" aria-label="Paginas de links">
            {Array.from({ length: pageCount }).map((_, index) => (
              <button
                key={`page-dot-${index}`}
                type="button"
                className={index === activePage ? 'page-dot is-active' : 'page-dot'}
                aria-label={`Ir para pagina ${index + 1}`}
                aria-selected={index === activePage}
                onClick={() => scrollToPage(index)}
              />
            ))}
          </div>
        </footer>
      </section>

      {gridContextMenu && gridContextLink && gridContextStyle ? (
        <div
          className="grid-context-menu"
          ref={gridContextMenuRef}
          style={gridContextStyle}
          role="menu"
          aria-label={`Acoes de ${gridContextLink.name}`}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" className="grid-context-item" onClick={() => onGridContextEdit(gridContextLink.id)}>
            <Pencil size={13} strokeWidth={2} />
            Editar
          </button>
          <button
            type="button"
            className="grid-context-item is-danger"
            onClick={() => onGridContextDelete(gridContextLink.id)}
          >
            <Trash2 size={13} strokeWidth={2} />
            Excluir
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={
          showSettingsTrigger || settingsOpen
            ? 'settings-trigger is-visible'
            : 'settings-trigger'
        }
        onClick={() => setSettingsOpen(true)}
        aria-label="Abrir configuracoes"
      >
        <Settings size={22} strokeWidth={1.8} />
      </button>

      {settingsOpen ? (
        <>
          <button
            type="button"
            className="backdrop"
            aria-label="Fechar configuracoes"
            onClick={closeSettings}
          />

          <aside className="settings-drawer" aria-label="Painel de configuracoes">
            <header className="drawer-header">
              {settingsView === 'menu' ? (
                <div className="drawer-title">
                  <Settings size={18} strokeWidth={1.8} />
                  <h2>Settings</h2>
                </div>
              ) : (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setSettingsView('menu')}
                  aria-label="Voltar"
                >
                  <ArrowLeft size={18} strokeWidth={2} />
                </button>
              )}

              <button
                type="button"
                className="icon-button"
                onClick={closeSettings}
                aria-label="Fechar"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </header>

            <div className="drawer-content">
              {settingsView === 'menu' ? (
                <div className="menu-list">
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setSettingsView('clock')}
                  >
                    <span className="menu-item-leading">
                      <Clock3 size={17} strokeWidth={2} />
                      Relogio
                    </span>
                    <ChevronRight size={16} strokeWidth={2} className="menu-item-chevron" />
                  </button>

                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setSettingsView('grid')}
                  >
                    <span className="menu-item-leading">
                      <Grid3x3 size={17} strokeWidth={2} />
                      Grid
                    </span>
                    <ChevronRight size={16} strokeWidth={2} className="menu-item-chevron" />
                  </button>

                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setSettingsView('background')}
                  >
                    <span className="menu-item-leading">
                      <ImageIcon size={17} strokeWidth={2} />
                      Background
                    </span>
                    <ChevronRight size={16} strokeWidth={2} className="menu-item-chevron" />
                  </button>

                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setSettingsView('links')}
                  >
                    <span className="menu-item-leading">
                      <Link2 size={17} strokeWidth={2} />
                      Links
                    </span>
                    <ChevronRight size={16} strokeWidth={2} className="menu-item-chevron" />
                  </button>
                </div>
              ) : null}

              {settingsView === 'clock' ? (
                <section className="settings-section">
                  <h3 className="section-heading">
                    <Clock3 size={16} strokeWidth={2} />
                    Relogio
                  </h3>

                  <div className="segmented" role="group" aria-label="Formato de relogio">
                    <button
                      type="button"
                      className={
                        settings.clockMode === '24h' ? 'seg-option is-active' : 'seg-option'
                      }
                      onClick={() => void persistSettings({ clockMode: '24h' as ClockMode })}
                    >
                      24h
                    </button>
                    <button
                      type="button"
                      className={
                        settings.clockMode === '12h' ? 'seg-option is-active' : 'seg-option'
                      }
                      onClick={() => void persistSettings({ clockMode: '12h' as ClockMode })}
                    >
                      12h
                    </button>
                  </div>

                  <label className="toggle-row">
                    <span className="toggle-label">
                      <Clock3 size={16} strokeWidth={2} />
                      Segundos
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.showSeconds}
                      onChange={(event) =>
                        void persistSettings({ showSeconds: event.target.checked })
                      }
                    />
                  </label>

                  <label className="control-row clock-size-row">
                    <span>Tamanho ({safeClockScale}%)</span>
                    <input
                      type="range"
                      min={60}
                      max={150}
                      step={2}
                      value={safeClockScale}
                      onChange={(event) =>
                        void persistSettings({
                          clockScale: toSafeInt(event.target.value, 60, 150, safeClockScale),
                        })
                      }
                    />
                  </label>
                </section>
              ) : null}

              {settingsView === 'grid' ? (
                <section className="settings-section">
                  <h3 className="section-heading">
                    <Grid3x3 size={16} strokeWidth={2} />
                    Grid
                  </h3>

                  <div className="control-row">
                    <span>Colunas</span>
                    <div className="segmented compact">
                      {[4, 5, 6].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            settings.gridCols === value ? 'seg-option is-active' : 'seg-option'
                          }
                          onClick={() => void persistSettings({ gridCols: value })}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="control-row">
                    <span>Linhas</span>
                    <div className="segmented compact">
                      {[2, 3, 4].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            settings.gridRows === value ? 'seg-option is-active' : 'seg-option'
                          }
                          onClick={() => void persistSettings({ gridRows: value })}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="control-row">
                    <span>Icone</span>
                    <div className="segmented compact">
                      {[58, 68, 78].map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={
                            settings.iconSize === value ? 'seg-option is-active' : 'seg-option'
                          }
                          onClick={() => void persistSettings({ iconSize: value })}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {settingsView === 'background' ? (
                <section className="settings-section">
                  <h3 className="section-heading">
                    <ImageIcon size={16} strokeWidth={2} />
                    Background
                  </h3>

                  <div className="background-preview-card" style={backgroundPreviewStyle}>
                    <span className="background-preview-badge">
                      {safeBackgroundMode === 'pinned' ? 'Fixo' : 'Rotativo'}
                    </span>
                  </div>

                  <label className="control-row clock-size-row">
                    <span>Opacidade ({safeBackgroundOpacity}%)</span>
                    <input
                      type="range"
                      min={35}
                      max={92}
                      step={1}
                      value={safeBackgroundOpacity}
                      onChange={(event) =>
                        void persistSettings({
                          backgroundOpacity: toSafeInt(
                            event.target.value,
                            35,
                            92,
                            safeBackgroundOpacity,
                          ),
                        })
                      }
                    />
                  </label>

                  <div className="segmented" role="group" aria-label="Modo do background">
                    <button
                      type="button"
                      className={safeBackgroundMode === 'rotating' ? 'seg-option is-active' : 'seg-option'}
                      onClick={() => setBackgroundMode('rotating')}
                    >
                      Rotativo
                    </button>
                    <button
                      type="button"
                      className={safeBackgroundMode === 'pinned' ? 'seg-option is-active' : 'seg-option'}
                      onClick={() => setBackgroundMode('pinned')}
                    >
                      Fixo
                    </button>
                  </div>

                  <div className="background-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={showNextBackground}
                      aria-label="Proximo background"
                      title="Proximo background"
                    >
                      <Shuffle size={15} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className={isCurrentBackgroundPinned ? 'icon-button is-active' : 'icon-button'}
                      onClick={() =>
                        isCurrentBackgroundPinned ? setBackgroundMode('rotating') : setBackgroundMode('pinned')
                      }
                      aria-label={isCurrentBackgroundPinned ? 'Desafixar background' : 'Fixar background atual'}
                      title={isCurrentBackgroundPinned ? 'Desafixar background' : 'Fixar background atual'}
                    >
                      {isCurrentBackgroundPinned ? (
                        <PinOff size={15} strokeWidth={2} />
                      ) : (
                        <Pin size={15} strokeWidth={2} />
                      )}
                    </button>
                    <button
                      type="button"
                      className={
                        backgroundFeedState === 'loading' ? 'icon-button feedback-loading' : 'icon-button'
                      }
                      onClick={() => void refreshBackgrounds()}
                      disabled={backgroundFeedState === 'loading'}
                      aria-label="Atualizar wallpapers"
                      title="Atualizar wallpapers"
                    >
                      <RefreshCw size={15} strokeWidth={2} />
                    </button>
                  </div>

                  {backgroundFeedState === 'error' ? (
                    <p>Wallpaper online indisponivel agora. Mantendo fundo local.</p>
                  ) : null}
                </section>
              ) : null}

              {settingsView === 'links' ? (
                <section className="settings-section">
                  <div className="section-heading-row">
                    <h3 className="section-heading">
                      <Link2 size={16} strokeWidth={2} />
                      Links
                    </h3>
                    <div className="links-toolbar">
                      <button
                        type="button"
                        className={linksPanelMode === 'add' ? 'icon-button is-active' : 'icon-button'}
                        onClick={() => {
                          setLinksPanelMode('add');
                          setOpenLinkMenuId(null);
                          setPendingDeleteLinkId(null);
                          if (!editingLinkId) {
                            goToAddStep('url');
                            resetLinkDraft();
                          }
                        }}
                        aria-label="Adicionar link"
                        title="Adicionar link"
                      >
                        <Plus size={15} strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        className={linksPanelMode === 'manage' ? 'icon-button is-active' : 'icon-button'}
                        onClick={() => {
                          setLinksPanelMode('manage');
                          setOpenLinkMenuId(null);
                          setPendingDeleteLinkId(null);
                        }}
                        aria-label="Lista de links"
                        title="Lista de links"
                      >
                        <GripVertical size={15} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={linksPanelMode === 'overview' ? 'icon-button is-active' : 'icon-button'}
                        onClick={() => {
                          setLinksPanelMode('overview');
                          setOpenLinkMenuId(null);
                          setPendingDeleteLinkId(null);
                        }}
                        aria-label="Ordenacao"
                        title="Ordenacao"
                      >
                        <ArrowUpDown size={15} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className={
                          faviconRefreshState === 'loading'
                            ? 'icon-button feedback-loading'
                            : faviconRefreshState === 'done'
                              ? 'icon-button feedback-done'
                              : 'icon-button'
                        }
                        onClick={refreshFavicons}
                        disabled={faviconRefreshState === 'loading'}
                        aria-label="Atualizar favicons"
                        title="Atualizar favicons"
                      >
                        <RefreshCw size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                  {faviconRefreshState === 'loading' ? (
                    <div className="refresh-progress">
                      <p className="refresh-feedback">
                        Atualizando favicons... {faviconRefreshPercent}% (
                        {faviconRefreshProgress?.done ?? 0}/{faviconRefreshProgress?.total ?? 0})
                      </p>
                      <div className="refresh-progress-track" aria-hidden="true">
                        <span
                          className="refresh-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, faviconRefreshPercent))}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  {faviconRefreshState === 'done' ? (
                    <p className="refresh-feedback is-success">Favicons atualizados</p>
                  ) : null}
                  {linksPanelMode === 'overview' ? (
                    <div className="control-row">
                      <span>Ordenacao</span>
                      <div className="segmented">
                        <button
                          type="button"
                          className={
                            (settings.linksSortMode ?? DEFAULT_SETTINGS.linksSortMode) === 'manual'
                              ? 'seg-option is-active'
                              : 'seg-option'
                          }
                          onClick={() => void persistSettings({ linksSortMode: 'manual' })}
                        >
                          Manual
                        </button>
                        <button
                          type="button"
                          className={
                            (settings.linksSortMode ?? DEFAULT_SETTINGS.linksSortMode) ===
                            'most_accessed'
                              ? 'seg-option is-active'
                              : 'seg-option'
                          }
                          onClick={() => void persistSettings({ linksSortMode: 'most_accessed' })}
                        >
                          Mais acessados
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {linksPanelMode === 'add' ? (
                    <>
                      {editingLinkId ? (
                        <>
                          <div className="edit-mode-banner">
                            <span>Editando link</span>
                            <button type="button" className="icon-button" onClick={onCancelEditLink}>
                              <X size={14} strokeWidth={2.2} />
                            </button>
                          </div>
                          <form className="link-create-form" onSubmit={onCreateLink}>
                            <input
                              value={linkDraft.name}
                              onChange={(event) =>
                                setLinkDraft((current) => ({ ...current, name: event.target.value }))
                              }
                              placeholder="Nome"
                            />
                            <input
                              value={linkDraft.url}
                              onChange={(event) =>
                                setLinkDraft((current) => ({ ...current, url: event.target.value }))
                              }
                              placeholder="URL"
                            />

                            <div className="icon-picker" role="group" aria-label="Icone do link">
                              {ICON_OPTIONS.map((option) => {
                                const Icon = option.icon;
                                return (
                                  <button
                                    key={option.key}
                                    type="button"
                                    className={
                                      linkDraft.icon === option.key
                                        ? 'icon-choice is-active'
                                        : 'icon-choice'
                                    }
                                    onClick={() =>
                                      setLinkDraft((current) => ({ ...current, icon: option.key }))
                                    }
                                    aria-label={option.label}
                                    title={option.label}
                                  >
                                    <Icon size={15} strokeWidth={2} />
                                  </button>
                                );
                              })}
                            </div>

                            <div className="segmented" role="group" aria-label="Fonte do icone">
                              <button
                                type="button"
                                className={linkDraft.useSiteFavicon ? 'seg-option is-active' : 'seg-option'}
                                onClick={() =>
                                  setLinkDraft((current) => ({ ...current, useSiteFavicon: true }))
                                }
                              >
                                Favicon
                              </button>
                              <button
                                type="button"
                                className={!linkDraft.useSiteFavicon ? 'seg-option is-active' : 'seg-option'}
                                onClick={() =>
                                  setLinkDraft((current) => ({ ...current, useSiteFavicon: false }))
                                }
                              >
                                Personalizado
                              </button>
                            </div>

                            <button type="submit" className="add-link-button" aria-label="Salvar link">
                              <Pencil size={15} strokeWidth={2.2} />
                            </button>
                          </form>
                        </>
                      ) : (
                        <div className="add-flow">
                          {addFlowStep === 'url' ? (
                            <>
                              <label className="flow-label">URL do link</label>
                              <input
                                className="flow-input"
                                value={linkDraft.url}
                                onChange={(event) =>
                                  setLinkDraft((current) => ({ ...current, url: event.target.value }))
                                }
                                placeholder="https://exemplo.com"
                              />
                              <div className="flow-actions">
                                <button type="button" className="seg-option is-active" onClick={onAddFlowUrlNext}>
                                  Continuar
                                </button>
                              </div>
                            </>
                          ) : null}

                          {addFlowStep === 'name' ? (
                            <>
                              <label className="flow-label">Nome do link</label>
                              <input
                                className="flow-input"
                                value={linkDraft.name}
                                onChange={(event) =>
                                  setLinkDraft((current) => ({ ...current, name: event.target.value }))
                                }
                                placeholder={getHostname(linkDraft.url || 'link')}
                              />
                              <div className="flow-actions">
                                <button type="button" className="seg-option" onClick={() => goToAddStep('url')}>
                                  Voltar
                                </button>
                                <button type="button" className="seg-option is-active" onClick={onAddFlowNameNext}>
                                  Continuar
                                </button>
                              </div>
                            </>
                          ) : null}

                          {addFlowStep === 'favicon' ? (
                            <>
                              <label className="flow-label">Fonte do icone</label>
                              <div className="favicon-choice">
                                <span className="favicon-preview">
                                  {getFaviconCandidates(linkDraft.url)[0] ? (
                                    <img
                                      src={withCacheBuster(getFaviconCandidates(linkDraft.url)[0], faviconRefreshKey, 0)}
                                      alt=""
                                    />
                                  ) : (
                                    <Globe size={16} strokeWidth={2} />
                                  )}
                                </span>
                                <div className="segmented">
                                  <button
                                    type="button"
                                    className={linkDraft.useSiteFavicon ? 'seg-option is-active' : 'seg-option'}
                                    onClick={() =>
                                      setLinkDraft((current) => ({ ...current, useSiteFavicon: true }))
                                    }
                                  >
                                    Usar favicon
                                  </button>
                                  <button
                                    type="button"
                                    className={!linkDraft.useSiteFavicon ? 'seg-option is-active' : 'seg-option'}
                                    onClick={() =>
                                      setLinkDraft((current) => ({ ...current, useSiteFavicon: false }))
                                    }
                                  >
                                    Personalizar
                                  </button>
                                </div>
                              </div>
                              <div className="flow-actions">
                                <button type="button" className="seg-option" onClick={() => goToAddStep('name')}>
                                  Voltar
                                </button>
                                <button type="button" className="seg-option is-active" onClick={() => void onAddFlowFaviconNext()}>
                                  {linkDraft.useSiteFavicon ? 'Salvar' : 'Continuar'}
                                </button>
                              </div>
                            </>
                          ) : null}

                          {addFlowStep === 'icon' ? (
                            <>
                              <label className="flow-label">Escolha um icone</label>
                              <div className="icon-picker" role="group" aria-label="Icone do link">
                                {ICON_OPTIONS.map((option) => {
                                  const Icon = option.icon;
                                  return (
                                    <button
                                      key={option.key}
                                      type="button"
                                      className={
                                        linkDraft.icon === option.key ? 'icon-choice is-active' : 'icon-choice'
                                      }
                                      onClick={() =>
                                        setLinkDraft((current) => ({ ...current, icon: option.key }))
                                      }
                                      aria-label={option.label}
                                      title={option.label}
                                    >
                                      <Icon size={15} strokeWidth={2} />
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="flow-actions">
                                <button type="button" className="seg-option" onClick={() => goToAddStep('favicon')}>
                                  Voltar
                                </button>
                                <button type="button" className="seg-option is-active" onClick={() => void onAddFlowIconSave()}>
                                  Salvar
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      )}

                      {linkFormError ? <p className="form-error">{linkFormError}</p> : null}
                    </>
                  ) : null}

                  {linksPanelMode === 'manage' ? (
                    <ul className="links-list">
                      {displayLinks.map((link) => {
                        const Icon = ICON_BY_KEY[link.icon] ?? Globe;
                        const useSiteFavicon = link.useSiteFavicon !== false;
                        const faviconCandidates = getRenderableFaviconCandidates(
                          link.url,
                          faviconChoiceByLink[link.id],
                        );
                        const fallbackOffset = faviconFallbackOffsetByLink[link.id] ?? 0;
                        const resolvedIndex = Math.min(
                          fallbackOffset,
                          Math.max(0, faviconCandidates.length - 1),
                        );
                        const useFallbackIcon =
                          !useSiteFavicon || faviconCandidates.length === 0;
                        const faviconSrc = useFallbackIcon
                          ? ''
                          : withCacheBuster(
                              faviconCandidates[resolvedIndex],
                              faviconRefreshKey,
                              resolvedIndex,
                            );
                        const manualSort =
                          (settings.linksSortMode ?? DEFAULT_SETTINGS.linksSortMode) === 'manual';
                        return (
                          <li
                            key={link.id}
                            draggable={manualSort}
                            onDragStart={() => setDraggedLinkId(link.id)}
                            onDragOver={(event) => {
                              if (manualSort) {
                                event.preventDefault();
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (manualSort) {
                                void onDropLink(link.id);
                              }
                            }}
                            onDragEnd={() => setDraggedLinkId(null)}
                          >
                            <div className="links-list-item">
                              <div className="links-list-main">
                                {manualSort ? (
                                  <span className="drag-handle" aria-hidden="true">
                                    <GripVertical size={14} strokeWidth={2} />
                                  </span>
                                ) : null}
                                <span className="list-icon-wrap">
                                  {useFallbackIcon ? (
                                    <Icon size={14} strokeWidth={2} />
                                  ) : (
                                    <img
                                      src={faviconSrc}
                                      alt=""
                                      loading="lazy"
                                      onLoad={(event) =>
                                        onFaviconLoad(
                                          link.id,
                                          faviconCandidates[resolvedIndex],
                                          faviconCandidates.length,
                                          event.currentTarget.naturalWidth || 0,
                                          event.currentTarget.naturalHeight || 0,
                                        )
                                      }
                                      onError={() => onFaviconError(link.id, faviconCandidates.length)}
                                    />
                                  )}
                                </span>
                                <div className="list-text">
                                  <strong>{link.name}</strong>
                                </div>
                              </div>
                              <div
                                className="link-actions"
                                ref={openLinkMenuId === link.id ? linkMenuRootRef : null}
                              >
                                <button
                                  type="button"
                                  className={openLinkMenuId === link.id ? 'icon-button is-active' : 'icon-button'}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onToggleLinkMenu(link.id);
                                  }}
                                  aria-label={`Mais opcoes para ${link.name}`}
                                  aria-expanded={openLinkMenuId === link.id}
                                >
                                  <MoreVertical size={14} strokeWidth={2} />
                                </button>

                                {openLinkMenuId === link.id ? (
                                  <div className="link-more-menu" role="menu" aria-label={`Acoes de ${link.name}`}>
                                    <button
                                      type="button"
                                      className="link-more-item"
                                      onClick={() => onStartEditLink(link)}
                                    >
                                      <Pencil size={13} strokeWidth={2} />
                                      Editar
                                    </button>
                                    <button
                                      type="button"
                                      className={
                                        pendingDeleteLinkId === link.id
                                          ? 'link-more-item is-danger is-confirm'
                                          : 'link-more-item is-danger'
                                      }
                                      onClick={() => onRequestDeleteLink(link.id)}
                                    >
                                      <Trash2 size={13} strokeWidth={2} />
                                      {pendingDeleteLinkId === link.id ? 'Confirmar' : 'Deletar'}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              {settingsView === 'menu' ? (
                <section className="settings-section compact-hint">
                  <h3 className="section-heading">
                    <Palette size={16} strokeWidth={2} />
                    Dica
                  </h3>
                  <p>Digite para filtrar e use o scroll para navegar entre paginas.</p>
                </section>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </main>
  );
}

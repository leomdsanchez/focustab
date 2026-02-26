import {
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  ChevronRight,
  Clock3,
  Folder,
  Github,
  Globe,
  Grid3x3,
  Linkedin,
  Link2,
  Mail,
  MessageCircle,
  Palette,
  Plus,
  Settings,
  Trash2,
  Twitter,
  X,
  Youtube,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  getLinks,
  getSettings,
  sanitizeUrl,
  saveLinks,
  saveSettings,
  type AppSettings,
  type ClockMode,
  type LinkIconKey,
  type QuickLink,
} from '../../src/lib/storage';

type SettingsView = 'menu' | 'clock' | 'grid' | 'links';

interface LinkDraft {
  name: string;
  url: string;
  icon: LinkIconKey;
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

function getFaviconUrl(url: string) {
  const hostname = getHostname(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
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

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsView, setSettingsView] = useState<SettingsView>('menu');
  const [showSettingsTrigger, setShowSettingsTrigger] = useState(false);
  const [query, setQuery] = useState('');
  const [failedFavicons, setFailedFavicons] = useState<Record<string, true>>({});
  const [linkDraft, setLinkDraft] = useState<LinkDraft>({
    name: '',
    url: '',
    icon: 'globe',
  });
  const [linkFormError, setLinkFormError] = useState('');

  const queryTimerRef = useRef<number | null>(null);
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
      const [savedSettings, savedLinks] = await Promise.all([getSettings(), getLinks()]);
      if (!mounted) {
        return;
      }

      setSettings(savedSettings);
      setLinks(savedLinks);
    })();

    return () => {
      mounted = false;
    };
  }, []);

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
              void addLinkFromClipboardRaw(text);
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
      void addLinkFromClipboardRaw(text);
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
  }, [settingsOpen, links]);

  const clockText = useMemo(() => getTimeLabel(now, settings), [now, settings]);

  const filteredLinks = useMemo(() => {
    const queryNormalized = normalizeText(query.trim());
    if (!queryNormalized) {
      return links;
    }

    return links.filter((link) => {
      const searchable = `${link.name} ${getHostname(link.url)} ${link.tags.join(' ')}`;
      return normalizeText(searchable).includes(queryNormalized);
    });
  }, [links, query]);

  const safeGridRows = toSafeInt(settings.gridRows, 1, 8, DEFAULT_SETTINGS.gridRows);
  const safeGridCols = toSafeInt(settings.gridCols, 1, 12, DEFAULT_SETTINGS.gridCols);
  const safeIconSize = toSafeInt(settings.iconSize, 40, 140, DEFAULT_SETTINGS.iconSize);

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

  function markFaviconFailure(linkId: string) {
    setFailedFavicons((current) => {
      if (current[linkId]) {
        return current;
      }

      return { ...current, [linkId]: true };
    });
  }

  async function addLinkFromClipboardRaw(raw: string) {
    const parsed = parseClipboardLink(raw);
    if (!parsed) {
      return;
    }

    const alreadyExists = links.some((link) => link.url === parsed.url);
    if (alreadyExists) {
      return;
    }

    const hostname = getHostname(parsed.url);
    const nextLink: QuickLink = {
      id: createLinkId(),
      name: parsed.name || hostname,
      url: parsed.url,
      icon: 'globe',
      tags: [hostname],
      order: links.length,
      createdAt: Date.now(),
    };

    await persistLinks([...links, nextLink]);
  }

  async function onCreateLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const sanitizedUrl = sanitizeUrl(linkDraft.url);
    if (!sanitizedUrl) {
      setLinkFormError('URL invalida');
      return;
    }

    const fallbackName = getHostname(sanitizedUrl);
    const finalName = linkDraft.name.trim() || fallbackName;

    const nextLink: QuickLink = {
      id: createLinkId(),
      name: finalName,
      url: sanitizedUrl,
      icon: linkDraft.icon,
      tags: [fallbackName],
      order: links.length,
      createdAt: Date.now(),
    };

    await persistLinks([...links, nextLink]);
    setLinkFormError('');
    setLinkDraft({ name: '', url: '', icon: 'globe' });
  }

  async function onDeleteLink(linkId: string) {
    await persistLinks(links.filter((link) => link.id !== linkId));
  }

  function closeSettings() {
    setSettingsOpen(false);
    setSettingsView('menu');
  }

  return (
    <main className="screen">
      <header className="top-area">
        <div className="clock-center" aria-live="polite">
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
                      return (
                        <a
                          key={link.id}
                          className="link-tile"
                          href={link.url}
                          title={link.name}
                        >
                          <span
                            className="link-icon"
                            style={{ width: safeIconSize, height: safeIconSize }}
                          >
                            {failedFavicons[link.id] ? (
                              <Icon size={Math.round(safeIconSize * 0.46)} strokeWidth={1.85} />
                            ) : (
                              <img
                                src={getFaviconUrl(link.url)}
                                alt=""
                                loading="lazy"
                                onError={() => markFaviconFailure(link.id)}
                              />
                            )}
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

              {settingsView === 'links' ? (
                <section className="settings-section">
                  <h3 className="section-heading">
                    <Link2 size={16} strokeWidth={2} />
                    Links
                  </h3>

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

                    <button type="submit" className="add-link-button" aria-label="Adicionar link">
                      <Plus size={16} strokeWidth={2.2} />
                    </button>
                  </form>

                  {linkFormError ? <p className="form-error">{linkFormError}</p> : null}

                  <ul className="links-list">
                    {links.map((link) => {
                      const Icon = ICON_BY_KEY[link.icon] ?? Globe;
                      return (
                        <li key={link.id}>
                          <div className="links-list-item">
                            <div className="links-list-main">
                              <span className="list-icon-wrap">
                                {failedFavicons[link.id] ? (
                                  <Icon size={14} strokeWidth={2} />
                                ) : (
                                  <img
                                    src={getFaviconUrl(link.url)}
                                    alt=""
                                    loading="lazy"
                                    onError={() => markFaviconFailure(link.id)}
                                  />
                                )}
                              </span>
                              <div>
                                <strong>{link.name}</strong>
                                <small>{getHostname(link.url)}</small>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="icon-button danger"
                              onClick={() => void onDeleteLink(link.id)}
                              aria-label={`Remover ${link.name}`}
                            >
                              <Trash2 size={14} strokeWidth={2} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
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

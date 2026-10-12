type PublicRouteLoader = () => Promise<unknown>;

const PREFETCH_THROTTLE_MS = 160;

const publicRouteLoaders: Array<{
  matches: (path: string) => boolean;
  load: PublicRouteLoader;
}> = [
  { matches: (path) => path === '/', load: () => import('./pages/Home/HomePage') },
  { matches: (path) => path === '/library', load: () => import('./pages/Library/LibraryPage') },
  { matches: (path) => path === '/favorites', load: () => import('./pages/Favorites/FavoritesPage') },
  { matches: (path) => path.startsWith('/gameplay/'), load: () => import('./pages/GameplayCategory/GameplayCategoryPage') },
  { matches: (path) => path.startsWith('/mechanism-observatory'), load: () => import('./pages/MechanismObservatory/MechanismObservatoryPage') },
  { matches: (path) => path === '/ranking', load: () => import('./pages/Ranking/RankingIndexPage') },
  // 任务化导航 P1：三个任务页骨架的悬停预取。
  { matches: (path) => path === '/insights', load: () => import('./pages/Insights/InsightsPage') },
  { matches: (path) => path === '/explore', load: () => import('./pages/Explore/ExplorePage') },
  { matches: (path) => path === '/watch', load: () => import('./pages/Watch/WatchPage') },
];

const prefetchedRoutes = new Set<string>();
const pendingRoutes = new Set<string>();
const scheduledRoutes = new Set<string>();
let lastPrefetchStartedAt = 0;

type ConnectionInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

function connectionAllowsPrefetch() {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: ConnectionInformation }).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

export function shouldPrefetchPublicRoute(path: string) {
  return connectionAllowsPrefetch() && publicRouteLoaders.some(({ matches }) => matches(path));
}

function resolvePublicRouteLoader(path: string) {
  return publicRouteLoaders.find(({ matches }) => matches(path))?.load;
}

function startPrefetch(path: string, load: PublicRouteLoader) {
  scheduledRoutes.delete(path);
  pendingRoutes.add(path);
  lastPrefetchStartedAt = Date.now();
  void load()
    .then(() => prefetchedRoutes.add(path))
    .catch(() => undefined)
    .finally(() => pendingRoutes.delete(path));
}

export function prefetchPublicRoute(path: string) {
  if (!shouldPrefetchPublicRoute(path)) return;
  if (prefetchedRoutes.has(path) || pendingRoutes.has(path) || scheduledRoutes.has(path)) return;

  const load = resolvePublicRouteLoader(path);
  if (!load) return;

  const waitMs = Math.max(0, PREFETCH_THROTTLE_MS - (Date.now() - lastPrefetchStartedAt));
  if (waitMs === 0) {
    startPrefetch(path, load);
    return;
  }

  scheduledRoutes.add(path);
  globalThis.setTimeout(() => {
    scheduledRoutes.delete(path);
    if (shouldPrefetchPublicRoute(path) && !prefetchedRoutes.has(path) && !pendingRoutes.has(path)) {
      startPrefetch(path, load);
    }
  }, waitMs);
}

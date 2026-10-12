import { shouldPrefetchPublicRoute } from '../../client/src/navigation-prefetch';

describe('navigation prefetch policy', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  it('allows likely public routes when connection quality is unknown', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { connection: undefined },
    });

    expect(shouldPrefetchPublicRoute('/library')).toBe(true);
    expect(shouldPrefetchPublicRoute('/admin')).toBe(false);
  });

  it('disables prefetch on save-data and 2G connections', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { connection: { saveData: true, effectiveType: '4g' } },
    });
    expect(shouldPrefetchPublicRoute('/library')).toBe(false);

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { connection: { saveData: false, effectiveType: '2g' } },
    });
    expect(shouldPrefetchPublicRoute('/library')).toBe(false);
  });
});

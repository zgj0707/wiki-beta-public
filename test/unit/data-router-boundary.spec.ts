import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(__dirname, '../../client/src');

describe('data router architecture boundary', () => {
  it('uses createBrowserRouter and keeps route loaders beside route objects', () => {
    const router = fs.readFileSync(path.join(clientRoot, 'router.tsx'), 'utf8');
    const routes = fs.readFileSync(path.join(clientRoot, 'routes/public-routes.tsx'), 'utf8');
    expect(router).toContain('createBrowserRouter');
    expect(router).not.toMatch(/<BrowserRouter|import\s+\{[^}]*\bBrowserRouter\b/);
    expect(routes).toContain('loader:');
    expect(routes).toContain("import('./loaders/content-loaders')");
  });

  it('keeps the admin route graph fully removed', () => {
    expect(fs.existsSync(path.join(clientRoot, 'routes/admin-routes.tsx'))).toBe(false);
    const router = fs.readFileSync(path.join(clientRoot, 'router.tsx'), 'utf8');
    expect(router).not.toContain('AdminPlatformBoundary');
    expect(router).not.toContain('adminRoutes');
  });
});

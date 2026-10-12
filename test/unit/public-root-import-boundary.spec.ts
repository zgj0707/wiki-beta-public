import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(process.cwd(), 'client/src');

function readClientFile(relativePath: string) {
  return fs.readFileSync(path.join(clientRoot, relativePath), 'utf8');
}

describe('public shell import boundary', () => {
  it('does not synchronously import platform runtime from the root entry', () => {
    const source = readClientFile('index.tsx');
    expect(source).not.toMatch(/@lark-apaas\/client-toolkit/u);
    expect(source).not.toMatch(/AppContainer|ErrorRender/u);
  });

  it('keeps the public root free of admin toolkit imports', () => {
    const source = readClientFile('shells/PublicRoot.tsx');
    expect(source).not.toMatch(/@lark-apaas\/client-toolkit/u);
    expect(source).not.toMatch(/AppContainer|ErrorRender|pages\/Admin/u);
  });

  it('keeps the public request adapter independent from the platform toolkit', () => {
    const source = readClientFile('api/backend.ts');
    expect(source).not.toMatch(/@lark-apaas\/client-toolkit/u);
    expect(source).toMatch(/same-origin/u);
    expect(source).toMatch(/X-Suda-Csrf-Token/u);
  });

  it('keeps the admin platform shell fully removed', () => {
    expect(fs.existsSync(path.join(clientRoot, 'shells/AdminPlatformBoundary.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(clientRoot, 'shells/AdminPlatformRuntime.tsx'))).toBe(false);
    expect(readClientFile('shells/PublicRoot.tsx')).not.toMatch(/AdminPlatform/u);
  });
});

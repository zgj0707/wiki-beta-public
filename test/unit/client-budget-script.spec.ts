import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const SCRIPT_PATH = join(process.cwd(), 'scripts/check-client-budgets.mjs');

function writeBuild(
  outputDir: string,
  javascript: Buffer | string,
  css = 'body { color: red; }',
) {
  const assetsDir = join(outputDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, 'entry.js'), javascript);
  writeFileSync(join(assetsDir, 'entry.css'), css);
  writeFileSync(
    join(outputDir, 'index.html'),
    '<script type="module" src="/assets/entry.js"></script>' +
      '<noscript><link rel="stylesheet" href="/assets/entry.css"></noscript>',
  );
}

describe('client bundle budget script', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'product-kb-budget-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('parses entry assets and reports raw and gzip byte sizes', () => {
    const javascript = 'console.log("entry");';
    const css = 'body { color: red; }';
    writeBuild(tempRoot, javascript, css);

    const stdout = execFileSync(process.execPath, [SCRIPT_PATH, tempRoot], {
      encoding: 'utf8',
    });
    const report = JSON.parse(stdout) as {
      entry: {
        js: {
          files: Array<{ path: string; rawBytes: number; gzipBytes: number }>;
        };
        css: {
          files: Array<{ path: string; rawBytes: number; gzipBytes: number }>;
        };
      };
    };

    expect(report.entry.js.files[0]).toMatchObject({
      path: 'assets/entry.js',
      rawBytes: Buffer.byteLength(javascript),
      gzipBytes: gzipSync(Buffer.from(javascript)).byteLength,
    });
    expect(report.entry.css.files[0]).toMatchObject({
      path: 'assets/entry.css',
      rawBytes: Buffer.byteLength(css),
      gzipBytes: gzipSync(Buffer.from(css)).byteLength,
    });
  });

  it('exits with code 1 and still emits JSON when an entry exceeds budget', () => {
    const oversizedJavascript = randomBytes(480 * 1024);
    writeBuild(tempRoot, oversizedJavascript);

    const result = spawnSync(process.execPath, [SCRIPT_PATH, tempRoot], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).withinBudget).toBe(false);
  });

  it('accepts the production entry budgets from the command line', () => {
    const javascript = randomBytes(30 * 1024);
    writeBuild(tempRoot, javascript);

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        tempRoot,
        '--entry-js-gzip',
        '25600',
        '--entry-css-gzip',
        '25600',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      budgets: { entryJsGzipBytes: number; entryCssGzipBytes: number };
    };
    expect(report.budgets).toEqual({
      entryJsGzipBytes: 25600,
      entryCssGzipBytes: 25600,
    });
  });
});

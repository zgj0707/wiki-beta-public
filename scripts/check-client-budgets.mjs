#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ENTRY_JS_GZIP_BUDGET = 470 * 1024;
const DEFAULT_ENTRY_CSS_GZIP_BUDGET = 25 * 1024;
const MAX_REPORTED_CHUNKS = 20;

function getAttribute(tag, name) {
  const match = tag.match(
    new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\\x27])(.*?)\\1', 'iu'),
  );
  return match?.[2] ?? null;
}

function uniqueAssetUrls(urls) {
  return [...new Set(urls)].filter((url) => {
    const trimmed = url.trim();
    return trimmed !== '' && !/^(?:data:|https?:|#)/iu.test(trimmed);
  });
}

/**
 * Extract the browser entry assets from generated HTML.
 *
 * The fullstack preset can inject CSS through a feature-detection script and
 * may move client/index.html to the output root. Inspect both module/link tags
 * and the preset's cssUrls array instead of relying on one exact HTML shape.
 */
export function parseEntryAssetUrls(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*>/giu)].map(([tag]) => tag);
  const links = [...html.matchAll(/<link\b[^>]*>/giu)].map(([tag]) => tag);

  const jsUrls = scripts
    .filter((tag) => getAttribute(tag, 'type')?.toLowerCase() === 'module')
    .map((tag) => getAttribute(tag, 'src'))
    .filter((url) => url !== null);

  const cssUrls = links
    .filter((tag) => {
      const rel = getAttribute(tag, 'rel') ?? '';
      return rel.toLowerCase().split(/\s+/u).includes('stylesheet');
    })
    .map((tag) => getAttribute(tag, 'href'))
    .filter((url) => url !== null && /\.css(?:[?#]|$)/iu.test(url));

  for (const match of html.matchAll(/cssUrls\s*=\s*\[([\s\S]*?)\]/giu)) {
    for (const urlMatch of match[1].matchAll(
      /["']([^"']+\.css(?:\?[^"']*)?)["']/giu,
    )) {
      cssUrls.push(urlMatch[1]);
    }
  }

  return {
    js: uniqueAssetUrls(jsUrls),
    css: uniqueAssetUrls(cssUrls),
  };
}

function walkFiles(directory) {
  const files = [];
  if (!existsSync(directory)) return files;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

function resolveAssetPath(outputDir, indexDir, url) {
  const withoutQuery = decodeURIComponent(url.split(/[?#]/u, 1)[0]);
  const assetPath = withoutQuery.startsWith('/')
    ? withoutQuery.slice(1)
    : withoutQuery;
  return resolve(
    withoutQuery.startsWith('/') ? outputDir : indexDir,
    assetPath,
  );
}

export function measureBytes(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer).byteLength,
  };
}

function measureAsset(outputDir, indexDir, url) {
  const absolutePath = resolveAssetPath(outputDir, indexDir, url);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(
      'Entry asset does not exist: ' + url + ' (' + absolutePath + ')',
    );
  }

  return {
    url,
    path: relative(outputDir, absolutePath).replaceAll('\\', '/'),
    ...measureBytes(readFileSync(absolutePath)),
  };
}

function sumAssets(assets, budgetBytes) {
  const rawBytes = assets.reduce((total, asset) => total + asset.rawBytes, 0);
  const gzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);
  return {
    files: assets,
    rawBytes,
    gzipBytes,
    budgetBytes,
    withinBudget: gzipBytes <= budgetBytes,
  };
}

function scanChunks(outputDir) {
  const assetsDir = join(outputDir, 'assets');
  const scanRoot = existsSync(assetsDir) ? assetsDir : outputDir;

  return walkFiles(scanRoot)
    .filter((filePath) => ['.js', '.css'].includes(extname(filePath)))
    .filter((filePath) => !basename(filePath).endsWith('.map'))
    .map((filePath) => ({
      path: relative(outputDir, filePath).replaceAll('\\', '/'),
      type: extname(filePath).slice(1),
      ...measureBytes(readFileSync(filePath)),
    }))
    .sort((left, right) => right.rawBytes - left.rawBytes)
    .slice(0, MAX_REPORTED_CHUNKS);
}

export function createBudgetReport(outputDirectory, options = {}) {
  const outputDir = resolve(outputDirectory);
  const entryJsGzipBudgetBytes =
    options.entryJsGzipBudgetBytes ?? DEFAULT_ENTRY_JS_GZIP_BUDGET;
  const entryCssGzipBudgetBytes =
    options.entryCssGzipBudgetBytes ?? DEFAULT_ENTRY_CSS_GZIP_BUDGET;
  const indexCandidates = [
    join(outputDir, 'index.html'),
    join(outputDir, 'client', 'index.html'),
  ];
  const indexPath = indexCandidates.find((candidate) => existsSync(candidate));

  if (!indexPath) {
    throw new Error(
      'Could not find generated index.html under ' +
        outputDir +
        ' or ' +
        join(outputDir, 'client'),
    );
  }

  const { js, css } = parseEntryAssetUrls(readFileSync(indexPath, 'utf8'));
  if (js.length === 0) {
    throw new Error(
      'Could not identify a module JavaScript entry in index.html',
    );
  }
  if (css.length === 0) {
    throw new Error('Could not identify a stylesheet entry in index.html');
  }

  const indexDir = resolve(indexPath, '..');
  const javascript = sumAssets(
    js.map((url) => measureAsset(outputDir, indexDir, url)),
    entryJsGzipBudgetBytes,
  );
  const stylesheet = sumAssets(
    css.map((url) => measureAsset(outputDir, indexDir, url)),
    entryCssGzipBudgetBytes,
  );

  return {
    outputDir,
    indexPath:
      relative(outputDir, indexPath).replaceAll('\\', '/') || 'index.html',
    budgets: {
      entryJsGzipBytes: entryJsGzipBudgetBytes,
      entryCssGzipBytes: entryCssGzipBudgetBytes,
    },
    entry: {
      js: javascript,
      css: stylesheet,
    },
    chunks: scanChunks(outputDir),
    withinBudget: javascript.withinBudget && stylesheet.withinBudget,
  };
}

function printHelp() {
  console.log(
    'Usage: node scripts/check-client-budgets.mjs <build-output-directory> [--entry-js-gzip bytes] [--entry-css-gzip bytes]',
  );
  console.log(
    'The report is emitted as JSON. Exit code 1 means an entry budget was exceeded.',
  );
}

function readBudget(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} requires a non-negative byte value`);
  }
  return Math.floor(value);
}

function main(argv) {
  const outputDirectory = argv.find((argument) => !argument.startsWith('-'));
  if (!outputDirectory || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }

  try {
    const report = createBudgetReport(outputDirectory, {
      entryJsGzipBudgetBytes: readBudget(
        argv,
        '--entry-js-gzip',
        DEFAULT_ENTRY_JS_GZIP_BUDGET,
      ),
      entryCssGzipBudgetBytes: readBudget(
        argv,
        '--entry-css-gzip',
        DEFAULT_ENTRY_CSS_GZIP_BUDGET,
      ),
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.withinBudget ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}

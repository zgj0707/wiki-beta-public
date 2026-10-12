import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMechanismDocument } from './mechanism-doc-parser.mjs';

const fixture = `
<document revision="9">
  <h1 block_id="scope">研究范围与阅读方式</h1>
  <p>只记录可回溯的来源。</p>
  <h1 block_id="games">游戏分析条目（正文）</h1>
  <h2 block_id="game-block">Low-Budget Repairs / 黑心装修队</h2>
  <table id="game-table">
    <thead><tr><th><p>分析字段</p></th><th><p>题材中立观察</p></th></tr></thead>
    <tbody>
      <tr><td><p>条目编号</p></td><td><p>1</p></td></tr>
      <tr><td><p>游戏名</p></td><td><p>Low-Budget Repairs</p></td></tr>
      <tr><td><p>原始材料 / 来源</p></td><td><p><a href="https://store.steampowered.com/app/3167920/_/">Steam 商店页</a>；商店描述</p></td></tr>
      <tr><td><p>核心钩子</p></td><td><p>先修复，再发现新的问题。</p></td></tr>
      <tr><td><p>核心玩法截图</p></td><td><p><img id="img-1" name="repair.png" caption="核心玩法截图" href="https://example.com/image.png?token=temp" src="asset-token" /></p></td></tr>
      <tr><td><p>3秒素材</p></td><td><p>画面先展示破损，再展示修复前后对比。</p></td></tr>
      <tr><td><p>试玩循环</p></td><td><p>观察、操作、验证结果。</p></td></tr>
      <tr><td><p>抽离复用</p></td><td><p>问题驱动的连续反馈。</p></td></tr>
      <tr><td><p>买量迁移</p></td><td><p>前后对比可以独立成素材。</p></td></tr>
    </tbody>
  </table>
  <h1 block_id="trend">休闲游戏供给趋势观察</h1>
  <table id="trend-table">
    <thead><tr><th><p>指标</p></th><th><p>2024</p></th><th><p>2025</p></th><th><p>2026 截至 8 月 25 日</p></th><th><p>结论</p></th></tr></thead>
    <tbody>
      <tr><td><p>Organizing 标签发行数</p></td><td><p>9</p></td><td><p>22</p></td><td><p>79</p></td><td><p>持续增加</p></td></tr>
      <tr><td><p>2025 同比</p></td><td><p>—</p></td><td><p>+144.4%</p></td><td><p>—</p></td><td><p>增长</p></td></tr>
      <tr><td><p>2026 年 1—8 月同期变化</p></td><td><p>—</p></td><td><p>13</p></td><td><p>79</p></td><td><p>约 +507.7%，回填影响较大</p></td></tr>
    </tbody>
  </table>
  <h1 block_id="template">后续游戏分析统一模板（不重要）</h1>
</document>`;

test('parses game tables cell-by-cell and preserves source evidence', () => {
  const parsed = parseMechanismDocument(fixture, { documentId: 'doc-1' });
  assert.equal(parsed.parserVersion, 'mechanism-table-v2');
  assert.equal(parsed.games.length, 1);
  assert.equal(parsed.games[0].stableKey, 'feishu-block:game-block');
  assert.equal(parsed.games[0].structuredData.gameName, 'Low-Budget Repairs');
  assert.equal(
    parsed.games[0].structuredData.sourceUrl,
    'https://store.steampowered.com/app/3167920/_',
  );
  assert.equal(parsed.games[0].structuredData.steamAppId, '3167920');
  assert.equal(
    parsed.games[0].structuredData.legacyLoop,
    '观察、操作、验证结果。',
  );
  assert.equal(parsed.games[0].structuredData.sourceTable.rows.length, 9);
  assert.equal(
    parsed.games[0].structuredData.sourceTable.rows.some(
      (row) => row.label === '核心玩法截图',
    ),
    false,
  );
  assert.equal(
    parsed.games[0].structuredData.sourceTable.rows.some((row) =>
      Object.prototype.hasOwnProperty.call(row, 'images'),
    ),
    false,
  );
  assert.equal(parsed.games[0].structuredData.coverUrl, null);
  assert.match(parsed.games[0].rawMarkdown, /## 核心钩子\n\n先修复/);
  assert.doesNotMatch(parsed.games[0].rawMarkdown, /^\s*\|/m);
  assert.deepEqual(parsed.games[0].parseErrors, []);
});

test('parses both supported trend table rows without losing percentage evidence', () => {
  const parsed = parseMechanismDocument(fixture, { documentId: 'doc-1' });
  const metrics = parsed.trends[0].structuredData.metrics;
  assert.equal(parsed.trends.length, 1);
  assert.ok(
    metrics.some(
      (metric) => metric.metricKey === 'release_count' && metric.value === 79,
    ),
  );
  assert.ok(
    metrics.some(
      (metric) =>
        metric.metricKey === 'year_over_year_percent' && metric.value === 144.4,
    ),
  );
  assert.ok(
    metrics.some(
      (metric) =>
        metric.metricKey === 'same_period_change_percent' &&
        metric.value === 507.7,
    ),
  );
  assert.equal(parsed.trends[0].parseErrors.length, 0);
  assert.equal(parsed.errors.length, 0);
});

test('excludes the trend section when parsing sync candidates', () => {
  const parsed = parseMechanismDocument(fixture, {
    documentId: 'doc-1',
    includeTrend: false,
  });
  assert.equal(parsed.trends.length, 0);
  assert.equal(
    parsed.items.every((item) => item.itemKind === 'game_analysis'),
    true,
  );
  assert.equal(parsed.errors.length, 0);
});

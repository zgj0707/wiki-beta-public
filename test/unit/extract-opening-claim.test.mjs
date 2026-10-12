import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOpeningClaim } from '../../scripts/lib/extract-opening-claim.mjs';
import { classifyClaimSync } from '../../scripts/lib/claim-sync-state.mjs';

test('extracts a claim after a Markdown heading', () => {
  assert.equal(extractOpeningClaim('# 标题\n\n## 核心结论\n\n市场正在收缩。')?.text, '市场正在收缩。');
});

test('extracts inline, bold, and metadata-labelled claims', () => {
  assert.equal(extractOpeningClaim('核心结论：应优先验证留存。')?.rule, 'inline_title');
  assert.equal(extractOpeningClaim('**一句话结论**\n\n先做小规模测试。')?.text, '先做小规模测试。');
  assert.deepEqual(Object.keys(extractOpeningClaim('核心判断：应当继续观察。') ?? {}).sort(), ['rule', 'sourceExcerpt', 'text', 'version']);
});

test('skips opening blanks, images, and table of contents', () => {
  const result = extractOpeningClaim('\n目录\n\n![封面](image.png)\n\n## 研究结论\n\n结论证据。');
  assert.match(result?.sourceExcerpt ?? '', /研究结论/);
});

test('does not infer a claim from 摘要 or arbitrary body text', () => {
  assert.equal(extractOpeningClaim('摘要：这是摘要。\n\n正文仍在继续。'), null);
});

test('does not scan beyond the opening boundary and handles empty content', () => {
  const opening = Array.from({ length: 8 }, (_, i) => `段落 ${i} ` + 'x'.repeat(180)).join('\n\n');
  assert.equal(extractOpeningClaim(`${opening}\n\n核心结论：太晚了。`), null);
  assert.equal(extractOpeningClaim(''), null);
});

const candidate = { text: '新结论', sourceExcerpt: '核心结论：新结论', rule: 'inline_title', version: 'opening-claim-v1' };

test('creates a pending candidate for a new document', () => {
  assert.equal(classifyClaimSync({ existing: null, candidate }).action, 'create');
});

test('does not create a claim when no explicit conclusion exists', () => {
  assert.deepEqual(classifyClaimSync({ existing: null, candidate: null }), { action: 'skip', reason: 'no_candidate' });
});

test('updates an unlocked candidate when the opening changes', () => {
  assert.equal(classifyClaimSync({ existing: { autoDetectedText: '旧', sourceExcerpt: '旧', extractionRule: 'inline_title', extractionVersion: 'opening-claim-v1', manualLocked: false }, candidate }).action, 'update_auto');
});

test('locks manual text while recording source change', () => {
  assert.deepEqual(classifyClaimSync({ existing: { autoDetectedText: '旧', sourceExcerpt: '旧', extractionRule: 'inline_title', extractionVersion: 'opening-claim-v1', manualLocked: true }, candidate }), { action: 'update_locked', candidate, sourceChanged: true });
});

test('does not write unchanged candidates', () => {
  assert.deepEqual(classifyClaimSync({ existing: { autoDetectedText: candidate.text, sourceExcerpt: candidate.sourceExcerpt, extractionRule: candidate.rule, extractionVersion: candidate.version, manualLocked: false }, candidate }), { action: 'skip', reason: 'unchanged' });
});

test('does not fabricate a claim when a manual record has no new candidate', () => {
  assert.deepEqual(classifyClaimSync({ existing: { autoDetectedText: '已确认', sourceExcerpt: '旧证据', extractionRule: 'inline_title', extractionVersion: 'opening-claim-v1', manualLocked: true }, candidate: null }), { action: 'skip', reason: 'no_candidate' });
});

test('detects extractor-version or evidence changes as an update', () => {
  assert.equal(classifyClaimSync({ existing: { autoDetectedText: candidate.text, sourceExcerpt: '不同证据', extractionRule: candidate.rule, extractionVersion: candidate.version, manualLocked: false }, candidate }).action, 'update_auto');
});

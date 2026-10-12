import {
  MECHANISM_SNIPPET_MAX,
  SNIPPET_TOTAL,
  buildMechanismSnippet,
  buildStructuredSnippet,
} from './chat-snippet';

/** 构造一篇带 n 个二级节的长文，每节 repeat 段正文。 */
function makeDoc(sectionCount: number, bodyPerSection = 600): string {
  const parts = ['# 测试文档\n', '开篇概述内容。\n'];
  for (let i = 1; i <= sectionCount; i += 1) {
    parts.push(`## 第${i}节 测试主题\n`);
    for (let j = 0; j < bodyPerSection / 60; j += 1) {
      parts.push(
        `这是第${i}节的第${j}段说明文字，描述了机制${i}的细节与数据表现。结论是指标${i}持续上升。\n`,
      );
    }
  }
  return parts.join('\n');
}

describe('buildStructuredSnippet', () => {
  it('短文原样返回', () => {
    const body = '# 标题\n短文内容。';
    expect(buildStructuredSnippet(body, [], -1)).toBe(body);
  });

  it('长文输出受预算约束且含大纲', () => {
    const body = makeDoc(8);
    const snippet = buildStructuredSnippet(body, [], -1);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_TOTAL + 80);
    expect(snippet).toContain('【文章大纲】');
    expect(snippet).toContain('## 第1节');
    expect(snippet).toContain('……');
  });

  it('命中锚定：命中词所在节的内容进入片段', () => {
    const body = makeDoc(8);
    const hitIndex = body.indexOf('机制5');
    const snippet = buildStructuredSnippet(body, ['机制5'], hitIndex);
    expect(snippet).toContain('## 第5节');
  });

  it('补充节选带节标题标签，覆盖多个未命中节', () => {
    const body = makeDoc(8);
    const hitIndex = body.indexOf('机制2');
    const snippet = buildStructuredSnippet(body, ['机制2'], hitIndex);
    const labels = snippet.match(/【第\d+节[^】]*】/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it('无标题结构文档回退旧版单窗口', () => {
    const body = Array.from({ length: 60 }, (_, i) => `普通段落第${i}行，没有标题结构。`).join('\n');
    const snippet = buildStructuredSnippet(body, ['普通'], body.indexOf('普通'));
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_TOTAL + 240);
    expect(snippet).not.toContain('【文章大纲】');
  });

  it('表格行保持原子：出现即整行完整', () => {
    const row = '| 列A | 列B | 列C数值指标 |';
    const body = `# 表格文档\n开篇。\n## 数据节\n${row}\n| a | b | c |\n## 另一节\n${'填充内容。'.repeat(200)}\n`;
    const snippet = buildStructuredSnippet(body, ['表格'], 0);
    const tableLines = (snippet.match(/^\|.+\|$/gm) ?? []).map((l) => l.trim());
    for (const line of tableLines) {
      expect([row, '| a | b | c |']).toContain(line);
    }
  });

  it('无命中（总结类问题）仍产出大纲+节选', () => {
    const body = makeDoc(8);
    const snippet = buildStructuredSnippet(body, [], -1);
    expect(snippet).toContain('【文章大纲】');
    const labels = snippet.match(/【第\d+节[^】]*】/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildMechanismSnippet', () => {
  it('三段完整给出，不做节选（机制条目本就很短）', () => {
    const snippet = buildMechanismSnippet({
      coreHook: '用像素搭建产业链。',
      buyValue: '上手成本低。',
      reuseNote: '材料流动加产线扩张。',
    });
    expect(snippet).toBe(
      '【机制】用像素搭建产业链。\n【优点】上手成本低。\n【利用方法】材料流动加产线扩张。',
    );
  });

  it('空段以（未填写）占位：否则相邻两段会被读成同一段', () => {
    const snippet = buildMechanismSnippet({
      coreHook: '只有机制。',
      buyValue: null,
      reuseNote: '   ',
    });
    expect(snippet).toContain('【机制】只有机制。');
    expect(snippet).toContain('【优点】（未填写）');
    expect(snippet).toContain('【利用方法】（未填写）');
  });

  it('超长按 MECHANISM_SNIPPET_MAX 截断并加省略号', () => {
    const snippet = buildMechanismSnippet({
      coreHook: '甲'.repeat(MECHANISM_SNIPPET_MAX),
      buyValue: '乙'.repeat(200),
      reuseNote: null,
    });
    expect(snippet.length).toBeLessThanOrEqual(MECHANISM_SNIPPET_MAX + 2);
    expect(snippet.endsWith('……')).toBe(true);
  });
});

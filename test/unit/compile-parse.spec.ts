import {
  CompileParseError,
  parseCompileOutput,
} from '../../server/modules/compile/compile.prompt';

/**
 * parseCompileOutput 是编译链路的**唯一信任边界**：模型说的任何事都要先过这里。
 * 这些用例锁定的都是真实出现过的畸形输出，不是假想边界。
 */
const VALID = {
  headline: '一句话结论',
  claims: [
    { text: '一条结论', type: 'fact', sources: [1], quote: '原文摘录' },
  ],
  gaps: [],
  contradictions: [],
};

const json = (): string => JSON.stringify(VALID);

describe('parseCompileOutput', () => {
  it('解析标准输出', () => {
    expect(parseCompileOutput(json()).headline).toBe('一句话结论');
  });

  it('剥离 ```json 围栏', () => {
    expect(parseCompileOutput('```json\n' + json() + '\n```').claims).toHaveLength(1);
  });

  it('忽略前后的解释文字', () => {
    const raw = `分析如下：\n${json()}\n以上就是结论。`;
    expect(parseCompileOutput(raw).claims).toHaveLength(1);
  });

  it('忽略 JSON 之后含 } 的解释文字（末个 } 不属于 JSON）', () => {
    // 旧实现取「首个 { 到末个 }」，会把解释里的 } 一起圈进来，必然解析失败。
    const raw = `${json()} 注：{} 表示空对象，[] 表示空数组。`;
    expect(parseCompileOutput(raw).headline).toBe('一句话结论');
  });

  it('修复字符串字面量内的裸换行', () => {
    // quote 要求摘录原文，多行摘录带出裸换行是高频情况，JSON 标准禁止。
    const raw = json().replace('"原文摘录"', '"第一行\n第二行"');
    const parsed = parseCompileOutput(raw);
    expect(parsed.claims[0].quote).toContain('第一行');
  });

  it('修复尾随逗号', () => {
    const raw = json().replace('}]', '},]');
    expect(parseCompileOutput(raw).claims).toHaveLength(1);
  });

  it('输出被截断时报「未闭合」，不谎报成格式错误', () => {
    // 截断与格式错的处理方式相反：前者加预算，后者改 prompt。
    const raw = json();
    const cut = raw.slice(0, raw.indexOf('"quote"') + 3);
    expect(() => parseCompileOutput(cut)).toThrow(CompileParseError);
    expect(() => parseCompileOutput(cut)).toThrow(/未闭合/);
  });

  it('不修未转义引号——宁可失败也不猜哪句是字符串结尾', () => {
    const raw = json().replace('"原文摘录"', '"他说"你好""');
    expect(() => parseCompileOutput(raw)).toThrow(CompileParseError);
  });

  it('完全没有 JSON 时报找不到对象', () => {
    expect(() => parseCompileOutput('抱歉，我无法完成。')).toThrow(/找不到 JSON 对象/);
  });

  it('顶层不是对象时报错', () => {
    expect(() => parseCompileOutput('[1, 2, 3]')).toThrow(CompileParseError);
  });

  it('缺 headline 时报错（不落半成品卡片）', () => {
    const raw = JSON.stringify({ ...VALID, headline: '' });
    expect(() => parseCompileOutput(raw)).toThrow(/缺少 headline/);
  });
});

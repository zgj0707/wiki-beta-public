import {
  BLOCK_TYPE,
  blocksToMarkdown,
} from '../../server/modules/wiki-beta/block-to-markdown';

const DOC_ID = 'docxEXAMPLEPUBLICDOC01';

function run(content: string, style?: Record<string, unknown>) {
  return {
    text_run: {
      content,
      ...(style ? { text_element_style: style } : {}),
    },
  };
}

describe('blocksToMarkdown', () => {
  it('renders heading blocks with the matching level of #', () => {
    const blocks = [
      {
        block_id: 'h1',
        block_type: BLOCK_TYPE.HEADING1,
        heading1: { elements: [run('一级标题')] },
      },
      {
        block_id: 'h3',
        block_type: BLOCK_TYPE.HEADING3,
        heading3: { elements: [run('三级标题')] },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe('# 一级标题\n### 三级标题');
  });

  it('renders text runs with bold, italic, inline code and decoded links', () => {
    const blocks = [
      {
        block_id: 't1',
        block_type: BLOCK_TYPE.TEXT,
        text: {
          elements: [
            run('粗体', { bold: true }),
            run('斜体', { italic: true }),
            {
              text_run: {
                content: '链接',
                text_element_style: {
                  link: { url: 'https%3A%2F%2Fexample.com%2Fdoc%3Fid%3D1' },
                },
              },
            },
            run('代码', { inline_code: true }),
          ],
        },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe(
      '**粗体***斜体*[链接](https://example.com/doc?id=1)`代码`',
    );
  });

  it('indents bullet children two spaces per nesting level', () => {
    const blocks = [
      {
        block_id: 'b1',
        block_type: BLOCK_TYPE.BULLET,
        bullet: { elements: [run('父项')] },
        children: ['b2'],
      },
      {
        block_id: 'b2',
        block_type: BLOCK_TYPE.BULLET,
        bullet: { elements: [run('子项')] },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe('- 父项\n  - 子项');
  });

  it('numbers ordered list items incrementally', () => {
    const blocks = [
      {
        block_id: 'o1',
        block_type: BLOCK_TYPE.ORDERED,
        ordered: { elements: [run('第一项')] },
      },
      {
        block_id: 'o2',
        block_type: BLOCK_TYPE.ORDERED,
        ordered: { elements: [run('第二项')] },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe('1. 第一项\n2. 第二项');
  });

  it('renders a two-row table with the first row as the header', () => {
    const cell = (id: string, content: string) => ({
      block_id: id,
      block_type: BLOCK_TYPE.TEXT,
      text: { elements: [run(content)] },
    });
    const blocks = [
      {
        block_id: 'tb',
        block_type: BLOCK_TYPE.TABLE,
        table: {
          cells: ['c1', 'c2', 'c3', 'c4'],
          property: { row_size: 2, column_size: 2 },
        },
      },
      cell('c1', '指标'),
      cell('c2', '结论'),
      cell('c3', '数值A'),
      cell('c4', '数值B'),
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe(
      '| 指标 | 结论 |\n| --- | --- |\n| 数值A | 数值B |',
    );
  });

  it('renders image blocks as local image redirect links', () => {
    const blocks = [
      {
        block_id: 'i1',
        block_type: BLOCK_TYPE.IMAGE,
        image: { image_token: 'imgToken001' },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe(
      `![图片](/api/articles/${DOC_ID}/images/imgToken001)`,
    );
  });

  it('skips unknown block types', () => {
    const blocks = [
      { block_id: 'u1', block_type: 999, unknown_block: { elements: [run('x')] } },
      {
        block_id: 't1',
        block_type: BLOCK_TYPE.TEXT,
        text: { elements: [run('正文')] },
      },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe('正文');
    expect(blocksToMarkdown([], DOC_ID)).toBe('');
  });

  it('concatenates multiple blocks in document order', () => {
    const blocks = [
      { block_id: 'page', block_type: BLOCK_TYPE.PAGE, children: ['h', 'p', 'd'] },
      {
        block_id: 'h',
        block_type: BLOCK_TYPE.HEADING2,
        heading2: { elements: [run('标题')] },
      },
      {
        block_id: 'p',
        block_type: BLOCK_TYPE.TEXT,
        text: { elements: [run('第一段')] },
      },
      { block_id: 'd', block_type: BLOCK_TYPE.DIVIDER },
    ];
    expect(blocksToMarkdown(blocks, DOC_ID)).toBe('## 标题\n第一段\n---');
  });
});

const CLAIM_TITLES = [
  '一句话结论',
  '核心结论',
  '研究结论',
  '主要结论',
  '结论',
  '核心判断',
];

const TITLE_PATTERN = CLAIM_TITLES.join('|');
export const OPENING_CLAIM_EXTRACTION_VERSION = 'opening-claim-v1';

function clean(value) {
  return String(value || '')
    .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSkippable(block) {
  const value = clean(block);
  if (!value) return true;
  if (/^(?:目录|contents?)$/iu.test(value)) return true;
  if (/^!\[[^\]]*\]\([^)]*\)$/u.test(value)) return true;
  if (/^【此处(?:图片|白板|内嵌表格)详见原文】$/u.test(value)) return true;
  if (/^\[[^\]]+\]\(#.+\)$/u.test(value)) return true;
  return false;
}

function splitBlocks(markdown) {
  return String(markdown || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
}

function stripTitlePrefix(value) {
  return clean(value)
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^\*{1,2}\s*/u, '')
    .replace(/\s*\*{1,2}$/u, '')
    .trim();
}

function matchTitle(value) {
  const line = stripTitlePrefix(value);
  const inline = line.match(new RegExp(`^(${TITLE_PATTERN})\\s*[:：-]\\s*(.+)$`, 'u'));
  if (inline) return { title: inline[1], text: clean(inline[2]), rule: 'inline_title' };

  const titled = line.match(new RegExp(`^\\**(${TITLE_PATTERN})\\**\\s*[:：]?\\s*$`, 'u'));
  if (titled) return { title: titled[1], text: '', rule: value.trim().startsWith('**') ? 'bold_title' : 'markdown_heading' };
  return null;
}

function evidence(title, text) {
  return clean(`${title}：${text}`).slice(0, 1200);
}

/**
 * Deterministically extracts only an explicitly labelled conclusion from the opening.
 * It never infers a claim from a title, summary, or arbitrary body paragraph.
 */
export function extractOpeningClaim(markdown) {
  const blocks = splitBlocks(markdown);
  let scannedChars = 0;
  let effectiveBlocks = 0;

  for (let index = 0; index < blocks.length && effectiveBlocks < 8 && scannedChars < 1200; index += 1) {
    const block = blocks[index];
    const normalized = clean(block);
    scannedChars += normalized.length;
    if (isSkippable(block)) continue;

    const firstLine = normalized.split('\n')[0];
    const match = matchTitle(firstLine);
    if (match) {
      let text = match.text;
      let evidenceText = evidence(match.title, text);
      if (!text) {
        for (let next = index + 1; next < blocks.length && effectiveBlocks + 1 < 8; next += 1) {
          if (isSkippable(blocks[next])) continue;
          text = clean(blocks[next]);
          evidenceText = evidence(match.title, text);
          break;
        }
      }
      if (text) {
        return {
          text,
          sourceExcerpt: evidenceText,
          rule: match.rule,
          version: OPENING_CLAIM_EXTRACTION_VERSION,
        };
      }
    }

    effectiveBlocks += 1;
  }

  return null;
}

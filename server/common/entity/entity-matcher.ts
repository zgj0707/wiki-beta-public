export interface EntityMatchTerm {
  entityId: string;
  term: string;
}

export interface EntityTextMatch {
  entityId: string;
  term: string;
  index: number;
  end: number;
}

function isWordChar(value: string | undefined) {
  return !!value && /[A-Za-z0-9_]/.test(value);
}

/** 边界谓词：ASCII 词内部（前后紧邻 [A-Za-z0-9_]）的命中不算。 */
function boundaryOk(text: string, index: number, end: number) {
  const first = text[index];
  const last = text[end - 1];
  if (isWordChar(first) && isWordChar(text[index - 1])) return false;
  if (isWordChar(last) && isWordChar(text[end])) return false;
  return true;
}

/**
 * Aho-Corasick 自动机（仓内自实现，零外部依赖）。
 *
 * 2026-09-15 替换原 O(文本长×词表数) 暴力扫描（P4b 批1）：词典×正文匹配是
 * 实体系统最大 CPU 热点，AC 把单篇正文匹配降到 O(文本长 + 命中数)。
 * 语义与旧实现逐条对齐（entity-matcher.spec.ts 固化）：
 *   1. 大小写不敏感（双方 toLocaleLowerCase）；
 *   2. 同一位置最长词优先；
 *   3. 从左到右贪心，命中后跳过词身（不产生重叠命中）；
 *   4. ASCII 词内部的子串命中跳过。
 */
interface AcNode {
  next: Map<string, number>;
  fail: number;
  /** 以此节点结尾的词在词表中的下标（构建期去重后）。 */
  output: number[];
}

interface CompiledMatcher {
  /** 返回全部出现（含重叠，未做边界/贪心筛选），按 index 升序、同位置长词优先。 */
  scan(lowered: string): Array<{ termIndex: number; index: number; end: number }>;
}

function buildAutomaton(terms: string[]): CompiledMatcher {
  const nodes: AcNode[] = [{ next: new Map(), fail: 0, output: [] }];
  const termIndexByNodeKey = new Map<string, number>();

  // 1. Trie：小写化词表（与旧实现 toLocaleLowerCase 口径一致）。
  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    const lowered = terms[termIndex].toLocaleLowerCase();
    let nodeIndex = 0;
    for (const char of lowered) {
      let nextIndex = nodes[nodeIndex].next.get(char);
      if (nextIndex === undefined) {
        nextIndex = nodes.length;
        nodes.push({ next: new Map(), fail: 0, output: [] });
        nodes[nodeIndex].next.set(char, nextIndex);
      }
      nodeIndex = nextIndex;
    }
    termIndexByNodeKey.set(`t${termIndex}`, nodeIndex);
    nodes[nodeIndex].output.push(termIndex);
  }

  // 2. BFS 建 fail 链，并把 fail 节点的 output 合并进当前节点（后缀命中集）。
  const queue: number[] = [];
  for (const childIndex of nodes[0].next.values()) {
    nodes[childIndex].fail = 0;
    queue.push(childIndex);
  }
  while (queue.length) {
    const nodeIndex = queue.shift() as number;
    const node = nodes[nodeIndex];
    for (const [char, childIndex] of node.next) {
      queue.push(childIndex);
      let failIndex = node.fail;
      while (failIndex !== 0 && !nodes[failIndex].next.has(char)) {
        failIndex = nodes[failIndex].fail;
      }
      const failNext = nodes[failIndex].next.get(char);
      nodes[childIndex].fail = failNext && failNext !== childIndex ? failNext : 0;
      if (nodes[childIndex].fail !== 0) {
        nodes[childIndex].output.push(...nodes[nodes[childIndex].fail].output);
      }
    }
  }

  return {
    scan(lowered: string) {
      const hits: Array<{ termIndex: number; index: number; end: number }> = [];
      let nodeIndex = 0;
      for (let position = 0; position < lowered.length; position += 1) {
        const char = lowered[position];
        while (nodeIndex !== 0 && !nodes[nodeIndex].next.has(char)) {
          nodeIndex = nodes[nodeIndex].fail;
        }
        nodeIndex = nodes[nodeIndex].next.get(char) ?? 0;
        for (const termIndex of nodes[nodeIndex].output) {
          const termLength = terms[termIndex].toLocaleLowerCase().length;
          hits.push({
            termIndex,
            index: position - termLength + 1,
            end: position + 1,
          });
        }
      }
      // 同位置长词优先：按 (index 升序, end 降序) 排。
      hits.sort((a, b) => a.index - b.index || b.end - a.end);
      return hits;
    },
  };
}

/** 词表 → 编译产物缓存：同一次 sweep 内 terms 数组引用不变，零重复构建。 */
const compiledCache = new WeakMap<EntityMatchTerm[], CompiledMatcher>();

function getCompiled(terms: EntityMatchTerm[]): CompiledMatcher {
  const cached = compiledCache.get(terms);
  if (cached) return cached;
  const cleaned = terms.filter((item) => item.term.trim());
  const compiled = buildAutomaton(cleaned.map((item) => item.term.trim()));
  compiledCache.set(terms, compiled);
  return compiled;
}

/** 暴力回退：仅当小写化改变文本长度（罕见 Unicode 折叠）时启用，保正确性。 */
function bruteForce(text: string, terms: EntityMatchTerm[]): EntityTextMatch[] {
  const candidates = terms
    .filter((item) => item.term.trim())
    .sort((a, b) => b.term.length - a.term.length);
  const matches: EntityTextMatch[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let found: EntityMatchTerm | undefined;
    let foundIndex = -1;
    for (let index = cursor; index < text.length && !found; index += 1) {
      for (const item of candidates) {
        const end = index + item.term.length;
        if (
          text.slice(index, end).toLocaleLowerCase() ===
            item.term.toLocaleLowerCase() &&
          boundaryOk(text, index, end)
        ) {
          found = item;
          foundIndex = index;
          break;
        }
      }
    }
    if (!found) break;
    matches.push({
      entityId: found.entityId,
      term: found.term,
      index: foundIndex,
      end: foundIndex + found.term.length,
    });
    cursor = foundIndex + found.term.length;
  }
  return matches;
}

/**
 * 确定性实体词典匹配：最长词优先，跳过 ASCII 单词内部的子串。
 *
 * 2026-09-11 从 `server/modules/entity/`（未注册的死模块）迁到 `server/common/`，
 * 因为实体提及投影与站内高亮两条链路都依赖它，而它本身零依赖、纯函数。
 * 2026-09-15 内核替换为 Aho-Corasick（P4b 批1），外部语义不变。
 */
export function findEntityTextMatches(
  text: string,
  terms: EntityMatchTerm[],
): EntityTextMatch[] {
  if (!text || !terms.length) return [];
  const lowered = text.toLocaleLowerCase();
  // 长度不一致说明存在改变长度的 Unicode 折叠（如 İ），AC 下标会漂移 → 回退暴力。
  if (lowered.length !== text.length) return bruteForce(text, terms);

  const cleaned = terms.filter((item) => item.term.trim());
  if (!cleaned.length) return [];
  const compiled = getCompiled(terms);

  const matches: EntityTextMatch[] = [];
  let cursor = 0;
  for (const hit of compiled.scan(lowered)) {
    const source = cleaned[hit.termIndex];
    if (!source) continue;
    if (hit.index < cursor) continue;
    if (!boundaryOk(text, hit.index, hit.end)) continue;
    matches.push({
      entityId: source.entityId,
      term: source.term,
      index: hit.index,
      end: hit.end,
    });
    cursor = hit.end;
  }
  return matches;
}

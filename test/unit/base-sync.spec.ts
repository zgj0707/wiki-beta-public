import {
  normalizeFieldValue,
  toBitableRecord,
} from '../../server/modules/base-sync/base-sync.service';

/**
 * 回归护栏（2026-09-29 事故）：`automatic_fields: true` 已发出、接口也确实
 * 返回了 `last_modified_time`，但两条链路的 `records.push` 手写转换把它丢掉，
 * 导致机制表 110 条 `review_time` 全被写成 null。此用例盯住「系统字段必须
 * 穿过转换层」这一不变量。
 */
describe('toBitableRecord', () => {
  it('保留记录级 last_modified_time（automatic_fields 的全部意义）', () => {
    const record = toBitableRecord({
      record_id: 'rec-1',
      fields: { 稳定键: 'k1' },
      last_modified_time: 1790667321000,
    });
    expect(record).toEqual({
      record_id: 'rec-1',
      fields: { 稳定键: 'k1' },
      last_modified_time: 1790667321000,
    });
  });

  it('不带该字段时不要伪造出 null 键（避免下游误判「有值但为空」）', () => {
    const record = toBitableRecord({ record_id: 'rec-2', fields: {} });
    expect(record).toEqual({ record_id: 'rec-2', fields: {} });
    expect(
      Object.prototype.hasOwnProperty.call(record, 'last_modified_time'),
    ).toBe(false);
  });

  it('非数值的 last_modified_time 一律丢弃（防脏值进 PG）', () => {
    const record = toBitableRecord({
      record_id: 'rec-3',
      fields: {},
      last_modified_time: 'not-a-number' as unknown as number,
    });
    expect(record?.last_modified_time).toBeUndefined();
  });

  it('缺 record_id 或 fields 的记录返回 null（保持原有过滤语义）', () => {
    // record_id 的判据是「必须是字符串」——空串仍算字符串，与原实现一致，
    // 不要在这里顺手加空串过滤（那会改变既有行为）。
    expect(toBitableRecord({ record_id: 'rec-ok', fields: {} })).not.toBeNull();
    expect(
      toBitableRecord({ record_id: 123 as unknown as string, fields: {} }),
    ).toBeNull();
    expect(
      toBitableRecord({ record_id: 'rec', fields: undefined as never }),
    ).toBeNull();
    expect(toBitableRecord(undefined as never)).toBeNull();
  });
});

describe('base-sync field normalization', () => {
  it('normalizes scalar and array field values into storable text', () => {
    expect(normalizeFieldValue('已批准')).toBe('已批准');
    expect(normalizeFieldValue(['玩法A', '玩法B'])).toBe('玩法A、玩法B');
    expect(normalizeFieldValue(1746800000000)).toBe('1746800000000');
    expect(normalizeFieldValue(true)).toBe('true');
    expect(normalizeFieldValue(false)).toBe('false');
    expect(normalizeFieldValue(null)).toBeNull();
    expect(normalizeFieldValue(undefined)).toBeNull();
    expect(normalizeFieldValue({ nested: 'object' })).toBeNull();
  });

  it('normalizes url cells and rich-text segments returned by records/search', () => {
    expect(normalizeFieldValue({ text: '打开', link: 'https://example.com/a' })).toBe(
      'https://example.com/a',
    );
    expect(
      normalizeFieldValue([{ type: 'text', text: '2026-05-09' }]),
    ).toBe('2026-05-09');
    expect(
      normalizeFieldValue([
        { type: 'url', text: 'https://example.com/a', link: 'https://example.com/a' },
        { type: 'text', text: ' 尾注' },
      ]),
    ).toBe('https://example.com/a 尾注');
    expect(normalizeFieldValue([])).toBeNull();
    expect(normalizeFieldValue([null, { unknown: 1 }])).toBeNull();
  });

  // 2026-09-21：`mapDirectoryRecord` / `DirectoryRecordProjection` 随
  // `wiki_beta_content` 表一并删除（文章工作台不再落 PG 镜像，改由
  // `FeishuBaseReader` 直读）。其 3 个字段映射用例同步移除。
});

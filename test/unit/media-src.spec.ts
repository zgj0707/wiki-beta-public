import { resolveMediaSrc } from '@client/src/lib/media-src';

/**
 * base-path 模块读 `import.meta.env`，jest 的 CommonJS 转换无法解析 ⇒ 这里 mock 掉，
 * 只锁 resolveMediaSrc 自身的判别逻辑（空值 / 绝对 URL 直通 / 相对路径补前缀）。
 */
jest.mock('@client/src/lib/base-path', () => ({
  withClientBasePath: (path: string) => {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `/app/app_test${normalized}`;
  },
}));

/**
 * 服务端下发的站内媒体地址是根相对路径，不补 CLIENT_BASE_PATH 前缀会打到站点根。
 * 该缺陷已复发三次（文章封面图 09-10、ChatWidget 引用链接 09-17、机制卡片图标 09-20），
 * 这里锁死「相对路径必补前缀 / 绝对 URL 原样 / 空值返回 null」三条边界。
 */
describe('resolveMediaSrc', () => {
  it('根相对路径补上 CLIENT_BASE_PATH 前缀', () => {
    expect(resolveMediaSrc('/media/mechanisms/abc/icon?v=12345678')).toBe(
      '/app/app_test/media/mechanisms/abc/icon?v=12345678',
    );
  });

  it('缺前导斜杠的相对路径同样补前缀且只补一个斜杠', () => {
    expect(resolveMediaSrc('media/mechanisms/abc/icon')).toBe(
      '/app/app_test/media/mechanisms/abc/icon',
    );
  });

  it('绝对 URL 原样返回（http / https / 协议相对）', () => {
    expect(resolveMediaSrc('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(resolveMediaSrc('http://cdn.example.com/a.png')).toBe(
      'http://cdn.example.com/a.png',
    );
    expect(resolveMediaSrc('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
  });

  it('空值返回 null（不做无意义的基路径拼接）', () => {
    expect(resolveMediaSrc(null)).toBeNull();
    expect(resolveMediaSrc(undefined)).toBeNull();
    expect(resolveMediaSrc('')).toBeNull();
    expect(resolveMediaSrc('   ')).toBeNull();
  });

  it('两端空白被裁掉后再判前缀', () => {
    expect(resolveMediaSrc('  /media/a.png  ')).toBe('/app/app_test/media/a.png');
  });
});

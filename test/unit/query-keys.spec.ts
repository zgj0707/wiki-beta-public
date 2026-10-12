import { contentKeys, favoriteKeys } from '@client/src/query/query-keys';

describe('public query key contracts', () => {
  it('normalizes equivalent facet filters deterministically', () => {
    expect(contentKeys.facets({ gameplayCategory: '  strategy ', search: '' })).toEqual(
      contentKeys.facets({ gameplayCategory: 'strategy' }),
    );
    expect(
      contentKeys.facets({ contentType: 'a', gameplayCategory: 'b' }),
    ).toEqual(contentKeys.facets({ gameplayCategory: 'b', contentType: 'a' }));
  });

  it('keeps pending/detail and user scopes out of public list identity', () => {
    expect(contentKeys.detail('doc-1')).not.toEqual(contentKeys.detail('doc-1', true));
    expect(favoriteKeys.list('user-a')).not.toEqual(favoriteKeys.list('user-b'));
  });
});

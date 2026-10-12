import { queryOptions } from '@tanstack/react-query';
import {
  fetchContentFacets,
  type ContentFacetsParams,
} from '@client/src/api/content';
import { cachePolicy, queryMeta } from './cache-policy';
import { contentKeys } from './query-keys';

export const contentFacetsQuery = (params: ContentFacetsParams = {}) =>
  queryOptions({
    queryKey: contentKeys.facets(params),
    queryFn: () => fetchContentFacets(params),
    ...cachePolicy.publicList,
    meta: queryMeta(),
  });

import { queryClient } from './query-client';
import { adminKeys, contentKeys } from './query-keys';

/** Shared mutation boundary: public approved reads are stale after review writes. */
export async function invalidateAfterContentMutation(docId?: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: contentKeys.all }),
    queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    ...(docId ? [queryClient.invalidateQueries({ queryKey: contentKeys.detail(docId) })] : []),
  ]);
}

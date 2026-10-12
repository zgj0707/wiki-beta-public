import type { LoaderFunctionArgs } from 'react-router-dom';
import { queryClient } from '@client/src/query/query-client';
import {
  mechanismDetailQuery,
  mechanismsQuery,
} from '@client/src/api/insight';

function paramsFromRequest(request: Request) {
  return new URL(request.url).searchParams;
}

/**
 * 只做「预取」不做「阻塞」：路由立即放行、页面先渲染自带骨架屏，
 * 数据到达后由 React Query 的 useQuery 自动填充，避免白屏等待接口。
 * 故用 prefetchQuery + void（刻意不 await），统一返回 null。
 */

export async function loadMechanismObservatory({
  request,
}: LoaderFunctionArgs) {
  const params = paramsFromRequest(request);
  // 只传 search：页面是 `mechanismsQuery({ search: query })`，而 query key 会把
  // undefined 归一成 ''，多传一个页面从不读取的 type 会暖到另一个 key 上、白做一次请求。
  // 页面要按类型筛选时，这里与页面的参数必须同时改。
  void queryClient.prefetchQuery(
    mechanismsQuery({ search: params.get('q') ?? undefined }),
  );
  return null;
}

export async function loadMechanismDetail({ params }: LoaderFunctionArgs) {
  if (!params.stableKey) return null;
  void queryClient.prefetchQuery(mechanismDetailQuery(params.stableKey));
  return null;
}


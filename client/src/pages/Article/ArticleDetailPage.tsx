import { useParams, useSearchParams } from 'react-router-dom';
import ArticleDetail from '@client/src/components/ArticleDetail';

export default function ArticleDetailPage() {
  const { docId } = useParams<{ docId: string }>();
  const [searchParams] = useSearchParams();
  if (!docId) return null;
  return <ArticleDetail docId={docId} focusText={searchParams.get('focus') ?? undefined} mode="page" />;
}

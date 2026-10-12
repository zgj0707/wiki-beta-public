import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import SubjectPane from '@client/src/components/ai/SubjectPane';
import { Button } from '@client/src/components/ui/button';

/**
 * /ai/e/:slug 实体结论卡（可分享的独立地址）。
 * 卡片本体与工作台右栏共用同一个组件，口径不可能分叉。
 */
export default function AIUnitPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  return (
    <div className="page-scroll">
      <div className="page-container flex flex-col gap-6">
        <header className="page-header">
          <div className="min-w-0">
            <p className="page-eyebrow">AI 编译结论</p>
            <p className="page-desc">
              结论与证据直接来自编译产物缓存，打开这张卡不消耗模型调用；
              只有「重新编译」才走你自己配置的模型。
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/ai">
              <ArrowLeft />
              返回工作台
            </Link>
          </Button>
        </header>

        <SubjectPane slug={slug} />
      </div>
    </div>
  );
}

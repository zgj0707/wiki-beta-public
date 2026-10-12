import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from '@client/src/lib/utils';
import { resolveMediaSrc } from '@client/src/lib/media-src';
import type { GameplayCategoryTone } from '@shared/gameplay-category';
import CategoryCover from '@client/src/components/CategoryCover';
import ImageLightbox from '@client/src/components/ImageLightbox';

interface ArticleCoverProps {
  /** Base「封面图」的站内代理地址；缺失或加载失败时的表现由 fallback 决定。 */
  src?: string | null;
  label: string;
  color: GameplayCategoryTone;
  /** 控制高度比例，如 aspect-[16/9]；由调用方传入 */
  className?: string;
  /**
   * 无图（未上传或加载失败）时的表现：
   * - `none`（默认）：整块不渲染，卡片不留图位，标题直接起头；
   * - `gradient`：回退品类渐变占位封面（头版区沿用，保证头版视觉重量）。
   */
  fallback?: 'none' | 'gradient';
  /** 点击封面打开全屏大图（仅详情弹窗开启；列表卡片点击语义是进详情，不开灯箱）。 */
  zoomable?: boolean;
}

/** 供调用方预判是否真的有封面（决定相邻的关闭按钮等元素如何排布）。 */
export function hasCoverSrc(src?: string | null): boolean {
  return resolveMediaSrc(src) !== null;
}

/**
 * 封面图位：有图渲染图片并保持裁切比例；
 * 无图时按 fallback 走「整块移除」或「品类渐变占位」。
 * zoomable 打开时，点击图片弹出全屏大图（ImageLightbox）。
 */
export default function ArticleCover({
  src,
  label,
  color,
  className,
  fallback = 'none',
  zoomable = false,
}: ArticleCoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const resolvedSrc = resolveMediaSrc(src);
  const showImage = Boolean(resolvedSrc) && failedSrc !== resolvedSrc;

  if (!showImage) {
    if (fallback === 'gradient') {
      return <CategoryCover label={label} color={color} className={className} />;
    }
    return null;
  }

  const zoomSrc = resolvedSrc as string;

  const image = (
    <img
      src={zoomSrc}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(zoomSrc)}
      className="h-full w-full object-cover"
    />
  );

  // 不可缩放：保持原有纯展示结构，避免给列表卡片引入多余的交互层
  if (!zoomable) {
    return (
      <div className={cn('relative w-full overflow-hidden bg-muted', className)}>
        {image}
      </div>
    );
  }

  return (
    <>
      <div className={cn('group relative w-full overflow-hidden bg-muted', className)}>
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label="查看封面大图"
          className="block h-full w-full cursor-zoom-in"
        >
          {image}
        </button>
        <span className="pointer-events-none absolute bottom-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <ImageLightbox
        open={zoomed}
        src={zoomSrc}
        onClose={() => setZoomed(false)}
      />
    </>
  );
}


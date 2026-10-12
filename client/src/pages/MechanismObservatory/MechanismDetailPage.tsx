import { useState } from 'react';
import { ArrowLeft, ChevronDown, ExternalLink, Maximize2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import { Skeleton } from '@client/src/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@client/src/components/ui/collapsible';
import ImageLightbox from '@client/src/components/ImageLightbox';
import {
  mechanismDetailQuery,
  mechanismScoreHintsQuery,
} from '@client/src/api/insight';
import type { MechanismDetailData } from '@client/src/types/insight';
import { displayNameOf } from '@client/src/lib/mechanism-display-name';
import { resolveMediaSrc } from '@client/src/lib/media-src';
import MechanismScoreBadges, {
  hasMechanismScore,
} from '@client/src/components/mechanism/MechanismScoreBadges';
import {
  decodeHtmlEntities,
  formatLocalDate,
  isInternalJson,
  normalizeExternalUrl,
  splitDisplayLabels,
} from '@shared/base-text';
import {
  MECHANISM_DIMENSION_TOTAL,
  MECHANISM_DIMENSIONS,
  MECHANISM_FIELD_GLOSSARY,
  type MechanismDimensionKey,
} from '@shared/mechanism-dimensions';

/** 内部数据护栏文案（JSON 护栏命中时统一用它）。 */
const INTERNAL_FIELD_NOTICE = '该字段为内部数据，已隐藏';

/** 唯一的解码入口：从 `item` 取值时解一次，下游一律直接用结果，不得二次解码。 */
function decode(value: string | null | undefined): string {
  return decodeHtmlEntities(value ?? '').trim();
}

/**
 * 维度正文：JSON 护栏 → 展示层软切分（按 `；` 软换行 + 行首标签加粗）。
 * 纯展示处理，不做语义解析与重排。
 * 注意：`text` 已在调用方（`decode(item[key])`）解过实体，这里**不再**解码。
 */
function DimensionBody({ text }: { text: string }) {
  if (isInternalJson(text)) {
    return (
      <p className="mt-2 text-[13px] italic text-muted-foreground">
        {INTERNAL_FIELD_NOTICE}
      </p>
    );
  }

  const segments = splitDisplayLabels(text);

  // 只有分隔符/空白（如「；」）是没有内容，不是内部数据被隐藏 —— 什么都不渲染。
  if (!segments.length) return null;

  return (
    <p className="whitespace-pre-wrap text-[15px] leading-[1.8] text-foreground/90">
      {segments.map((segment, index) => (
        <span key={index}>
          {segment.label ? (
            <span className="font-medium text-foreground">
              {segment.label}：
            </span>
          ) : null}
          {segment.body}
          {index < segments.length - 1 ? <br /> : null}
        </span>
      ))}
    </p>
  );
}

/** 来源与核验：`http(s)` 才渲染成链接，否则只渲染纯文本。 */
function SourceSection({
  raw,
  url,
  label,
}: {
  raw: string;
  url: string | null;
  label: string;
}) {
  if (isInternalJson(raw)) {
    return (
      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">原始出处</h3>
        <p className="mt-1 text-xs text-muted-foreground">可点开核验的一手链接</p>
        <p className="mt-2 text-[13px] italic text-muted-foreground">
          {INTERNAL_FIELD_NOTICE}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border bg-card p-5">
      <h3 className="text-sm font-semibold">原始出处</h3>
      <p className="mt-1 text-xs text-muted-foreground">可点开核验的一手链接</p>
      {url ? (
        <>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-[15px] text-primary hover:underline"
          >
            {label}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          <p className="mt-1 break-all text-xs text-muted-foreground">{raw}</p>
        </>
      ) : (
        <p className="mt-2 break-all text-[15px] leading-[1.8] text-foreground/90">
          {raw}
        </p>
      )}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div className="page-container space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}

/** 机制观察详情：Hero → 机制流程图 → 分组正文 → 页脚（维度统计 + 字段说明）。 */
export default function MechanismDetailPage() {
  const { stableKey = '' } = useParams();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedIconSrc, setFailedIconSrc] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const detailQuery = useQuery({
    ...mechanismDetailQuery(stableKey),
    enabled: Boolean(stableKey),
  });
  const item = detailQuery.data ?? null;

  /** 指数列的 Base 字段描述，供分值徽标悬停提示（与列表页共用同一份缓存）。 */
  const scoreHintsQueryResult = useQuery(mechanismScoreHintsQuery());
  const scoreHints = scoreHintsQueryResult.data ?? null;

  if (detailQuery.isPending) {
    return (
      <div className="page-scroll">
        <DetailSkeleton />
      </div>
    );
  }

  if (detailQuery.isError || !item) {
    return (
      <div className="page-scroll">
        <div className="page-container">
          <Link
            to="/mechanism-observatory"
            className="text-sm text-primary hover:underline"
          >
            ← 返回机制观察
          </Link>
          <div className="mt-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <div>该机制条目不存在或尚未发布。</div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => void detailQuery.refetch()}
            >
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 白名单取值：只从 shared 维度表里的 key 取，表外的列（内部同步元数据等）永不进入展示层。
  const values = new Map<MechanismDimensionKey, string>();
  for (const dimension of MECHANISM_DIMENSIONS) {
    values.set(dimension.key, decode(item[dimension.key]));
  }

  const displayName = displayNameOf(item);
  const updateDate = formatLocalDate(item.updatedAt);
  const hasScores = hasMechanismScore(item.marketScore, item.innovationScore);
  const sourceRaw = decode(item.sourceLink);
  const sourceUrl = normalizeExternalUrl(sourceRaw);

  const annotated = MECHANISM_DIMENSIONS.filter(
    (dimension) => (values.get(dimension.key) ?? '').length > 0,
  );
  const missing = MECHANISM_DIMENSIONS.filter(
    (dimension) => (values.get(dimension.key) ?? '').length === 0,
  ).map((dimension) => dimension.title);

  const figureSrc = resolveMediaSrc(item.figureUrl);
  const showFigure = Boolean(figureSrc) && failedSrc !== figureSrc;
  const iconSrc = resolveMediaSrc(item.iconUrl);
  const showIcon = Boolean(iconSrc) && failedIconSrc !== iconSrc;

  return (
    <div className="page-scroll">
      <div className="page-container">
        <Link
          to="/mechanism-observatory"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          返回机制观察
        </Link>

        {/* Hero：88px 图标 + 中文名主标题（试译标注）/ 英文名副标题 + meta 行 */}
        <div className="mt-4 rounded-lg border bg-card p-6">
          {item.entryType || item.reviewStatus || hasScores ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {item.entryType ? (
                <Badge variant="secondary">{decode(item.entryType)}</Badge>
              ) : null}
              {item.reviewStatus ? (
                <Badge variant="outline">{decode(item.reviewStatus)}</Badge>
              ) : null}
              <MechanismScoreBadges
                marketScore={item.marketScore}
                innovationScore={item.innovationScore}
                hints={scoreHints}
              />
            </div>
          ) : null}

          <div className="flex items-start gap-4">
            {/*
              88px 方形图标（Base「游戏图标」列的 128×128 PNG，载入失败即隐藏本元素：
              与其显示破图框，不如让标题占满整行）。
            */}
            {showIcon && iconSrc ? (
              <img
                src={iconSrc}
                alt=""
                width={88}
                height={88}
                loading="lazy"
                decoding="async"
                onError={() => setFailedIconSrc(iconSrc)}
                className="h-[88px] w-[88px] shrink-0 rounded-xl border object-cover"
              />
            ) : null}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="page-title">{displayName.primary}</h1>
                {displayName.tentative ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    title="该中文名为试译，非官方定名"
                  >
                    试译
                  </Badge>
                ) : null}
              </div>

              {displayName.secondary ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {displayName.secondary}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    原始出处
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : sourceRaw && !isInternalJson(item.sourceLink) ? (
                  <span className="break-all">原始出处：{sourceRaw}</span>
                ) : null}
                {/* 更新时间按决定保留在详情页 Hero（列表卡片不显示时间，只用它排序与分月） */}
                {updateDate ? <span>更新时间 {updateDate}</span> : null}
              </div>
            </div>
          </div>
        </div>

        {/* 机制流程图（阶段 B 落点）：无图 / 加载失败时不渲染图位，不留空洞 */}
        {showFigure && figureSrc ? (
          <section className="mt-6">
            <h2 className="section-title">机制流程图</h2>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label="查看机制流程图大图"
                className="group relative block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted"
              >
                <img
                  src={figureSrc}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailedSrc(figureSrc)}
                  className="mx-auto max-h-[520px] w-full object-contain"
                />
                <span className="pointer-events-none absolute bottom-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                </span>
              </button>
            </div>
          </section>
        ) : null}
        <ImageLightbox
          open={zoomed}
          src={figureSrc}
          alt={`${displayName.primary} 机制流程图`}
          hint="机制流程图 · 点击任意处或按 Esc 关闭"
          onClose={() => setZoomed(false)}
        />

        {/* 三段正文：机制 / 优点 / 利用方法；空段不渲染 */}
        {MECHANISM_DIMENSIONS.map((dimension) => {
          const text = values.get(dimension.key) ?? '';
          if (!text.length) return null;
          return (
            <section key={dimension.key} className="mt-6">
              <h2 className="section-title">{dimension.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {dimension.hint}
              </p>
              <div className="mt-3 rounded-lg border bg-card p-5">
                <DimensionBody text={text} />
              </div>
            </section>
          );
        })}

        {/* 来源与核验 */}
        {sourceRaw && !isInternalJson(item.sourceLink) ? (
          <section className="mt-6">
            <h2 className="section-title">来源与核验</h2>
            <div className="mt-3">
              <SourceSection
                raw={sourceRaw}
                url={sourceUrl}
                label="打开原始出处"
              />
            </div>
          </section>
        ) : null}

        {/* 页脚：维度统计 + 未标注维度 + 页级字段说明 */}
        <div className="mt-8 rounded-lg border bg-card p-5">
          <p className="text-sm">
            本条目已标注{' '}
            <span className="font-semibold text-primary">
              {annotated.length}
            </span>
            /{MECHANISM_DIMENSION_TOTAL} 段文案
          </p>
          {missing.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              未标注：{missing.join('、')}
            </p>
          ) : null}

          <Collapsible className="mt-4">
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-primary">
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              字段说明
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-1.5 border-t pt-3">
              {MECHANISM_FIELD_GLOSSARY.map((entry) => (
                <p
                  key={entry.term}
                  className="text-xs leading-5 text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {entry.term}
                  </span>
                  ：{entry.definition}
                </p>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}

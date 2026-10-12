import { cn } from '@client/src/lib/utils';
import type { GameplayCategoryTone } from '@shared/gameplay-category';

/** 品类渐变占位封面：Base 图片接入前的统一过渡方案（决策记录见 design/frontend-redesign-2026-09.md）。 */
const COVER_GRADIENTS: Record<GameplayCategoryTone, string> = {
  blue: 'from-blue-500 to-indigo-700',
  violet: 'from-violet-500 to-purple-700',
  green: 'from-green-500 to-emerald-700',
  orange: 'from-orange-500 to-amber-700',
  rose: 'from-rose-500 to-pink-700',
  teal: 'from-teal-500 to-cyan-700',
  gray: 'from-slate-500 to-slate-700',
};

interface CategoryCoverProps {
  label: string;
  color: GameplayCategoryTone;
  /** 控制高度比例，如 aspect-[16/9]；由调用方传入 */
  className?: string;
}

export default function CategoryCover({ label, color, className }: CategoryCoverProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative w-full overflow-hidden bg-gradient-to-br',
        COVER_GRADIENTS[color] ?? COVER_GRADIENTS.gray,
        className,
      )}
    >
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(255,255,255,.5) 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="relative grid h-full place-items-center">
        <span className="px-4 text-center text-lg font-extrabold tracking-wide text-white/95">
          {label}
        </span>
      </div>
    </div>
  );
}

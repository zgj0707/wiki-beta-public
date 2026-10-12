import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * 全屏大图查看层。
 *
 * 用 portal 挂到 document.body：预览弹窗的外层容器带 `backdrop-blur`，
 * 而 backdrop-filter 会给后代 fixed 元素新建包含块，直接把 fixed 层写在
 * 弹窗内部会被困在弹窗范围内，必须脱离 DOM 树渲染。
 *
 * 关闭方式：点击任意处 / Esc / 右上角按钮。Esc 用捕获阶段监听并
 * stopPropagation，避免同一次按键继续冒泡到预览弹窗的 Esc 处理
 * （那个处理是「先关全文面板、再关弹窗」）。
 */
export default function ImageLightbox({
  open,
  src,
  alt = '',
  hint = '点击任意处或按 Esc 关闭',
  onClose,
}: {
  open: boolean;
  src: string | null;
  alt?: string;
  hint?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open || !src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex cursor-zoom-out items-center justify-center bg-black/90 p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="封面大图"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭大图"
        className="absolute right-4 top-4 z-10 grid h-9 w-9 cursor-pointer place-items-center rounded-full bg-white/12 text-lg text-white transition-colors hover:bg-white/25"
      >
        ✕
      </button>
      <p className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 text-xs text-white/60">
        {hint}
      </p>
    </div>,
    document.body,
  );
}

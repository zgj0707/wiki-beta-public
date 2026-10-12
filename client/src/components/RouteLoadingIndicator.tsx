import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';

/**
 * 路由切换加载指示：视口居中悬浮圆（logo + 提示文字 + 进度环）。
 *
 * 出现条件：路由切换后 300ms 时页面数据仍在取数（React Query 全局 isFetching > 0）
 * 才出现，加载快则完全不显示。
 *
 * 为什么是「联动」而不是「固定时长」：固定展示 N 秒无法与真实加载状态对齐——
 * 加载比 N 秒慢时最后一段什么反馈都没有，加载比 N 秒快时内容早出来了遮罩还盖着。
 * 所以改为出现后持续显示、直到全站取数归零（isFetching === 0）才收尾，
 * 只用 MIN_DISPLAY_MS / MAX_DISPLAY_MS 兜住「一闪而过」和「请求永不结束」两个极端，
 * 收尾时把进度环推到 100% 再渐隐，视觉上是「填满 → 消失」。
 *
 * 圆径 37vmin（约画面 1/9）、进度环显示、文字轮换、出现期间全站背景高斯模糊。
 */
const SHOW_DELAY_MS = 300;
/** 最短展示时长：避免请求很快结束时指示器只闪一帧。 */
const MIN_DISPLAY_MS = 420;
/** 兜底上限：防止某个请求永不结束把遮罩永久卡住。 */
const MAX_DISPLAY_MS = 6000;
/** 取数归零后，把进度环从 90% 推到 100% 再渐隐所需时长。 */
const COMPLETE_FILL_MS = 320;
/** 轮询取数状态的间隔：fetchingRef 里始终是最新的 isFetching 值。 */
const POLL_MS = 100;
const TIP_ROTATE_MS = 900;
/** 进度环周长：2πr，r=62（viewBox 130）。 */
const RING_LENGTH = 2 * Math.PI * 62;

const TIPS_MAIN = ['正在进入研究站…', '获取最新内容…', '马上就好…'];
const TIPS_SUB = ['获取最新内容…', '几乎完成了…', '感谢耐心等待…'];

export default function RouteLoadingIndicator() {
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const barRef = useRef<SVGCircleElement>(null);
  // 全站取数计数：>0 表示仍有请求在飞行（=「跳转尚未完成」的信号）。
  const isFetching = useIsFetching();
  const fetchingRef = useRef(0);

  useEffect(() => {
    fetchingRef.current = isFetching;
  }, [isFetching]);

  // 路由切换后等 300ms 再判定：此刻仍有请求在飞 →「超过 300ms 没跳完」→ 出现；
  // 300ms 内已取数完毕则完全不显示。路径再次变化时立即隐藏并重判。
  useEffect(() => {
    setVisible(false);
    setTipIndex(0);
    const checkTimer = window.setTimeout(() => {
      if (fetchingRef.current > 0) setVisible(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(checkTimer);
  }, [location.pathname]);

  // 出现期间：进度环 ease-out 爬到 90%，并轮询取数状态，直到归零才收尾。
  // 刻意不把 isFetching 写进依赖——那会让每次取数变化都重建定时器、引发重渲循环；
  // 这里统一读 fetchingRef（见上方同步 effect），时序行为完全一致。
  useEffect(() => {
    if (!visible) return;
    const bar = barRef.current;
    let innerRaf = 0;
    const shownAt = Date.now();
    if (bar) {
      bar.style.transition = 'none';
      bar.style.strokeDashoffset = String(RING_LENGTH);
      // 双 rAF：先让「归零」生效，再开启过渡爬升到 90%（隐藏时无需复位，下次出现先归零）。
      innerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(() => {
          bar.style.transition = '';
          bar.style.strokeDashoffset = String(RING_LENGTH * 0.1);
        });
      });
    }

    let finished = false;
    let hideTimer = 0;
    // 收尾：① 把环推到 100%（用内联短过渡覆盖样式里的 2s 长过渡，
    // 否则环还没填满遮罩就先淡出了）→ ② 满足最短展示时长后渐隐。
    const finish = () => {
      if (finished) return;
      finished = true;
      if (bar) {
        bar.style.transition = `stroke-dashoffset ${COMPLETE_FILL_MS}ms ease-out`;
        bar.style.strokeDashoffset = '0';
      }
      const remaining = Math.max(MIN_DISPLAY_MS - (Date.now() - shownAt), 0);
      hideTimer = window.setTimeout(
        () => setVisible(false),
        remaining + COMPLETE_FILL_MS,
      );
    };

    const pollTimer = window.setInterval(() => {
      if (fetchingRef.current === 0) finish();
    }, POLL_MS);
    // 兜底：请求永不结束时，到 MAX_DISPLAY_MS 也强制收尾。
    const maxTimer = window.setTimeout(finish, MAX_DISPLAY_MS);

    return () => {
      window.clearInterval(pollTimer);
      window.clearTimeout(maxTimer);
      window.clearTimeout(hideTimer);
      cancelAnimationFrame(innerRaf);
    };
  }, [visible]);

  // 展示期间提示文字轮换；渐隐后停止。
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(
      () => setTipIndex((index) => (index + 1) % TIPS_MAIN.length),
      TIP_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [visible]);

  return (
    <div
      className={visible ? 'rl-layer rl-show' : 'rl-layer'}
      aria-hidden={!visible}
    >
      <div className="rl-wrap">
        <div className="rl-halo" />
        <svg className="rl-ring" viewBox="0 0 130 130" aria-hidden>
          <circle
            className="rl-ring-track"
            cx="65"
            cy="65"
            r="62"
            fill="none"
            strokeWidth="3"
          />
          <circle
            ref={barRef}
            className="rl-ring-bar"
            cx="65"
            cy="65"
            r="62"
            fill="none"
            strokeWidth="3"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH}
          />
        </svg>
        <div className="rl-circle">
          <div className="rl-logo">W</div>
          <div key={tipIndex} className="rl-text">
            {TIPS_MAIN[tipIndex]}
          </div>
        </div>
      </div>
      <div key={`sub-${tipIndex}`} className="rl-tip">
        {TIPS_SUB[tipIndex]}
      </div>
    </div>
  );
}

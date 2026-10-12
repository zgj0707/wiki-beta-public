import { Outlet } from 'react-router-dom';
import TopNav from '@client/src/components/TopNav';
import ChatWidget from '@client/src/components/chat/ChatWidget';
// 路由加载悬浮圆已暂时关闭（保留组件与 base.css 中的 .rl-* 样式，随时可恢复）：
// import RouteLoadingIndicator from '@client/src/components/RouteLoadingIndicator';

/**
 * 顶部导航布局：TopNav 占顶部固定高度，main 用 flex-1 占剩余空间，
 * 各页面内部自带 .page-scroll 滚动容器，行为与旧侧栏版一致。
 * 说明：RouteLoadingIndicator（路由切换悬浮圆加载指示）当前未挂载，如需启用请取消上方 import
 * 注释并在根 div 末尾恢复 <RouteLoadingIndicator />。
 */
export default function Layout() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        跳到主内容
      </a>
      <TopNav />
      <main id="main" className="min-h-0 flex-1 overflow-hidden" tabIndex={-1}>
        <Outlet />
      </main>
      <ChatWidget />
      {/* <RouteLoadingIndicator /> */}
    </div>
  );
}

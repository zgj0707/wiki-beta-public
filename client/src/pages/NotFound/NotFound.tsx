import { NavLink } from 'react-router-dom';

const NotFound = () => {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">页面不存在</h1>
      <p className="text-sm text-muted-foreground">请检查链接，或返回首页继续浏览。</p>
      <NavLink to="/" className="text-sm font-medium text-primary hover:underline">返回首页</NavLink>
    </div>
  );
};

export default NotFound;

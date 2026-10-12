import { useEffect, useState } from 'react';

/** 瀑布流列数随视口切换（1 / 2 / 3），供按索引取模分桶使用。首页与其他列表页共用。 */
export function useWaterfallColumns() {
  const [count, setCount] = useState(3);
  useEffect(() => {
    const update = () =>
      setCount(
        window.innerWidth >= 1280 ? 3 : window.innerWidth >= 640 ? 2 : 1,
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return count;
}

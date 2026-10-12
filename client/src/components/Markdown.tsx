import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo, useState } from 'react';
import '../styles/article.css';
import { Link2 } from 'lucide-react';

interface MarkdownProps {
  content: string;
  className?: string;
  /** 由 toc 提取的标题 id 顺序列表，按文档顺序注入 h1-h3 锚点 id */
  headingIds?: string[];
}

// 飞书内部图链（internal-api-drive-stream.*）需鉴权，公开站点无法加载；
// 加载失败时回退为带图注的占位框，避免破图导致版式错乱。
function DocImage({ src, alt }: { src?: string; alt?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <figure className="doc-img broken">
        <figcaption>{alt || '（图片来自飞书云文档，需登录后查看）'}</figcaption>
      </figure>
    );
  }
  return (
    <figure className="doc-img">
      <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />
      {alt ? <figcaption>{alt}</figcaption> : null}
    </figure>
  );
}

// 渲染从飞书知识库抓取的 Markdown 正文，按飞书云文档排版规范呈现。
// v2 实体链路退场（2026-10-09）：mention 高亮/悬停卡渲染已随实体 UI 下线移除；
// 正文里的实体标记是前端按投影动态注入的，并非 markdown 固有内容，移除后零残留。
function Markdown({ content, className, headingIds }: MarkdownProps) {
  if (!content) return null;
  // 每次渲染重置计数器，标题与段落都生成稳定的可回溯锚点。
  let headingCounter = 0;
  let paragraphCounter = 0;
  const heading = (Tag: 'h1' | 'h2' | 'h3') =>
    function H({ node, children, ...props }: any) {
      const id = headingIds?.[headingCounter++];
      return (
        <Tag id={id} {...props}>
          <span>{children}</span>
          {id && (
            <a
              className="doc-anchor"
              href={`#${id}`}
              aria-label="打开此标题锚点"
            >
              <Link2 className="h-3.5 w-3.5" />
            </a>
          )}
        </Tag>
      );
    };
  return (
    <div className={`feishu-doc ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: heading('h1'),
          h2: heading('h2'),
          h3: heading('h3'),
          p: ({ node, children, ...props }: any) => {
            const id = `paragraph-${++paragraphCounter}`;
            return (
              <p id={id} {...props}>
                <span>{children}</span>
                <a
                  className="doc-anchor doc-anchor-paragraph"
                  href={`#${id}`}
                  aria-label="打开此段落锚点"
                >
                  <Link2 className="h-3 w-3" />
                </a>
              </p>
            );
          },
          img: ({ node, ...props }: any) => (
            <DocImage src={props.src} alt={props.alt} />
          ),
          a: ({ node, children, href, ...props }: any) => {
            if (String(href ?? '').startsWith('#'))
              return (
                <a href={href} {...props}>
                  {children}
                </a>
              );
            return (
              <a target="_blank" rel="noreferrer" href={href} {...props}>
                {children}
              </a>
            );
          },
          table: ({ node, ...props }: any) => (
            <div className="doc-table-wrap">
              <table>{props.children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// props 不变时跳过整棵重解析（组件映射与计数器随函数体重建的开销主要在这里）。
export default memo(Markdown);

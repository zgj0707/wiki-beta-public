import { Component, type ErrorInfo, type ReactNode } from 'react';
import { withClientBasePath } from '@client/src/lib/base-path';

type RootErrorBoundaryProps = { children: ReactNode };
type RootErrorBoundaryState = { error: Error | null; resetKey: number };

/**
 * Small local fallback for the public shell. It intentionally does not import
 * the platform toolkit, so a public startup failure cannot pull the admin
 * runtime back into the initial dependency graph.
 */
export function RootErrorFallback({
  error,
  onReset,
}: {
  error: Error;
  onReset: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section className="w-full max-w-xl space-y-4" role="alert">
        <div>
          <h1 className="text-xl font-semibold">页面暂时无法加载</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请重试当前页面，或返回首页。
          </p>
        </div>
        {import.meta.env.DEV && (
          <pre className="overflow-auto rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            {error.message}
          </pre>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => window.location.assign(withClientBasePath('/'))}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            返回首页
          </button>
        </div>
      </section>
    </div>
  );
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error, resetKey: 0 };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // Platform-owned telemetry remains outside this local public fallback.
  }

  reset = () => {
    this.setState(({ resetKey }) => ({ error: null, resetKey: resetKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <RootErrorFallback error={this.state.error} onReset={this.reset} />
      );
    }

    return <div key={this.state.resetKey}>{this.props.children}</div>;
  }
}

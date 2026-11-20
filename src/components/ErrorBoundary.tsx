import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort UI guard. A render error (including a failed lazy chunk import)
 * must not leave a blank page: show a readable recovery panel instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Intentionally no logging: no user data or query strings leave the device.
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section
        role="alert"
        className="panel mx-auto mt-10 max-w-lg p-6"
        aria-labelledby="error-boundary-title"
      >
        <h1 id="error-boundary-title" className="m-0 text-xl">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-2)" }}>
          π Atlas hit an unexpected error while rendering this page. Your searches never
          leave your device, and nothing was uploaded.
        </p>
        <p className="mono mt-3 break-words text-xs" style={{ color: "var(--text-2)" }}>
          {error.message || "Unknown error"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload π Atlas
          </button>
        </div>
      </section>
    );
  }
}

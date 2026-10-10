import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What broke, in the reader's words ("the arranging tool"). */
  what: string;
  /** Changing this clears the error (e.g. the route), so navigating away and back retries. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  key?: string;
}

/**
 * Keeps one page's crash (a result the views can't read, a bug) from blanking the whole site: the
 * header and footer stay, and the reader gets a plain message and a reload button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error) {
    console.error(`Cover Part: ${this.props.what} failed`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="tool">
        <div className="notice notice--error page-error" role="alert">
          <p>
            Something went wrong in {this.props.what}, so it stopped instead of showing wrong parts. Reloading the page usually
            fixes it.
          </p>
          <p className="page-error-detail">{this.state.error.message}</p>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </main>
    );
  }
}

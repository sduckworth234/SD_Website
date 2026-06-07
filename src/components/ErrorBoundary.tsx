import { Component, type ReactNode } from "react";

// Catches render-time crashes anywhere below it and shows a calm fallback with a
// reload, instead of a blank white screen. (React error boundaries must be class
// components.)
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Unhandled UI error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="error-screen">
          <div className="error-body">
            <p className="eyebrow">Something went wrong</p>
            <h1>Something went wrong.</h1>
            <p>Sorry — the page hit an unexpected error. A reload usually fixes it.</p>
            <button className="solid-button" type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

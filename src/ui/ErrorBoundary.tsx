import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <main role="alert" className="min-h-0 flex-1 overflow-y-auto bg-bg px-page pt-20 text-center">
        <p className="font-semibold">Qualcosa è andato storto</p>
        <p className="mt-2 text-sm text-muted">{this.state.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-accent"
        >
          Ricarica
        </button>
      </main>
    );
  }
}

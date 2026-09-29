import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { btnPrimary } from "./primitives";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The last line of defence against a blank page.
 *
 * React unmounts the entire tree when a render throws and nothing catches it,
 * which leaves `#root` empty: a white screen with no message and nothing for the
 * user to act on — indistinguishable from the app never having loaded. This keeps
 * the failure on screen instead, with the message and a reload, so a crash is
 * something you can read and report rather than a page that "just doesn't work".
 *
 * It sits above `ClerkProvider` so a failure inside Clerk's own tree is caught too.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console keeps the component stack, which is what narrows down *where* it
    // threw; the screen only has room for the message.
    console.error("[app] render failed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-rose-600">
            <AlertTriangle size={18} />
            <p className="text-sm font-semibold">Something broke while rendering</p>
          </div>
          <p className="mt-2 font-mono text-[11px] break-words text-slate-700">{error.message}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            The browser console has the component stack. Reloading usually clears a hot-reload
            fault introduced while editing.
          </p>
          <button
            type="button"
            className={`${btnPrimary} mt-4`}
            onClick={() => window.location.reload()}
          >
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}

import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { AlertTriangle } from "lucide-react";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import { btnPrimary } from "./components/ui";
import { authEnabled } from "./lib/env";
import { useHashRoute, usePublicRoute } from "./lib/hooks";
import { useWorkspace, WorkspaceLoading, WorkspaceProvider } from "./lib/workspace";
import { SuppliersPage } from "./pages/SuppliersPage";
import { CompetitionPage } from "./pages/CompetitionPage";
import { ClientsPage } from "./pages/ClientsPage";
import { BusinessPage } from "./pages/BusinessPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";

function AppShell() {
  const { route, navigate } = useHashRoute();

  return (
    <Layout route={route} navigate={navigate}>
      {route === "suppliers" ? <SuppliersPage /> : null}
      {route === "competition" ? <CompetitionPage /> : null}
      {route === "clients" ? <ClientsPage /> : null}
      {route === "business" ? <BusinessPage /> : null}
      {route === "notifications" ? <NotificationsPage /> : null}
    </Layout>
  );
}

function LoadError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-rose-600">
          <AlertTriangle size={18} />
          <p className="text-sm font-semibold">We could not load your workspace</p>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          {message ?? "Check your Supabase connection settings and try again."}
        </p>
        <button type="button" className={`${btnPrimary} mt-4`} onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  );
}

/** Signed out → the marketing landing page, or the auth screen behind it. */
function PublicArea() {
  const { route } = usePublicRoute();
  if (route === "sign-in" || route === "sign-up") {
    return <LoginPage initialMode={route} />;
  }
  return <LandingPage />;
}

/** Signed in → make sure the business profile exists before showing the app. */
function WorkspaceGate() {
  const { data, loading, error, needsOnboarding, refresh } = useWorkspace();

  if (loading) return <WorkspaceLoading />;
  if (needsOnboarding) return <OnboardingPage />;
  if (!data) return <LoadError message={error} onRetry={() => void refresh()} />;
  return <AppShell />;
}

export function App() {
  return (
    <ToastProvider>
      {authEnabled ? (
        <>
          <SignedOut>
            <PublicArea />
          </SignedOut>
          <SignedIn>
            <WorkspaceProvider>
              <WorkspaceGate />
            </WorkspaceProvider>
          </SignedIn>
        </>
      ) : (
        <WorkspaceProvider>
          <AppShell />
        </WorkspaceProvider>
      )}
    </ToastProvider>
  );
}

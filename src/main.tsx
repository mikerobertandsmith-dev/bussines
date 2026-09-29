import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { ThemeProvider } from "next-themes";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { authEnabled, env } from "./lib/env";
import "./index.css";

const app = (
  <StrictMode>
    {/* Drives the `.dark` class on <html> for the marketing theme toggle. */}
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <App />
    </ThemeProvider>
  </StrictMode>
);

/*
 * Wrapped in the boundary so a render fault shows a message instead of unmounting
 * the tree into an empty `#root` — see `ErrorBoundary`.
 */
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {authEnabled ? (
      /*
       * Clerk hosts the auth screens itself, so it needs to know where they live.
       * These must be real paths (not hash routes) — an unset signInUrl is what
       * makes Clerk bounce people to its hosted Account Portal instead.
       */
      <ClerkProvider
        publishableKey={env.clerkPublishableKey}
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/"
        signUpFallbackRedirectUrl="/"
        afterSignOutUrl="/"
      >
        {app}
      </ClerkProvider>
    ) : (
      app
    )}
  </ErrorBoundary>,
);

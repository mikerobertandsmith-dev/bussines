import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { authEnabled, env } from "./lib/env";
import "./index.css";

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

/** Clerk hands us paths; this app routes on the hash. */
function toHashRoute(target: string) {
  const path = target.startsWith("#") ? target.slice(1) : target;
  if (window.location.hash !== `#${path}`) window.location.hash = path;
}

createRoot(document.getElementById("root")!).render(
  authEnabled ? (
    <ClerkProvider
      publishableKey={env.clerkPublishableKey}
      afterSignOutUrl="/"
      routerPush={(to) => toHashRoute(to)}
      routerReplace={(to) => toHashRoute(to)}
    >
      {app}
    </ClerkProvider>
  ) : (
    app
  ),
);

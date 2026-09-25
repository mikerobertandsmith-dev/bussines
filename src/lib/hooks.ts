import { useCallback, useEffect, useState } from "react";

/** State that survives a page reload, backed by localStorage. */
export function usePersistentState<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* ignore corrupt storage */
    }
    return initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full or unavailable */
    }
  }, [key, state]);

  const reset = useCallback(() => setState(initial), [initial]);

  return [state, setState, reset] as const;
}

export type RouteId =
  | "suppliers"
  | "competition"
  | "clients"
  | "business"
  | "notifications";

const ROUTES: RouteId[] = [
  "suppliers",
  "competition",
  "clients",
  "business",
  "notifications",
];

function parseHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES.find((r) => r === raw) ?? "suppliers") as RouteId;
}

/** Screens anyone can see before they sign in. */
export type PublicRoute = "landing" | "sign-in" | "sign-up";

/**
 * The auth screens live on real paths because Clerk owns their routing
 * (`/sign-in`, `/sign-up`, plus any nested step it appends). Hash equivalents are
 * still honoured so older links keep working.
 */
function parsePublicRoute(): PublicRoute {
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/sign-in" || path.startsWith("/sign-in/")) return "sign-in";
  if (path === "/sign-up" || path.startsWith("/sign-up/")) return "sign-up";

  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("sign-in")) return "sign-in";
  if (hash.startsWith("sign-up")) return "sign-up";

  // Everything else — including no hash at all — is the marketing landing page,
  // which is the default entry point.
  return "landing";
}

/** Routing for the signed-out marketing and auth screens. */
export function usePublicRoute() {
  const [route, setRoute] = useState<PublicRoute>(() =>
    typeof window === "undefined" ? "landing" : parsePublicRoute(),
  );

  useEffect(() => {
    const onChange = () => setRoute(parsePublicRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);

  /** Client-side navigation between the public screens, without a reload. */
  const go = useCallback((next: PublicRoute) => {
    window.history.pushState({}, "", next === "landing" ? "/" : `/${next}`);
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  return { route, go };
}

export function useHashRoute() {
  const [route, setRoute] = useState<RouteId>(() =>
    typeof window === "undefined" ? "suppliers" : parseHash(),
  );

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: RouteId) => {
    window.location.hash = `/${next}`;
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  return { route, navigate };
}

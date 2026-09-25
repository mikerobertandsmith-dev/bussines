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

export type RouteId = "suppliers" | "competition" | "clients" | "business";

const ROUTES: RouteId[] = ["suppliers", "competition", "clients", "business"];

function parseHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES.find((r) => r === raw) ?? "suppliers") as RouteId;
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

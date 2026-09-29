import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { relativeTime } from "../lib/format";
import { useRefresh } from "../lib/refresh";
import { useToast } from "./Toast";

/** How far down the page must be dragged before letting go refreshes it. */
const TRIGGER_DISTANCE = 72;
/** The indicator stops growing here, so a long drag cannot bury the page. */
const MAX_DISTANCE = 96;
/** Below 1 the page trails the pointer, which is what makes the drag feel weighted. */
const DRAG_RESISTANCE = 0.6;
/** How long the "already current" check plays before it says so. */
const CURRENT_CHECK_MS = 900;
/**
 * How much of a failure reason the toast repeats. The gateway's messages are
 * already written to be read, but a toast is one line and must stay one.
 */
const REASON_LIMIT = 160;

/** A control is not a pull handle: dragging out of one is a selection, not a gesture. */
const INTERACTIVE = "input, textarea, select, button, a";

/**
 * The first failure, in one line, so a toast that says "3 failed" is not the whole
 * story — the gateway's message names the missing setting, the empty keyword list,
 * or the budget that stopped it.
 */
function why(outcome: { error?: string }): string {
  if (!outcome.error) return "";
  const reason =
    outcome.error.length > REASON_LIMIT
      ? `${outcome.error.slice(0, REASON_LIMIT - 1)}…`
      : outcome.error;
  return ` — ${reason}`;
}

/**
 * Drag-down refresh for the pages that share one workspace.
 *
 * The gesture is offered on Suppliers, Competition and My Business, and it runs a
 * single workspace refresh rather than three separate reloads. What the user drags
 * into view is an indicator only: the page keeps the version it is already showing
 * until the new one lands, and nothing is swapped underneath them mid-read.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const { refreshing, pull } = useRefresh();
  const toast = useToast();
  const surface = useRef<HTMLDivElement | null>(null);
  /** The live distance: the touch listeners run outside React's render loop. */
  const dragged = useRef(0);
  const startY = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const [distance, setDistance] = useState(0);
  /** Inside the window: the check is playing, so the bar stays up until it reports. */
  const [checking, setChecking] = useState(false);

  const busy = refreshing || checking;

  const setDrag = useCallback((next: number) => {
    dragged.current = next;
    setDistance(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const outcome = await pull();
      if (outcome.status === "capped") {
        // Inside the window. Play the check, then say the workspace is already
        // current rather than implying a scan ran.
        setChecking(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          setChecking(false);
          toast(`Already up to date — refreshed ${relativeTime(outcome.lastRefreshedAt)}.`);
        }, CURRENT_CHECK_MS);
        return;
      }
      if (outcome.status === "refreshed" && outcome.mode === "collect") {
        // Inside the window with output waiting. Nothing was started, so the sweep's
        // wording would read as "0 of 0 live scans ran" — what happened is that paid
        // crawls were read back.
        const bits = [
          `${outcome.site.ran} of ${outcome.site.attempted} waiting catalogue reads collected`,
        ];
        if (outcome.running) bits.push(`${outcome.running} still running`);
        if (outcome.failed) bits.push(`${outcome.failed} failed`);
        toast(`Collected — ${bits.join(" · ")}${why(outcome)}.`);
      }
      if (outcome.status === "refreshed" && outcome.mode === "sweep") {
        // Reported in two halves because they are two different things: three
        // workspace-wide scans, and one catalogue read per watched site. A crawl
        // that outlived the wait is called out on its own — its money is already
        // spent and the next pull collects it, so folding it into "ran" would
        // overstate what the user actually has.
        const bits = [
          `${outcome.live.ran} of ${outcome.live.attempted} live scans ran`,
          `${outcome.site.ran} of ${outcome.site.attempted} site scans ran`,
        ];
        if (outcome.running) bits.push(`${outcome.running} still running`);
        if (outcome.failed) bits.push(`${outcome.failed} failed`);
        toast(`Refreshed — ${bits.join(" · ")}${why(outcome)}.`);
      }
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The workspace could not be refreshed.");
    }
  }, [pull, toast]);

  /** Ends a drag: releases past the threshold refresh, anything shorter springs back. */
  const settle = useCallback(() => {
    const released = dragged.current;
    startY.current = null;
    setDrag(0);
    if (released >= TRIGGER_DISTANCE) void refresh();
  }, [refresh, setDrag]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Touch is handled by hand rather than through React's props: `touchmove` has to
   * be non-passive so the drag can stop the browser's own pull-to-refresh from
   * taking the gesture, and React registers it passively at the root.
   */
  useEffect(() => {
    const node = surface.current;
    if (!node) return;

    function onTouchStart(event: TouchEvent) {
      startY.current = null;
      const touch = event.touches[0];
      const target = event.target;
      // The gesture only belongs to the top of the page.
      if (busy || !touch || window.scrollY > 0) return;
      if (target instanceof Element && target.closest(INTERACTIVE)) return;
      startY.current = touch.clientY;
    }

    function onTouchMove(event: TouchEvent) {
      if (startY.current === null) return;
      const touch = event.touches[0];
      if (!touch) return;
      const next = (touch.clientY - startY.current) * DRAG_RESISTANCE;
      if (next <= 0) {
        setDrag(0);
        return;
      }
      // Taken over only once the drag is downward, so an ordinary scroll of the
      // page is never swallowed by the gesture.
      if (event.cancelable) event.preventDefault();
      setDrag(Math.min(MAX_DISTANCE, next));
    }

    function onTouchEnd() {
      if (startY.current === null) return;
      settle();
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [busy, settle, setDrag]);

  const ready = distance >= TRIGGER_DISTANCE;
  const label = checking
    ? "Checking for new data…"
    : refreshing
      ? "Refreshing — running your scans; this page keeps the last version until it lands"
      : ready
        ? "Release to refresh"
        : "Pull down to refresh — suppliers, competitors and your business update together";

  return (
    <div
      ref={surface}
      role="group"
      aria-label="Pull down to refresh suppliers, competitors and your business"
      className={`overscroll-contain ${distance > 0 ? "select-none" : ""}`}
      onPointerDown={(event) => {
        startY.current = null;
        // Touch is claimed by the listeners above, which can prevent the scroll.
        if (event.pointerType === "touch") return;
        if (busy || window.scrollY > 0) return;
        const target = event.target;
        if (target instanceof Element && target.closest(INTERACTIVE)) return;
        startY.current = event.clientY;
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "touch" || startY.current === null) return;
        const next = (event.clientY - startY.current) * DRAG_RESISTANCE;
        if (next <= 0) {
          setDrag(0);
          return;
        }
        // Once we are actually pulling, stop the drag from extending a text
        // selection across the page underneath it.
        if (event.cancelable) event.preventDefault();
        setDrag(Math.min(MAX_DISTANCE, next));
      }}
      onPointerUp={() => {
        if (startY.current === null) return;
        settle();
      }}
      onPointerCancel={() => {
        startY.current = null;
        setDrag(0);
      }}
      onPointerLeave={() => {
        startY.current = null;
        setDrag(0);
      }}
    >
      {distance > 0 || refreshing || checking ? (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
          {refreshing || checking ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-indigo-600" />
          ) : (
            <ArrowDown
              size={14}
              className={`shrink-0 text-indigo-600 transition-transform ${ready ? "rotate-180" : ""}`}
            />
          )}
          <span>{label}</span>
        </div>
      ) : null}

      {children}
    </div>
  );
}

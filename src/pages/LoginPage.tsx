import { useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import { BarChart3, Binoculars, Mail, ShieldCheck, Truck } from "lucide-react";
import { configSummary } from "../lib/env";

export function LoginPage() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-up");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between bg-slate-900 px-10 py-12 text-slate-300 lg:flex">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white">
              <ShieldCheck size={20} />
            </span>
            <div>
              <p className="text-base font-semibold text-white">Market Watch</p>
              <p className="text-xs text-slate-400">Supplier &amp; competitor monitoring</p>
            </div>
          </div>

          <h1 className="mt-12 max-w-md text-3xl font-semibold leading-tight text-white">
            Know what your suppliers and competitors did — before your customers do.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-slate-400">
            Create your account, tell us about your business once, and your dashboard fills with
            supplier stock changes, competitor price moves, ad signals, review drops and your own SEO
            and GEO scores.
          </p>

          <ul className="mt-10 space-y-4">
            {[
              { icon: <Truck size={16} />, title: "Supplier feeds", body: "New inventory, restocks and buy-price changes on every supplier site you watch." },
              { icon: <Binoculars size={16} />, title: "Competitor watch", body: "Their traffic, keyword gaps, social channels, ads and customer reviews." },
              { icon: <BarChart3 size={16} />, title: "Your own scores", body: "SEO, GEO, traffic, industry rank and the inventory you should stock next." },
              { icon: <Mail size={16} />, title: "Client messaging", body: "Scheduled alerts and check-ins to your own customers, on your cadence." },
            ].map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-indigo-300">
                  {item.icon}
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="text-xs text-slate-400">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-slate-500">
          Auth: {configSummary.auth} · Data: {configSummary.database}
        </p>
      </aside>

      <main className="flex items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-5 flex items-center justify-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <ShieldCheck size={18} />
            </span>
            <span className="text-base font-semibold text-slate-900">Market Watch</span>
          </div>

          <div className="mb-4 flex rounded-xl border border-slate-200 bg-white p-1">
            {(
              [
                { value: "sign-up", label: "Create account" },
                { value: "sign-in", label: "I already have one" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setMode(tab.value)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === tab.value
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {mode === "sign-up" ? (
              <SignUp routing="virtual" signInUrl="#/sign-in" />
            ) : (
              <SignIn routing="virtual" signUpUrl="#/sign-up" />
            )}
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-500">
            After signing up you will be asked a few questions about your business so the monitoring
            starts on the right suppliers, competitors and clients.
          </p>
        </div>
      </main>
    </div>
  );
}

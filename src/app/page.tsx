"use client";

import { useCallback, useEffect, useState } from "react";

type Principal = {
  id?: string;
  email?: string;
  fullName?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown;
};

type ProbeState =
  | { phase: "loading" }
  | { phase: "unauthenticated"; status: number }
  | { phase: "authenticated"; status: number; principal: Principal }
  | { phase: "error"; message: string };

export default function SmokeScreen() {
  const [state, setState] = useState<ProbeState>({ phase: "loading" });

  const probe = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (res.status === 401) {
        setState({ phase: "unauthenticated", status: 401 });
        return;
      }
      if (!res.ok) {
        setState({
          phase: "error",
          message: `Unexpected status ${res.status} from /api/auth/me`,
        });
        return;
      }
      const body = (await res.json()) as Principal;
      setState({ phase: "authenticated", status: res.status, principal: body });
    } catch (err) {
      setState({
        phase: "error",
        message:
          err instanceof Error
            ? err.message
            : "Network error contacting the proxy",
      });
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  return (
    <div className="min-h-screen bg-surface-muted text-ink-800">
      <header className="h-topbar flex items-center justify-between border-b border-border-default bg-navy-800 text-navy-50 px-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-thead-caps text-navy-100">
            ENVIABLE
          </span>
          <span className="h-4 w-px bg-navy-600/60" />
          <span className="text-small text-navy-100/80">
            Inventory and Operations
          </span>
        </div>
        <div className="flex items-center gap-3 text-small text-navy-100/80">
          <span>frontend smoke probe</span>
          <span className="rounded-sm border border-navy-600/60 px-1.5 py-0.5 text-micro uppercase tracking-wider text-navy-50">
            scaffold
          </span>
        </div>
      </header>

      <div className="flex">
        <aside className="w-sidebar h-[calc(100vh-44px)] border-r border-border-default bg-surface">
          <nav className="py-2">
            {[
              { label: "Dashboard", active: true },
              { label: "Procurement" },
              { label: "Inventory" },
              { label: "Sales" },
              { label: "Payments" },
              { label: "Reports" },
              { label: "Admin" },
            ].map((item) => (
              <div
                key={item.label}
                className={`px-4 py-1.5 text-body ${
                  item.active
                    ? "bg-navy-50 text-navy-800 border-l-2 border-navy-700"
                    : "text-ink-600 hover:bg-ink-50 border-l-2 border-transparent"
                }`}
              >
                {item.label}
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex-1 p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h1 className="text-page font-semibold text-ink-900">
              Auth proxy smoke check
            </h1>
            <span className="text-small text-ink-500">
              GET <span className="text-mono-id">/api/auth/me</span>
            </span>
          </div>

          <section className="grid grid-cols-3 gap-4 mb-4">
            <KpiTile
              label="Proxy reachable"
              value={
                state.phase === "loading"
                  ? "checking..."
                  : state.phase === "error"
                    ? "no"
                    : "yes"
              }
              tone={
                state.phase === "error"
                  ? "danger"
                  : state.phase === "loading"
                    ? "neutral"
                    : "success"
              }
            />
            <KpiTile
              label="HTTP status"
              value={
                state.phase === "loading" || state.phase === "error"
                  ? "--"
                  : String(state.status)
              }
              tone={
                state.phase === "authenticated"
                  ? "success"
                  : state.phase === "unauthenticated"
                    ? "warning"
                    : "neutral"
              }
              mono
            />
            <KpiTile
              label="Session"
              value={
                state.phase === "authenticated"
                  ? "active"
                  : state.phase === "unauthenticated"
                    ? "none"
                    : state.phase === "error"
                      ? "unknown"
                      : "..."
              }
              tone={
                state.phase === "authenticated"
                  ? "success"
                  : state.phase === "unauthenticated"
                    ? "warning"
                    : "neutral"
              }
            />
          </section>

          <section className="rounded-md border border-border-default bg-surface">
            <header className="flex items-center justify-between border-b border-border-default px-4 py-2">
              <h2 className="text-section font-semibold text-ink-800">
                Response detail
              </h2>
              <button
                type="button"
                onClick={() => void probe()}
                className="h-control px-3 rounded-sm bg-navy-700 text-navy-50 text-body font-medium hover:bg-navy-800 active:bg-navy-900 disabled:opacity-50"
                disabled={state.phase === "loading"}
              >
                {state.phase === "loading" ? "Probing..." : "Re-probe"}
              </button>
            </header>

            <div className="px-4 py-3 text-body">
              {state.phase === "loading" && (
                <p className="text-ink-500">Contacting /api/auth/me...</p>
              )}

              {state.phase === "unauthenticated" && (
                <div className="space-y-2">
                  <p>
                    Proxy reached the backend. No session cookie present, so
                    the backend returned{" "}
                    <span className="text-mono-id text-warning-700">401</span>.
                    This is the expected pre-login state and confirms the
                    rewrite at <span className="text-mono-id">/api/*</span> is
                    forwarding to the backend.
                  </p>
                  <p className="text-small text-ink-500">
                    Once login lands, Set-Cookie from the backend will reach
                    the browser (httpOnly), and this probe will return the
                    principal without any JavaScript ever reading the cookie.
                  </p>
                </div>
              )}

              {state.phase === "authenticated" && (
                <div className="space-y-2">
                  <p>
                    Authenticated as{" "}
                    <span className="text-mono-id text-navy-700">
                      {state.principal.email ?? state.principal.id ?? "principal"}
                    </span>
                    .
                  </p>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-sm border border-border-subtle bg-surface-muted px-3 py-2 font-mono text-small text-ink-700">
                    {JSON.stringify(state.principal, null, 2)}
                  </pre>
                </div>
              )}

              {state.phase === "error" && (
                <div className="rounded-sm border border-danger-100 bg-danger-50 px-3 py-2 text-danger-800">
                  <p className="font-medium">Proxy probe failed</p>
                  <p className="text-small">{state.message}</p>
                  <p className="text-small text-ink-600 mt-1">
                    Check that the backend dev server is running on the URL
                    set by{" "}
                    <span className="text-mono-id">BACKEND_API_URL</span>{" "}
                    (default{" "}
                    <span className="text-mono-id">http://localhost:3000</span>
                    ).
                  </p>
                </div>
              )}
            </div>

            <footer className="border-t border-border-default px-4 py-2 text-small text-ink-500 flex justify-between">
              <span>
                Proxy target:{" "}
                <span className="text-mono-id">
                  {"<BACKEND_API_URL>/api/*"}
                </span>
              </span>
              <span>
                Throwaway scaffold. Real screens land in later prompts.
              </span>
            </footer>
          </section>
        </main>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
  mono?: boolean;
}) {
  const toneClasses = {
    success: "text-success-700",
    warning: "text-warning-700",
    danger: "text-danger-700",
    neutral: "text-ink-700",
  }[tone];

  return (
    <div className="rounded-md border border-border-default bg-surface px-4 py-3">
      <div className="text-thead-caps mb-1">{label}</div>
      <div
        className={`text-kpi font-semibold ${toneClasses} ${
          mono ? "text-mono-id" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

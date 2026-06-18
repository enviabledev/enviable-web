"use client";

/**
 * Embeds the backend-rendered invoice HTML so the user sees the invoice in
 * context, exactly as the PDF will render it (same backend template). The
 * rendered document is fetched on demand from the backend HTML endpoint and
 * dropped into a sandboxed iframe for visual isolation (the invoice carries
 * its own A4 layout / fonts that must not leak into the app shell, and the app
 * shell must not bleed into the invoice).
 *
 * Online-only by nature: the backend renders on demand, so the rendered
 * document needs a connection. The honest offline treatment is to say so
 * plainly. The underlying invoice summary (from the mirror) is painted by the
 * parent page; this frame is only the rendered-document surface, so when
 * offline it shows a "requires a connection" notice rather than a blank box.
 *
 * No window.print(), no browser print stylesheet: the only way to a printed
 * artifact is the Print button, which fetches the backend PDF.
 */
import { useEffect, useRef, useState } from "react";

import OfflineNotice from "@/components/sync/OfflineNotice";
import { useConnectivity } from "@/lib/sync/connectivity";

import PrintButton from "./PrintButton";

type FrameState =
  | { kind: "loading" }
  | { kind: "ready"; html: string }
  | { kind: "offline" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

export default function InvoiceDocumentFrame({
  htmlPath,
  pdfPath,
  pdfFilename,
  docNoun = "document",
}: {
  htmlPath: string;
  pdfPath: string;
  pdfFilename?: string;
  docNoun?: string;
}) {
  const { state: connState } = useConnectivity();
  const [state, setState] = useState<FrameState>({ kind: "loading" });
  const [frameHeight, setFrameHeight] = useState(A4_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Fit-to-width: the rendered document is a fixed 794px A4 page. On a viewport
  // narrower than that (mobile/tablet) we scale the whole page down so the user
  // sees the full page instead of the clipped left third. scale = 1 at desktop
  // widths (>= 794 of usable content), so the document is never enlarged.
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // available content width = container minus its horizontal padding (px-4).
      const avail = el.clientWidth - 32;
      setScale(avail > 0 ? Math.min(1, avail / A4_WIDTH) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refetch the rendered HTML when the path changes or the connection returns.
  // connState in the dep array gives a free retry on reconnect: an offline
  // open flips to the rendered document once the network is back.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      let res: Response;
      try {
        res = await fetch(htmlPath, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
      } catch {
        if (!cancelled) setState({ kind: "offline" });
        return;
      }
      if (cancelled) return;
      if (res.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      if (res.status === 401) {
        setState({
          kind: "error",
          message: "Your session has expired. Reload to view this document.",
        });
        return;
      }
      if (res.status >= 500) {
        // Treat a broken/unreachable backend as offline, consistent with the
        // connectivity manager's 5xx-is-offline rule.
        setState({ kind: "offline" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Could not render the ${docNoun} (HTTP ${res.status}).`,
        });
        return;
      }
      const html = await res.text();
      if (!cancelled) setState({ kind: "ready", html });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [htmlPath, connState, docNoun]);

  // Size the iframe to its content so the A4 page shows in full without an
  // inner scrollbar. sandbox="allow-same-origin" keeps the embedded document
  // script-free (no allow-scripts) for isolation while still letting the
  // parent read its height for sizing.
  const onFrameLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const h = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
      A4_HEIGHT,
    );
    setFrameHeight(h);
  };

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Rendered document
        </h2>
        <PrintButton pdfPath={pdfPath} fallbackFilename={pdfFilename} variant="primary" />
      </header>

      <div ref={scrollRef} className="px-4 py-5 bg-[var(--color-ink-100)] overflow-auto flex justify-center min-h-[420px]">
        {state.kind === "loading" && (
          <div className="self-center text-center text-[12.5px] text-[var(--color-ink-500)]">
            <span className="inline-flex items-center gap-2.5">
              <span className="inline-block w-[10px] h-[10px] rounded-full bg-[var(--color-navy-700)] animate-pulse" />
              Rendering the {docNoun}...
            </span>
          </div>
        )}

        {state.kind === "ready" && (
          // Outer box reserves the SCALED footprint so the layout (centering,
          // height) is correct; the iframe renders at full A4 size and is
          // visually scaled to fit. transform-origin top-left so the scaled
          // page pins to the box's top-left.
          <div style={{ width: A4_WIDTH * scale, height: frameHeight * scale }}>
            <iframe
              ref={iframeRef}
              title={`Rendered ${docNoun}`}
              data-testid="invoice-document-frame"
              sandbox="allow-same-origin"
              srcDoc={state.html}
              onLoad={onFrameLoad}
              style={{
                width: A4_WIDTH,
                height: frameHeight,
                border: "none",
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              className="bg-white shadow-[0_1px_4px_rgba(15,23,42,0.12)]"
            />
          </div>
        )}

        {state.kind === "offline" && (
          <div className="self-center w-full" data-testid="document-offline-notice">
            <OfflineNotice
              title="Rendered document requires a connection"
              body={`The invoice summary above is from your local mirror, but the rendered ${docNoun} is generated by the server on demand. It will appear here when the connection returns. The Print button is disabled offline for the same reason.`}
            />
          </div>
        )}

        {state.kind === "forbidden" && (
          <div className="self-center text-center text-[12.5px] text-[var(--color-ink-500)]">
            You do not have permission to view this {docNoun}.
          </div>
        )}

        {state.kind === "error" && (
          <div className="self-center text-center text-[12.5px] text-[var(--color-danger-700)]">
            {state.message}
          </div>
        )}
      </div>
    </section>
  );
}

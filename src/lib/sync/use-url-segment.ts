"use client";

import { useEffect, useState } from "react";

/**
 * Read the last segment of window.location.pathname, URI-decoded.
 *
 * Use this in detail-page components INSTEAD OF next/navigation's useParams
 * for the dynamic id. Background, 2026-06: the SW's sibling-URL fallback
 * (see public/sw.js findSiblingFallback) serves a cached sibling URL's
 * HTML when an uncached detail URL is requested offline. The cached HTML's
 * embedded RSC payload was server-rendered for the sibling URL, so Next's
 * router context (and therefore useParams) reports the SIBLING's id, not
 * the URL bar's id. A detail page that reads from useParams ends up
 * fetching the sibling's data from the mirror and rendering it under the
 * wrong URL (Kalu's TVSKGS25E0001237 URL rendered TVSKGS25E00012317's
 * data).
 *
 * Reading window.location.pathname directly bypasses Next's router context
 * and gets the URL the browser actually shows. SSR/initial render returns
 * the empty string (no window.location available server-side), which the
 * page treats as "still loading"; the useEffect fires on mount and the
 * page re-renders with the correct id.
 *
 * popstate covers browser back/forward. Soft-nav across detail URLs
 * remounts the [id] page (Next's segment-change behavior), so the
 * mount-time read picks up the new URL automatically.
 */
export function useUrlLastSegment(): string {
  const [seg, setSeg] = useState("");
  useEffect(() => {
    const sync = () => {
      const segments = window.location.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1] ?? "";
      setSeg(decodeURIComponent(last));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return seg;
}

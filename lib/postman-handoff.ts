/* ---------------------------------------------------------------------
   Send to PostMan

   PostMan (the KISEM report generator) can open this app with the plant
   already named. When it does, the engineer gets one extra button: it
   posts back the SAME .xlsx this app already exports, base64, and PostMan
   reads it with the ordinary importer. No file downloaded, no file dialog,
   no second format to keep in step.

   Export-and-drop is untouched and remains the route that always works.
   This only removes two clicks when the two are open together.

   Contract: rdudr/PostMAN docs/HANDOFF.md
   --------------------------------------------------------------------- */

/* PostMan's own deployments. An `origin` arrives in a URL and a URL can be
   written by anyone, so it is checked against this list and nothing else.
   Without the check, any site could open this app with
   `origin=https://collector.example` and be handed the plant's
   measurements the moment the engineer pressed the button.

   NEXT_PUBLIC_POSTMAN_ORIGINS (comma separated) adds to the list for a
   preview deployment. Do NOT relax this to a suffix match on
   `.vercel.app` - every preview deployment on Vercel would satisfy it. */
const BUILT_IN_ORIGINS = [
  "https://post-man-iota.vercel.app",
  "https://post-man-rdudrs-projects.vercel.app",
  "http://localhost:8801",
];

export function postmanOrigins(): string[] {
  const extra = (process.env.NEXT_PUBLIC_POSTMAN_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...BUILT_IN_ORIGINS, ...extra];
}

export type PostmanHandoff = {
  origin: string;   // where to post back to - already checked against the list
  company: string;  // the plant name PostMan's report is for
  fy: string;       // financial year, e.g. "2025-26"
};

const SESSION_KEY = "postman.handoff";

/* Read the query PostMan opened us with and remember it for the session.

   It has to be remembered: the parameters are on the landing URL, and the
   first client-side navigation drops them. `window.opener` survives that,
   so the channel is still there afterwards - only the addressing would be
   lost. Call this once, high up, on mount. */
export function captureHandoff(): PostmanHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("from") === "postman") {
      const origin = q.get("origin") || "";
      if (postmanOrigins().includes(origin)) {
        const h: PostmanHandoff = {
          origin,
          company: q.get("company") || "",
          fy: q.get("fy") || "",
        };
        window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(h));
        return h;
      }
      /* Opened by something claiming to be PostMan from an address we do
         not know. Behave as though it were an ordinary visit. */
      console.warn("[postman] ignoring unknown origin:", origin);
    }
    return getHandoff();
  } catch {
    return null;
  }
}

export function getHandoff(): PostmanHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as PostmanHandoff;
    /* Re-check on every read: the list can change between deployments and
       sessionStorage is not a place to store trust. */
    return h && postmanOrigins().includes(h.origin) ? h : null;
  } catch {
    return null;
  }
}

/* True when there is a PostMan to send to AND a window to send through.
   `window.opener` is null if the tab was reloaded from history or opened
   by hand, in which case the button should not be offered at all. */
export function canSendToPostman(): boolean {
  if (typeof window === "undefined") return false;
  return !!getHandoff() && !!window.opener && !window.opener.closed;
}

/* Hand the workbook over. `workbookBase64` is exactly what this app's own
   export writes - same bytes, same sheets, same column names. */
export function sendToPostman(
  workbookBase64: string,
  company: string,
  format: string
): { ok: boolean; reason?: string } {
  const h = getHandoff();
  if (!h) return { ok: false, reason: "This app was not opened from PostMan." };
  if (typeof window === "undefined" || !window.opener || window.opener.closed) {
    return { ok: false, reason: "The PostMan window has been closed." };
  }
  try {
    window.opener.postMessage(
      { kind: "kisem-data", format, company, workbook: workbookBase64 },
      h.origin
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

import type { Inspection, InspectionReport, Paged } from '@/types/api';

import { get, http } from './client';

/**
 * Reports.
 *
 * The backend returns a structured report payload. Rendering it to PDF is still
 * not done in this file, and the reason has not changed: a PDF built from
 * whatever the operator's screen happened to contain is the wrong provenance
 * for a document that may be served on a dealer.
 *
 * `printReport` below is not that. It asks the server for the report — the same
 * document the inspector app produces, rendered by `renderReportHtml` from the
 * stored payload — and hands that to the browser's print dialogue, where the
 * operator saves it as PDF. The bytes originate on the server and the console
 * never composes the document; it only prints what it was given.
 */

export function getInspectionReport(id: string): Promise<InspectionReport> {
  return get<InspectionReport>(`/inspections/${id}/report`);
}

/**
 * Fetches the server-rendered report and opens the print dialogue on it.
 *
 * The window is opened *before* the request, empty, because a browser only
 * honours `window.open` while it can still see the click that caused it — and
 * an `await` in between loses that. It is filled in when the HTML arrives, so
 * the operator sees the tab appear immediately rather than wondering whether
 * the button did anything.
 *
 * The request goes through `http` rather than `fetch` so it carries the session
 * token and the refresh-on-401 retry like every other call. `?format=html` is
 * the printable rendering; the JSON payload is the same document's data.
 *
 * Returns nothing and throws on failure, so the caller can report it — a
 * download that silently does nothing is worse than one that says why.
 */
export async function printReport(id: string, reference?: string): Promise<void> {
  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('The browser blocked the report window. Allow pop-ups for this site.');
  }

  win.document.write('<p style="font:14px system-ui;padding:24px">Preparing the report…</p>');

  try {
    const { data } = await http.get<string>(`/inspections/${id}/report`, {
      params: { format: 'html' },
      responseType: 'text',
      // The report is HTML, not the JSON envelope every other response uses.
      transformResponse: [(body: string) => body],
    });

    win.document.open();
    win.document.write(data);
    win.document.close();
    if (reference) win.document.title = reference;

    // Let the document lay out — and its images load — before the dialogue
    // opens, or the operator gets a print preview of a half-drawn page. The
    // timer is a floor, not a second attempt: `load` does not fire at all if
    // an image 404s, and a report that never offers to print is the worse
    // failure. Whichever arrives first wins and the other is a no-op.
    let printed = false;
    const printOnce = () => {
      if (printed) return;
      printed = true;
      win.print();
    };
    win.addEventListener('load', printOnce, { once: true });
    win.setTimeout(printOnce, 1500);
  } catch (error) {
    win.close();
    throw error;
  }
}

export interface ReportListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  productCategory?: string;
  from?: string;
  to?: string;
}

/**
 * The reports index.
 *
 * A report is not a stored entity — it is a rendering of an inspection. So the
 * list of "available reports" is the list of inspections that have been
 * assessed, which is what this asks for.
 */
export function listReportableInspections(
  filters: ReportListFilters = {},
): Promise<Paged<Inspection>> {
  return get<Paged<Inspection>>('/inspections', {
    ...filters,
    sort: 'newest',
  } as Record<string, unknown>);
}

import { useCallback, useMemo, useRef, useState } from 'react';

import { dialog, notify } from '../components/Dialog';

import type { ExportOption } from '../components/ExportSheet';
import { toApiError } from '../services/api';
import {
  openPdf,
  savePdfToDevice,
  sharePdf,
  type DocumentSource,
  type SaveOutcome,
} from '../services/exportService';

/**
 * Drives the Download PDF button.
 *
 * Downloading offers two destinations rather than one, because they answer
 * different questions. "Save to device" puts the PDF in a folder the officer
 * picks and can browse back to; "Share" hands it to the system sheet for
 * sending on to a supervisor or a dealer. A single button that only ever opened
 * the share sheet left an officer who wanted a copy on the handset with no way
 * to get one.
 *
 * The document is built lazily through `resolve`, which returns `null` while
 * the underlying record is still loading. That lets the button live in a
 * screen's action bar from the first frame without it being able to export a
 * half-loaded record.
 */
export function useDocumentExport(resolve: () => DocumentSource | null) {
  const [downloading, setDownloading] = useState(false);

  // Held in a ref so the callbacks stay stable while the screen re-renders.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  const run = useCallback(async (action: (source: DocumentSource) => Promise<SaveOutcome>) => {
    const source = resolveRef.current();
    if (!source) {
      void notify({
        title: 'Nothing to export yet',
        message: 'The record is still loading. Try again in a moment.',
      });
      return;
    }

    setDownloading(true);
    try {
      const outcome = await action(source);

      /**
       * ── A SAVE IS CONFIRMED, NOT FOLLOWED UP ───────────────────────────
       *
       * The confirmation used to offer `Open` beside `Done`, on the reasoning
       * that an officer holding the packet would want to look at the report
       * straight away. In the field it read as a second decision at the end of
       * a flow that was already finished, and it pushed the officer out of the
       * app into a PDF viewer they then had to come back from.
       *
       * So a completed save is now a plain acknowledgement. The file name and
       * the folder are still named, which is what an officer needs to find it
       * again; getting it open is the file manager's job, not this screen's.
       *
       * `app_only` below keeps its `Open`, because there the file exists and
       * nothing on the device offers a folder or a share sheet to reach it —
       * removing the action would strand the document.
       */
      if (outcome.status === 'saved') {
        void notify({
          title: 'Report saved',
          message: `${outcome.fileName} was saved to ${outcome.folder}.`,
          tone: 'success',
        });
      } else if (outcome.status === 'app_only') {
        // The case where opening it here is the *only* way to reach it: the
        // file exists, and nothing on this device offers a folder or a sheet.
        const open = await dialog<boolean>({
          title: 'Report ready',
          message: `${outcome.fileName} was produced, but this device offers no folder to save it to.`,
          tone: 'warning',
          dismissValue: false,
          actions: [
            { label: 'Open', value: true, style: 'default' },
            { label: 'Done', value: false, style: 'cancel' },
          ],
        });

        if (open === true) await openPdf(outcome.uri, outcome.fileName);
      }
      // A completed share needs no alert — the share sheet was its own
      // confirmation, and on Android an alert would land behind the chooser.
      // A cancellation needs none either: the officer chose to back out.
    } catch (error) {
      void notify({ title: 'Download failed', message: toApiError(error).message, tone: 'danger' });
    } finally {
      setDownloading(false);
    }
  }, []);

  /**
   * Asks where the PDF should go, then produces it.
   *
   * The choice is put first, before the render, so an officer who picked the
   * wrong one has not already waited through a document being built.
   *
   * The question is asked by `ExportSheet` rather than by `Alert.alert`, which
   * is what this used to use. The alert offered two bare labels with nothing to
   * say what either did, in a dialog identical to the one that reports a
   * failure; saving and sharing have different consequences in the field and
   * each now carries a line explaining itself.
   */
  const [sheetOpen, setSheetOpen] = useState(false);

  const download = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const options: ExportOption[] = useMemo(
    () => [
      {
        key: 'save',
        icon: 'download-outline',
        title: 'Save to device',
        description: 'Pick a folder. The copy stays on this handset, offline.',
        onSelect: () => void run(savePdfToDevice),
      },
      {
        key: 'share',
        icon: 'share-outline',
        title: 'Share',
        description: 'Send it on — email, WhatsApp, or another app.',
        onSelect: () => void run(sharePdf),
      },
    ],
    [run],
  );

  /** Saves straight to a folder, with no intermediate prompt. */
  const saveToDevice = useCallback(() => void run(savePdfToDevice), [run]);

  /** Opens the share sheet, with no intermediate prompt. */
  const share = useCallback(() => void run(sharePdf), [run]);

  return {
    downloading,
    /** Opens the destination sheet. */
    download,
    saveToDevice,
    share,
    /**
     * Props for the sheet, spread onto an `ExportSheet` inside the screen.
     *
     * A hook cannot render a modal itself, and returning props rather than a
     * ready-made element keeps the screen in charge of where in its tree the
     * modal sits — which matters, because a sheet mounted inside a scroll view
     * inherits its transform.
     */
    sheet: {
      visible: sheetOpen,
      title: 'Download report',
      subtitle: 'Where should the PDF go?',
      options,
      onClose: closeSheet,
    },
  };
}

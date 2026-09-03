import { useCallback, useMemo, useRef, useState } from 'react';

import { notify } from '../components/Dialog';

import type { ExportOption } from '../components/ExportSheet';
import { toApiError } from '../services/api';
import {
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

      if (outcome.status === 'saved') {
        void notify({
          title: 'Saved to device',
          message: `${outcome.fileName} was saved to ${outcome.folder}.`,
          tone: 'success',
        });
      } else if (outcome.status === 'app_only') {
        void notify({
          title: 'PDF ready',
          message: `${outcome.fileName} was produced, but this device offers no way to save or share it.`,
          tone: 'warning',
        });
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

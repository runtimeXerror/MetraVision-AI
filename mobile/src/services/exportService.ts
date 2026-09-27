import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { ApiError } from '../types';

import { primeBrandImages } from './documents/brandImages';
import { A4 } from './documents/html';

/**
 * ── PDF EXPORT ──────────────────────────────────────────────────────────────
 * Renders a document to PDF on the device and hands it to the share sheet, from
 * which the officer saves it to Files/Drive, mails it, or sends it on.
 *
 * PDF is the only export format, and that is a decision rather than a gap. An
 * enforcement document that leaves the device in an editable container can be
 * altered after issue with nothing to show for it. Amendments belong *in* the
 * app, where they are recorded against the officer who made them and printed
 * beside the value they replaced — which is what the report editor does.
 *
 * Files are written to the cache directory. An exported copy is a derivative of
 * the record, and the record lives on the server: if the OS reclaims the cache,
 * nothing is lost that cannot be regenerated, and enforcement documents are not
 * left sitting in app storage indefinitely.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface DocumentSource {
  /** File name without an extension; sanitised before use. */
  baseName: string;
  /** Print-ready HTML. Built lazily — a long report is not free to render. */
  html: () => string;
}

export interface ExportResult {
  fileName: string;
  /** Where the PDF was written inside the app's own storage. */
  uri: string;
}

export type SaveOutcome =
  /**
   * `uri` is the app's own copy, not the one in the chosen folder.
   *
   * Carried so the confirmation can offer to open the report there and then.
   * The folder copy cannot be opened: on Android it lives behind a Storage
   * Access Framework tree the app holds no read grant for, and its path is not
   * something any viewer can be pointed at. The cache copy is byte-identical,
   * still on disk, and openable — so it is what "Open" hands over.
   */
  | { status: 'saved'; fileName: string; folder: string; uri: string }
  | { status: 'shared'; fileName: string }
  /** The officer backed out of the folder picker or the share sheet. */
  | { status: 'cancelled' }
  /** No share sheet and no picker: the file exists, but only inside the app. */
  | { status: 'app_only'; fileName: string; uri: string };

/**
 * Strips anything a file system will reject.
 *
 * Report references are safe already, but a business name reaches this from
 * free text an inspector typed in the field, and `Sharma & Sons / Kirana` would
 * otherwise be read as a path.
 */
function safeName(name: string): string {
  const cleaned = name
    // Control characters, plus everything Windows, Android or iOS rejects.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : 'document';
}

/** The one place exported files are written. */
function exportsDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'exports');
  if (!directory.exists) directory.create({ idempotent: true });
  return directory;
}

/**
 * Keeps the export folder from growing without bound.
 *
 * An officer who exports twenty reports in a day should not be carrying twenty
 * PDFs of them around. Newest are kept; the share sheet has long since copied
 * anything that was actually saved.
 */
function prune(directory: Directory, keep = 12): void {
  try {
    const files = directory
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .sort((a, b) => (b.modificationTime ?? 0) - (a.modificationTime ?? 0));

    for (const file of files.slice(keep)) file.delete();
  } catch {
    // Housekeeping must never be the reason an export fails.
  }
}

/**
 * Renders the document to a PDF inside the app's own cache.
 *
 * Private to this module: on its own the result is a file in a directory no
 * officer can browse to. Every caller goes on to either save it somewhere real
 * or hand it to the share sheet.
 */
async function renderPdf(source: DocumentSource): Promise<ExportResult> {
  const fileName = `${safeName(source.baseName)}.pdf`;
  let file: File;

  try {
    const directory = exportsDirectory();
    prune(directory);

    // The letterhead artwork has to be inlined as bytes before the document is
    // rendered — the builders are synchronous and read it from a cache.
    await primeBrandImages();

    // `printToFileAsync` writes to a cache path of its own choosing under a
    // generated name. It is moved under the report's own name so that what the
    // officer sees in the share sheet, and later in Files, identifies the
    // record — `Print-a1b2c3.pdf` is not a document anyone can file.
    const printed = await Print.printToFileAsync({
      html: source.html(),
      width: A4.width,
      height: A4.height,
      base64: false,
    });

    const target = new File(directory, fileName);
    if (target.exists) target.delete();

    const rendered = new File(printed.uri);
    rendered.move(target);
    file = target.exists ? target : rendered;
  } catch (error) {
    throw new ApiError(
      'export_failed',
      'The PDF could not be produced on this device. Check that there is free storage and try again.',
      { details: error },
    );
  }

  return { fileName, uri: file.uri };
}

/**
 * Writes the PDF to a folder the officer chooses on the device.
 *
 * This is the one that answers "where did my download go". The app's own
 * storage is not somewhere an officer can browse to, so the file is copied into
 * a real folder — Downloads, Documents, an SD card — picked through the system
 * folder picker, and the result names the folder back so the officer knows
 * where to look. On Android the picker returns a Storage Access Framework URI,
 * which is why the copy goes through the file system API rather than a path.
 */
export async function savePdfToDevice(source: DocumentSource): Promise<SaveOutcome> {
  const rendered = await renderPdf(source);

  // Inferred rather than annotated: the picker resolves to the module's base
  // directory shape, which is not the same declared type as `Directory` here.
  let target: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch (error) {
    // Dismissing the picker rejects with a cancellation, and that is not a
    // failure — the officer changed their mind, and the rendered file is still
    // there to share instead.
    //
    // Anything else *is* a failure and has to say so. Treating every rejection
    // as a cancellation, which this used to do, meant a device with no picker
    // activity answered a tap on "Save" with silence.
    if (isCancellation(error)) return { status: 'cancelled' };

    throw new ApiError(
      'export_failed',
      'This device could not open a folder picker. Use Share instead to save the PDF through another app.',
      { details: error },
    );
  }

  try {
    await writeInto(target, rendered);
  } catch (error) {
    throw new ApiError(
      'export_failed',
      'The PDF was produced but could not be written to that folder. Try a different one, such as Downloads.',
      { details: error },
    );
  }

  return {
    status: 'saved',
    fileName: rendered.fileName,
    folder: folderLabel(target),
    uri: rendered.uri,
  };
}

/**
 * ── OPENING WHAT WAS JUST SAVED ─────────────────────────────────────────────
 *
 * "Saved to Downloads" is a true statement and a dead end. It tells an officer
 * standing in a shop that their report exists somewhere they are not, and
 * leaves them to close the app, find a file manager, and go looking for a name
 * they have already forgotten. The one moment they certainly want to look at
 * the document is the moment it is finished.
 *
 * So the confirmation offers to open it, and this is what that runs.
 *
 * ── WHY THE SHARE SHEET AND NOT A VIEWER ───────────────────────────────────
 *
 * Because there is no viewer to call. Handing a `file://` path to `Linking` on
 * Android raises `FileUriExposedException`; a true "open with" needs an
 * `ACTION_VIEW` intent, which needs `expo-intent-launcher`, which is a
 * dependency this app does not carry. The share sheet is what is installed,
 * and every device that has a PDF reader lists it there — so the officer
 * reaches the document in one tap from the confirmation rather than none, and
 * without going near a folder.
 *
 * Failures are swallowed. This runs from a dialog the officer has already been
 * told succeeded, and reporting "could not open" over the top of "saved"
 * would suggest the save itself had failed.
 */
export async function openPdf(uri: string, fileName: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) return;

  try {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Open ${fileName}`,
    });
  } catch {
    // Dismissed, or nothing on the device handles a PDF. Neither is an error
    // worth putting in front of somebody who has their report already.
  }
}

/**
 * Writes the rendered PDF into the folder the officer picked.
 *
 * ── Why this is not `file.copy(directory)` ──────────────────────────────────
 *
 * It was, and on Android it always threw. `pickDirectoryAsync` returns a
 * Storage Access Framework tree — a `content://` URI — and
 * `expo-file-system`'s `copy` is implemented over `java.io.File`, whose
 * accessor raises `This method cannot be used with content URIs` the moment it
 * is handed one. Every "Save to device" on Android failed at that line, and the
 * catch above dutifully reported it as the folder's fault.
 *
 * The SAF-aware route is `createFile` — which exists on `Directory` precisely
 * because SAF needs a display name and a MIME type to allocate a document —
 * followed by a write through the same unified file interface. `copy` is kept
 * as the fallback for a plain `file://` directory, which is what the iOS picker
 * can return.
 * ────────────────────────────────────────────────────────────────────────────
 */
async function writeInto(
  // The picker's own return type. The module's base `Directory` is not the same
  // declared type as the `Directory` exported here, and naming it structurally
  // pins this signature to whichever one the installed version returns.
  directory: Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>,
  rendered: ExportResult,
): Promise<void> {
  const bytes = await new File(rendered.uri).bytes();

  if (directory.uri.startsWith('content://')) {
    // SAF resolves a name collision itself, appending "(1)" rather than
    // overwriting — which is the right default for an enforcement document.
    directory.createFile(rendered.fileName, 'application/pdf').write(bytes);
    return;
  }

  new File(rendered.uri).copy(new Directory(directory.uri));
}

/**
 * True when an error is the officer backing out rather than something breaking.
 *
 * Matched on the code the native module raises, with a message check behind it
 * because the web and iOS implementations word their cancellation differently.
 */
function isCancellation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = (error as { message?: string } | null)?.message ?? '';

  return (
    code.includes('PICKER_CANCELLED') ||
    code.includes('ERR_CANCELED') ||
    /cancel/i.test(code) ||
    /cancel|dismiss|user did not/i.test(message)
  );
}

/**
 * Hands the PDF to the system share sheet.
 *
 * Kept beside `savePdfToDevice` rather than replacing it: sharing is for
 * sending the report on — to a supervisor, to the dealer, into an email —
 * whereas saving is for keeping a copy the officer can find later. They are
 * different intentions and an officer should not have to guess which one a
 * single button will do.
 */
export async function sharePdf(source: DocumentSource): Promise<SaveOutcome> {
  const rendered = await renderPdf(source);

  if (!(await Sharing.isAvailableAsync())) {
    return { status: 'app_only', fileName: rendered.fileName, uri: rendered.uri };
  }

  try {
    await Sharing.shareAsync(rendered.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Share ${rendered.fileName}`,
    });
  } catch {
    // Dismissing the sheet rejects on some platforms; the file is written
    // either way, so this is a cancellation and not a failed export.
    return { status: 'cancelled' };
  }

  return { status: 'shared', fileName: rendered.fileName };
}

/**
 * A folder name an officer will recognise.
 *
 * A raw SAF URI (`content://com.android.externalstorage.../tree/primary%3ADownload`)
 * is not an answer to "where was it saved", so the last meaningful segment is
 * decoded out of it.
 */
function folderLabel(directory: { uri: string }): string {
  try {
    const decoded = decodeURIComponent(directory.uri).replace(/\/+$/, '');
    const segment = decoded.split(/[:/]/).filter(Boolean).pop();
    return segment && segment.length <= 40 ? segment : 'the folder you chose';
  } catch {
    return 'the folder you chose';
  }
}

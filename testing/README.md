# testing

Drop photographs of real packages here and read them through the whole pipeline.

```
npm run testing              read every package in this folder
npm run testing -- --only maggi     just the ones whose name matches
```

Needs the OCR sidecar running (`npm run dev:ocr`). Nothing else — no database,
no server, no sign-in.

---

## One folder per package

```
testing/
    maggi-masala-70g/
        front.jpg
        back.jpg
    dettol-soap-125g/
        front.jpg
        back.jpg
        side.jpg
```

**Name the files after the face.** `front`, `back`, `side` — anything else counts
as an additional face. This is not cosmetic: the rule engine will not record a
declaration as *missing* from a package it has only seen one side of, so a folder
of `1.jpg`, `2.jpg` reads as one face photographed four times and every absent
declaration comes back as "needs review" instead of as a finding.

## Photographing them

The reading is only ever as good as the photograph, and these four things
account for most of the difference:

- **Fill the frame with the panel.** Not the whole packet on a table.
- **Get the declarations block sharp.** The MRP, net quantity, dates and the
  manufacturer's address are usually the smallest print on the pack, and they
  are the entire point.
- **Kill the glare.** Turn the packet away from the tube light rather than
  turning the flash on. A blown highlight over the MRP box is unrecoverable —
  the text is not dim, it is gone.
- **Flatten what you can.** A pouch held taut reads; the same pouch curled reads
  down the middle and not at the edges. For a bottle, take two shots rotated
  rather than one wide one.

If a declaration is only legible in a close-up, add the close-up as a third
image. More faces is strictly better: the completeness score is what decides
whether an absent declaration can be recorded as a violation at all.

---

## What the output means

```
maggi-masala-70g
  38 lines read · verdict VIOLATION_DETECTED
    batch_number           "B.No 4521"
    commodity_name         "Instant Noodles"
    consumer_care          — not found
    manufacturing_date     "MFD 03/2026"
    mrp                    "MRP ₹14.00 (incl. of all taxes)"
    net_quantity           "70 g"
  findings: LM-PC-R6-2
```

Read it against the packet in your hand. Three outcomes and they are not equally
serious:

| What you see | What it means |
| --- | --- |
| Value correct | Working. Nothing to do. |
| `— not found`, and it is on the pack | A miss. The declaration is there and was not read. |
| Value present and wrong | The worst one. A figure that would reach a report. |

The count printed at the end — "N of M declaration slots came back with a
value" — is **not** an accuracy figure. A value can be read and be wrong, and
some declarations genuinely are not on some packages. Only your eyes on the
packet settle it.

## When something reads badly

Promote that package into the corpus, which turns it into a permanent guard:
the build fails if a later change breaks it again.

```
backend/tests/corpus/<package-name>/
    front.jpg
    back.jpg
    expected.json      ← written by hand, reading the packet
```

Copy `backend/tests/corpus/_template/expected.json` and fill it in **from the
package**, never from what the system said — pasting the output records the bug
as the expectation. Then:

```
cd backend
npm run corpus -- --case <package-name> --live --record
npm run corpus -- --verbose
```

Full instructions in `backend/tests/corpus/README.md`.

---

Images in this folder are ignored by git. They are your test material, not part
of the repository — a corpus case is the thing that gets committed.

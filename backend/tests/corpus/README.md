# The label corpus

Real photographs of real packages, with a hand-written statement of what each
package actually says, scored by running the real pipeline.

It exists because fixing extraction one label at a time does not converge.
Every package that came in exposed four defects; fixing them risked four others
in labels nobody was looking at any more, and there was no way to tell. A
number that goes up is worth more than any single fix.

```
npm run corpus                      score against the recorded readings (fast)
npm run corpus -- --verbose         print every field, not only the misses
npm run corpus -- --case minimalist just the cases whose slug matches
npm run corpus -- --live            read the photographs through the OCR sidecar
npm run corpus -- --live --record   …and save the readings for next time
```

`npm test` runs the corpus too, against the recorded readings. It fails if a
false finding appears, or if accuracy drops below `baseline.json`.

## Adding a package

**1. Photograph it properly.** Front panel and back panel at minimum, one shot
each, whole panel sharp and filling the frame. If a declaration block is only
legible in a separate close-up, add that as a third image.

**2. Make a folder** named after the package, in lowercase with hyphens:

```
tests/corpus/minimalist-b5-moisturizer/
    front.jpg
    back.jpg
    expected.json
```

**3. Write `expected.json` by hand, reading the package.** Not by running the
system and pasting what it said — that records the bug as the expectation.

```json
{
  "package": "Minimalist Vitamin B5 10% Moisturizer, 50 g",
  "category": "cosmetic",
  "images": [
    { "file": "front.jpg", "face": "FRONT" },
    { "file": "back.jpg", "face": "BACK" }
  ],
  "fields": {
    "brand": "Minimalist",
    "commodity_name": "Moisturizer",
    "net_quantity": "50 g",
    "country_of_origin": "India",
    "manufacturer": { "contains": ["L.B.C.P.", "Haridwar", "249403"] },
    "consumer_care": { "contains": ["help@beminimalist.co"] },
    "ingredients": { "contains": ["Water/Aqua", "Panthenol"] },
    "mrp": null,
    "manufacturing_date": null,
    "batch_number": null
  },
  "declaredElsewhere": ["mrp", "manufacturing_date", "best_before", "batch_number"],
  "mustNotViolate": ["mrp", "manufacturing_date", "best_before"],
  "notes": "Tube inside a carton. MRP is on the carton, dates and batch on the crimp."
}
```

**4. Record the reading once:**

```
npm run corpus -- --case minimalist --live --record
```

This writes `ocr.json` beside the photographs. Commit it: it is what lets the
corpus run in milliseconds without the sidecar, and what makes the score
reproducible.

**5. Look at the score, and raise the baseline** in `baseline.json` when it
goes up.

## Writing `fields`

| you write | it means |
|---|---|
| `"50 g"` | must read as this, ignoring case and surrounding punctuation |
| `{ "contains": ["Haridwar", "249403"] }` | must contain all of these — for addresses and ingredient lists |
| `null` | must **not** be found |

`null` is not "I didn't bother". It is an assertion, and on a tube whose price
is on its carton it is the most important line in the file.

Field names are the pipeline's own: `brand`, `product_name`, `commodity_name`,
`net_quantity`, `mrp`, `unit_sale_price`, `manufacturing_date`, `best_before`,
`expiry_date`, `manufacturer`, `importer`, `packer`, `consumer_care`,
`country_of_origin`, `batch_number`, `ingredients`, `fssai_licence`,
`veg_nonveg_mark`, `dimensions`, `gm_declaration`.

## `declaredElsewhere` and `mustNotViolate`

A package inside a carton prints *"For MRP, refer to the carton"* instead of the
price. That is not silence about the MRP — it is the package saying the tube is
not the retail unit.

- `declaredElsewhere` — the declarations the label points elsewhere for. Asserts
  the system read the pointer.
- `mustNotViolate` — the declarations that must never come back as a potential
  violation. **The strongest assertion in the file**, and usually the reason to
  add the package at all.

A missed declaration wastes an inspector's minute. A false finding is an
accusation against a compliant trader, and one of those costs the credibility
of every report the system has ever issued. The scorecard keeps them in
separate columns for that reason, and a single false finding fails the run
whatever the percentage says.

## What to put in the corpus

Cover the ways labels *differ*, not the brands you happen to own:

- a food pouch, a cosmetic tube, a bottle, a carton, a sachet
- an imported package (country of origin, importer)
- a Hindi or bilingual label
- a multipack
- one whose MRP is on the carton, one whose dates are on the crimp
- **two or three that are genuinely non-compliant** — a violation the system
  should find is as much a test as one it should not
- the hard ones: curved bottle, dark print, glare, small print, low light

Twenty packages chosen this way tell you more than two hundred of the same
shape.

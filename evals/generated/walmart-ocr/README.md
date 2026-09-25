# Liam Concierge — fictional grocery-label OCR example

`demo-01.png` was created with the built-in imagegen tool from a founder-supplied Walmart bag photograph. The original photograph is not distributed. This is an AI-edited synthetic fixture, not an official Walmart sample, a real shipment, or evidence of production accuracy.

The recipient and order, trip, route and date fields were replaced. Both original barcodes were removed and replaced by **TEST CODE** placeholders. The hand and original surroundings were replaced; the image contains no EXIF or PNG text metadata. The result was visually checked. See the exact [generation prompt](demo-01.prompt.txt).

## Expected visible fields

| Field | Expected value |
|---|---|
| Recipient text | ALEX D. |
| Order/reference text | 900000000000001 |
| Trip text | DEMO |
| Label code | T0001 |
| Storage text | AMBIENT |
| Apartment, address, phone, weight | Absent |
| Carrier tracking | Unknown; do not reinterpret the order/reference as tracking |
| Scannable barcode | None; placeholders intentionally replace both codes |
| Intake outcome | Review; no verified resident identity or apartment |

Native Tesseract 5.5.2, English, PSM 11 read the recipient and order/reference exactly in a local smoke check. The full [OCR output](demo-01.tesseract.txt) includes errors elsewhere; this is not a claim that every field was recognized. Reproduce from the repository root:

```sh
tesseract evals/generated/walmart-ocr/demo-01.png stdout -l eng --psm 11
```

This example is for OCR development and demos, not barcode-decoder evaluation or a held-out benchmark. To test scanning, generate standards-compliant barcodes from known fictional payloads and verify the decoded values independently. Never retain an original barcode just because the adjacent name was changed. Future variations from the same photograph belong in the same evaluation split. No recognition model has been trained on this fixture.

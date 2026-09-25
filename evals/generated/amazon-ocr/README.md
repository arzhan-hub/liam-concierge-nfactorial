# Liam Concierge — fictional Amazon-style OCR example

`demo-01.png` was created with the built-in imagegen tool from a founder-supplied Amazon box photograph. The original photograph is not distributed. This is an AI-edited synthetic fixture, not an official Amazon sample, a real shipment, or an independent benchmark.

The name, address, tracking, item, routing and date fields were replaced with fictional values. All original barcodes and matrix codes, including the partially hidden code on the cardboard, were removed. Sticker codes are replaced with **TEST CODE** placeholders. The generated image was visually checked and has no PNG text or EXIF metadata. The exact [prompt](demo-01.prompt.txt) and [expected fields](manifest.json) are included.

| Field | Expected printed value |
|---|---|
| Recipient | JORDAN SAMPLE |
| Street and apartment | 100 DEMO RD APT C-204 |
| City/state/ZIP | DEMO CITY NJ / 00000 |
| Tracking text | TBA000000000001 |
| Item reference on upper sticker | DEMOITEM001 |
| Weight | 2.0 Lbs, label-sourced, not independently weighed |
| Scannable codes | None |
| Intake outcome | Review; no verified resident record is supplied |

The address, postal code and tracking are deliberately fictional and must never be used to ship, contact a carrier or match a real resident. A readable apartment does not establish identity or permission to handle a parcel.

Native Tesseract 5.5.2, English, PSM 11 read the name, address line and weight correctly. It misread the tracking prefix as `7BA` and made other errors; the full [OCR output](demo-01.tesseract.txt) is retained. No paid model was used for that recognition check. Image creation itself used imagegen.

```sh
tesseract evals/generated/amazon-ocr/demo-01.png stdout -l eng --psm 11
```

This fixture is for OCR development and demos, not barcode evaluation or model training. Future variants of this same source belong in the same split. Barcode tests need standards-compliant test codes with independently verified payloads. This example remains outside the frozen golden set and the UPS benchmark.

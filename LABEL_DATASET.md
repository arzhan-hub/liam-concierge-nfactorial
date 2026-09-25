# Liam Concierge — label examples and OCR-first evaluation

## What is included

The [Dynamsoft UPS collection](evals/external/ups-synthetic/README.md) contains 11 photographs of synthetic labels under CC BY 4.0, with attribution and pinned source hashes. These are photos of 10 distinct primary test labels on boxes, not real resident deliveries. Metadata including GPS was removed while keeping image pixels unchanged.

The existing 20 original synthetic PNGs and frozen 40-case golden set remain unchanged. The new photos are a separate exploratory benchmark: they must not be folded into the earlier reported accuracy or counted as 11 independent labels. No fine-tuning or model training has been performed.

The upstream README claims 18 unique labels, but the pinned annotation file lists 58 image records with only 10 distinct tracking IDs. Our 11-photo subset covers those 10 IDs; it does not establish an 18-label collection. Some expanded photos include partial neighboring labels. Ground truth refers to the primary fully visible label, not every barcode in the frame. Five target labels show weight `1` without an explicit unit: this does not justify assigning 1 lb.

A separate [fictional Walmart-style example](evals/generated/walmart-ocr/README.md) was created with imagegen from a founder-supplied photo. It replaces personal and shipment identifiers and removes both original barcodes. It is OCR-only, with exact expected fields, prompt and local OCR output; it is not part of the UPS benchmark or the frozen golden set.

## Visual references found online

| Source | Examples / relevance | Repository treatment |
|---|---|---|
| [Dynamsoft](https://github.com/Dynamsoft/datasets-from-dynamsoft/tree/654e7fa343bca0d19db349480e29cc176d36668a/UPS-Synthetic-Labels) | Synthetic UPS-style photographs with multiple barcode types | 11 photos included under the declared CC BY 4.0 license |
| [ShipStation shipping label examples](https://help.shipstation.com/hc/en-us/articles/10150289124891-US-Shipping-Label-Examples) | Images for USPS, UPS, FedEx, DHL Express and DHL eCommerce | Reference link; images not redistributed |
| [Shippo USPS examples](https://support.goshippo.com/hc/en-us/articles/360024319032-USPS-Shipping-Label-Examples-in-Shippo) | Ground Advantage, Priority and Priority Express images | Reference link; images not redistributed |
| [FedEx test-label PDF](https://developer.fedex.com/api/content/dam/fedex-com/irc/SV_labels/USE_SCHEDULED_PICKUP_FEDEX_GROUND_YOUR_PACKAGING_SENDER_URL_ONLY_PAPER_85X11_TOP_HALF_LABEL.pdf) | Explicitly marked test label | Reference link; redistribution permission not established |
| [DHL eCommerce Label API](https://developer.dhl.com/api-reference/label-dhl-ecommerce-americas) | Domestic and international examples, different identifier roles | Reference link; images not redistributed |
| [Amazon Shipping packaging guide](https://shipping.amazon.com/resources/getting-started-guide/how-amazon-shipping-works) | Format and placement reference; not a dataset of Amazon apartment-delivery labels | Reference link |
| [Walmart Create label](https://developer.walmart.com/us-marketplace/docs/create-label) | Marketplace shipping labels; does not establish the meaning of GMD bag-label codes | Reference link; separate fictional GMD-style OCR fixture linked above; no official GMD image copied |

Accessed September 24, 2026 US Eastern. The search included third-party sources, not just carrier documentation. A publicly viewable picture alone is not evidence of permission to republish it or use it for training. Real founder-supplied label photos remain outside this repository. New examples need image and barcode-content review, provenance and applicable permission.

## Recommended intake design

1. Decode barcodes locally and distinguish shipment tracking from routing, order and item references. Do not treat the first decoded code as necessarily the tracking number.
2. Run OCR locally to read printed text. Normalize photo orientation and offer a label crop before recognition; preserve uncertain characters instead of silently changing O to 0 or I to 1.
3. Parse explicit fields, compare barcode and text, and propose only verified resident candidates. A unique-looking name is not proof of residency. Missing fields stay empty; ambiguity requires review.
4. Offer a retake, manual correction or a separately consented AI fallback. No automatic paid retry loop. Show when an image will leave the device.
5. Require physical-package confirmation before recording custody, regardless of OCR or AI confidence.

OCR can itself use pretrained machine-learning models. The cost distinction is local recognition versus a metered remote model call. Local OCR has no per-request model API charge, but uses device/server compute; runtime assets may need an initial download. For the current browser app, [Tesseract.js](https://github.com/naptha/tesseract.js) supports browser and Node execution. [ML Kit Text Recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2) is an option for a future native Android/iOS implementation. A desktop Tesseract result does not establish either mobile implementation's accuracy or latency.

**Current UI status:** barcode decoding is local, but photo field extraction still uses the explicit AI button. The OCR benchmark added here is not yet a browser OCR integration. Gmail, identity and delivery consent are separate from label-image processing.

## Run the offline experiment

Install native Tesseract 5 plus `eng` and `osd` data, then:

```sh
npm run eval:ocr
```

The command tests three configurations against the same 11 images: sparse text without orientation detection (PSM 11), sparse text with Tesseract orientation detection (PSM 12), and EXIF-normalized input with PSM 11. A separate ZXing Code128 baseline uses the same EXIF orientation. No crop, resize or image enhancement is applied; prepared buffers stay in memory. It saves raw recognized text, exact tracking matches, runtime, engine version, language-data hashes and fixture hash under `evals/results/`. Whitespace and letter case are normalized; characters are not repaired using expected answers. This command makes no network recognition calls and does not load API credentials. Zero exit status means the experiment completed, not that all labels were recognized correctly.

Original images exceed the app's current 3 MB limit. These are CLI benchmark results, not end-to-end application or physical Android tests. There are no printed recipient fields on the target UPS labels, so it cannot measure name or apartment extraction accuracy. Full resident matching requires separate labeled cases.

## Initial four-photo result — September 24, 2026 US Eastern

[Original raw report](evals/results/external-ups-ocr-2026-09-25T03-52-24.637Z.json), Tesseract 5.5.2 and ZXing 0.23.0 on an ARM64 Mac:

| Pipeline | Exact tracking | Measured time per photo |
|---|---:|---:|
| OCR PSM 11, raw pixels | 0/4 | 1.1–2.5 s |
| OCR PSM 12, automatic orientation detection | 0/4 | 1.9–4.3 s |
| OCR PSM 11, EXIF orientation applied | 2/4 | 5.9–7.0 s |
| ZXing Code128, EXIF orientation applied | 4/4 | 93–106 ms |

The two successful OCR photos show the **same** underlying label (one of three distinct labels). Two other labels yielded `O` where the expected tracking identifier contains `0`. Orientation affects results substantially. Timings include preparation for the corresponding mode; the EXIF OCR mode includes a full-resolution PNG buffer conversion. They are not Android measurements or a claim about every OCR engine.

Both configurations from the initial unnormalized experiment remain in its timestamped report; the later experiment adds EXIF normalization and barcode decoding. No failures were removed, no model calls were made and no model was trained. This supports testing barcode-first intake with OCR for printed fields, not claiming a measured production savings rate. The images do not test extraction of recipient names or apartments.

## Expanded result — September 25, 2026 UTC

[Expanded raw report](evals/results/external-ups-ocr-latest.json): 11 photos, 10 distinct primary labels, same engines and preprocessing protocol. Raw PSM 11 matched **0/11**, raw PSM 12 **3/11**, EXIF-normalized PSM 11 **7/11**, and the first-Code128 baseline **10/11**. Every OCR process completed. The oblique IMG_9599 photo failed the barcode baseline; failures remain in the report. These are photo counts, not 11 independent labels. No remote recognition calls or training occurred. This expanded result supersedes the initial sample for coverage without altering the frozen golden evaluation.

## How examples improve the service

Adding files to GitHub does not change a model. An evaluation runs the current pipeline against known answers; prompting supplies instructions/examples at inference time; fine-tuning is a separate training operation that changes model behavior. Keep prompt-development examples separate from final evaluation, splitting by physical label rather than photograph.

Start with barcode/OCR and explicit validation, then evaluate the optional AI fallback on failures. Measure exact tracking, apartment accuracy, mistaken resident assignments, review rate, per-package cost and latency. Fine-tuning is only a later option if representative, consented and correctly labeled data demonstrates a persistent need. Do not assume a vision-capable model supports training. The current [OpenAI vision fine-tuning documentation](https://developers.openai.com/api/docs/guides/vision-fine-tuning) states that new users cannot access its winding-down fine-tuning platform; this project does not depend on it.

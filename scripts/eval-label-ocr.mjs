// Offline, exploratory OCR benchmark. Never loads API keys or calls an LLM.
// Prerequisite: native Tesseract 5 with eng and osd language data on PATH.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import zxing from "@zxing/library";

const exec = promisify(execFile);
const manifestPath = "evals/external/ups-synthetic/manifest.json";
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const command = (args, input) => {
  const result = exec("tesseract", args, { timeout: 90_000, maxBuffer: 2_000_000 });
  // Any preparation stays in memory; committed source images remain unchanged.
  if (input) {
    result.child.stdin.on("error", () => {}); // the process rejection reports failed recognition
    result.child.stdin.end(input);
  }
  return result;
};
const version = (await command(["--version"])).stdout.split("\n")[0];
const languageList = await command(["--list-langs"]);
const dataPath = languageList.stdout.match(/"([^"]+)"/)?.[1];
const languageHashes = {};
for (const lang of ["eng", "osd"]) {
  if (dataPath) languageHashes[lang] = hash(await readFile(`${dataPath}/${lang}.traineddata`));
}
if (manifest.license !== "CC-BY-4.0" || manifest.cases.length !== manifest.coverage.photos)
  throw new Error("Unexpected fixture manifest. Review sources before running.");
for (const c of manifest.cases) {
  if (!/^evals\/external\/ups-synthetic\/IMG_\d+\.JPG$/.test(c.image)) throw new Error("Unexpected image path");
  if (hash(await readFile(c.image)) !== c.sha256) throw new Error(`Image hash mismatch: ${c.id}`);
}

// Text reading only: no O/0 or I/1 guessing, no checksum repair, no ground-truth hints.
// Multiple different tracking candidates remain ambiguous; this is not a resident matcher.
function candidates(text) {
  return [...new Set(text.split(/\r?\n/).flatMap((line) => {
    const compact = line.toUpperCase().replace(/\s+/g, "");
    return [...compact.matchAll(/(?<![A-Z0-9])1Z[A-Z0-9]{16}(?![A-Z0-9])/g)].map((m) => m[0]);
  }))];
}
const results = [];
for (const config of [
  { psm: 11, orientation: "raw", description: "Sparse text without orientation detection" },
  { psm: 12, orientation: "raw", description: "Sparse text with Tesseract orientation detection" },
  { psm: 11, orientation: "exif", description: "EXIF orientation applied before sparse-text OCR" },
]) {
  const { psm } = config;
  const rows = [];
  for (const c of manifest.cases) {
    const start = performance.now();
    try {
      const input = config.orientation === "exif" ? await sharp(c.image).autoOrient().png().toBuffer() : undefined;
      const { stdout } = await command([input ? "stdin" : c.image, "stdout", "-l", "eng", "--psm", String(psm)], input);
      const found = candidates(stdout);
      rows.push({ id: c.id, group_id: c.group_id, expected_tracking: c.expected_tracking,
        candidates: found, exact_tracking_match: found.length === 1 && found[0] === c.expected_tracking,
        latency_ms: Math.round(performance.now() - start), raw_text: stdout, completed: true });
    } catch {
      rows.push({ id: c.id, group_id: c.group_id, completed: false, exact_tracking_match: false,
        latency_ms: Math.round(performance.now() - start), error: "Local OCR did not complete; check Tesseract and its language data." });
    }
    console.log(`psm=${psm}/${config.orientation}: ${rows.length}/${manifest.cases.length}`);
  }
  results.push({ ...config,
    summary: { images: rows.length, distinct_labels: new Set(rows.map((r) => r.group_id)).size,
      exact_tracking_matches: rows.filter((r) => r.exact_tracking_match).length,
      completed: rows.filter((r) => r.completed).length }, rows });
}
const barcodeRows = [];
const { MultiFormatReader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap, DecodeHintType, BarcodeFormat } = zxing;
for (const c of manifest.cases) {
  const start = performance.now();
  let decoded = null;
  try {
    const { data, info } = await sharp(c.image).autoOrient().greyscale().raw().toBuffer({ resolveWithObject: true });
    const source = new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height);
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]], [DecodeHintType.TRY_HARDER, true]]);
    decoded = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)), hints).getText();
  } catch { /* Record a miss, never replace it with the expected value. */ }
  barcodeRows.push({ id: c.id, group_id: c.group_id, expected_tracking: c.expected_tracking, decoded,
    exact_tracking_match: decoded === c.expected_tracking, latency_ms: Math.round(performance.now() - start) });
}
const barcode = { engine: "@zxing/library", version: JSON.parse(await readFile("node_modules/@zxing/library/package.json", "utf8")).version,
  preprocessing: "EXIF orientation and grayscale in memory; no crop or resize", scope: "First Code128 result only; not all-code or MaxiCode coverage",
  exact_tracking_matches: barcodeRows.filter((r) => r.exact_tracking_match).length, rows: barcodeRows };
const timestamp = new Date().toISOString();
const report = { suite: "external-ups-ocr", timestamp, manifest_sha256: hash(manifestBytes),
  engine: version, sharp_version: sharp.versions.sharp, platform: process.platform, arch: process.arch, language_data_sha256: languageHashes,
  llm_calls: 0, external_recognition_requests: 0,
  coverage: manifest.coverage,
  limitations: "Synthetic label photos. Exploratory, not a held-out production evaluation. Scores the primary label tracking text and a separate first-Code128 baseline, not all neighboring labels, resident matching or mobile performance. Original photos exceed the app's 3 MB upload limit. No model training performed.", results, barcode };
await mkdir("evals/results", { recursive: true });
await writeFile(`evals/results/external-ups-ocr-${timestamp.replaceAll(":", "-")}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile("evals/results/external-ups-ocr-latest.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ocr: results.map(({ psm, orientation, summary }) => ({ psm, orientation, ...summary })),
  barcode: { exact_tracking_matches: barcode.exact_tracking_matches, images: barcode.rows.length } }, null, 2));
if (results.some((r) => r.rows.some((row) => !row.completed))) process.exitCode = 1;

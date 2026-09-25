import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("external label fixtures keep attribution, stable bytes and orientation-only metadata", async () => {
  const manifest = JSON.parse(await readFile("evals/external/ups-synthetic/manifest.json", "utf8"));
  assert.equal(manifest.license, "CC-BY-4.0");
  assert.ok(manifest.attribution.includes("Dynamsoft"));
  assert.equal(manifest.cases.length, 11);
  assert.equal(new Set(manifest.cases.map((c: { group_id: string }) => c.group_id)).size, 10);
  // A single TIFF Orientation entry. No GPS, camera identity, dates, thumbnails or comments.
  const orientationOnly = Buffer.from("45786966000049492a0008000000010012010300010000000600000000000000", "hex");
  for (const c of manifest.cases) {
    assert.ok(Number.isInteger(c.orientation) && c.orientation >= 1 && c.orientation <= 8);
    const expectedMetadata = Buffer.from(orientationOnly);
    expectedMetadata.writeUInt16LE(c.orientation, 24);
    assert.match(c.image, /^evals\/external\/ups-synthetic\/IMG_\d+\.JPG$/);
    assert.match(c.source_sha256, /^[a-f0-9]{64}$/);
    assert.ok(c.source_url.includes(`/${manifest.source_commit}/UPS-Synthetic-Labels/images/`));
    const data = await readFile(c.image);
    assert.equal(createHash("sha256").update(data).digest("hex"), c.sha256);
    assert.equal(data.length, c.bytes);
    assert.equal(data.readUInt16BE(0), 0xffd8);
    let offset = 2, orientations = 0, scan = false;
    while (offset < data.length) {
      assert.equal(data[offset], 0xff);
      const marker = data[offset + 1];
      if (marker === 0xda) { scan = true; break; }
      const length = data.readUInt16BE(offset + 2);
      assert.ok(length >= 2 && offset + 2 + length <= data.length);
      if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
        assert.equal(marker, 0xe1, "Unexpected image metadata");
        assert.deepEqual(data.subarray(offset + 4, offset + 2 + length), expectedMetadata);
        orientations++;
      }
      offset += length + 2;
    }
    assert.equal(orientations, 1);
    assert.equal(scan, true);
  }
});

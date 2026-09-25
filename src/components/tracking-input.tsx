"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

/** Scanning proposes text only. It never saves a parcel or verifies a recipient. */
export default function TrackingInput({
  label,
  autoFocus = false,
}: {
  label: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [message, setMessage] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let controls: IScannerControls | undefined;
    const stop = () => {
      cancelled = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setActive(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const timeout = window.setTimeout(() => {
      stop();
      setActive(false);
      setMessage(
        "No barcode confirmed. Try better lighting, move closer, or type the tracking number.",
      );
    }, 30000);
    async function scan() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("secure-context");
        }
        const [
          { BrowserMultiFormatReader },
          { BarcodeFormat, DecodeHintType },
        ] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
          },
        });
        if (cancelled) {
          stop();
          return;
        }
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 150,
        });
        controls = await reader.decodeFromStream(
          stream,
          video.current!,
          (result, _error, scanner) => {
            if (!result || cancelled) return;
            const text = result.getText().trim().toUpperCase();
            scanner.stop();
            stop();
            setActive(false);
            if (!/^[A-Z0-9-]{5,100}$/.test(text)) {
              setMessage(
                "That code is not a plain tracking number. Scan the tracking barcode or type the number printed on the label.",
              );
              return;
            }
            setCandidate(text);
            setMessage(
              "Compare this number with the printed tracking number before using it. Shipping labels can contain several barcodes.",
            );
          },
        );
        if (cancelled) controls.stop();
      } catch (error) {
        if (cancelled) return;
        stop();
        setActive(false);
        setMessage(
          error instanceof Error && error.message === "secure-context"
            ? "Camera scanning needs HTTPS on your phone (or localhost on this computer). You can still type a tracking number."
            : "Camera unavailable. Allow camera access in your browser and try again, or type a tracking number.",
        );
      }
    }
    void scan();
    return () => {
      stop();
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [active]);

  return (
    <div className="tracking-entry">
      <label>
        {label}
        <input
          ref={input}
          name="tracking"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setCandidate("");
          }}
          required
          maxLength={100}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setMessage(
                "Tracking entered. Confirm the remaining details before saving.",
              );
            }
          }}
        />
      </label>
      <button
        type="button"
        className="button"
        onClick={() => {
          setCandidate("");
          setMessage("");
          setActive(!active);
        }}
      >
        {active ? "Stop camera" : "Scan with camera"}
      </button>
      {active && (
        <div className="scanner-preview">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="Live barcode camera preview"
          />
          <p>
            Point at the tracking barcode. Camera images stay on this device.
          </p>
        </div>
      )}
      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}
      {candidate && (
        <div className="scan-candidate">
          <p>
            Detected code: <strong>{candidate}</strong>
          </p>
          <button
            type="button"
            className="button primary"
            onClick={() => {
              setValue(candidate);
              setCandidate("");
              setMessage(
                "Tracking entered. Confirm the resident and remaining details before saving.",
              );
              input.current?.focus();
            }}
          >
            Use this tracking number
          </button>
        </div>
      )}
    </div>
  );
}

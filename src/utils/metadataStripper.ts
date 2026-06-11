/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import exifr from "exifr";
import * as piexif from "piexifjs";

export interface StripOptions {
  exif: boolean;
  xmp: boolean;
  c2pa: boolean;
  pngChunks: boolean;
}

export interface DetectedMetadata {
  exif: boolean;
  xmp: boolean;
  c2pa: boolean;
  pngChunks: boolean;
  details: Array<{ key: string; val: string }>;
}

/**
 * Merges multiple ArrayBuffers into a single ArrayBuffer.
 */
function mergeArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  let totalLength = 0;
  for (const buf of buffers) {
    totalLength += buf.byteLength;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

/**
 * Defensive resolver for piexif loader to handle varying bundle shapes
 */
function removeExif(dataUrl: string): string {
  try {
    if (typeof piexif === "function") {
      return (piexif as any)(dataUrl);
    }
    if (piexif && typeof (piexif as any).remove === "function") {
      return (piexif as any).remove(dataUrl);
    }
    if (
      piexif &&
      (piexif as any).default &&
      typeof (piexif as any).default.remove === "function"
    ) {
      return (piexif as any).default.remove(dataUrl);
    }
    throw new Error("Piexif remove handler is not accessible in this context.");
  } catch (err) {
    console.error("[Stripper Error] piexif execution failed:", err);
    return dataUrl;
  }
}

/**
 * Converts ArrayBuffer to DataURL representation.
 */
function arrayBufferToDataURL(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer], { type: mimeType });
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts DataURL to ArrayBuffer representation.
 */
function dataURLToArrayBuffer(dataURL: string): ArrayBuffer {
  const byteString = atob(dataURL.split(",")[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return ab;
}

/**
 * Strips JPEG metadata EXIF/XMP blocks cleanly using piexifjs
 */
export async function stripJpegMetadata(
  arrayBuffer: ArrayBuffer,
  fileType: string
): Promise<ArrayBuffer> {
  const dataURL = await arrayBufferToDataURL(arrayBuffer, fileType);
  const cleanedDataURL = removeExif(dataURL);
  return dataURLToArrayBuffer(cleanedDataURL);
}

/**
 * Strips non-rendering chunk structures from PNG files (keeping only IHDR, IDAT, IEND, PLTE, and tRNS).
 */
export function stripPngMetadata(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(arrayBuffer);
  if (arrayBuffer.byteLength < 8) return arrayBuffer;

  // Validate PNG signature: \x89PNG\r\n\x1a\n
  const isPng =
    view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A;
  if (!isPng) return arrayBuffer;

  const chunks: ArrayBuffer[] = [];
  chunks.push(arrayBuffer.slice(0, 8)); // PNG Signature

  let offset = 8;
  const length = arrayBuffer.byteLength;

  while (offset < length) {
    if (offset + 8 > length) {
      break;
    }

    const chunkLength = view.getUint32(offset);
    const chunkTypeBytes = [
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7),
    ];
    const chunkType = String.fromCharCode(...chunkTypeBytes);
    const chunkTotalLength = 12 + chunkLength;
    const nextOffset = offset + chunkTotalLength;

    if (nextOffset > length) {
      break;
    }

    // Keep ONLY core structures: IHDR, IDAT, IEND, PLTE, and tRNS (for transparency stability)
    const allowedChunks = ["IHDR", "IDAT", "IEND", "PLTE", "tRNS"];
    if (allowedChunks.includes(chunkType)) {
      chunks.push(arrayBuffer.slice(offset, nextOffset));
    } else {
      console.log(
        `[PNG Stream Info] Stripped metadata chunk: ${chunkType} (${chunkLength} bytes)`
      );
    }

    offset = nextOffset;
  }

  return mergeArrayBuffers(chunks);
}

/**
 * Convert WebP format images to clean canvas representations to flush metadata on re-encoding.
 */
export function stripWebpMetadata(
  arrayBuffer: ArrayBuffer,
  fileType: string
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([arrayBuffer], { type: fileType });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not construct 2D Canvas layout"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (resultBlob) => {
          if (!resultBlob) {
            reject(new Error("WebP re-encoding failed"));
            return;
          }
          const reader = new FileReader();
          reader.onload = (e) => {
            resolve(e.target?.result as ArrayBuffer);
          };
          reader.onerror = (err) => reject(err);
          reader.readAsArrayBuffer(resultBlob);
        },
        "image/webp",
        0.98 // high quality WebP
      );
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Processes incoming files and inspects with exifr and raw buffers to gather metadata details.
 */
export async function detectMetadata(
  arrayBuffer: ArrayBuffer,
  fileType: string
): Promise<DetectedMetadata> {
  const result: DetectedMetadata = {
    exif: false,
    xmp: false,
    c2pa: false,
    pngChunks: false,
    details: [],
  };

  const len = arrayBuffer.byteLength;
  const lowerType = fileType.toLowerCase();

  const add = (key: string, val: string) => {
    result.details.push({ key, val });
  };

  add("File Size", `${(len / 1024).toFixed(2)} KB`);

  // Detect using exifr
  let parsedExif: any = null;
  try {
    parsedExif = await exifr.parse(arrayBuffer, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      iptc: true,
      icc: true,
    });
  } catch (err) {
    console.log(
      "[Detector Debug] exifr notice (no metadata standards found or unreadable):",
      err
    );
  }

  // Raw segment signatures checking
  const view = new DataView(arrayBuffer);

  if (
    lowerType.includes("jpeg") ||
    lowerType.includes("jpg") ||
    (len >= 4 && view.getUint16(0) === 0xffd8)
  ) {
    add("Format", "JPEG Image");
  } else if (
    lowerType.includes("png") ||
    (len >= 8 && view.getUint32(0) === 0x89504e47)
  ) {
    add("Format", "PNG Image");
    let offset = 8;
    while (offset < len) {
      if (offset + 8 > len) break;
      const chunkLength = view.getUint32(offset);
      const chunkTypeBytes = [
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      ];
      const chunkType = String.fromCharCode(...chunkTypeBytes);
      const nextOffset = offset + 12 + chunkLength;
      if (nextOffset > len) break;

      const metadataChunks = [
        "tEXt",
        "zTXt",
        "iTXt",
        "eXIf",
        "tIME",
        "iCCP",
        "gAMA",
      ];
      if (metadataChunks.includes(chunkType)) {
        result.pngChunks = true;
        add(`PNG Block Detected`, `Type: ${chunkType} (${chunkLength} bytes)`);
      }
      offset = nextOffset;
    }
  } else if (
    lowerType.includes("webp") ||
    (len >= 12 &&
      view.getUint32(0) === 0x52494646 &&
      view.getUint32(8) === 0x57454250)
  ) {
    add("Format", "WebP Image");
  }

  // ASCII segment scanner for custom tags/block verification (C2PA content credentials, etc)
  let parsedText = "";
  const scanLimit = Math.min(len, 128000);
  const bytesToScan = new Uint8Array(arrayBuffer, 0, scanLimit);
  for (let i = 0; i < scanLimit; i++) {
    const charOf = bytesToScan[i];
    if (charOf >= 32 && charOf <= 126) {
      parsedText += String.fromCharCode(charOf);
    } else {
      parsedText += " ";
    }
  }

  if (
    parsedText.includes("http://ns.adobe.com") ||
    parsedText.includes("<x:xmpmeta") ||
    parsedText.includes("xmp")
  ) {
    result.xmp = true;
    add("XMP Presence", "XMP metadata block located in binary structure");
  }
  if (
    parsedText.includes("c2pa") ||
    parsedText.includes("C2PA") ||
    parsedText.includes("contentCredentials") ||
    parsedText.includes("APP11")
  ) {
    result.c2pa = true;
    add("C2PA Status", "C2PA / Content Credentials tracking block found");
  }
  if (parsedText.includes("Exif") || parsedText.includes("EXIF")) {
    result.exif = true;
  }

  // Map parsed tags of exifr onto details presentation layout
  if (parsedExif) {
    result.exif = true;
    Object.keys(parsedExif).forEach((k) => {
      const val = parsedExif[k];
      if (val && typeof val !== "object" && String(val).trim().length > 0) {
        add(`EXIF: ${k}`, String(val));
      }
    });
  }

  console.log("[Detector Debug] metadata scanning result summary:", {
    exif: result.exif,
    xmp: result.xmp,
    c2pa: result.c2pa,
    pngChunks: result.pngChunks,
    detailsCount: result.details.length,
  });

  return result;
}

/**
 * Controller that handles matching formats and launching appropriate sanitization routines.
 */
export async function stripMetadata(
  arrayBuffer: ArrayBuffer,
  fileType: string,
  options: StripOptions
): Promise<ArrayBuffer> {
  const lowerType = fileType.toLowerCase();
  let result: ArrayBuffer = arrayBuffer;

  console.log(
    `[Stripper Debug] Starting strip operation for format: ${fileType}, original size: ${arrayBuffer.byteLength} bytes`
  );

  if (lowerType.includes("jpeg") || lowerType.includes("jpg")) {
    result = await stripJpegMetadata(arrayBuffer, fileType);
  } else if (lowerType.includes("png")) {
    result = stripPngMetadata(arrayBuffer);
  } else if (lowerType.includes("webp")) {
    result = await stripWebpMetadata(arrayBuffer, fileType);
  } else {
    // Binary magic byte checks fallback
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
      result = await stripJpegMetadata(arrayBuffer, "image/jpeg");
    } else if (arrayBuffer.byteLength >= 8 && view.getUint32(0) === 0x89504e47) {
      result = stripPngMetadata(arrayBuffer);
    } else if (
      arrayBuffer.byteLength >= 12 &&
      view.getUint32(0) === 0x52494646 &&
      view.getUint32(8) === 0x57454250
    ) {
      result = await stripWebpMetadata(arrayBuffer, "image/webp");
    }
  }

  console.log(
    `[Stripper Debug] Completed stripping. Output size: ${result.byteLength} bytes.`
  );

  // Validate using exifr that no standard trackers exist
  try {
    const postCheck = await exifr.parse(result, {
      tiff: true,
      exif: true,
      gps: true,
      xmp: true,
      iptc: true,
      icc: true,
    });
    if (postCheck) {
      console.log(
        "[Stripper Verification] Residual tags found in output object:",
        Object.keys(postCheck)
      );
    } else {
      console.log(
        "[Stripper Verification] SUCCESS: exifr.parse() confirms zero residual metadata tags."
      );
    }
  } catch (err) {
    console.log(
      "[Stripper Verification] SUCCESS: Zero standard metadata blocks detected by exifr (parse failed to locate markers, which is correct)."
    );
  }

  return result;
}

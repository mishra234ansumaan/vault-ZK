export interface ExtractedText {
  text: string;
  method: "plain-text" | "pdf-text" | "pdf-ocr" | "image-ocr";
}

async function ocrImage(source: Blob | HTMLCanvasElement): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    gzip: true,
    cacheMethod: "none",
  });
  try {
    const { data } = await worker.recognize(source);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function readPdf(bytes: Uint8Array): Promise<ExtractedText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  let text = "";
  const pages = Math.min(doc.numPages, 6);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  if (text.trim().length >= 25) return { text, method: "pdf-text" };

  let ocr = "";
  for (let i = 1; i <= Math.min(pages, 3); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable for PDF OCR");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    ocr += (await ocrImage(canvas)) + "\n";
  }
  return { text: ocr, method: "pdf-ocr" };
}

/** Extracts raw text from any supported document – entirely on-device. */
export async function extractText(file: File, bytes: Uint8Array): Promise<ExtractedText> {
  const name = file.name.toLowerCase();
  const mime = file.type;
  if (mime === "application/pdf" || name.endsWith(".pdf")) return readPdf(bytes);
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/.test(name)) {
    return { text: await ocrImage(file), method: "image-ocr" };
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), method: "plain-text" };
}

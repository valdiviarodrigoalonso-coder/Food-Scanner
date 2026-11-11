// Camera barcode scanner. Uses the browser's built-in BarcodeDetector when it exists, otherwise a
// WebAssembly build of ZXing (the engine iPhones need, since Safari has no built-in detector).
import { validBarcode } from './nutrition.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const PONYFILL = 'https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/dist/es/ponyfill.js';
let detectorPromise = null;

export function getDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    if ('BarcodeDetector' in globalThis) {
      try {
        const supported = await globalThis.BarcodeDetector.getSupportedFormats();
        if (FORMATS.every((f) => supported.includes(f))) return new globalThis.BarcodeDetector({ formats: FORMATS });
      } catch {}
    }
    const mod = await import(PONYFILL);
    return new mod.BarcodeDetector({ formats: FORMATS });
  })();
  detectorPromise.catch(() => (detectorPromise = null));
  return detectorPromise;
}

function accept(raw) {
  const code = String(raw || '').replace(/\D/g, '');
  if (code.length === 8 && /^[01]/.test(code)) return code; // UPC-E or EAN-8; confirmed by double read
  return validBarcode(code) ? code : null;
}

/** Decode a barcode from a still image (File/Blob). Returns the code or null. */
export async function scanImage(file) {
  const detector = await getDetector();
  const bmp = await createImageBitmap(file);
  try {
    const found = await detector.detect(bmp);
    for (const f of found) {
      const c = accept(f.rawValue);
      if (c) return c;
    }
    return null;
  } finally {
    bmp.close && bmp.close();
  }
}

/**
 * Open the camera on a <video> and start looking for a barcode.
 *   onCode(code)        once, after the same code is read twice in a row (protects against misreads)
 *   onStatus(state,msg) 'loading' | 'scanning' | 'error'
 * Resolves with a controller as soon as the camera is on: { stop(), torch(on), hasTorch, alive() }.
 * Rejects only if the camera itself cannot be opened.
 */
export async function startScanner(video, onCode, onStatus = () => {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot open the camera here. The page has to be opened over https (or installed to the Home Screen).');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw new Error('Camera access is turned off for this app. Allow it in your phone’s Settings (Safari › Camera), then try again.');
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new Error('No camera was found on this device.');
    if (e.name === 'NotReadableError') throw new Error('The camera is being used by another app. Close it and try again.');
    throw new Error('Could not start the camera (' + e.name + ').');
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.play().catch(() => {});

  let stopped = false;
  const track = stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const ctl = {
    hasTorch: !!caps.torch,
    alive: () => !stopped && !!track && track.readyState === 'live',
    stop() {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
    async torch(on) {
      try {
        await track.applyConstraints({ advanced: [{ torch: !!on }] });
      } catch {}
    },
  };

  onStatus('loading');
  getDetector().then(
    (detector) => {
      if (stopped) return;
      onStatus('scanning');
      let last = null;
      let lastAt = 0;
      const tick = async () => {
        if (stopped) return;
        if (video.readyState >= 2 && video.videoWidth) {
          try {
            const found = await detector.detect(video);
            for (const f of found) {
              const code = accept(f.rawValue);
              if (!code) continue;
              const now = Date.now();
              if (code === last && now - lastAt < 1500) {
                ctl.stop();
                onCode(code);
                return;
              }
              last = code;
              lastAt = now;
              break;
            }
          } catch {}
        }
        setTimeout(tick, 110);
      };
      tick();
    },
    () => {
      if (stopped) return;
      ctl.stop();
      onStatus('error', 'Could not load the barcode reader. Check your internet connection and try again.');
    },
  );
  return ctl;
}

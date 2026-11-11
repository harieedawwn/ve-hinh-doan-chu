// Minimal 2D-context surface used by the engine so any compatible context can be injected
// (browser CanvasRenderingContext2D, OffscreenCanvas, node-canvas, or the built-in SoftContext).

export interface ImageDataLike { readonly width: number; readonly height: number; data: Uint8ClampedArray }

export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
  putImageData(img: ImageDataLike, x: number, y: number): void;
}

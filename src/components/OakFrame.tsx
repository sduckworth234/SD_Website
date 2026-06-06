// Realistic oak frame, client-side: a transparent-window PNG (real oak render +
// warm mat) overlaid on the photo, which sits in the cut-out window. Window
// fractions are baked from the source templates (scripts that generated
// public/frames/frame-*.png). Any photo frames instantly — no per-image render.
const FRAME = {
  portrait: { ar: 828 / 1141, win: [0.1473, 0.1069, 0.7053, 0.7853] },
  landscape: { ar: 1141 / 828, win: [0.1069, 0.1473, 0.7853, 0.7053] },
} as const;

export type FrameOrientation = keyof typeof FRAME;

export function OakFrame({
  src,
  orientation = "portrait",
  alt = "",
  className = "",
}: {
  src: string;
  orientation?: FrameOrientation;
  alt?: string;
  className?: string;
}) {
  const f = FRAME[orientation];
  const [l, t, w, h] = f.win;
  return (
    <div className={`oak${className ? ` ${className}` : ""}`} style={{ aspectRatio: String(f.ar) }}>
      <span
        className="oak-art"
        style={{ left: `${l * 100}%`, top: `${t * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
      >
        <img src={src} alt={alt} loading="lazy" decoding="async" />
        <span className="oak-glass" aria-hidden="true" />
      </span>
      <img className="oak-png" src={`/frames/frame-${orientation}.png`} alt="" aria-hidden="true" />
    </div>
  );
}

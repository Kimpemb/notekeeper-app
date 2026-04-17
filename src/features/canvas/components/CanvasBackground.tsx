// src/features/canvas/components/CanvasBackground.tsx
import React from "react";

interface CanvasBackgroundProps {
  zoom: number;
  viewportX: number;
  viewportY: number;
}

const BASE_SPACING = 24;       // world-space pitch at zoom = 1
const FADE_MIN = 16;           // screen-px: fine grid starts fading out
const FADE_MAX = 28;           // screen-px: fine grid fully invisible, coarse fully visible
const DOT_RADIUS = 1.2;        // fixed screen-space radius
const BASE_OPACITY = 0.45;



function computeOffset(viewportX: number, viewportY: number, worldSpacing: number, zoom: number) {
  const screenSpacing = worldSpacing * zoom;
  const offsetX = ((viewportX % worldSpacing) * zoom + screenSpacing * 10) % screenSpacing;
  const offsetY = ((viewportY % worldSpacing) * zoom + screenSpacing * 10) % screenSpacing;
  return { screenSpacing, offsetX, offsetY };
}

export const CanvasBackground: React.FC<CanvasBackgroundProps> = ({
  zoom,
  viewportX,
  viewportY,
}) => {
  // Find the coarsest pitch whose screen-space size is >= FADE_MIN
  // by finding which power-of-2 multiple of BASE_SPACING we're in
  const level = Math.max(0, Math.ceil(Math.log2(FADE_MIN / (BASE_SPACING * zoom))));
  const fineSpacing  = BASE_SPACING * Math.pow(2, level);
  const coarseSpacing = fineSpacing * 2;

  const fine   = computeOffset(viewportX, viewportY, fineSpacing,   zoom);
  const coarse = computeOffset(viewportX, viewportY, coarseSpacing, zoom);

  // How far through the fade window are we?
  // t=0 → fine fully visible; t=1 → fine invisible, coarse takes over
  const t = Math.min(1, Math.max(0,
    (FADE_MAX - fine.screenSpacing) / (FADE_MAX - FADE_MIN)
  ));

  const fineOpacity   = BASE_OPACITY * (1 - t);
  const coarseOpacity = BASE_OPACITY * (t < 0.05 ? 0 : 1); // coarse only shows during transition + beyond

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      style={{ pointerEvents: "none" }}
    >
      <defs>
        {fineOpacity > 0.01 && (
          <pattern
            id="dots-fine"
            width={fine.screenSpacing}
            height={fine.screenSpacing}
            patternUnits="userSpaceOnUse"
            x={fine.offsetX}
            y={fine.offsetY}
          >
            <circle
              cx={fine.screenSpacing / 2}
              cy={fine.screenSpacing / 2}
              r={DOT_RADIUS}
              fill="currentColor"
              className="text-slate-400"
              opacity={fineOpacity}
            />
          </pattern>
        )}
        {coarseOpacity > 0.01 && (
          <pattern
            id="dots-coarse"
            width={coarse.screenSpacing}
            height={coarse.screenSpacing}
            patternUnits="userSpaceOnUse"
            x={coarse.offsetX}
            y={coarse.offsetY}
          >
            <circle
              cx={coarse.screenSpacing / 2}
              cy={coarse.screenSpacing / 2}
              r={DOT_RADIUS}
              fill="currentColor"
              className="text-slate-400"
              opacity={coarseOpacity}
            />
          </pattern>
        )}
      </defs>

      {fineOpacity > 0.01 && (
        <rect width="100%" height="100%" fill="url(#dots-fine)" />
      )}
      {coarseOpacity > 0.01 && (
        <rect width="100%" height="100%" fill="url(#dots-coarse)" />
      )}
    </svg>
  );
};
'use client';

import { DynamicFavicon, type FaviconDrawFn } from '@thesandybridge/ui/components';

const drawTileIcon: FaviconDrawFn = (ctx, size, accent, bg) => {
  const r = 3;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 6);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.roundRect(5, 5, 9, 9, r); ctx.fill();
  ctx.beginPath(); ctx.roundRect(18, 5, 9, 9, r); ctx.fill();
  ctx.beginPath(); ctx.roundRect(5, 18, 9, 9, r); ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.roundRect(19, 19, 7.5, 7.5, r); ctx.fill();
  ctx.globalAlpha = 1;
};

export function Favicon() {
  return <DynamicFavicon draw={drawTileIcon} />;
}

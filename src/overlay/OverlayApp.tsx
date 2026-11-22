// Page served to OBS:  /overlay/<layoutId>            → full layout scaled to the source size
//                      /overlay/<layoutId>/<widgetId> → one widget filling the source (responsive)
import React, { useMemo } from 'react';
import { useOverlayFeed } from './feed.js';
import { PRESETS, presetById } from './presets.js';
import { FitCanvas, OverlayCanvas, OverlayRoot, WidgetBox } from './OverlayCanvas.js';
import { useOv, widgetVisible } from './util.js';
import type { OverlayLayout } from './types.js';

function readRoute() {
  const q = new URLSearchParams(window.location.search);
  // In dev the Rust server redirects to Vite with ?path=/overlay/...&api=http://127.0.0.1:PORT
  const path = q.get('path') ?? window.location.pathname;
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const i = parts.indexOf('overlay');
  return {
    layoutId: (i >= 0 ? parts[i + 1] : undefined) || 'cockpit-classic',
    widgetId: i >= 0 ? parts[i + 2] : undefined,
    api: q.get('api') ?? '',
    token: q.get('k'),
    demo: q.get('demo') === '1',
  };
}

const SingleWidget: React.FC<{ widgetId: string }> = ({ widgetId }) => {
  const { layout, feed, combat } = useOv();
  // Accept a widget id, or a widget type for hand-written URLs (/overlay/minimal/profit).
  const widget = layout.widgets.find((w) => w.id === widgetId) ?? layout.widgets.find((w) => w.type === widgetId);
  if (!widget) return null;
  const visible = widgetVisible({ ...widget, hidden: false }, feed, combat);
  return (
    <div className={`ov-slot ${visible ? '' : 'ov-slot-hidden'}`} style={{ inset: 0 }}>
      <WidgetBox widget={widget} />
    </div>
  );
};

export const OverlayApp: React.FC = () => {
  const route = useMemo(readRoute, []);
  const { feed, moments } = useOverlayFeed({
    api: route.api,
    layoutId: route.layoutId,
    token: route.token,
    forceDemo: route.demo,
  });

  const layout: OverlayLayout =
    (!feed.layoutDeleted && feed.layout) || presetById(route.layoutId) || PRESETS[0];

  // App closed / server unreachable: stay fully transparent instead of showing stale numbers.
  if (!feed.online) return null;

  return (
    <OverlayRoot layout={layout} feed={feed} moments={moments} style={{ position: 'fixed', inset: 0 }}>
      {route.widgetId ? (
        <SingleWidget widgetId={route.widgetId} />
      ) : (
        <FitCanvas width={layout.canvas.width} height={layout.canvas.height}>
          <OverlayCanvas />
        </FitCanvas>
      )}
    </OverlayRoot>
  );
};

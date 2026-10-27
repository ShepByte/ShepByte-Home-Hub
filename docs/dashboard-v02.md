# Dashboard V0.2

## Behaviour

Both `/` (authenticated live dashboard) and `/prototype/` (standalone preview) now render the same 2400 × 1700 world. Island coordinates are fixed in world space. Screen size changes the camera viewport, not island spacing. Mobile starts at 90% zoom; desktop starts at 100%. Zoom is bounded between 60% and 140%; camera bounds prevent losing the world completely.

- Faceted isometric islands with warm house windows, coloured edge lighting, floor pools and mirrored geometry.
- Smooth curved branches with SVG data balls following the actual cable paths.
- Pointer-based mouse/touch panning, pinch zoom, trackpad scrolling, keyboard navigation, island shortcuts and a Home reset.
- A 7-pixel drag threshold prevents accidental panel activation after a swipe, including gestures beginning on an island.
- Safe-area spacing, dynamic viewport height, independent panel scrolling and no document overscroll. The navigation strip scrolls horizontally on narrow phones.
- Subtle ambient haze and optional decorative rain. Neither weather nor data-ball motion claims to be live telemetry.
- Reduced motion disables animation. Background tabs pause animation. No continuous JavaScript rendering loop runs while the camera is idle.
- Static preview clearly labels itself as disconnected; it no longer claims the hub is healthy or invents device counts.

The backend, API routes, authentication, protocol, simulator, database and deployment service are unchanged. The live frontend still supports approval, hardware telemetry, Overview / History / Settings, sharing preferences, dashboard links and revocation. Polling no longer reopens the Devices panel on top of device details. API failures are visible outside the hidden login screen.

## Maintenance

Inline SVG keeps the art available offline and within the existing server's strict static-file allowlist and CSP. The camera block (marked `V0.2 camera`) and world CSS block (marked `V0.2 world`) are intentionally identical in the two existing bundles, so the standalone preview still works with `python3 -m http.server --directory prototype`. When editing these blocks, update both copies. No server route additions or production Node dependencies are needed.

## Validation

Run the backend suite and JavaScript syntax checks:

```sh
python3 -m unittest discover -s tests -v
npm run check
```

Browser regression checks use a temporary database and the actual Python HTTP server. They cover both routes at 1440 × 900, 390 × 844, 320 × 568 and 844 × 390, rotation, world overflow, drag-vs-tap, navigation, zoom, panels, keyboard and reduced motion. Chromium additionally exercises touch swipes, two-finger pinch and moving data balls. The real-API scenario approves a synthetic device, receives hardware/events, opens all three tabs, waits through polling, checks financial sharing defaults and locks the dashboard. Browser exceptions and CSP errors fail the run.

```sh
npm ci
npx playwright install --with-deps chromium webkit
npm run test:dashboard
BROWSER=webkit npm run test:dashboard
```

`BROWSER_EXECUTABLE` optionally supplies a local browser executable. Node and Playwright are development-only tools; do not install them on the Pi just to run Home Hub.

Validation completed: all 11 Python tests, both JavaScript syntax checks and the Chromium browser suite passed. Desktop and phone screenshots were visually inspected. WebKit could not be run in the development environment because its browser runtime/dependencies were unavailable; the command above is provided for a supported host.

Physical iPhone Safari, home-screen standalone mode, safe-area behaviour on actual hardware and sustained Pi/browser performance remain acceptance checks on the user's devices. Browser emulation is not a physical-device test.

## Update an existing Pi checkout

From the existing repository directory:

```sh
git switch main
git pull --ff-only
```

Then reload the dashboard in Safari. The existing Python server reads these static files for each request, so a running server does not need a restart for this frontend update. Keep using the current address/port. The standalone prototype remains a preview; live devices require the backend dashboard and its existing authentication setup.

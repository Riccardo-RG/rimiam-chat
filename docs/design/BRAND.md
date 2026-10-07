# RIMIAM — logo and interface palette

User-authorized presentation refinement, 2026-09-28. The supplied [original PNG](brand/logo-original.png) is retained as the reference. The [SVG master](../../public/brand/rimiam-mark.svg) is a clean geometric reconstruction of its green, orange and purple facets, with transparent negative space instead of the raster's textured white background. This is a reversible visual choice; it changes no product or authority semantics.

## Current Web presentation — 2026-10-07

The user authorized a decisive Web redesign, including a freely chosen palette. The multicolor logo and its assets remain unchanged. Cobalt actions, slate neutrals and graphite dark surfaces now distinguish the interface from the logo colors; restrained purple, amber and red retain supporting roles. Light / Dark / System remains available. This reversible choice supersedes the previous **Web presentation only**; product semantics and native clients are unchanged. iOS/Android visual alignment is deferred until the user closes Web testing.

| Web role                  | Light                 | Dark                  |
| ------------------------- | --------------------- | --------------------- |
| Canvas / surface          | `#F6F7F9` / `#FFFFFF` | `#11151E` / `#191E29` |
| Primary text / muted text | `#202631` / `#596577` | `#E8EDF5` / `#A7B3C7` |
| Action cobalt             | `#3457D5`             | `#A3B5FF`             |
| Supporting purple         | `#6846A3`             | `#C3ACF0`             |
| Attention amber           | `#855018`             | `#F1C68D`             |

The [Web tokens](../../src/app/ritmo.css) are authoritative for current presentation. The [experience note](../development/PRODUCT_DESIGN.md#current-web-refinement--2026-10-07) records composition. No browser or visual acceptance was performed for this refinement; verification and remaining limits belong in [STATUS](../development/STATUS.md).

## Previous application — 2026-09-28

Retained as presentation history and the unchanged native baseline; the Web palette above supersedes these interface-color choices for Web.

- Keep the multicolor mark intact in both themes. Use it at account entry and Home; Workspace names remain the navigation title. The favicon and launcher icons use the same geometry.
- Keep surfaces neutral: soft off-white by day, deep green charcoal by night. Green is the primary action accent; purple supports Miriam's presence; orange supports requests for attention. Use text and structure alongside color; errors remain red.
- Web retains the Light / Dark / System preference. Native clients follow system appearance. Avoid saturated full-page backgrounds, gradients on interface surfaces and decorative color on every capability.

| Role                      | Light                 | Dark                  |
| ------------------------- | --------------------- | --------------------- |
| Canvas / surface          | `#F7F8F5` / `#FFFFFF` | `#111613` / `#1A211C` |
| Primary text / muted text | `#202A23` / `#5D6C61` | `#EDF3EC` / `#B0BEB3` |
| Action green              | `#087443`             | `#8DDBAB`             |
| Supporting purple         | `#713AB7`             | `#C5A3F0`             |
| Attention orange          | `#A94B00`             | `#FFBD76`             |

Implementation entry points: [web signature](../../src/client/brand-signature.tsx), [SwiftUI tokens](../../mobile/ios/Miriam/RIMIAMStyle.swift), [Compose theme](../../mobile/android/app/src/main/java/it/miriam/nativeapp/MainActivity.kt). This earlier palette used contrast-adjusted relatives of the logo colors, not literal pixel samples.

## Asset maintenance

Edit the SVG master, then run `node scripts/generate-brand-assets.mjs` from the repository root. The [exporter](../../scripts/generate-brand-assets.mjs) uses Sharp already installed with Next.js; it generates the web SVG favicon/180px touch icon, opaque 1024px iOS AppIcon, transparent iOS in-app image and Android vectors/adaptive foreground. No new dependency or external service is required. Android's system-themed monochrome icon uses the mark's silhouette. Update the exporter if the SVG geometry vocabulary changes; unsupported geometry must not silently disappear.

The 2026-09-28 palette verification checked text contrast in both themes (at least 4.5:1) and input borders against their surfaces (above 3:1). This historical targeted check is not full visual/accessibility acceptance or verification of the new Web palette. Current verification is recorded in [STATUS](../development/STATUS.md).

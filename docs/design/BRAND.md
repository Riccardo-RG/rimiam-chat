# RIMIAM — logo and interface palette

User-authorized presentation refinement, 2026-09-28. The supplied [original PNG](brand/logo-original.png) is retained as the reference. The [SVG master](../../public/brand/rimiam-mark.svg) is a clean geometric reconstruction of its green, orange and purple facets, with transparent negative space instead of the raster's textured white background. This is a reversible visual choice; it changes no product or authority semantics.

## Application

- Keep the multicolor mark intact in both themes. Use it at account entry and Home; Workspace names remain the navigation title. The favicon and launcher icons use the same geometry.
- Keep surfaces neutral: soft off-white by day, deep green charcoal by night. Green is the primary action accent; purple supports Miriam's presence; orange supports requests for attention. Use text and structure alongside color; errors remain red.
- Web retains the Light / Dark / System preference. Native clients follow system appearance. Avoid saturated full-page backgrounds, gradients on interface surfaces and decorative color on every capability.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas / surface | `#F7F8F5` / `#FFFFFF` | `#111613` / `#1A211C` |
| Primary text / muted text | `#202A23` / `#5D6C61` | `#EDF3EC` / `#B0BEB3` |
| Action green | `#087443` | `#8DDBAB` |
| Supporting purple | `#713AB7` | `#C5A3F0` |
| Attention orange | `#A94B00` | `#FFBD76` |

Implementation entry points: [web tokens](../../src/app/ritmo.css), [web signature](../../src/client/brand-signature.tsx), [SwiftUI tokens](../../mobile/ios/Miriam/RIMIAMStyle.swift), [Compose theme](../../mobile/android/app/src/main/java/it/miriam/nativeapp/MainActivity.kt). Interface colors are contrast-adjusted relatives of the logo colors, not literal pixel samples.

## Asset maintenance

Edit the SVG master, then run `node scripts/generate-brand-assets.mjs` from the repository root. The [exporter](../../scripts/generate-brand-assets.mjs) uses Sharp already installed with Next.js; it generates the web SVG favicon/180px touch icon, opaque 1024px iOS AppIcon, transparent iOS in-app image and Android vectors/adaptive foreground. No new dependency or external service is required. Android's system-themed monochrome icon uses the mark's silhouette. Update the exporter if the SVG geometry vocabulary changes; unsupported geometry must not silently disappear.

Text contrast pairs were checked in both themes (at least 4.5:1), and input borders against their surfaces exceed 3:1. This is targeted palette verification, not full visual/accessibility acceptance. Browser/device visual acceptance remains pending; see [STATUS](../development/STATUS.md).

# RIMIAM — logo and interface palette

User-authorized presentation refinement, 2026-09-28. The supplied [original PNG](brand/logo-original.png) is retained as the reference. The [SVG master](../../public/brand/rimiam-mark.svg) is a clean geometric reconstruction of its green, orange and purple facets, with transparent negative space instead of the raster's textured white background. This is a reversible visual choice; it changes no product or authority semantics.

<a id="current-web-presentation"></a>

## Current Web identity

The 20 November Studio direction uses a paper reading surface by day and graphite by night. Human messages use neutral ink. Emme’s replies use a subtly cooler slate in light mode and silver-grey in dark mode. Emme’s name and monochrome cut of the RIMIAM mark identify her in both themes. People’s photos appear in desktop bylines; the narrow Web layout uses names and conversation time breaks. The sidebar retains the original multicolour mark. Active navigation has a soft tonal fill. The [Incisa glyphs](../../src/client/workspace-icon.tsx) include a two-stroke spiral for spaces, a compass for tools and a person with a plus for invitations. **System**, **Light** and **Dark** remain available. See the [approved prototype](prototypes/studio/index.html).

The 19 November release used four original, AI-generated WebP panoramas. The light set pairs the limestone [coast](../../public/scenes/costa.webp) with the alpine [ridge](../../public/scenes/crinale.webp); the dark set pairs a coastal [harbour](../../public/scenes/porto.webp) with an inland [viaduct](../../public/scenes/viadotto.webp). That release paired its header and navigation thumbnail by Workspace ID. The 20 November Web revision replaces the decorative fallback with the space glyph in the directory. These editorial photographs are independent of the profile and Workspace pictures people explicitly share. The first-party visual references were the lighting of the [Leonida locations](https://www.rockstargames.com/VI) and the physical and digital controls of the [Ford Mustang](https://www.ford.com/cars/mustang/). All four original images depict invented locations; the shipped assets contain no game screenshots, logos, licensed vehicles or external photography.

Web tokens live in [ritmo.css](../../src/app/ritmo.css), the narration mark in [brand-signature.tsx](../../src/client/brand-signature.tsx), and authenticated identity images in [identity-photos.ts](../../src/server/identity-photos.ts). Profile pictures are visible to the account owner and current eligible members of a shared space. Workspace photos are changeable by current eligible contributors.

On November 19, 2026 the computed token contrast for Emme’s text against the reading surface was 6.50:1 in light mode and 10.47:1 in dark mode. Muted text reached 6.10:1 and 8.04:1 respectively. Input outlines against the field surface reached 3.08:1 and 3.32:1. The [captured conversation](reviews/2026-11-19-web/verifica/README.md) shows both themes and the narrow-Web layout.

### Readability and appearance

The Web type scale follows the browser’s preferred font size. With the usual 16 CSS pixel setting, the base grows from 17 to 18 pixels across phone and desktop widths. Dates and captions use a 0.83rem minimum; avatar initials and graphic marks have their own optical sizes. Primary touch controls aim for 44 CSS pixels. Keyboard outlines stay visible; touching a button does not add a second ring. These sizes are product choices. The acceptance references are [WCAG text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [visible focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html).

**Account → Aspetto** defaults to Grafite. Its cool charcoal in light mode and silver grey in dark mode mark Home, Workspace and panel titles. The same ink marks the selected navigation icons, active tabs and starred files. The active rail item and Workspace tab also have a soft graphite background. Blu oceano, Verde bosco and Prugna tint actions and selected icons in either theme. Reading surfaces, conversation text and warnings retain their established colors.

## Earlier Web presentation — 2026-11-18

The earlier Web beta used a blue-ink navigation rail, paper reading surfaces and a vermilion accent. Dark mode uses midnight blue with warm off-white text and a peach accent. Editorial serif titles identify the Workspace and its Goal. Controls, messages and provenance use system sans for legibility. The multicolor logo and Light, Dark and System preferences are retained. See [release evidence](../development/STATUS.md) for the live version.

| Web role                  | Light                 | Dark                  |
| ------------------------- | --------------------- | --------------------- |
| Canvas / surface          | `#F6F3ED` / `#FFFDF8` | `#111A29` / `#192437` |
| Primary text / muted text | `#192844` / `#555F70` | `#F4F0EA` / `#ACB7CB` |
| Action / soft tint        | `#A63C26` / `#F3E5DE` | `#FFA68A` / `#352B2C` |
| Rail / attention          | `#192844` / `#775014` | `#0D1523` / `#F3C77F` |

Presentation entry points are the [Web tokens](../../src/app/ritmo.css) and the [experience note](../development/PRODUCT_DESIGN.md). The original mark remains the product signature.

## Web presentation — 2026-10-07

The October Web iteration introduced cobalt actions, slate neutrals and graphite dark surfaces. The November palette supersedes those Web colors. The native client sources were retired in November.

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

This earlier palette used colors derived from the logo and adjusted for contrast. The Web signature and the React Native guide describe the implementation available today. [Web signature](../../src/client/brand-signature.tsx) · [React Native guide](../development/MULTICLIENT.md).

## Asset maintenance

Edit the SVG master, then run `node scripts/generate-brand-assets.mjs` from the repository root. The [exporter](../../scripts/generate-brand-assets.mjs) uses Sharp already installed with Next.js; it generates the Web favicon and launcher icons, including the touch icon used when installing the Web app on iOS. Update the exporter if the SVG geometry vocabulary changes; unsupported geometry must not silently disappear.

The 2026-09-28 palette verification checked text contrast in both themes (at least 4.5:1) and input borders against their surfaces (above 3:1). This historical targeted check is not full visual/accessibility acceptance or verification of the new Web palette. Current verification is recorded in [STATUS](../development/STATUS.md).

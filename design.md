---
version: alpha
name: FCode-design-analysis
description: A native-desktop coding-agent GUI whose interface reads like a quietly-confident developer tool in the Codex / Linear / Raycast lineage — dense, monochrome-first, and utilitarian rather than marketing-loud. The canvas is near-white neutral (`#fcfcfc` light / `#0e0e0e` dark), not warm; text is a near-black neutral (`#0d0d0d`) carried by the OS system-ui stack. The single brand voltage is **Codex Blue** (`#0169cc`) reserved for links, focus rings, and the primary action — every other surface is grayscale. A dedicated **agent/skill accent** (violet `#924ff7`) plus diff green/red form the only other chromatic vocabulary, scoped to agent activity and code diffs. The signature is not color but **material**: a frosted translucent sidebar/composer/popover system (`backdrop-filter: blur(24px) saturate(180%)`) layered over an almost flat, shadow-averse surface model where depth comes from 4–6% hairlines and inset edge highlights, never drop shadows. Everything is dense — a 12px base UI size, 28px rows, and `-0.015em` tracking. JetBrains Mono on every code, input, and terminal surface. The entire palette is theme-engine-driven: accent, contrast, surface, ink, and fonts are user-tunable across 28+ built-in themes and a light/dark axis.

colors:
  primary: "#0169cc"
  primary-active: "#0157a8"
  primary-fallback: "#339cff"
  ink: "#0d0d0d"
  ink-soft: "#1a1c1f"
  body: "#262626"
  body-strong: "#0d0d0d"
  muted: "#737373"
  muted-soft: "#a3a3a3"
  hairline: "rgba(0,0,0,0.05)"
  hairline-soft: "rgba(0,0,0,0.04)"
  hairline-strong: "rgba(0,0,0,0.06)"
  canvas: "#fcfcfc"
  canvas-under: "#fcfcfc"
  surface-card: "#ffffff"
  surface-elevated: "rgba(0,0,0,0.04)"
  ring: "#a3a3a3"
  on-primary: "#ffffff"
  canvas-dark: "#0e0e0e"
  surface-card-dark: "#0f0f0f"
  ink-dark: "#f5f5f5"
  body-dark: "#e5e5e5"
  hairline-dark: "rgba(255,255,255,0.04)"
  input-dark: "rgba(255,255,255,0.05)"
  skill: "#924ff7"
  skill-dark: "#ad7bf9"
  diff-added: "#00a240"
  diff-removed: "#ba2623"
  diff-added-dark: "#40c977"
  diff-removed-dark: "#fa423e"
  semantic-success: "#00a240"
  semantic-error: "#ba2623"
  semantic-warning: "#f59e0b"
  semantic-info: "#0169cc"
  brand-claude: "#d97757"

typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.0
    letterSpacing: -0.015em
  title-md:
    fontFamily: "system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.015em
  title-sm:
    fontFamily: "system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.015em
  body-md:
    fontFamily: "system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.015em
  body-strong:
    fontFamily: "system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: -0.015em
  label-sm:
    fontFamily: "system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.015em
  caption:
    fontFamily: "system-ui, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: -0.01em
  button:
    fontFamily: "system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: -0.015em
  code:
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', 'SF Mono', 'SFMono-Regular', Consolas, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  code-block:
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  terminal:
    fontFamily: "'JetBrainsMono NFM', 'JetBrainsMono NF', 'JetBrains Mono', monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: 0px
  sm: 6px
  md: 8px
  lg: 10px
  user-message: 14px
  xl: 14px
  content-card: 14.4px
  2xl: 18px
  3xl: 22px
  4xl: 26px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  base: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  section: 48px
  row-height: 28px

components:
  window-shell:
    backgroundColor: "{colors.canvas-under}"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    note: "Frameless — .drag-region owns the titlebar; app-shell-background is transparent on macOS so the OS vibrancy shows through."
  sidebar:
    backgroundColor: "color-mix(in srgb, {colors.surface-card} 52%, transparent)"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    backdropFilter: "blur(24px) saturate(180%)"
    shadow: "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.04)"
    note: "Frosted iOS-glass material on macOS (translucent); opaque {colors.surface-card} on Windows/Linux."
  sidebar-row:
    backgroundColor: transparent
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 28px
    padding: 2px 8px
    hoverBackground: "{colors.surface-elevated}"
    activeBackground: "rgba(0,0,0,0.06)"
  sidebar-icon-button:
    backgroundColor: transparent
    textColor: "color-mix(in srgb, {colors.muted} 60%, transparent)"
    rounded: "{rounded.sm}"
    padding: 2px
    hoverBackground: "{colors.surface-elevated}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    height: 32px
    padding: 0 11px
    border: "1px solid transparent"
    note: "Flat — no drop shadow, no inset glint. Hover = background at 90% opacity."
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.body-strong}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    height: 32px
    border: "1px solid transparent"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.body-strong}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    height: 32px
    border: "1px solid {colors.hairline}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    hoverBackground: "{colors.surface-elevated}"
  button-destructive:
    backgroundColor: "{colors.semantic-error}"
    textColor: "#ffffff"
    typography: "{typography.button}"
    rounded: "{rounded.lg}"
    border: "1px solid {colors.semantic-error}"
  button-prominent:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    note: "Full-pill hero action; scales to 1.05 on hover — the only button that animates."
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    rounded: "{rounded.2xl}"
    padding: 24px
    border: "1px solid {colors.hairline}"
    shadow: "shadow-xs (outer 5% alpha) + before: inset 0 1px black/4%"
  card-title:
    typography: "{typography.display}"
    textColor: "{colors.body-strong}"
  card-description:
    typography: "{typography.body-md}"
    textColor: "{colors.muted}"
  text-input:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body-strong}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: 8px 12px
    border: "1px solid {colors.hairline-strong}"
    note: "inputs/textareas render in JetBrains Mono by default."
  composer:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body-strong}"
    rounded: "{rounded.xl}"
    backdropFilter: "blur(16px)"
    focusBorder: "1px solid {colors.primary}"
    note: "Chat input surface; frosted on macOS, opaque elsewhere."
  popover-menu:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.body}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    backdropFilter: "blur(32px)"
    border: "1px solid {colors.hairline}"
  code-block:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.body-strong}"
    typography: "{typography.code-block}"
    rounded: "{rounded.md}"
    padding: 12px
    note: "Shares the user-message bubble surface so 'input' and 'source' read alike."
  diff-added-line:
    backgroundColor: "color-mix(in srgb, {colors.diff-added} 12%, transparent)"
    textColor: "{colors.diff-added}"
  diff-removed-line:
    backgroundColor: "color-mix(in srgb, {colors.diff-removed} 12%, transparent)"
    textColor: "{colors.diff-removed}"
  skill-chip:
    backgroundColor: "color-mix(in srgb, {colors.skill} 14%, transparent)"
    textColor: "{colors.skill}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
    note: "Agent/skill affordance — the one non-blue accent in the chrome."
  icon-chip:
    backgroundColor: "{colors.surface-card}"
    rounded: "{rounded.full}"
    size: 24px
    shadow: "0 0 0 1px {colors.hairline}, 0 1px 2px rgba(0,0,0,0.05)"
  badge-pill:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.body}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 8px
  scrollbar-thumb:
    backgroundColor: "rgba(0,0,0,0.1)"
    rounded: "{rounded.pill}"
    width: 10px
    note: "2px transparent inset border floats the thumb; dark = rgba(255,255,255,0.07)."
  terminal:
    backgroundColor: "{colors.canvas-under}"
    textColor: "{colors.body}"
    typography: "{typography.terminal}"
    note: "xterm surface; scrollbar hidden, NerdFont glyph stack."
---

## Overview

FCode's interface reads as a **quietly-confident native developer tool** — closer to Codex, Linear, and Raycast than to a marketing site or a bright web app. It believes in **density and calm** over decoration. The base canvas is a near-white neutral (`{colors.canvas}` — #fcfcfc in light, #0e0e0e in dark), and near-black neutral ink (`{colors.ink}` — #0d0d0d) is carried by the **OS system-ui font stack**, so the app feels like it belongs to the operating system rather than to the browser.

The single brand voltage is **Codex Blue** (`{colors.primary}` — #0169cc), reserved for links, focus rings, and the primary action. Everything else in the chrome is grayscale. The only other chromatic vocabulary is a dedicated **agent/skill violet** (`{colors.skill}` — #924ff7) and the **diff green/red** pair — all scoped to agent activity and code, never sprinkled as decoration.

The strongest signature is **material, not color**. A frosted translucent glass system (`backdrop-filter: blur(24px) saturate(180%)`) gives the sidebar, composer, and popovers their depth, layered over an almost aggressively **flat, shadow-averse** surface model: cards and buttons get their edges from 4–6% alpha hairlines and inset 1px highlights, not drop shadows. Type and spacing are **dense** — a 12px base UI size, 28px rows, tight `-0.015em` tracking — and **JetBrains Mono** carries every code, input, and terminal surface.

Critically, none of these values are hard-coded per-screen: the whole palette flows from a **runtime theme engine** (`apps/web/src/theme/theme.logic.ts`) where accent, contrast, surface, ink, and fonts are user-tunable across 28+ built-in themes (Codex, Catppuccin, Nord, Linear, Notion, Raycast, Vercel…) on a light/dark axis. This document captures the **default (Codex)** theme as the canonical reference.

**Key Characteristics:**

- Neutral near-white/near-black canvas — not warm, not pure black. Grayscale-first.
- One CTA color: `{colors.primary}` (Codex Blue #0169cc). Used scarcely.
- Depth is **material + hairline**, never drop shadows. Buttons are deliberately flat.
- Frosted translucent glass (sidebar/composer/popover) is the signature surface.
- Dense by default: 12px UI text, 28px rows, `-0.015em` tracking.
- Two scoped accent families only: agent/skill violet, and diff green/red.
- JetBrains Mono on every code, input, and terminal surface.
- Fully theme-engine-driven; light/dark are first-class, not an afterthought.

## Colors

### Brand & Accent

- **Codex Blue** (`{colors.primary}` — #0169cc): Primary action, links, focus ring, file labels, info. The one voltage. Used scarcely.
- **Codex Blue Active** (`{colors.primary-active}` — #0157a8): Press/darken state (implemented as accent @ 90% opacity on hover).
- **Accent Fallback** (`{colors.primary-fallback}` — #339cff): The engine's hard fallback accent when a theme omits one.

### Surface (light)

- **Canvas** (`{colors.canvas}` — #fcfcfc): The page floor (`surface-under`). Near-white neutral.
- **Surface Card** (`{colors.surface-card}` — #ffffff): Pure-white panel surface, a hair brighter than the canvas.
- **Surface Elevated** (`{colors.surface-elevated}` — black @ 4%): Secondary/muted fills, hover states, code-block backing.

### Surface (dark)

- **Canvas Dark** (`{colors.canvas-dark}` — #0e0e0e): Dark page floor.
- **Surface Card Dark** (`{colors.surface-card-dark}` — ~#0f0f0f): 99% canvas + 1% white — a barely-lifted panel.

### Hairlines (the depth system)

- **Hairline** (`{colors.hairline}` — black @ 5%): Default 1px divider / card outline.
- **Hairline Soft** (`{colors.hairline-soft}` — black @ 4%): Internal dividers (thinned to 60% via color-mix).
- **Hairline Strong** (`{colors.hairline-strong}` — black @ 6%): Input outlines.
- **Dark hairline** (`{colors.hairline-dark}` — white @ 4%): Same role in dark mode.

### Text

- **Ink** (`{colors.ink}` — #0d0d0d): Display + emphasis in light. Near-black neutral.
- **Body** (`{colors.body}` — #262626 / neutral-800): Default running text.
- **Muted** (`{colors.muted}` — #737373 / neutral-500): Secondary text, descriptions.
- **Muted Soft** (`{colors.muted-soft}` — #a3a3a3 / neutral-400): Disabled, placeholder, faint icons.
- **Ink Dark / Body Dark** (`{colors.ink-dark}` — #f5f5f5, `{colors.body-dark}` — #e5e5e5): Dark-mode text.
- **On Primary** (`{colors.on-primary}` — #ffffff): Text on Codex Blue.

### Agent / Diff (scoped signatures)

- **Skill** (`{colors.skill}` — #924ff7 light / #ad7bf9 dark): Violet. Agent skill/tool affordances, magenta terminal ANSI, "purple" accent. The only non-blue chrome accent.
- **Diff Added** (`{colors.diff-added}` — #00a240 light / #40c977 dark): Green. Added lines, success.
- **Diff Removed** (`{colors.diff-removed}` — #ba2623 light / #fa423e dark): Red. Removed lines, destructive.

### Semantic

- **Success** (`{colors.semantic-success}` — #00a240): Confirmations (shares diff-added).
- **Error** (`{colors.semantic-error}` — #ba2623): Validation / destructive (shares diff-removed).
- **Warning** (`{colors.semantic-warning}` — #f59e0b / amber-500).
- **Info** (`{colors.semantic-info}` — #0169cc): Shares the accent.

### Provider Brand

- **Claude** (`{colors.brand-claude}` — #d97757): Anthropic/Claude provider mark. Reserved to that provider's identity, never a system color.

## Typography

### Font Families

The UI runs the **OS system-ui stack** (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`) so the app reads as native. Every code, input, textarea, and `<pre>` surface switches to **JetBrains Mono** (`"JetBrains Mono Variable"` → fallbacks). The terminal uses a **NerdFont** JetBrains Mono variant for glyph coverage. Body text carries a tight `-0.015em` letter-spacing throughout.

### Hierarchy

| Token                      | Size | Weight | Line Height | Tracking | Use                                  |
| -------------------------- | ---- | ------ | ----------- | -------- | ------------------------------------ |
| `{typography.display}`     | 18px | 600    | 1.0         | -0.015em | Card titles / largest heading        |
| `{typography.title-md}`    | 14px | 600    | 1.4         | -0.015em | Section + panel titles               |
| `{typography.title-sm}`    | 13px | 600    | 1.4         | -0.015em | List/group labels                    |
| `{typography.body-md}`     | 12px | 400    | 1.5         | -0.015em | **The workhorse UI size**            |
| `{typography.body-strong}` | 12px | 500    | 1.5         | -0.015em | Emphasis, button labels              |
| `{typography.label-sm}`    | 11px | 400    | 1.4         | -0.015em | Dense chips, meta rows               |
| `{typography.caption}`     | 10px | 400    | 1.4         | -0.01em  | Badges, smallest labels              |
| `{typography.button}`      | 12px | 500    | 1.0         | -0.015em | Button labels                        |
| `{typography.code}`        | 12px | 400    | 1.5         | 0        | Inline code, inputs — JetBrains Mono |
| `{typography.code-block}`  | 13px | 400    | 1.5         | 0        | Code blocks — JetBrains Mono         |
| `{typography.terminal}`    | 12px | 400    | 1.4         | 0        | Terminal — NerdFont mono             |

### Principles

- **12px is the base UI size.** This is a dense tool, not a reading page. Sizes flex via density tokens (`--app-font-size-ui` 12 · `-sm` 11 · `-xs` 10 · `-lg` 13).
- **Tight tracking on all UI text** (`-0.015em`). Zero tracking on code.
- **Bold is 600 max, and rare.** Emphasis usually means weight 500, not 700. Markdown `strong` is even rendered at 500.
- **JetBrains Mono on every code / input / terminal surface.**

### Note on Substitutes

The UI font is intentionally the **OS default** — no licensed display face. Bundled fallbacks (`@fontsource-variable/inter`, plus DM Sans / Geist loaded in `index.html`) cover non-native platforms; **Inter** weight 400–600 is the closest cross-platform stand-in for the system stack. **JetBrains Mono** ships via `@fontsource-variable/jetbrains-mono`.

## Layout

### Spacing System

- **Base unit:** 4px (Tailwind scale).
- **Tokens:** `{spacing.xxs}` 2px · `{spacing.xs}` 4px · `{spacing.sm}` 8px · `{spacing.base}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 20px · `{spacing.xl}` 24px · `{spacing.xxl}` 32px · `{spacing.section}` 48px.
- **Row height:** 28px (`--app-density-row-height`, 1.75rem) — the fundamental list rhythm.
- **Card padding:** 24px (`p-6`). **Row padding:** 2px × 8px.

### Grid & Container

- App-shell layout, not a marketing grid: **frosted sidebar rail + inset content card**.
- The content area is a single rounded "card" seamed to the sidebar; there is **one seam line only** (a clipped inset ring, never a second border).
- Density is user-tunable (`--app-density-*`), so heights/paddings are variables, not fixed.

### Whitespace Philosophy

Utilitarian and **dense** — this is an IDE-adjacent tool where information density is a feature. Whitespace is used to separate functional regions (sidebar / chat / diff / terminal), not for editorial pacing. Rows sit tight (28px), gaps are 4–8px.

## Elevation & Depth

The system is **material + hairline first, shadow-averse**. There are effectively two depth mechanisms and both avoid heavy shadows.

| Level                | Treatment                                                                                     | Use                                 |
| -------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------- |
| Flat (canvas)        | `{colors.canvas}` #fcfcfc / #0e0e0e                                                           | Page floor, chat surface, settings  |
| Hairline border      | 1px `{colors.hairline}` (black/white @ 4–6%)                                                  | Card outlines, dividers, inputs     |
| Card                 | `{colors.surface-card}` + `shadow-xs/5` + inset 1px edge highlight (`before: 0 1px black/4%`) | Content cards, dialogs              |
| **Frosted material** | `backdrop-filter: blur(16–32px) saturate(180%)` over a semi-transparent surface               | Sidebar, composer, popovers (macOS) |

### The Material Rule

On macOS the shell is **translucent** — the sidebar is `color-mix(surface-card 52%, transparent)` with a 24px frosted blur and a bright specular top edge (`inset 0 1px 0 rgba(255,255,255,0.55)`). On Windows/Linux the same surfaces render **opaque** (fractional-DPI blur artifacts), so translucency is a platform-conditional enhancement, never a dependency.

### Buttons Are Flat On Purpose

Buttons carry **no drop shadow, no inset glint, no pseudo-element edge** — solid fill + 1px border + hover-background only. If depth is needed, a new _variant_ is added rather than reintroducing shadows piecewise. The `prominent` full-pill is the sole button that animates (scale to 1.05).

## Shapes

### Border Radius Scale

Driven by one base token `--radius: 0.625rem` (10px) with a computed scale.

| Token                               | Value  | Use                                                       |
| ----------------------------------- | ------ | --------------------------------------------------------- |
| `{rounded.none}`                    | 0px    | Reserved / flush edges                                    |
| `{rounded.sm}`                      | 6px    | Icon buttons, xs/icon-xs rows                             |
| `{rounded.md}`                      | 8px    | Sidebar rows, inputs, code blocks                         |
| `{rounded.lg}`                      | 10px   | **Buttons** (base radius)                                 |
| `{rounded.xl}`                      | 14px   | Composer, stacked-card inner corners                      |
| `{rounded.user-message}`            | 14px   | Chat user-message bubbles                                 |
| `{rounded.2xl}`                     | 18px   | **Cards**                                                 |
| `{rounded.3xl}`                     | 22px   | Large panels (rare)                                       |
| `{rounded.4xl}`                     | 26px   | Largest surfaces (rare)                                   |
| `{rounded.pill}` / `{rounded.full}` | 9999px | Chips, badges, prominent button, avatars, scrollbar thumb |

## Components

### Window Shell & Sidebar

**`window-shell`** — Frameless. A `.drag-region` owns the titlebar; `--app-shell-background` is transparent on macOS so OS vibrancy shows through, opaque elsewhere.

**`sidebar`** — The signature surface. Frosted iOS-glass: `color-mix(surface-card 52%, transparent)`, `backdrop-filter: blur(24px) saturate(180%)`, bright specular top edge. Renders opaque on non-macOS. Only **one seam** divides it from the content card.

**`sidebar-row`** — Dense list row. 28px height, `{rounded.md}`, 12px text, 2×8px padding, transparent by default, hover `{colors.surface-elevated}`, active black @ 6%.

**`sidebar-icon-button`** — `{rounded.sm}`, icon at 60% muted, hover lifts the background.

### Buttons

**`button-primary`** — Codex Blue fill, white text, `{typography.button}` (12px/500), height 32px, `{rounded.lg}` (10px), **flat**. Hover = 90% opacity.

**`button-secondary`** — `{colors.surface-elevated}` fill, ink text, transparent border.

**`button-outline`** — Transparent fill, 1px `{colors.hairline}` border, ink text.

**`button-ghost`** — Transparent, muted text, hover-background only. The default for chrome/toolbar actions.

**`button-destructive`** — `{colors.semantic-error}` fill, white text.

**`button-prominent`** — Full-pill (`{rounded.pill}`) ink-on-canvas hero action; scales to 1.05 on hover — the only animated button.

> The full family also includes `chrome`, `chrome-outline`, `subtle`, `primary-outline`, `secondary-outline`, `destructive-outline`, and `link` — all mirroring the same flat border/focus treatment across 6 text sizes (chip · xs · sm · default · lg · xl) each paired with a square icon-only counterpart at matching heights.

### Cards & Surfaces

**`card`** — `{colors.surface-card}`, 1px `{colors.hairline}`, `{rounded.2xl}` (18px), 24px padding, `shadow-xs` + a 1px inset edge highlight. Subcomponents: `card-title` (18px/600), `card-description` (12px muted), header/panel/footer at 24px padding. A `card-frame` variant stacks multiple cards seamlessly with clipped shared borders.

**`popover-menu`** — Elevated menu surface, `{rounded.lg}`, `blur(32px)` frost, 1px hairline.

### Inputs

**`text-input`** — `{colors.surface-card}`, 1px `{colors.hairline-strong}`, `{rounded.md}` (8px), 8×12px padding. **Renders in JetBrains Mono** by default (inputs/textareas inherit the mono stack).

**`composer`** — The chat input surface. `{rounded.xl}`, frosted `blur(16px)` on macOS, focus border in `{colors.primary}`.

### Code & Agent

**`code-block`** — `{colors.surface-elevated}` backing (shared with the user-message bubble), `{typography.code-block}` (13px JetBrains Mono), `{rounded.md}`, 12px padding.

**`diff-added-line` / `diff-removed-line`** — Green/red tinted line backgrounds (`{colors.diff-added}` / `{colors.diff-removed}`), 12% fill.

**`skill-chip`** — Violet agent/skill affordance. `color-mix({colors.skill} 14%, transparent)` fill, `{typography.label-sm}`, `{rounded.pill}`. The one non-blue accent in the chrome — scope it to agent/skill activity only.

### Small Elements

**`icon-chip`** — 24px circular badge on the sidebar material, ringed by a 1px hairline + faint shadow so stacked icons separate.

**`badge-pill`** — `{colors.surface-elevated}` fill, `{typography.caption}` (10px), `{rounded.pill}`.

**`scrollbar-thumb`** — Thin 10px pill, `rgba(0,0,0,0.1)` (dark `rgba(255,255,255,0.07)`), floated off the track by a 2px transparent inset border. Hidden entirely in the terminal.

**`terminal`** — xterm surface on the canvas, NerdFont JetBrains Mono, scrollbar removed.

## Do's and Don'ts

### Do

- Reserve `{colors.primary}` (Codex Blue) for the primary action, links, and focus. Keep the rest grayscale.
- Get depth from **material + hairlines + inset highlights**. Frost translucent surfaces on macOS only.
- Keep the UI **dense**: 12px base text, 28px rows, `-0.015em` tracking.
- Render every code / input / terminal surface in JetBrains Mono.
- Scope the two accent families: violet = agent/skill, green/red = diff. Nothing else colored.
- Drive everything from the theme engine's tokens (`--color-*`) so accent/contrast/surface/ink/fonts stay user-tunable across light/dark.

### Don't

- Don't add drop shadows to buttons or reintroduce inset glints piecewise — the flat look is the default. Add a _variant_ instead.
- Don't bump display type to 700+ or loosen tracking — the tool voice depends on tight, quiet type.
- Don't use warm hues for the canvas or ink — the palette is neutral gray, not cream.
- Don't spend the skill violet or diff green/red as decoration — they're semantic.
- Don't depend on the frosted translucency for legibility; it must degrade to opaque off macOS.
- Don't hard-code hex per screen — reference the resolved `--color-*` / semantic tokens so themes keep working.

## Responsive Behavior

This is a **desktop-native app**, not a responsive marketing page — the primary axis is _window size_ and _density_, not phone breakpoints.

| Axis              | Behavior                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Narrow window     | Sidebar collapses to an icon rail; content card takes the width.                                                    |
| Density setting   | Row height / padding / font size flex via `--app-density-*` and `--app-font-size-*` tokens (compact ↔ comfortable). |
| Platform material | macOS = translucent frosted shell; Windows/Linux = opaque surfaces (blur disabled).                                 |
| Theme / mode      | Light / dark / system, plus 28+ code themes, all swapped live by re-projecting `--color-*` onto `:root`.            |

### Touch / Hit Targets

- Buttons default to 32px height; a `pointer-coarse` after-element pads the hit area to ≥44px on touch/pen input without changing the visual size.

## Iteration Guide

1. Change color through the **theme engine**, not per-component hex. Edit a seed in `theme.seed.generated.ts` or the resolved tokens in `theme.logic.ts`.
2. Buttons default to `{rounded.lg}` (10px); cards to `{rounded.2xl}` (18px); rows/inputs to `{rounded.md}` (8px).
3. New button treatments become **variants** in `button.tsx` (mirror an existing one's border/focus) — avoid per-call-site className overrides.
4. Use `{token.refs}` / `--color-*` everywhere — never inline hex in components.
5. Keep depth in the **material + hairline** system; don't reach for shadows.
6. Keep the accent scarce and the two semantic accent families (skill violet, diff green/red) tightly scoped.
7. Respect density: everything sizes from `--app-density-*` / `--app-font-size-*`, so prefer those over fixed px.

## Known Gaps

- This captures the **default (Codex) theme**; the app ships 28+ themes and a fully tunable accent/contrast/surface/ink/font engine — treat the specific hexes here as the canonical instance of a system, not fixed brand values.
- The UI font is the **OS system-ui stack**; exact rendering (weight, metrics) varies by platform. Inter is the cross-platform substitute.
- Frosted translucency is macOS-only; the opaque fallback is the guaranteed baseline.
- Animation timings (composer/pane reveal, prominent-button scale) are largely out of scope here.
- No large "marketing display" tier exists — the biggest common heading is 18px. This is an application UI, not a landing page; the template's hero/pricing/CTA-band sections have no direct analog and were intentionally omitted.

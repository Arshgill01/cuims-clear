# CUIMS Clear Design System

## 1. Creative North Star

**The Student Shortcut.** CUIMS Clear should feel like a tool a sharp student made for
other students: immediate, inspectable, and quietly defiant. The interface is a compact
control surface, not a university portal or a startup dashboard. Its visual signature is
graphite type on neutral paper with one high-energy acid-lime accent.

## 2. Product Scene

A student opens the extension between classes or from a hostel desk, often in a hurry and
on an ordinary laptop display. They need to confirm that their login is saved, silence the
two known interruption categories, and enter CUIMS in a few seconds. The popup must remain
legible at a glance and trustworthy around credentials.

## 3. UX Architecture

The popup has four zones in one continuous surface: identity and purpose, saved-login
fields, automation controls, and actions/privacy. “Open CUIMS” is the primary action.
Saving settings is explicit. Credential deletion stays visible and local. Controls use
native semantics and keyboard behavior; state is never conveyed through color alone.

## 4. Visual System

- Canvas: `#f2f3ee`; surface: `#ffffff`; ink: `#181a17`; muted ink: `#63685f`.
- Borders: `#d6dad1`; strong borders: `#aeb4aa`.
- Accent: `#b7f34a` with `#18200d` text; focus: `#527f17`; success: `#28633a`.
- Type: Avenir Next when available, then Avenir, Inter, system sans-serif.
- Radius: 8px for controls and 10px for the mark; no decorative shadows or gradients.
- Spacing: 4px base rhythm with 12px, 16px, 20px, and 24px as primary intervals.
- Motion: only short state feedback; remove it when reduced motion is requested.

## 5. Component Language

The identity mark is a black square cut by two lime forward slashes: progress without
institutional branding. Inputs are white with crisp one-pixel borders. Full-row native
checkboxes form two small setting groups: login and quiet mode. Primary actions are lime
with dark text; secondary actions are white or graphite. Privacy text is compact but never
hidden. Destructive local-data removal is a plain, clearly labelled text action.

## 6. Accessibility & Content

Target WCAG AA contrast, visible `:focus-visible` rings, 44px primary targets, and logical
tab order. Labels remain visible above fields. Password visibility has an accessible name
that updates with state. Status messages use a polite live region. Copy is short, direct,
and peer-built: no hype, no university voice, and no claim that CAPTCHA is bypassed.

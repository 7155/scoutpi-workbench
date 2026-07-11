# Workbench Localization

The ScoutPi Workbench supports English and Simplified Chinese without adding localization state to the Earth runtime or Pi tool schemas.

## Language Switch

Desktop uses the `EN / 中` segmented control in the application header. On narrow mobile layouts, the same action is available from the workspace overflow menu so the map and primary run controls keep stable dimensions.

The selected locale is stored in browser `localStorage` under:

```text
scoutpi.workbench.locale
```

When no preference exists, the Workbench follows the browser language. Switching language immediately updates labels, tooltips, dialogs, charts, status labels, role labels, `document.lang`, and the page title. Reloading the application preserves the choice.

## Content Boundary

Localization applies to product-owned interface text. ScoutPi deliberately does not machine-translate:

- investigation questions and hypotheses;
- user-authored claims and evidence excerpts;
- dataset and adapter titles from external providers;
- runtime error bodies and source metadata.

Those values are evidence or domain content. Automatically rewriting them would break provenance, identifiers, search, or reproducibility. Known runtime states and observable-role identifiers are rendered through bounded label maps; unknown identifiers remain visible in a readable fallback form.

## Implementation

`apps/web/src/i18n.ts` provides a small dependency-free Vue locale store:

- `useI18n()` for reactive templates;
- `translate()` for stable product labels and interpolation;
- `translateStatus()` and `translateRole()` for controlled runtime vocabularies;
- `setAppLocale()` for persistence and document metadata.

The English source phrase remains the fallback, so a missing translation never hides a control. Tests verify bilingual labels, interpolation, known state/role translation, and unknown domain-role fallback.

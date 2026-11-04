# Kinfolk — agent instructions

## Design

- Design source of truth: the token layer in `apps/web/app/globals.css` (`:root` variables — palette, easings). Style with those tokens or Tailwind theme utilities; never introduce new raw hex values in components. To change the look, change the tokens, not the component.
- House rules (founder-approved): monospace (DM Mono) is for digits and uppercase eyebrow labels only; the display face is for titles only; no tinted background panels; state each fact once per surface.
- Type roles (defined in `apps/web/app/layout.tsx` + `globals.css`): `--font-display` = Bricolage Grotesque, titles only, weight 600, applied via the `.serif` class (legacy name, pending a mechanical rename to `.display`); `--font-sans` = Onest for all body/UI; `--font-mono` = DM Mono. Neither face ships italics and `font-synthesis: weight` blocks faked ones — emphasis is weight or color, never italic. Do not introduce new fonts.
- Fit-score colors come from `apps/web/app/(app)/apartments/_components/fit-tone.ts` — never hand-roll them.
- Accessibility bar: WCAG 2.1 AA. Body text ≥4.5:1 — no muted-gray-on-cream body copy (`--ink-500` and lighter fail on the cream background; body text needs `--ink-600` or darker). Visible focus rings (`kin-focus`). Full keyboard support for modals (Esc, arrow-key gallery, focus trap). Respect `prefers-reduced-motion` for all entrance/hover motion.
- Broad aesthetic explorations get rejected. Get a concrete visual reference and iterate one direction; never ship N-variant galleries. Known-rejected direction: the cream-gradient + serif "Poke-calm" look — do not re-propose it.

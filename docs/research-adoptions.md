# Research Adoptions

Screenslop keeps research repos in ignored folders. When a pattern graduates into the engine, the decision belongs here so it is not trapped in `research/`.

## Critique MVP

### Adopted now

- **Pixelslop evidence discipline**: every finding needs runtime evidence. Screenslop uses Apple runtime artifacts instead of browser DOM data.
- **Mobile-screen-eval finding shape**: findings should explain the element, the observation, why it matters, the fix, and how to verify it.
- **Apple mobile thresholds**: the first deterministic checks use evidence that current bundles can prove, especially AX names and 44pt hit targets.
- **Baguette AX frames**: Baguette reports frames in device points, so critique rules treat touch targets and screen bounds as point-based.

### Deferred

- **Tokextract / DESIGN.md** belongs in `screenslop learn`, after its contract is inspected against Screenslop's evidence model.
- **XcodeBuildMCP** remains the next runtime fallback, not a blocker for the first critique pass.
- **Swift visual testing** belongs in `matrix` and `verify`, after single-bundle critique is stable.
- **Pixelslop personas and checkpointing** belong after findings have stable IDs and a fix loop.

### Rejected for the MVP

- Source-only UI criticism when runtime evidence exists.
- LLM taste scoring as the first critique engine.
- Direct web DOM heuristics copied into Apple UI review.
- Typography, contrast, color, or motion claims before Screenslop collects evidence that can prove them.

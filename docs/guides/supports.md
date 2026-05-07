# Supports

Support structures hold up overhanging geometry during printing. Without them, the cured layer has nothing to bond to, and the print either fails or deforms.

## Understanding overhang angle

The **overhang angle** setting is the threshold above which a surface is considered to need support. It's measured from the horizontal build plate:

- **0°** = horizontal (flat ceiling) — always needs support
- **30°** = the default — a good balance for most resins; surfaces angled more than 30° from horizontal are supported
- **45°** — more aggressive; surfaces up to 45° steep may print unsupported depending on resin and layer height
- **60°+** — very permissive; only near-horizontal faces get supports

Most resins handle 45° without supports if layer height is ≤ 0.05 mm. Start at 30° if you're unsure, then reduce if you're over-supporting.

## Auto-Generate

Click **Auto-Generate** in the Supports panel. The engine:

1. Detects all faces below the overhang angle threshold
2. Places contact points based on the **density** setting
3. Routes support pillars from each contact point down to the build plate (or to the model surface below it)
4. Optionally adds **cross-bracing** between adjacent pillars for stability
5. Optionally adds a **base pan** (raft-like pad) at the bottom of the support tree

### Density

- **Auto density** (default) scales point count to surface area — you rarely need to change this
- Manual density lets you specify support points per cm²

### Cross-bracing

Adds diagonal struts between support pillars. Useful for tall, thin support trees that could flex during peel. Adds a small amount of resin.

### Base pan

A flat pad at the bottom of the support cluster that improves build plate adhesion for models with many small support contact points. Configure the **margin** (how far the pan extends beyond the outermost support foot), **thickness**, and **lip** (raised edge to catch the pad during removal).

## Checking coverage

Enable **Show unsupported areas** to colour the model surface:

- **Red** — still needs support
- **Green** — covered by an existing support

This overlay updates live as you add or remove supports, so you can verify coverage without slicing.

## Manual placement

Switch to **Manual Placement** mode (the crosshair button) and click directly on the model surface to add individual support pillars. This is useful for:

- Adding a single pillar to a spot the auto-generator missed
- Precise placement on cosmetic surfaces (you can use a smaller tip diameter)
- Reinforcing a specific weak point identified in the peel force chart

Press `Esc` to leave manual placement mode.

## Intent-aware generation

If you've painted surface intents, supports will avoid cosmetic faces where possible and preferentially contact hidden or reliability-critical faces. Run Auto-Generate *after* painting intents for best results.

## Tips

- Generate supports *after* orienting — orientation changes which faces overhang
- Tip diameter controls how easily supports snap off after printing; 0.3–0.5 mm is a good range for cosmetic parts
- If a support tree looks unstable (very tall, few pillars), enable cross-bracing or add manual reinforcement pillars
- Check the peel force chart in the Slice panel after slicing — spikes indicate layers with high support contact area that may cause adhesion issues

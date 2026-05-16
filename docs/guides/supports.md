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
4. Optionally adds cross-bracing, a base pan, and other options from the **Advanced** section

### Density

- **Auto density** (default) scales point count to surface area — you rarely need to change this
- Manual density lets you specify support points per cm²

## Advanced options

Expand the **Advanced** section in the panel for full control over how supports are generated and what they look like.

### Thickness

- **Auto Thickness** (default) sizes tip and shaft diameters to suit the model — leave it on unless you need precise control
- **Tip Diameter** — the sphere at the contact point; smaller tips snap off more cleanly but are weaker (0.3–0.5 mm for cosmetic parts)
- **Support Thickness** — shaft diameter; thicker shafts are more rigid but use more resin

### Detection

- **Local Minima** — adds supports at hanging low points (tips, dangles) even if the angle isn't steep enough to trigger the overhang detector
- **Stabilization** — adds perimeter supports around tall or narrow models to prevent tip-over during peel; the **Stabilization Density** slider controls how many are placed
- **Reinforcements** — adds supports where the model wall is thinner than the **Reinforcement Threshold**; useful for fragile thin sections but slow on high-polygon models

### Spherical Connection

Adds a small ball joint at the contact point between the tip and the model surface. Makes supports easier to remove cleanly. Set **Sphere Diameter** to match your tip diameter.

### Cross-bracing

Adds diagonal struts between support pillars. Useful for tall, thin support trees that could flex during peel. Adds a small amount of resin.

### Base bracing

Adds thick low struts between nearby support feet. Use this when you want more base stability than separate feet provide, but want to save resin compared with a full base pan.

### Base pan

A flat pad at the bottom of the support cluster that improves build plate adhesion for models with many small support contact points. Configure the **margin** (how far the pan extends beyond the outermost support foot), **thickness**, and **lip** (raised edge to catch the pad during removal).

### Routing

- **Support Scope** — *Outside only* (default) skips internal cavities; switch to *Include cavities* if you need to support internal overhangs
- **Approach** — controls whether pillars prefer angled or vertical routes around obstructions
- **Max Pillar Angle** — the steepest angle (from vertical) a pillar can lean to reach its contact point
- **Model Clearance** — minimum gap between a pillar shaft and the model surface
- **Max Contact Offset** — how far a pillar can shift horizontally to find a clear path

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

## Deleting individual pillars

When the Supports panel is open, **right-click** any support pillar in the viewport to delete it instantly. This works on both auto-generated and manually placed pillars. Press `Ctrl+Z` to undo the deletion.

Auto-generated pillars and manual pillars coexist freely. Running **Auto-Generate** again will replace the auto pillars but keep your manual ones. All settings (cross-bracing, base pan, spherical connections) apply to the combined set of pillars.

## Intent-aware generation

If you've painted surface intents, supports will avoid cosmetic faces where possible and preferentially contact hidden or reliability-critical faces. Run Auto-Generate *after* painting intents for best results.

## Tips

- Generate supports *after* orienting — orientation changes which faces overhang
- Tip diameter controls how easily supports snap off after printing; 0.3–0.5 mm is a good range for cosmetic parts
- If a support tree looks unstable (very tall, few pillars), enable cross-bracing or add manual reinforcement pillars
- Check the peel force chart in the Slice panel after slicing — spikes indicate layers with high support contact area that may cause adhesion issues

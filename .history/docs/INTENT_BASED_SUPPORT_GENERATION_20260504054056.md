# PRD: Intent-Based Support System

## 1. Problem

Current SLA workflows are **parameter-driven**:

- Users tune:
  - support density
  - touchpoint size
  - orientation

- Or rely on:
  - auto-support (black box)

Observed issues:

- No way to express **what matters**
- Tradeoffs are implicit:
  - cosmetic vs reliability
  - removal vs strength

- High reliance on:
  - trial-and-error
  - expert knowledge

- Inconsistent outcomes across:
  - teams
  - models
  - use cases

---

## 2. Goal

Replace parameter-driven support generation with **goal-driven support planning**.

Users specify **intent**.
PreForm determines **how to achieve it**.

---

## 3. Non-goals

Explicit exclusions:

- Full CAD modeling
- Freeform mesh editing tools
- Arbitrary scripting system (v1)
- ML black-box-only solution without explainability

---

## 4. Definitions

### Intent

A structured constraint or priority applied to:

- whole model
- region
- surface
- feature

Example:

- “cosmetic surface”
- “hidden surface”
- “dimension-critical”
- “fragile feature”
- “removal-sensitive”

---

## 5. Core Concept

### Current model

```
Geometry → heuristics → supports
```

### Target model

```
Geometry + Intent → optimization → supports + explanation
```

---

## 6. User Value

### Before

- Trial-and-error
- Manual support editing
- Unclear failures

### After

- Declarative workflow
- Predictable tradeoffs
- Reduced expertise requirement
- Faster iteration

---

## 7. User Stories

### U1 — Cosmetic priority

> As a user, I want to mark a face as cosmetic
> so that no supports appear there unless strictly required

---

### U2 — Engineering part

> As a user, I want a feature to be dimension-critical
> so that supports reinforce it and avoid deformation

---

### U3 — Fast post-processing

> As a user, I want minimal cleanup time
> so that supports are grouped and accessible

---

### U4 — Reliability-first

> As a user, I want maximum print success
> so that the system increases support density automatically

---

### U5 — Hidden surfaces

> As a user, I want supports placed on hidden areas
> so visible faces remain clean

---

## 8. Functional Requirements

### 8.1 Intent assignment

Users can:

- Select:
  - faces
  - regions
  - entire model

- Assign intent labels:

**MVP intents:**

- Cosmetic
- Hidden
- Reliability-critical
- Removal-sensitive

---

### 8.2 Intent priority

Each intent has:

- Priority (low / medium / high)
- Optional constraints:
  - “never place supports”
  - “prefer but allow override”

---

### 8.3 Support generation engine

Must consider:

- Orientation
- Support placement
- Support density
- Touchpoint size
- Support topology

Optimization must balance:

- Print success
- Surface damage
- Removal effort
- Material usage
- Print time

---

### 8.4 Conflict resolution

System must detect:

- conflicting intents

Example:

- Cosmetic surface conflicts with unsupported island

System behavior:

- Surface flagged
- Suggested resolution shown

---

### 8.5 Tradeoff controls

Expose limited axes:

- Appearance ↔ Reliability
- Removal effort ↔ Material/time

User adjusts → supports update in real time

---

### 8.6 Explanation system

User can click a support:

System shows:

- why it exists
- which intent caused it
- alternative options rejected

---

### 8.7 Risk integration

System integrates with:

- island detection
- suction/cupping detection
- trapped resin detection

Output:

- risk-aware support placement

---

## 9. UX Design

### 9.1 Intent painting

- Brush tool
- Face selection
- Region selection

Visual overlay:

- Color-coded intent map

---

### 9.2 Intent panel

Shows:

- active intents
- priorities
- conflicts

---

### 9.3 Tradeoff slider

Simple UI:

```
[Appearance ----------- Reliability]
[Fast cleanup --------- Minimal material]
```

---

### 9.4 Conflict inspector

Displays:

- conflicting areas
- suggested fixes

---

### 9.5 Support explanation

Click support → panel:

- “Placed due to unsupported island under cosmetic constraint”
- “Alternative: rotate +12°, increases print time by 8%”

---

## 10. System Architecture

### 10.1 Pipeline

```
1. Geometry ingestion
2. Region segmentation
3. Intent mapping
4. Candidate generation
   - orientations
   - support layouts
5. Objective evaluation
6. Optimization
7. Result + explanation
```

---

### 10.2 Objective model

Each candidate scored by:

- Print stability
- Support visibility
- Removal difficulty
- Material usage
- Time
- Drainage risk

---

### 10.3 Optimization approach

MVP:

- weighted scoring

Later:

- Pareto frontier
- multi-objective solver

---

## 11. MVP Scope

### Included

- 4 intents
- surface painting
- priority system
- orientation + support optimization
- 2 tradeoff sliders
- basic explanation system

---

### Excluded

- ML-based learning
- assembly-aware intent
- advanced drainage simulation
- batch optimization

---

## 12. Phase 2

- Drainage-aware intent
- support accessibility prediction
- reusable intent templates
- printer/material-specific tuning

---

## 13. Phase 3

- learning from print outcomes
- CAD semantic import
- batch production optimization
- advanced Pareto exploration

---

## 14. Risks

### R1 — UX complexity

Mitigation:

- limit intent vocabulary
- progressive disclosure

---

### R2 — optimization latency

Mitigation:

- precomputed candidates
- incremental updates

---

### R3 — incorrect automation

Mitigation:

- explanation layer
- easy override

---

### R4 — user mistrust

Mitigation:

- transparency
- deterministic fallback

---

## 15. Success Metrics

### Quantitative

- Reduction in manual support edits
- Reduction in failed prints
- Time to first successful print
- Support removal time

---

### Qualitative

- perceived control
- trust in automation
- reduced expert dependency

---

## 16. Strategic Positioning

Compared to competitors:

- Others: parameter-driven
- PreForm: **goal-driven**

This creates:

- differentiation
- ecosystem lock-in
- stronger alignment with Formlabs hardware + materials

---

## Final Assessment

This is not a feature.
It is a **new abstraction layer in slicers**.

If executed correctly:

- replaces manual workflows
- reduces expertise barrier
- strengthens PreForm’s core value proposition

If executed poorly:

- becomes another confusing UI layer on top of existing knobs

The difference is entirely in:

- constraint modeling
- optimization quality
- explanation clarity

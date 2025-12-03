# Among Us Ghost Design Specification

## Complete Visual Reference & Animation Algorithm

---

## Overview

In Among Us, when a player is killed or ejected, they become a **ghost**. The ghost is a semi-transparent, floating version of the original crewmate/impostor character with distinctive visual characteristics that distinguish it from living players.

---

## Ghost Visual Appearance

### Key Characteristics

1. **Same Color as Original Character**: The ghost retains the player's original suit color
2. **Semi-Transparency**: Ghosts are see-through (approximately 45-55% opacity) with a slight alpha pulse
3. **Floating/Hovering**: Ghosts float slightly above ground level with a gentle bobbing motion
4. **Wavy/Wispy Bottom**: Instead of legs, the bottom of the ghost dissolves into a wispy, ectoplasmic tail with 3-4 undulating "drips" or "waves"
5. **Same Visor**: The iconic cyan/light-blue visor remains visible
6. **Same Backpack**: The small backpack/life support bump on the back is retained
7. **No Legs**: The legs are replaced entirely by the ghostly tail
8. **Soft Glow**: A subtle ethereal glow effect around the edges

---

## Body Shape Breakdown

### Upper Body (Head + Torso)
The upper portion remains similar to the living character:
- **Bean/Capsule Shape**: Rounded top, slightly narrower than a full crewmate
- **Visor Position**: Large horizontal oval visor, positioned in upper third of body
- **Visor Color**: Light cyan/blue (#84D2F6) with white highlight reflection
- **Backpack**: Small dark-shaded ellipse on the left side (back of character)

### Lower Body (Ghost Tail)
The distinctive ghostly element:
- **No Feet/Legs**: Clean transition from body to wispy tail
- **Wavy Drips**: 3-4 separate "drip" shapes hanging from the bottom
- **Asymmetrical Waves**: Each drip has a slightly different length and animation phase
- **Transparency Gradient**: The tail fades to more transparent at the bottom tips
- **Fluid Motion**: The drips wave gently as if underwater or in zero gravity

---

## ASCII Art Representation

### Front View (Still)
```
          ╭──────────╮
         ╱            ╲
        │   ┌──────┐   │
        │   │ ▫▫▫▫ │   │      ← Visor with highlight
        │   │      │   │
        │   └──────┘   │
        │              │
        ╰─────┬┬┬┬─────╯
             ╱│││╲
            ╱ │││ ╲
           ╱  │││  ╲
          ╱   │││   ╲
             ╰┼┼╯
              ││
              ╰╯
              Wispy tail drips
```

### Side View
```
         ╭────────╮
        ╱          ╲
       │    ┌───┐   │
    ╭──│    │   │   │──╮     ← Backpack
    │  │    └───┘   │  │
    ╰──│            │──╯
       │            │
       ╰────┬┬┬┬────╯
           ╱│││╲
          ╱ │││ ╲
         ╱  │││  ╲
        ╱   │││   ╲
            ╰╯╰╯
```

### Detailed ASCII Art (Larger Scale)
```
                    ╭─────────────────────╮
                   ╱                       ╲
                  ╱                         ╲
                 ╱                           ╲
                │                             │
                │     ┌─────────────────┐     │
                │     │   ╱▔▔▔▔▔▔▔╲    │     │   ← Visor highlight
                │     │   │       │    │     │
                │     │   │  ░░░  │    │     │   ← Visor reflection
                │     │   ╲_______╱    │     │
                │     └─────────────────┘     │
        ╭───╮   │                             │
        │   │───│                             │   ← Backpack (side)
        │   │   │                             │
        ╰───╯   │                             │
                │                             │
                ╰───────────┬─┬─┬─┬───────────╯
                           ╱  │ │  ╲
                          ╱   │ │   ╲
                         ╱    │ │    ╲
                        ╱     │ │     ╲
                       ╱      │ │      ╲           ← Wispy tail tendrils
                      ╱       │ │       ╲
                     ╱        │ │        ╲
                    ╱         ╰─╯         ╲
                   ╱                       ╲
                  ╰╮                       ╭╯
                   ╰╮                     ╭╯
                    ╰─────────────────────╯
```

### Animation Frame Sequence (Wispy Tail)
```
Frame 1:          Frame 2:          Frame 3:          Frame 4:
   │ │ │             │ │ │            │ │ │             │ │ │
  ╱│ │ │╲           ╱ │ │ ╲          │ │ │ │           ╲ │ │╱
 ╱ │ │ │ ╲         │  │ │  │        ╱ │ │ │ ╲          │ │ │ │
│  │ │ │  │       ╱   │ │   ╲      │  │ │ │  │        │  │ │  │
 ╲ │ │ │ ╱       │    │ │    │      ╲ │ │ │ ╱          ╲ │ │ ╱
  ╰─┴─┴─╯         ╲   ╰─╯   ╱        ╰─┴─┴─╯            ╰─┴─╯
                   ╰───────╯
```

---

## Animation Algorithms

### 1. Hovering/Floating Animation
The ghost hovers with a gentle up-and-down bobbing motion:

```typescript
// Hovering animation parameters
const HOVER_AMPLITUDE = 0.08;     // How far up/down (in units relative to size)
const HOVER_FREQUENCY = 1.2;      // Cycles per second (slow, ethereal)
const HOVER_OFFSET = 0.15;        // Base height offset from ground

// Animation function
function calculateHoverOffset(time: number): number {
  // Smooth sinusoidal bobbing
  return HOVER_OFFSET + Math.sin(time * HOVER_FREQUENCY * Math.PI * 2) * HOVER_AMPLITUDE;
}
```

**Algorithm Explanation:**
- Uses a sine wave to create smooth up-and-down motion
- Frequency of ~1.2 Hz feels ghostly and ethereal
- Amplitude is small (8% of body size) for subtle effect
- Base offset keeps ghost slightly above "ground level"

---

### 2. Alpha Pulse Animation
The ghost's transparency gently pulses for an ethereal effect:

```typescript
// Alpha pulse parameters
const BASE_ALPHA = 0.50;          // Base transparency (50%)
const ALPHA_AMPLITUDE = 0.05;     // Pulse range (45% to 55%)
const ALPHA_FREQUENCY = 0.7;      // Slow pulse rate

// Animation function
function calculateGhostAlpha(time: number): number {
  return BASE_ALPHA + Math.sin(time * ALPHA_FREQUENCY * Math.PI * 2) * ALPHA_AMPLITUDE;
}
```

**Algorithm Explanation:**
- Gentle oscillation between 45% and 55% opacity
- Slower than the hover (0.7 Hz) for a different rhythm
- Creates a "breathing" or "pulsing" ghostly effect

---

### 3. Wispy Tail Animation
The distinctive wavy bottom with multiple undulating tendrils:

```typescript
// Tail animation parameters
const NUM_TENDRILS = 4;           // Number of wavy drips
const WAVE_AMPLITUDE = 0.12;      // How far each tendril waves
const WAVE_FREQUENCY = 1.8;       // Wave speed
const LENGTH_VARIATION = 0.25;    // How much tendril lengths differ
const PHASE_OFFSET = Math.PI / 2; // Phase difference between tendrils

interface TendrilState {
  baseX: number;      // Horizontal position at body bottom
  baseLength: number; // Base length of this tendril
  phase: number;      // Animation phase offset
}

// Initialize tendrils with slight variations
function initializeTendrils(bodyWidth: number): TendrilState[] {
  const tendrils: TendrilState[] = [];
  const spacing = bodyWidth / (NUM_TENDRILS + 1);
  
  for (let i = 0; i < NUM_TENDRILS; i++) {
    tendrils.push({
      baseX: -bodyWidth / 2 + spacing * (i + 1),
      baseLength: 1.0 + (Math.random() - 0.5) * LENGTH_VARIATION,
      phase: i * PHASE_OFFSET + Math.random() * 0.3
    });
  }
  return tendrils;
}

// Calculate tendril points for a given time
function calculateTendrilPath(
  tendril: TendrilState,
  time: number,
  tailLength: number
): {x: number, y: number}[] {
  const points: {x: number, y: number}[] = [];
  const segments = 8; // Number of points along tendril
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments; // 0 to 1 along tendril
    const y = t * tailLength * tendril.baseLength;
    
    // Wave increases in amplitude as we go down
    const waveStrength = t * t; // Quadratic increase
    const xOffset = Math.sin(time * WAVE_FREQUENCY * Math.PI * 2 + tendril.phase + t * 3) 
                    * WAVE_AMPLITUDE * waveStrength;
    
    points.push({
      x: tendril.baseX + xOffset,
      y: y
    });
  }
  return points;
}
```

**Algorithm Explanation:**
- 4 tendrils spread across the bottom of the body
- Each tendril has a different phase offset for natural variation
- Wave amplitude increases quadratically toward the tips (more sway at bottom)
- Uses sine wave with multiple frequency components for organic feel
- Length variation makes each tendril slightly different

---

### 4. Combined Animation State
The complete ghost animation state at any given time:

```typescript
interface GhostAnimationState {
  hoverOffset: number;      // Y offset from base position
  alpha: number;            // Current transparency
  tendrilPaths: {x: number, y: number}[][];  // Path points for each tendril
}

function calculateGhostState(time: number, bodyWidth: number): GhostAnimationState {
  return {
    hoverOffset: calculateHoverOffset(time),
    alpha: calculateGhostAlpha(time),
    tendrilPaths: tendrils.map(t => calculateTendrilPath(t, time, tailLength))
  };
}
```

---

### 5. Rendering Algorithm (PixiJS)

```typescript
function renderGhost(graphics: PIXI.Graphics, color: number, size: number, time: number): void {
  const state = calculateGhostState(time, size);
  
  graphics.clear();
  
  // Apply hover offset to container
  graphics.y = -state.hoverOffset * size;
  
  // Colors
  const visorColor = 0x84D2F6;
  const darkerColor = darken(color, 0.15);
  const lighterColor = lighten(color, 0.3);
  
  // === MAIN BODY (Bean/Capsule shape) ===
  graphics.beginFill(color, state.alpha);
  // Upper body ellipse
  graphics.drawEllipse(0, -size * 0.2, size * 0.6, size * 0.5);
  graphics.endFill();
  
  // === WISPY TAIL ===
  for (const path of state.tendrilPaths) {
    graphics.beginFill(color, state.alpha * 0.8);
    
    // Draw tendril as a tapered shape
    graphics.moveTo(path[0].x - size * 0.08, 0);
    
    // Left edge going down
    for (let i = 1; i < path.length; i++) {
      const width = (1 - i / path.length) * size * 0.1; // Taper
      graphics.lineTo(path[i].x - width, path[i].y);
    }
    
    // Tip
    graphics.lineTo(path[path.length - 1].x, path[path.length - 1].y + size * 0.05);
    
    // Right edge going up
    for (let i = path.length - 1; i >= 0; i--) {
      const width = (1 - i / path.length) * size * 0.1;
      graphics.lineTo(path[i].x + width, path[i].y);
    }
    
    graphics.closePath();
    graphics.endFill();
  }
  
  // === FILL GAP between body and tail ===
  graphics.beginFill(color, state.alpha);
  graphics.drawRect(-size * 0.55, -size * 0.1, size * 1.1, size * 0.35);
  graphics.endFill();
  
  // === BACKPACK ===
  graphics.beginFill(darkerColor, state.alpha);
  graphics.drawEllipse(-size * 0.5, -size * 0.1, size * 0.2, size * 0.3);
  graphics.endFill();
  
  // === VISOR ===
  graphics.beginFill(visorColor, state.alpha);
  graphics.drawEllipse(size * 0.08, -size * 0.2, size * 0.3, size * 0.18);
  graphics.endFill();
  
  // === VISOR HIGHLIGHT ===
  graphics.beginFill(0xFFFFFF, state.alpha * 0.6);
  graphics.drawEllipse(size * 0.15, -size * 0.28, size * 0.08, size * 0.05);
  graphics.endFill();
  
  // === ETHEREAL GLOW (outer edge) ===
  graphics.lineStyle(2, lighterColor, state.alpha * 0.3);
  graphics.drawEllipse(0, -size * 0.2, size * 0.65, size * 0.55);
  graphics.lineStyle(0);
}
```

---

## Transparency Gradient for Tail

The ghostly tail should fade out toward the tips:

```typescript
// Create gradient alpha for tail tendrils
function getTendrilAlpha(baseAlpha: number, position: number): number {
  // position: 0 = at body, 1 = at tip
  // Alpha fades from 100% to 30% of base
  return baseAlpha * (1.0 - position * 0.7);
}
```

---

## Color Reference

| Element | Color | Hex | Notes |
|---------|-------|-----|-------|
| Body | Player Color | varies | Semi-transparent |
| Visor | Light Cyan | #84D2F6 | Slightly lighter than living |
| Visor Highlight | White | #FFFFFF | 50-60% opacity |
| Backpack | Darkened Body | - | 15% darker than body |
| Glow | Lightened Body | - | 30% lighter, very low opacity |
| Tail Tips | Body Color | - | Fading to ~30% opacity |

---

## Animation Timing Summary

| Animation | Frequency | Amplitude | Notes |
|-----------|-----------|-----------|-------|
| Hover Bob | 1.2 Hz | 8% of size | Smooth sine wave |
| Alpha Pulse | 0.7 Hz | ±5% | 45-55% range |
| Tail Wave | 1.8 Hz | 12% of width | Increases toward tips |
| Phase Offset | - | π/2 per tendril | Creates wave effect |

---

## Visual Comparison: Living vs Ghost

```
LIVING CREWMATE:              GHOST:
                              
    ╭──────╮                      ╭──────╮
   ╱        ╲                    ╱   ░    ╲    ← Semi-transparent
  │  ┌────┐  │                  │  ┌────┐  │
  │  │    │  │                  │  │ ▫  │  │    ← Same visor
  │  └────┘  │                  │  └────┘  │
  │          │                  │    ░     │
  ╰──────────╯                  ╰────┬┬┬───╯
    │      │                        ╱│ │╲
    │      │     ← Feet            ╱ │ │ ╲     ← Wavy tail
    ╰──────╯                       ╲ │ │ ╱
                                    ╰─┴─╯

  Standing on ground            Floating above ground
  100% opacity                  ~50% opacity with pulse
  Static when idle              Always gently moving
```

---

## Implementation Notes

1. **Ghost Only Visible to Other Ghosts**: In the actual game, living players cannot see ghosts
2. **Pass Through Walls**: Ghosts have no collision with walls
3. **Unlimited Vision**: Ghosts can see the entire map
4. **Can Complete Tasks**: Ghost crewmates can still contribute to task completion
5. **Cannot Interact**: Ghosts cannot report bodies, vote, or sabotage (except impostor sabotage)

---

## Files to Modify

- `src/rendering/PlayerRenderer.ts` - The `drawGhost()` method
- `src/rendering/AIAgentVisualRenderer.ts` - The `drawGhostSprite()` method

Both need to implement:
1. Proper wispy tail with animated tendrils
2. Hover animation
3. Alpha pulse
4. Gradient transparency on tail
5. Ethereal glow effect

# UI/Rendering Implementation Plan - 20 Point Detailed Breakdown

## Visual Rendering Priority Focus

### Phase 1: Canvas & Map Foundation (Points 1-4)

#### 1. Create Canvas Rendering Foundation ⚡
**Technical Requirements:**
- Initialize Pixi.js v8 Application
- Create viewport with proper aspect ratio (16:9 or 4:3)
- Set up rendering layers:
  - Layer 0: Background (space/floor)
  - Layer 1: Map elements (rooms, walls)
  - Layer 2: Shadows and vision occlusion
  - Layer 3: Game objects (tasks, vents, bodies)
  - Layer 4: Players and effects
  - Layer 5: Vision overlay (fog of war)
  - Layer 6: UI elements
- Camera system with transform matrix
- 60 FPS target with deltaTime updates

**Implementation Details:**
```typescript
- Canvas size: 1920x1080 base resolution
- Zoom levels: 0.5x to 3.0x
- Grid system for coordinate mapping (1 game unit = 20 pixels)
- Anti-aliasing enabled
- WebGL renderer with fallback to Canvas2D
```

#### 2. Implement Map Rendering System ⚡
**Technical Requirements:**
- Render all 14 rooms from skeld-map.ts data
- Room floor colors:
  - Cafeteria: Light gray (#B0B0B0)
  - Weapons: Dark blue (#2B4C7E)
  - Shields: Yellow tint (#D4C04A)
  - Navigation: Blue (#3A5F7D)
  - O2: Light blue (#6B9BD1)
  - Admin: Tan (#A89968)
  - Storage: Orange-brown (#C17A3A)
  - Electrical: Yellow (#E0C341)
  - Security: Gray (#7D7D7D)
  - Reactor: Green-blue (#5A9B8E)
  - MedBay: Cyan (#4DBDBD)
  - Upper/Lower Engine: Orange (#D17A3D)
  - Communications: Light blue (#7BA3D0)

**Wall Rendering:**
- Wall thickness: 0.5 units (10 pixels)
- Wall color: Dark gray (#3D3D3D)
- Wall caps: Rounded corners (radius 0.2 units)
- Inner shadows for depth

**Floor Details:**
- Subtle grid pattern overlay (5% opacity)
- Slight gradient from center to edges
- Room name labels (centered, white text, 18px bold)

#### 3. Add Hallway and Corridor System ⚡
**Critical Hallways to Implement:**

**Upper Corridor:**
- Connects: Cafeteria → Admin → Navigation → O2
- Width: 3 units
- Length: ~30 units horizontal
- Y-position: 10-13

**Lower Corridor:**
- Connects: Cafeteria → Storage → Electrical
- Width: 2.5 units
- Multiple segments with turns

**West Corridor:**
- Connects: Upper Engine → Reactor → Lower Engine
- Includes decontamination zones
- Special rendering for decon (green tint, animated particles)

**Decontamination Zones:**
- Visual: Green transparent overlay
- Width: 2 units
- Length: 3 units
- Animated vertical scan lines
- Duration indicator (3-second timer when occupied)

**Corridor Features:**
- Slightly darker than rooms
- Connecting walls at junctions
- Smooth transitions (no gaps)
- Proper collision geometry

#### 4. Render Doors and Entryways ⚡
**Door Types:**

**Normal Doors:**
- Visual: Sliding door frame
- Open state: Door retracted into wall
- Closed state: Door fills doorway
- Color: Metallic gray (#6B6B6B)
- Width: 1.5 units

**Sabotaged Doors:**
- Red pulsing outline (2px)
- "LOCKED" text overlay
- Countdown timer (10 seconds)
- Different animation (emergency close)

**Door Animations:**
- Opening: 0.3 second slide
- Closing: 0.3 second slide
- Sabotage close: 0.1 second slam
- Easing: cubic-bezier

**Vision Blocking:**
- Closed doors completely block vision rays
- Use raycast intersection with door geometry
- Update vision when doors change state

---

### Phase 2: Player & Vision System (Points 5-8)

#### 5. Implement Player Sprite Rendering ⚡
**Player Sprite Design:**
- Top-down astronaut silhouette
- Circular base (0.8 unit diameter = 16 pixels)
- Player colors:
  - Red (#C51111)
  - Blue (#132ED1)
  - Green (#117F2D)
  - Pink (#ED54BA)
  - Orange (#EF7D0E)
  - Yellow (#F5F557)
  - Black (#3F474E)
  - White (#D6E0F0)

**Sprite Features:**
- Visor highlight (lighter shade)
- Backpack outline
- Direction indicator (subtle visor orientation)
- Shadow beneath player (soft ellipse, 50% opacity)

**Player States:**
- Idle: Subtle bob animation (0.1 units, 2 seconds)
- Walking: Smooth movement interpolation
- Doing Task: Slight lean toward task
- Dead: Laying down with bone (cut in half sprite)
- Ghost: 50% opacity, floating animation

**Name Labels:**
- Position: Above player (1.5 units above center)
- Font: 14px bold sans-serif
- Color: Player color with white outline
- Background: Semi-transparent black pill shape
- Always on top (highest z-index)

#### 6. Build Vision Cone System ⚡
**Vision Mathematics:**
```
Vision Radius Formula:
- Base: settings.crewmateVision units (default 5 units = 100 pixels)
- Impostor: settings.impostorVision units (default 7 units)
- During Lights Sabotage: base × 0.25

Gradient Rendering:
- 0-70% radius: Full visibility (alpha = 1.0)
- 70-90% radius: Linear fade (alpha = 1.0 to 0.5)
- 90-100% radius: Faster fade (alpha = 0.5 to 0.0)
- Beyond radius: Complete darkness (alpha = 0.0)
```

**Implementation Approach:**
- Use radial gradient shader
- Center at player position
- Update every frame
- Blend mode: Multiply for fog of war
- Multiple players: Union of all vision cones

**Visual Effects:**
- Smooth circular gradient
- No hard edges
- Proper alpha blending with map
- Performance: Use texture cache for gradient

#### 7. Implement Wall Occlusion for Vision ⚡
**Raycasting Algorithm:**

**Ray Emission:**
- Cast rays every 2° (180 rays per circle)
- Start from player center
- Max distance = vision radius
- Store intersection points

**Wall Intersection:**
- Check each ray against all wall segments
- Use line-line intersection formula
- Find closest intersection
- Terminate ray at wall hit

**Corner Handling:**
- Special case: Ray hits exact corner
- Cast additional rays ±0.5° from corner
- Prevent light bleeding around corners
- Handle convex vs concave corners differently

**Door Integration:**
- Closed doors treated as walls
- Open doors ignored in raycasting
- Update ray cache when doors change
- Dynamic occlusion updates

**Optimization:**
- Spatial partitioning (quadtree)
- Only check nearby walls
- Cache ray results for 1 frame
- Parallel ray processing (Web Workers if needed)

#### 8. Add Vision Shadow Casting ⚡
**Shadow Polygon Algorithm:**

**For each wall segment:**
1. Calculate if wall is facing player (dot product test)
2. If facing away, skip
3. Find wall endpoints relative to player
4. Project endpoints to vision radius
5. Create shadow quad (4 vertices)
6. Fill shadow with black (alpha based on distance)

**Shadow Rendering:**
- Use Graphics API to draw polygons
- Fill color: Black with gradient alpha
- Blend mode: Multiply
- Layer: Between map and vision overlay

**Corner Shadows:**
- Detect corner vertices
- Create radial shadow fan from corner
- Blend multiple shadows smoothly
- Handle overlapping shadows

**Performance:**
- Pre-calculate shadow geometry
- Update only when player/doors move
- Use instanced rendering for multiple shadows
- Maximum 50 shadow polygons per frame

---

### Phase 3: Game Objects & Effects (Points 9-13)

#### 9. Render Task Indicators and Locations ⚡
**Task Visual Design:**

**Task Icons:**
- Size: 0.5 units (10 pixels)
- Yellow exclamation mark for available tasks
- Gray checkmark for completed tasks
- Pulsing animation (scale 0.9 to 1.1, 1.5 seconds)

**Task States:**
```
Available: Yellow icon, visible to assigned player
In Progress: Blue circular progress bar around icon
Completed: Green checkmark, fade out after 1 second
Visual Task: Special star icon (visible to all)
```

**Interaction Range Indicator:**
- Yellow circle around task when in range (1.5 units)
- Radius: 1.5 units
- Color: Yellow with 30% opacity
- Animated: Pulse effect

**Multi-Stage Tasks:**
- Arrow pointing to next stage location
- Dotted line path between stages
- Stage counter (e.g., "2/4")

#### 10. Create Vent Visualization ⚡
**Vent Graphics:**

**Base Vent:**
- Size: 0.8 units square
- Dark metallic grate texture
- Horizontal slats (5-7 lines)
- Subtle shadow beneath
- Position: From skeld-map.ts vent positions

**Vent States:**
- Closed: Normal grate appearance
- Open: Grate slides open (0.3s animation)
- Occupied: Red glow from inside
- Connected: Faint connection lines when hovering

**Impostor-Only Features:**
- Green highlight when in range (impostors only)
- Network visualization:
  - Dotted lines to connected vents
  - Arrow indicators for travel direction
  - Vent ID labels

**Vent Usage Animation:**
- Entry: Player shrinks and disappears into vent
- Exit: Player grows out of vent
- Duration: 0.3 seconds each
- Particle effect: Small dust puffs

#### 11. Implement Body Rendering ⚡
**Dead Body Design:**

**Body Sprite:**
- Player color with bone visible (cut in half)
- Top half separated from bottom half
- Bone protruding from middle
- Size: 1 unit tall (horizontal)
- Pool of colored liquid (player color, 50% opacity)

**Body States:**
- Fresh: Bright colors, larger pool
- Aging: Gradual color fade over time
- Old: 50% opacity after 60 seconds
- Reported: Fade out over 0.5 seconds

**Report Button:**
- Appears when player within 2.5 units
- Red circular button with "REPORT" text
- Pulsing animation
- Hover effect: Scale 1.1x
- Click hitbox: 1 unit radius

**Visibility:**
- Bodies visible through fog of war (slight glow)
- Always render on top of floor
- Shadow beneath body
- Body doesn't block movement

#### 12. Add Sabotage Visual Effects ⚡
**Reactor Meltdown:**
- Red flashing lights in Reactor room
- Warning symbols on walls
- Screen shake (intensity increases with time)
- Countdown timer: Large red numbers
- Sound: Klaxon alarm visualization (animated wave rings)

**O2 Depletion:**
- Blue warning overlay
- Decreasing O2 percentage display (90% → 0%)
- Flashing O2 room and Admin room
- Countdown: Red timer
- Gasping animation on player sprites

**Lights Sabotage:**
- Darken entire map (reduce brightness 75%)
- Crewmate vision shrinks to 25%
- Impostor vision unchanged
- Yellow flashing on Electrical room
- Reduced color saturation globally

**Communications Sabotage:**
- Static effect on UI elements
- Crossed-out icons for:
  - Task list
  - Admin table
  - Security cameras
- Gray overlay on affected systems
- Animated scan lines

**Door Sabotage:**
- Red pulsing outline on closed doors
- "LOCKED" text overlay
- 10-second countdown per door
- Metallic slam sound visualization

#### 13. Build Camera System Overlay ⚡
**Camera Locations (4 total):**

**Camera Sprites:**
- Small security camera icon
- Mounted on walls/ceilings
- Red blinking LED when active
- Coverage cone visualization (30° angle)

**Camera Views:**
- Coverage area: Colored transparent overlay
- Navigation Camera: Covers Nav/Shields hallway
- Admin Camera: Covers Admin/Cafeteria area
- Security Camera: Covers Security entrance
- MedBay Camera: Covers MedBay hallway

**Camera Usage Indicator:**
- LED blinks red when viewed (from Security)
- Faster blink = currently being viewed
- Coverage cone shows in real-time

**Security Room View:**
- Split-screen showing all 4 camera feeds
- Grainy black/white effect
- Timestamp overlay
- Player silhouettes visible in feeds

---

### Phase 4: UI Components (Points 14-16)

#### 14. Create Task Progress Bar UI ⚡
**Position:** Top of screen, horizontal
**Dimensions:** 80% screen width, 30 pixels tall

**Visual Design:**
- Background: Dark gray bar (#2D2D2D)
- Fill: Bright green (#00FF00)
- Border: 2px white outline
- Segments: Vertical dividers for each task
- Percentage text: Right side, white, bold

**Behavior:**
- Fills left to right
- Smooth animation (0.5s ease-out)
- Particle burst when task completes
- Glow effect on fill edge

**States:**
- 0-50%: Green
- 50-75%: Yellow-green
- 75-99%: Yellow
- 100%: Gold with celebration animation

#### 15. Implement Player List Panel ⚡
**Position:** Right side of screen
**Dimensions:** 200px wide, auto height

**Player Entry Design:**
```
[Color Circle] PlayerName [Status Icon]
├─ Alive: No icon
├─ Dead: Small skull icon (gray)
├─ Ghost: Transparent player icon
└─ Impostor: Red outline (debug mode only)
```

**Features:**
- Click player to focus camera
- Hover to highlight player on map
- Sort: Alive first, then dead
- Update in real-time
- Fade out animation when player dies

**Visual Polish:**
- Semi-transparent black background
- White text with player color accent
- Smooth scrolling if >8 players
- Role indicator (debug mode)

#### 16. Build Minimap Component ⚡
**Position:** Bottom-right corner
**Dimensions:** 250x175 pixels

**Map Display:**
- Simplified room outlines (no details)
- Player dots (colored circles, 5px)
- Dead body markers (gray X)
- Current view rectangle (white outline)

**Features:**
- Click to pan camera to location
- Zoom indicator (current zoom level)
- Room names on hover
- Updates 10 times per second

**Visual Style:**
- Dark background (#1A1A1A)
- White room outlines (1px)
- Semi-transparent overlay (80% opacity)
- Border: 2px white

---

### Phase 5: Polish & Controls (Points 17-20)

#### 17. Add Debug Vision Overlay ⚡
**Toggle Key:** "V" key

**Features:**
- Show all agent vision cones simultaneously
- Each agent: Different colored outline
- Vision rays: Thin colored lines
- Wall hits: Small dots at intersections
- Vision radius: Dashed circle

**AI Reasoning Display:**
- Text bubble above each player
- Current goal/action
- Suspicion levels (heat map)
- Pathfinding route (dotted line)
- Decision reasoning (small font)

**Performance:**
- Only render when debug mode active
- Update every 5 frames (12 FPS)
- Toggle individual overlays

#### 18. Create Animation System ⚡
**Animation Library:** Pixi.js Tweening or custom

**Key Animations:**

**Movement:**
- Position interpolation (lerp)
- Smooth easing (ease-in-out)
- 60 FPS updates

**Task Completion:**
- Task icon → checkmark (morph)
- Green particle burst
- Task bar fill animation
- Sound wave visualization

**Kill Animation:**
- Attacker lunges forward
- Victim recoils
- Blood splatter particles (player color)
- Body falls (rotation + position)
- Duration: 0.5 seconds

**Vent Entry/Exit:**
- Player shrinks into vent (0.3s)
- Vent grate opens/closes
- Small smoke puff
- Scale tween (1.0 → 0.0 → 1.0)

**Sabotage Effects:**
- Light flicker (random intervals)
- Screen shake (sine wave)
- Warning flash (opacity pulse)
- Countdown number update (scale bounce)

#### 19. Implement Camera Controls ⚡
**Control Scheme:**

**Mouse:**
- Drag: Pan camera (left mouse button)
- Scroll: Zoom in/out (0.5x to 3.0x)
- Click Player: Focus on player
- Double-click: Reset camera

**Keyboard:**
- Arrow keys: Pan camera
- +/- keys: Zoom
- Space: Reset camera
- 1-8 keys: Focus on player 1-8

**Camera Behavior:**
- Smooth follow: Lerp to target (0.1 factor)
- Zoom easing: 0.3 seconds
- Bounds: Can't pan outside map
- Auto-follow mode: Toggle with "F" key

**Camera States:**
- Free: Manual control
- Following: Tracks selected player
- Overview: Shows entire map
- Meeting: Centers on cafeteria

#### 20. Build UI Control Panel ⚡
**Position:** Bottom-left corner
**Dimensions:** 300px wide, 150px tall

**Controls:**

**Playback:**
- ⏸ Play/Pause button
- Speed: 1x, 2x, 5x, 10x dropdown
- ⏮ Restart game button

**Debug Toggles:**
- ☑ Show Vision Cones
- ☑ Show Pathfinding
- ☑ Show Suspicion Levels
- ☑ Show AI Reasoning
- ☑ Show Impostor (reveal role)

**Game Settings:**
- 🔊 Volume slider
- 🎨 Theme selector (dark/light)
- ⚙️ Settings modal button

**Visual Design:**
- Dark panel background (#2D2D2D)
- Modern flat buttons
- Toggle switches (green when on)
- Tooltips on hover
- Smooth transitions

---

## Rendering Performance Targets

- **Frame Rate**: Consistent 60 FPS
- **Draw Calls**: <100 per frame
- **Texture Memory**: <500 MB
- **Update Loop**: <16ms per frame
- **Vision Calculations**: <5ms per frame
- **Particle Systems**: <1000 particles max

## Implementation Order Priority

1. **Canvas Foundation** → Map → Hallways → Doors (Core structure)
2. **Players** → Vision → Occlusion (Interactive elements)
3. **Tasks** → Vents → Bodies (Game objects)
4. **Sabotage** → Cameras (Effects)
5. **UI Panels** → Debug → Controls (Interface)

## Color Palette Reference

### Room Colors
```
Cafeteria:      #B0B0B0 (Light gray)
Weapons:        #2B4C7E (Dark blue)
Shields:        #D4C04A (Yellow tint)
Navigation:     #3A5F7D (Blue)
O2:             #6B9BD1 (Light blue)
Admin:          #A89968 (Tan)
Storage:        #C17A3A (Orange-brown)
Electrical:     #E0C341 (Yellow)
Security:       #7D7D7D (Gray)
Reactor:        #5A9B8E (Green-blue)
MedBay:         #4DBDBD (Cyan)
Engines:        #D17A3D (Orange)
Communications: #7BA3D0 (Light blue)
```

### Player Colors
```
Red:    #C51111
Blue:   #132ED1
Green:  #117F2D
Pink:   #ED54BA
Orange: #EF7D0E
Yellow: #F5F557
Black:  #3F474E
White:  #D6E0F0
```

### UI Colors
```
Background:     #1A1A1A (Very dark gray)
Panel:          #2D2D2D (Dark gray)
Border:         #FFFFFF (White)
Walls:          #3D3D3D (Dark gray)
Task Available: #FFFF00 (Yellow)
Task Complete:  #00FF00 (Green)
Alert:          #FF0000 (Red)
Warning:        #FFA500 (Orange)
```

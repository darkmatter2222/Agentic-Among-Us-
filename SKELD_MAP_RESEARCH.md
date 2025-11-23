# The Skeld Map - Complete Research & Specifications

## Research Summary
Based on comprehensive analysis of Among Us gameplay, official maps, and community documentation, this document provides exact specifications for The Skeld spaceship map for perfect replication.

---

## Map Overview

### Dimensions
- **Total Size**: ~60 units wide × ~40 units tall (in game coordinates)
- **Rendering Scale**: 1 game unit = 20 pixels
- **Canvas Size**: 1200px × 800px rendered area
- **Layout Type**: Central hub (Cafeteria) with wings extending in 4 directions

### Visual Style
- **Background**: Deep space black (#000814)
- **Hallways**: Dark gray (#2A2E3A) - darker than rooms
- **Walls**: Very dark gray (#1A1D24) with 0.5 unit thickness
- **Room Floors**: Varied colors by function (see Room Details)

---

## Room Layout - Exact Specifications

### 1. **Cafeteria** (Central Hub - Spawn Point)
- **Position**: (18, 14)
- **Size**: 12 units × 9 units
- **Color**: Light gray (#B0B0B0)
- **Type**: High-traffic, safest area
- **Features**:
  - Emergency Meeting Button (center, red)
  - 4 tables arranged around center
  - 5 exits (most connected room)
- **Tasks**:
  - Empty Garbage (northwest corner)
  - Download Data (table near Admin door)
  - Fix Wiring (east wall)
- **Vents**: 1 vent (south wall) → connects to Admin
- **Doors**: None (always open for emergency access)

---

### LEFT WING (West Side)

### 2. **Upper Engine**
- **Position**: (2, 2)
- **Size**: 8 units × 8 units
- **Color**: Burnt orange (#D17A3D)
- **Type**: Dead-end, high danger
- **Features**:
  - Large engine unit (center-north)
  - Fuel deposit station
- **Tasks**:
  - Align Engine Output (engine console)
  - Accept Diverted Power (electrical panel)
  - Fuel Engines (deposit, from Storage)
- **Vents**: 1 vent → connects to Lower Engine & Reactor
- **Doors**: 1 door (entrance from corridor)
- **Decontamination**: Yes (to Reactor, 3-second walk)

### 3. **Reactor**
- **Position**: (2, 12)
- **Size**: 8 units × 10 units
- **Color**: Teal green (#5A9B8E)
- **Type**: Dead-end, critical sabotage point
- **Features**:
  - 2 hand scanners (opposite walls)
  - Central reactor core (blue glow)
- **Tasks**:
  - Start Reactor (Simon Says pattern)
  - Unlock Manifolds (number sequence)
- **Vents**: 1 vent (center) → connects to both Engines
- **Doors**: 2 doors (north/south decontamination areas)
- **Decontamination**: Yes (to both engines, 3-second each)
- **Sabotage**: **CRITICAL** - Reactor Meltdown

### 4. **Lower Engine**
- **Position**: (2, 24)
- **Size**: 8 units × 8 units
- **Color**: Burnt orange (#D17A3D)
- **Type**: Dead-end, high danger
- **Features**:
  - Large engine unit (center-south)
  - Fuel deposit station
- **Tasks**:
  - Align Engine Output (engine console)
  - Accept Diverted Power (electrical panel)
  - Fuel Engines (deposit, from Storage)
- **Vents**: 1 vent → connects to Upper Engine & Reactor
- **Doors**: 1 door (entrance from corridor)
- **Decontamination**: Yes (to Reactor, 3-second walk)

### 5. **Security**
- **Position**: (11, 10)
- **Size**: 6 units × 6 units
- **Color**: Dark gray (#7D7D7D)
- **Type**: Dead-end, surveillance room
- **Features**:
  - Camera monitoring station (4 screens showing all cameras)
  - Desk with monitors
- **Tasks**:
  - Accept Diverted Power (electrical panel)
  - Fix Wiring (wall panel)
- **Vents**: 1 vent → connects to Electrical & MedBay
- **Doors**: 1 door (entrance from corridor)

### 6. **MedBay**
- **Position**: (15, 7)
- **Size**: 8 units × 6 units
- **Color**: Cyan (#4DBDBD)
- **Type**: Dead-end, medical area
- **Features**:
  - Medical scanner (vertical cylinder)
  - Medical beds/supplies
- **Tasks**:
  - **Submit Scan** (VISUAL TASK - player stands still)
  - Inspect Sample (wait 60s, select anomaly)
- **Vents**: 1 vent → connects to Electrical & Security
- **Doors**: 1 door (entrance from corridor)

### 7. **Electrical**
- **Position**: (13, 17)
- **Size**: 7 units × 6 units
- **Color**: Yellow (#E0C341)
- **Type**: Most dangerous room (single entrance, poor visibility)
- **Features**:
  - Central electrical panel
  - Wiring boxes on walls
  - Power distribution system
- **Tasks**:
  - Fix Wiring (3 panels around map, including here)
  - Calibrate Distributor (rotating nodes)
  - **Divert Power** (to all rooms)
- **Vents**: 1 vent → connects to MedBay & Security
- **Doors**: 1 door (entrance from corridor)
- **Sabotage**: **Lights** control (toggle 5 switches)

---

### BOTTOM SECTION (South)

### 8. **Storage**
- **Position**: (11, 23)
- **Size**: 11 units × 7 units
- **Color**: Tan brown (#C17A3A)
- **Type**: Large open area, moderately safe
- **Features**:
  - Fuel cans (for engine tasks)
  - Storage crates/boxes
  - Large open floor space
- **Tasks**:
  - Fix Wiring (wall panel)
  - **Fuel Engines** (pickup gas cans)
  - Empty Garbage (garbage chute)
- **Vents**: None
- **Doors**: 2 doors (west entrance, east entrance)

### 9. **Admin**
- **Position**: (24, 15)
- **Size**: 7 units × 7 units
- **Color**: Tan/gold (#A89968)
- **Type**: Strategic location, crossroads
- **Features**:
  - Admin table (shows player location dots)
  - Card swipe station
  - Map terminal
- **Tasks**:
  - **Swipe Card** (must swipe at correct speed)
  - Fix Wiring (wall panel)
  - Upload Data (terminal)
- **Vents**: 1 vent → connects to Cafeteria
- **Doors**: 2 doors (multiple entrances)

### 10. **Communications**
- **Position**: (21, 27)
- **Size**: 7 units × 5 units
- **Color**: Blue gray (#7BA3D0)
- **Type**: Dead-end, sabotage point
- **Features**:
  - Communications array
  - Radio equipment
  - Frequency dial
- **Tasks**:
  - Download Data (terminal)
  - Accept Diverted Power (electrical panel)
- **Vents**: None
- **Doors**: 1 door (entrance from corridor)
- **Sabotage**: **Communications** (rotate dial to match frequency)

---

### RIGHT WING (East Side)

### 11. **Weapons**
- **Position**: (26, 2)
- **Size**: 9 units × 6 units
- **Color**: Dark blue (#2B4C7E)
- **Type**: Dead-end, high danger
- **Features**:
  - Asteroid targeting system
  - Weapons console
  - Large window showing space
- **Tasks**:
  - **Clear Asteroids** (VISUAL TASK - shoot 20 asteroids)
  - Download Data (terminal)
- **Vents**: 1 vent → connects to Navigation & Shields
- **Doors**: 1 door (entrance from corridor)

### 12. **Navigation**
- **Position**: (30, 10)
- **Size**: 8 units × 8 units
- **Color**: Medium blue (#3A5F7D)
- **Type**: Corner location, medium risk
- **Features**:
  - Navigation console
  - Star charts
  - Course plotting station
- **Tasks**:
  - Chart Course (drag ship through waypoints)
  - Stabilize Steering (click when centered)
  - Download Data (terminal)
- **Vents**: 1 vent → connects to Weapons & Shields
- **Doors**: 2 doors (west entrance, O2 connection)

### 13. **O2 (Life Support)**
- **Position**: (34, 20)
- **Size**: 7 units × 6 units
- **Color**: Light blue (#6B9BD1)
- **Type**: Dead-end, critical sabotage point
- **Features**:
  - O2 monitoring station
  - Code input panels (2)
  - Air filtration visible
- **Tasks**:
  - Clean O2 Filter (drag leaves)
  - Empty Garbage (second stage after Cafeteria)
- **Vents**: None
- **Doors**: 1 door (entrance from Navigation)
- **Sabotage**: **CRITICAL** - O2 Depletion (requires 2 code entries)

### 14. **Shields**
- **Position**: (32, 26)
- **Size**: 7 units × 6 units
- **Color**: Yellow (#D4C04A)
- **Type**: Dead-end, high danger
- **Features**:
  - Shield generators (hexagonal)
  - Shield control panel
- **Tasks**:
  - **Prime Shields** (VISUAL TASK - hexagons light up)
  - Accept Diverted Power (electrical panel)
- **Vents**: 1 vent → connects to Navigation & Weapons
- **Doors**: 1 door (entrance from corridor)

---

## Hallway Network

### Main Corridors
All hallways are **1.5-2 units wide** and **darker than rooms** (#2A2E3A)

1. **Upper Horizontal Corridor**
   - Connects: Cafeteria → Weapons → Navigation
   - Length: ~18 units
   - Width: 2 units

2. **Upper Left Vertical Corridor**
   - Connects: Cafeteria → MedBay → Security → Electrical
   - Length: ~12 units
   - Width: 1.5 units

3. **Left Vertical Spine**
   - Connects: Upper Engine → Reactor → Lower Engine
   - Length: ~30 units
   - Width: 2 units (includes decontamination zones)

4. **Lower Horizontal Corridor**
   - Connects: Storage → Admin → Communications → Shields
   - Length: ~24 units
   - Width: 2 units

5. **Right Vertical Corridor**
   - Connects: Navigation → O2 → Shields
   - Length: ~16 units
   - Width: 1.5 units

6. **Cafeteria Central Hub Connections**
   - North: To Weapons corridor
   - South: To Storage/Admin
   - West: To MedBay/Upper Engine
   - East: To Admin

### Decontamination Zones
**Visual**: Green tinted (#00FF00 10% alpha) with horizontal scan lines

1. **Upper Engine ↔ Reactor**
   - Length: 2 units
   - Force walk: 3 seconds
   - Green overlay with 3 scan lines

2. **Reactor ↔ Lower Engine**
   - Length: 2 units
   - Force walk: 3 seconds
   - Green overlay with 3 scan lines

---

## Vent Networks (4 Separate Systems)

Impostors can travel instantly between connected vents. Entry/exit = 0.3s animation.

### Network 1: LEFT ENGINE SYSTEM
```
Upper Engine ↔ Reactor ↔ Lower Engine
```
- 3 vents
- Covers entire left wing
- Strategic for quick engine/reactor movement

### Network 2: MEDICAL WING
```
MedBay ↔ Security ↔ Electrical
```
- 3 vents
- Covers left-center rooms
- Connects surveillance to power

### Network 3: CAFETERIA HUB
```
Cafeteria ↔ Admin
```
- 2 vents only
- Central positioning
- Quick escape from high-traffic area

### Network 4: RIGHT WEAPONS SYSTEM
```
Weapons ↔ Navigation ↔ Shields
```
- 3 vents
- Covers right wing
- East side coverage

**No vent connections between networks!**

---

## Door Locations

### Rooms with Doors
- **Cafeteria**: NO DOORS (emergency access)
- **Upper Engine**: 1 door
- **Lower Engine**: 1 door
- **Reactor**: 2 doors (decon areas)
- **Security**: 1 door
- **MedBay**: 1 door
- **Electrical**: 1 door
- **Storage**: 2 doors
- **Admin**: 2 doors
- **Communications**: 1 door
- **Weapons**: 1 door
- **Navigation**: 2 doors
- **O2**: 1 door
- **Shields**: 1 door

**Total**: 18 doors

### Door Sabotage Mechanics
- Duration: 10 seconds per door
- Cooldown: 10-30 seconds (ship-wide, not per door)
- Multiple doors can be closed simultaneously
- Doors auto-open after timer OR when crisis sabotage is fixed

---

## Camera Locations (4 Total)

Fixed security cameras with ~60° field of view

1. **Navigation Corridor Camera**
   - Position: Hallway near Navigation/Weapons
   - Coverage: Weapons entrance, Nav hallway

2. **Admin Corridor Camera**
   - Position: Hallway between Cafeteria and Admin
   - Coverage: Admin entrance, Cafeteria exits

3. **Security Entrance Camera**
   - Position: Outside Security room
   - Coverage: Security hallway, approach

4. **MedBay Entrance Camera**
   - Position: Outside MedBay room
   - Coverage: MedBay hallway, approach

All viewable from Security room monitors.

---

## Task Distribution

### Common Tasks (0-2, everyone gets same)
- Fix Wiring (3 locations: Cafeteria, Storage, Admin, Security, Electrical, Navigation)
- Swipe Card (Admin)

### Long Tasks (0-3 per player)
- Start Reactor (Reactor) - 10s Simon Says
- Submit Scan (MedBay) - 10s stand still - **VISUAL**
- Inspect Sample (MedBay) - 60s wait + selection
- Fuel Engines (Storage→Engines) - 20s total, multiple trips
- Empty Garbage (Cafeteria→O2) - 9s total, 2 stages

### Short Tasks (0-5 per player)
- Chart Course (Navigation) - 3s
- Stabilize Steering (Navigation) - 2s
- Prime Shields (Shields) - 3s - **VISUAL**
- Clean O2 Filter (O2) - 4s
- Divert Power + Accept Power (Electrical→Various) - 3s total
- Clear Asteroids (Weapons) - 20s - **VISUAL**
- Unlock Manifolds (Reactor) - 4s
- Align Engine Output (Upper/Lower Engine) - 3s each
- Upload/Download Data (Various) - 9s

### Visual Tasks (Visible to All)
1. **Submit Scan** (MedBay) - Green scanner beam
2. **Clear Asteroids** (Weapons) - Gun firing visible
3. **Prime Shields** (Shields) - Hexagons light up

**Total Tasks on Map**: 30+ task locations

---

## Sabotage Points

### Critical Sabotages (Cause Loss if Not Fixed)
1. **Reactor Meltdown**
   - Location: Reactor
   - Timer: 30-45 seconds
   - Fix: 2 players hold hand scanners simultaneously

2. **O2 Depletion**
   - Locations: O2 and Admin (code entry)
   - Timer: 30-45 seconds
   - Fix: Enter 5-digit code at both locations

### Utility Sabotages
3. **Lights Out**
   - Location: Electrical
   - Effect: Crewmate vision → 0.25x (from 3.0 to 0.75 units)
   - Fix: Toggle 5 switches to match pattern

4. **Communications**
   - Location: Communications
   - Effect: Hides task list, arrows, admin table, cameras
   - Fix: Rotate dial to match frequency wave

5. **Doors**
   - Location: Any door (18 total)
   - Effect: Blocks passage for 10 seconds
   - Fix: Auto-opens after timer

---

## Strategic Analysis

### Most Dangerous Rooms (Dead Ends)
1. **Electrical** - Single entrance, poor visibility
2. **Weapons** - Far from main areas
3. **Shields** - Corner location
4. **O2** - Isolated position
5. **Communications** - Dead end
6. **Upper/Lower Engine** - Isolated
7. **MedBay** - Dead end
8. **Security** - Dead end

### Safest Areas
1. **Cafeteria** - 5 exits, high traffic, spawn point
2. **Storage** - 2 exits, large open space
3. **Admin** - Central crossroads, 2 exits

### Choke Points (Kill Opportunities)
- Electrical corridor (single entrance)
- O2 entrance (narrow passage)
- Decontamination zones (forced 3-second walk)
- Storage-to-Electrical hallway

### High-Traffic Routes
- Cafeteria ↔ Admin (task completion)
- Cafeteria ↔ Storage (fuel tasks)
- Electrical ↔ Security (vision cone check)

---

## Visual Details for Perfect Replication

### Wall Rendering
- **Thickness**: 0.5 units (10 pixels at 20px/unit)
- **Color**: #1A1D24 (very dark gray, almost black)
- **Style**: Solid lines with slight inner shadow for depth
- **Corners**: Properly mitered, not overlapping

### Room Floor Patterns
- **Grid Pattern**: Subtle 1-unit grid overlay (5% opacity black lines)
- **Floor Color**: Per room (see individual room specs)
- **Brightness**: Rooms slightly brighter than hallways

### Hallway Style
- **Color**: #2A2E3A (darker than rooms)
- **Width**: 1.5-2 units consistently
- **Floor**: Smoother texture, less grid visible
- **Transitions**: Smooth blending at room entrances

### Door Visual
- **Frame**: Dark metallic gray (#3D3D3D)
- **Panel**: Lighter gray when closed (#5A5A5A)
- **Open State**: Frame only, no panel
- **Closed State**: Vertical panel fills doorway
- **Animation**: 0.3s slide open/close

### Vent Visual
- **Grill**: Dark gray (#2A2A2A) square
- **Size**: 1 unit × 1 unit
- **Slats**: 3-4 horizontal lines across
- **Position**: Floor-mounted, slight shadow

### Object Markers
- **Tasks**: Yellow "!" icon (0.3 units), gentle pulse
- **Emergency Button**: Red button (0.5 units) in Cafeteria center
- **Bodies**: Colored to match player, cut in half with bone visible

---

## Dimensions Summary Table

| Room | X | Y | Width | Height | Doors | Vents | Dead End |
|------|---|---|-------|--------|-------|-------|----------|
| Cafeteria | 18 | 14 | 12 | 9 | 0 | 1 | No |
| Upper Engine | 2 | 2 | 8 | 8 | 1 | 1 | Yes |
| Reactor | 2 | 12 | 8 | 10 | 2 | 1 | Yes |
| Lower Engine | 2 | 24 | 8 | 8 | 1 | 1 | Yes |
| Security | 11 | 10 | 6 | 6 | 1 | 1 | Yes |
| MedBay | 15 | 7 | 8 | 6 | 1 | 1 | Yes |
| Electrical | 13 | 17 | 7 | 6 | 1 | 1 | Yes |
| Storage | 11 | 23 | 11 | 7 | 2 | 0 | No |
| Admin | 24 | 15 | 7 | 7 | 2 | 1 | No |
| Communications | 21 | 27 | 7 | 5 | 1 | 0 | Yes |
| Weapons | 26 | 2 | 9 | 6 | 1 | 1 | Yes |
| Navigation | 30 | 10 | 8 | 8 | 2 | 1 | No |
| O2 | 34 | 20 | 7 | 6 | 1 | 0 | Yes |
| Shields | 32 | 26 | 7 | 6 | 1 | 1 | Yes |

---

## Implementation Checklist

### Map Structure
- [ ] 14 rooms with exact positions and sizes
- [ ] 5 hallway corridors with proper width
- [ ] 2 decontamination zones with green effect
- [ ] Proper room-to-hallway connections

### Interactive Elements
- [ ] 18 doors with positions and sabotage capability
- [ ] 11 vents in 4 separate networks
- [ ] 4 security cameras with proper FOV
- [ ] 1 emergency meeting button (Cafeteria)

### Tasks
- [ ] 30+ task locations across all rooms
- [ ] 3 visual tasks properly marked
- [ ] Common task designation (wiring, swipe card)
- [ ] Multi-stage tasks (fuel, garbage, power)

### Visual Fidelity
- [ ] Correct room colors matching Among Us
- [ ] Darker hallways vs rooms
- [ ] 0.5-unit thick walls
- [ ] Grid patterns on floors
- [ ] Door frames and panels
- [ ] Vent grills with slats
- [ ] Task indicators with pulse

### Gameplay Elements
- [ ] Spawn points (Cafeteria)
- [ ] Wall collision boundaries
- [ ] Line-of-sight blocking
- [ ] Dead-end flagging for AI
- [ ] High-danger area marking

---

This research document provides complete specifications for pixel-perfect replication of The Skeld from Among Us.

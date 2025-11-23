# Among Us Map Editor

A comprehensive Python tool for creating vector-based maps from PNG images for the Among Us game simulation.

## Features

✅ **Load PNG Background Images** - Import any Among Us map image as reference  
✅ **Draw Polygon Rooms** - Create irregular room shapes with vector polygons  
✅ **Draw Hallways** - Define corridor shapes between rooms  
✅ **Define Player Zones** - Mark walkable areas for player movement  
✅ **Place & Link Vents** - Add vents and create vent network connections  
✅ **Place Doors** - Add doors with horizontal/vertical orientation  
✅ **Place Tasks** - Add task points with specific task type selection (20 task types)  
✅ **Place Cameras** - Add security cameras with vision cones  
✅ **Save/Load JSON** - Export maps to JSON format compatible with game engine  

## Installation

### Prerequisites
- Python 3.7 or higher
- pip package manager

### Install Dependencies

```bash
cd maps
pip install -r requirements.txt
```

This will install:
- **Pillow** (PIL) - Image processing library

Note: `tkinter` comes pre-installed with Python on most systems.

## Usage

### Starting the Editor

```bash
cd maps
python map_editor.py
```

### Workflow

#### 1. Load PNG Background
1. Click **"Load PNG"** button
2. Navigate to `maps/pngs/` directory
3. Select your Among Us map image
4. Image will display on the canvas

#### 2. Draw Rooms
1. Click **"Draw Room"** button
2. Click on canvas to add polygon vertices (minimum 3 points)
3. Right-click or click **"Finish Polygon"** to complete
4. Enter room name in dialog (e.g., "Cafeteria", "Electrical")
5. Room polygon appears with cyan outline

#### 3. Draw Hallways
1. Click **"Draw Hallway"** button
2. Click to add vertices for corridor shape
3. Right-click or click **"Finish Polygon"**
4. Enter hallway name (e.g., "upper_corridor", "reactor_decontam")
5. Hallway appears with yellow outline

#### 4. Define Player Zones
1. Click **"Draw Player Zone"** button
2. Click to outline walkable areas
3. Right-click or **"Finish Polygon"** to complete
4. Zone appears with semi-transparent green fill
5. **Important:** Only areas inside player zones allow player movement

#### 5. Place Vents
1. Click **"Place Vent"** button
2. Click on canvas where vent should be
3. Vent appears as orange circle with ID (e.g., "vent_1")
4. Repeat for all vent locations

#### 6. Link Vents
1. Click **"Link Vents"** button
2. Click first vent to select it
3. Click second vent to create bidirectional connection
4. Dashed orange line shows connection
5. Repeat to create vent networks (e.g., MedBay ↔ Electrical ↔ Security)

**Vent Networks Example (The Skeld):**
- West: Upper Engine ↔ Lower Engine ↔ Reactor
- Central: MedBay ↔ Electrical ↔ Security
- East: Navigation ↔ Weapons ↔ Shields
- Cafeteria: Cafeteria ↔ Admin

#### 7. Place Doors
1. Click **"Place Door"** button
2. Click where door should be
3. Answer "Is this door horizontal?" dialog:
   - **Yes** = Horizontal door (blocks vertical movement)
   - **No** = Vertical door (blocks horizontal movement)
4. Enter room name the door belongs to
5. Door appears as brown rectangle

#### 8. Place Tasks
1. Click **"Place Task"** button
2. Click where task should be
3. Select task type from list:

**Short Tasks:**
- Swipe Card
- Prime Shields
- Empty Garbage
- Chart Course
- Stabilize Steering
- Unlock Manifolds
- Clean O2 Filter
- Divert Power
- Accept Power

**Long Tasks:**
- Start Reactor
- Submit Scan (visual)
- Inspect Sample
- Fuel Engines
- Upload Data
- Download Data
- Clear Asteroids (visual)
- Fix Wiring
- Calibrate Distributor
- Align Engine Output

4. Enter room name where task is located
5. Task appears as yellow square with label

#### 9. Place Cameras
1. Click **"Place Camera"** button
2. Click where camera should be
3. Enter camera parameters:
   - **Direction**: Angle in degrees (0° = right, 90° = down, 180° = left, 270° = up)
   - **Vision Range**: How far camera can see (e.g., 10.0 units)
   - **Vision Angle**: Width of vision cone (e.g., 60° for standard cone)
4. Camera appears as blue circle with vision cone arc

#### 10. Save Map
1. Click **"Save JSON"** button
2. Navigate to `maps/json/` directory
3. Enter filename (e.g., `skeld_map.json`)
4. Map data exports in game-compatible JSON format

#### 11. Load Map
1. Click **"Load JSON"** button
2. Select previously saved JSON file
3. All elements load automatically
4. Background PNG loads if file exists in `maps/pngs/`

### Controls

| Button | Function |
|--------|----------|
| **Load PNG** | Import background image |
| **Save JSON** | Export map data |
| **Load JSON** | Import map data |
| **Draw Room** | Create room polygon |
| **Draw Hallway** | Create hallway polygon |
| **Draw Player Zone** | Define walkable area |
| **Place Vent** | Add vent location |
| **Link Vents** | Connect two vents |
| **Place Door** | Add door |
| **Place Task** | Add task point |
| **Place Camera** | Add security camera |
| **Finish Polygon** | Complete current polygon |
| **Cancel** | Cancel current operation |
| **Clear All** | Delete all elements |

### Mouse Controls

- **Left Click** - Add polygon vertex / Place object
- **Right Click** - Finish polygon (same as "Finish Polygon" button)
- **Mouse Move** - Shows current coordinates in status bar

### Tips

1. **Draw from Outside In:**
   - Draw player zones first (overall walkable area)
   - Then draw rooms and hallways
   - Finally add objects (vents, doors, tasks, cameras)

2. **Room Shapes:**
   - Click vertices in order around the room perimeter
   - For rectangular rooms: 4 clicks (corners)
   - For irregular rooms: As many clicks as needed

3. **Precision:**
   - Use the status bar to see exact coordinates
   - Zoom the canvas if needed for precise placement

4. **Vent Networks:**
   - Link vents that should be connected in gameplay
   - Each vent network is isolated (e.g., can't travel from MedBay network to Engine network)

5. **Task Distribution:**
   - Place multiple instances of same task if needed
   - Visual tasks: Submit Scan, Clear Asteroids
   - Multi-stage tasks: Fix Wiring (3 panels), Fuel Engines (multiple trips)

6. **Camera Coverage:**
   - The Skeld typically has 4 cameras
   - Position cameras to monitor key hallways
   - Vision cones show coverage area

## JSON Output Format

The saved JSON file contains:

```json
{
  "metadata": {
    "image": "skeld_map.png",
    "version": "1.0"
  },
  "rooms": [
    {
      "name": "Cafeteria",
      "vertices": [{"x": 20.5, "y": 15.3}, ...],
      "color": "#404040"
    }
  ],
  "hallways": [...],
  "playerZones": [...],
  "vents": [
    {
      "id": "vent_1",
      "position": {"x": 12.5, "y": 28.3},
      "connectedTo": ["vent_2", "vent_3"]
    }
  ],
  "doors": [...],
  "tasks": [
    {
      "type": "Swipe Card",
      "position": {"x": 18.2, "y": 22.1},
      "room": "Admin"
    }
  ],
  "cameras": [...]
}
```

## Integration with Game Engine

The JSON files can be imported into the TypeScript game engine:

```typescript
import mapData from './maps/json/skeld_map.json';

// Use the data to initialize game map
const rooms = mapData.rooms;
const vents = mapData.vents;
const tasks = mapData.tasks;
// etc.
```

## Troubleshooting

**"tkinter not found"**
- Windows: tkinter comes with Python installer (check "tcl/tk" during install)
- macOS: `brew install python-tk`
- Linux: `sudo apt-get install python3-tk`

**"Cannot load PNG"**
- Ensure PNG file is valid and not corrupted
- Supported formats: PNG only
- Place PNGs in `maps/pngs/` directory

**"Map JSON not compatible"**
- Ensure JSON follows the schema above
- Check for syntax errors in JSON file
- Version 1.0 format required

## File Structure

```
maps/
├── map_editor.py          # Main editor application
├── requirements.txt       # Python dependencies
├── README.md             # This file
├── pngs/                 # Background PNG images
│   └── skeld_map.png
└── json/                 # Exported map data
    └── skeld_map.json
```

## Future Enhancements

Potential features for future versions:
- Undo/Redo functionality
- Edit/delete individual elements
- Grid snap for precise alignment
- Multiple layer visibility toggles
- Auto-generate player zones from rooms
- Import from official Among Us map files
- Export preview images

## License

Part of the Agentic Among Us project.

## Author

Created for AI-driven Among Us simulation project.

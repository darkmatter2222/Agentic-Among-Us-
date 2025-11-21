from dataclasses import dataclass, field
from typing import List, Tuple, Dict, Set

@dataclass
class Point:
    x: int
    y: int
    
    def __hash__(self):
        return hash((self.x, self.y))
    
    def __eq__(self, other):
        return self.x == other.x and self.y == other.y
        
    def to_tuple(self):
        return (self.x, self.y)

@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int
    
    @property
    def center(self) -> Point:
        return Point(self.x + self.w // 2, self.y + self.h // 2)
    
    def contains(self, p: Point) -> bool:
        return self.x <= p.x < self.x + self.w and self.y <= p.y < self.y + self.h

@dataclass
class Door:
    id: str
    room_id: str
    position: Point
    is_closed: bool = False

@dataclass
class Prop:
    id: str
    room_id: str
    shape: str # "circle" or "rect"
    position: Point # Center position
    width: int
    height: int
    color: Tuple[int, int, int]

@dataclass
class TaskLocation:
    id: str
    room_id: str
    position: Point
    task_type: str
    description: str

@dataclass
class Room:
    id: str
    name: str
    bounds: Rect
    color: Tuple[int, int, int]
    doors: List[Door] = field(default_factory=list)
    tasks: List[TaskLocation] = field(default_factory=list)
    vents: List[Point] = field(default_factory=list)
    props: List[Prop] = field(default_factory=list)

class SpaceshipMap:
    def __init__(self):
        self.width = 100
        self.height = 80
        self.grid: List[List[int]] = [[1 for _ in range(self.width)] for _ in range(self.height)] # 1: Wall, 0: Walkable
        self.rooms: Dict[str, Room] = {}
        self.doors: Dict[str, Door] = {}
        self.tasks: Dict[str, TaskLocation] = {}
        self.spawn_points: List[Point] = []
        
        self._initialize_skeld()

    def is_walkable(self, x: int, y: int) -> bool:
        if 0 <= x < self.width and 0 <= y < self.height:
            # Check if it's a wall
            if self.grid[y][x] == 1:
                return False
            # Check if it's a closed door
            for door in self.doors.values():
                if door.position.x == x and door.position.y == y and door.is_closed:
                    return False
            return True
        return False

    def _carve_rect(self, rect: Rect):
        for y in range(rect.y, rect.y + rect.h):
            for x in range(rect.x, rect.x + rect.w):
                if 0 <= x < self.width and 0 <= y < self.height:
                    self.grid[y][x] = 0

    def _carve_corridor(self, start: Point, end: Point, width: int = 2):
        # Simple L-shaped corridor
        # Horizontal first
        x_step = 1 if end.x > start.x else -1
        for x in range(start.x, end.x + x_step, x_step):
            for w in range(width):
                if 0 <= start.y + w < self.height:
                    self.grid[start.y + w][x] = 0
        
        # Vertical
        y_step = 1 if end.y > start.y else -1
        for y in range(start.y, end.y + y_step, y_step):
            for w in range(width):
                if 0 <= end.x + w < self.width:
                    self.grid[y][end.x + w] = 0

    def _add_room(self, id: str, name: str, x: int, y: int, w: int, h: int, color: Tuple[int, int, int]):
        rect = Rect(x, y, w, h)
        room = Room(id, name, rect, color)
        self.rooms[id] = room
        self._carve_rect(rect)
        return room

    def _add_door(self, room_id: str, x: int, y: int):
        door_id = f"door_{room_id}_{len(self.doors)}"
        door = Door(door_id, room_id, Point(x, y))
        self.doors[door_id] = door
        if room_id in self.rooms:
            self.rooms[room_id].doors.append(door)
        # Ensure door is walkable initially
        self.grid[y][x] = 0

    def _add_task(self, room_id: str, x: int, y: int, task_type: str, description: str):
        task_id = f"task_{room_id}_{len(self.tasks)}"
        task = TaskLocation(task_id, room_id, Point(x, y), task_type, description)
        self.tasks[task_id] = task
        if room_id in self.rooms:
            self.rooms[room_id].tasks.append(task)

    def _add_vent(self, room_id: str, x: int, y: int, link_id: int):
        # link_id represents the network (0: Nav/Shields, 1: Reactor/Engines, 2: Med/Sec/Elec)
        # For now, just storing the point
        if room_id in self.rooms:
            self.rooms[room_id].vents.append(Point(x, y))

    def _add_prop(self, room_id: str, shape: str, x: int, y: int, w: int, h: int, color: Tuple[int, int, int]):
        if room_id in self.rooms:
            prop = Prop(f"prop_{room_id}_{len(self.rooms[room_id].props)}", room_id, shape, Point(x, y), w, h, color)
            self.rooms[room_id].props.append(prop)
            
            # Mark prop area as unwalkable (walls)
            # Calculate bounds based on center x,y and w,h
            # Top-left
            tl_x = x - w // 2
            tl_y = y - h // 2
            for py in range(tl_y, tl_y + h):
                for px in range(tl_x, tl_x + w):
                    if 0 <= px < self.width and 0 <= py < self.height:
                        self.grid[py][px] = 1

    def _initialize_skeld(self):
        # Refined Palette
        FLOOR_CAFETERIA = (68, 76, 105)
        FLOOR_WEAPONS = (50, 50, 55)
        FLOOR_NAV = (55, 70, 70)
        FLOOR_O2 = (60, 80, 60)
        FLOOR_SHIELDS = (50, 50, 55)
        FLOOR_COMMS = (50, 60, 80)
        FLOOR_STORAGE = (60, 80, 60)
        FLOOR_ADMIN = (90, 80, 60)
        FLOOR_ELEC = (90, 90, 60)
        FLOOR_ENGINE = (45, 45, 50)
        FLOOR_SECURITY = (90, 50, 50)
        FLOOR_REACTOR = (50, 55, 80)
        FLOOR_MEDBAY = (60, 90, 90)
        
        # Prop Colors
        TABLE_COLOR = (220, 220, 230)
        CRATE_COLOR = (160, 100, 60)
        ENGINE_COLOR = (180, 180, 190)
        BED_COLOR = (230, 250, 250)
        
        # 1. Define Rooms (Adjusted to avoid overlap)
        
        # Cafeteria (Top Center) - Shifted Right
        cafeteria = self._add_room("cafeteria", "Cafeteria", 40, 5, 28, 18, FLOOR_CAFETERIA)
        # Spawn point shifted to be walkable (not on the center table)
        self.spawn_points.append(Point(cafeteria.bounds.center.x, cafeteria.bounds.center.y + 5))
        self._add_prop("cafeteria", "circle", 54, 14, 6, 6, TABLE_COLOR) # Center
        self._add_prop("cafeteria", "circle", 46, 10, 4, 4, TABLE_COLOR)
        self._add_prop("cafeteria", "circle", 62, 10, 4, 4, TABLE_COLOR)
        self._add_prop("cafeteria", "circle", 46, 18, 4, 4, TABLE_COLOR)
        self._add_prop("cafeteria", "circle", 62, 18, 4, 4, TABLE_COLOR)
        
        # MedBay (Left of Cafeteria)
        self._add_room("medbay", "MedBay", 26, 14, 10, 10, FLOOR_MEDBAY)
        self._add_prop("medbay", "rect", 28, 19, 3, 5, BED_COLOR)
        self._add_prop("medbay", "rect", 32, 19, 3, 5, BED_COLOR)

        # Upper Engine (Top Left)
        self._add_room("upper_engine", "Upper Engine", 8, 10, 14, 14, FLOOR_ENGINE)
        self._add_prop("upper_engine", "rect", 15, 17, 6, 8, ENGINE_COLOR)

        # Reactor (Far Left)
        self._add_room("reactor", "Reactor", 4, 32, 14, 16, FLOOR_REACTOR)
        self._add_prop("reactor", "rect", 11, 40, 6, 6, (100, 200, 255))
        self._add_prop("reactor", "rect", 6, 36, 2, 4, ENGINE_COLOR)
        self._add_prop("reactor", "rect", 6, 44, 2, 4, ENGINE_COLOR)

        # Security (Middle Left)
        self._add_room("security", "Security", 24, 30, 10, 10, FLOOR_SECURITY)
        self._add_prop("security", "rect", 27, 35, 4, 2, (50, 50, 50))

        # Lower Engine (Bottom Left)
        self._add_room("lower_engine", "Lower Engine", 8, 56, 14, 14, FLOOR_ENGINE)
        self._add_prop("lower_engine", "rect", 15, 63, 6, 8, ENGINE_COLOR)

        # Electrical (Middle Left/Bottom)
        self._add_room("electrical", "Electrical", 28, 46, 12, 12, FLOOR_ELEC)
        self._add_prop("electrical", "rect", 34, 52, 6, 4, (100, 100, 100))

        # Storage (Bottom Center)
        self._add_room("storage", "Storage", 40, 60, 20, 14, FLOOR_STORAGE)
        self._add_prop("storage", "rect", 45, 65, 4, 6, CRATE_COLOR)
        self._add_prop("storage", "rect", 55, 68, 5, 5, CRATE_COLOR)

        # Admin (Middle Right)
        self._add_room("admin", "Admin", 62, 38, 10, 10, FLOOR_ADMIN)
        self._add_prop("admin", "rect", 67, 43, 6, 4, TABLE_COLOR)

        # Communications (Bottom Right)
        self._add_room("comms", "Communications", 64, 64, 10, 10, FLOOR_COMMS)
        self._add_prop("comms", "rect", 69, 69, 4, 4, TABLE_COLOR)

        # Shields (Bottom Right)
        self._add_room("shields", "Shields", 70, 52, 12, 12, FLOOR_SHIELDS)
        self._add_prop("shields", "rect", 76, 58, 6, 6, (200, 200, 255))

        # O2 (Right Middle)
        self._add_room("o2", "O2", 68, 28, 10, 10, FLOOR_O2)

        # Weapons (Top Right)
        self._add_room("weapons", "Weapons", 72, 8, 14, 14, FLOOR_WEAPONS)
        self._add_prop("weapons", "rect", 79, 15, 4, 4, ENGINE_COLOR)

        # Navigation (Far Right)
        self._add_room("navigation", "Navigation", 88, 34, 8, 14, FLOOR_NAV)
        self._add_prop("navigation", "rect", 92, 41, 4, 4, TABLE_COLOR)

        # 2. Carve Corridors
        # Cafeteria (Left) to MedBay/Upper Engine
        self._carve_corridor(Point(40, 14), Point(36, 14), 3) # Cafe to Hall
        self._carve_corridor(Point(36, 14), Point(36, 19), 3) # Hall to Medbay
        self._carve_corridor(Point(36, 14), Point(22, 14), 3) # Hall to Upper Engine
        
        # Cafeteria (Right) to Weapons/O2/Nav
        self._carve_corridor(Point(68, 14), Point(72, 14), 3) # Cafe to Weapons Hall
        self._carve_corridor(Point(72, 14), Point(72, 28), 3) # Down to O2
        self._carve_corridor(Point(72, 22), Point(88, 40), 3) # To Nav (Diagonal-ish) -> L shape
        
        # Cafeteria (Bottom) to Admin/Storage
        self._carve_corridor(Point(54, 23), Point(54, 60), 4) # Main Spine
        
        # Admin connection
        self._carve_corridor(Point(62, 43), Point(54, 43), 2)
        
        # Storage connections
        self._carve_corridor(Point(60, 67), Point(64, 67), 2) # To Comms
        self._carve_corridor(Point(60, 62), Point(70, 58), 2) # To Shields
        self._carve_corridor(Point(40, 67), Point(22, 63), 3) # To Lower Engine/Elec
        
        # Electrical connection
        self._carve_corridor(Point(34, 46), Point(34, 40), 2) # Up from Elec
        self._carve_corridor(Point(34, 40), Point(22, 40), 2) # To Main Left Hall
        
        # Left Hall (Engine/Reactor/Security)
        self._carve_corridor(Point(22, 17), Point(22, 63), 3) # Vertical Left Spine
        self._carve_corridor(Point(22, 40), Point(18, 40), 2) # To Reactor
        self._carve_corridor(Point(22, 35), Point(24, 35), 2) # To Security
        
        # Reactor Connections
        self._carve_corridor(Point(18, 35), Point(18, 45), 3) # Reactor Front
        self._carve_corridor(Point(18, 35), Point(8, 24), 2) # To Upper Engine
        self._carve_corridor(Point(18, 45), Point(8, 56), 2) # To Lower Engine

        # 3. Add Doors
        self._add_door("cafeteria", 40, 14) # Left
        self._add_door("cafeteria", 68, 14) # Right
        self._add_door("cafeteria", 54, 23) # Bottom
        
        self._add_door("medbay", 36, 19)
        self._add_door("security", 34, 35)
        self._add_door("electrical", 34, 46)
        self._add_door("lower_engine", 22, 63)
        self._add_door("upper_engine", 22, 17)
        self._add_door("reactor", 18, 35) # Top
        self._add_door("reactor", 18, 45) # Bottom
        
        self._add_door("storage", 40, 67) # Left
        self._add_door("storage", 60, 67) # Right
        self._add_door("storage", 54, 60) # Top
        
        # 4. Add Tasks (Approximate new positions)
        self._add_task("cafeteria", 42, 6, "upload_data", "Upload Data")
        self._add_task("cafeteria", 66, 6, "empty_garbage", "Empty Garbage")
        self._add_task("weapons", 80, 10, "clear_asteroids", "Clear Asteroids")
        self._add_task("navigation", 92, 36, "chart_course", "Chart Course")
        self._add_task("o2", 73, 33, "clean_o2_filter", "Clean O2 Filter")
        self._add_task("shields", 76, 58, "prime_shields", "Prime Shields")
        self._add_task("comms", 69, 69, "upload_data", "Upload Data")
        self._add_task("storage", 50, 67, "fuel_engines", "Fuel Engines")
        self._add_task("admin", 67, 43, "swipe_card", "Swipe Card")
        self._add_task("electrical", 30, 50, "fix_wiring", "Fix Wiring")
        self._add_task("medbay", 28, 19, "submit_scan", "Submit Scan")
        self._add_task("reactor", 6, 40, "start_reactor", "Start Reactor")

        # 5. Add Vents
        self._add_vent("weapons", 80, 10, 0)
        self._add_vent("navigation", 92, 45, 0)
        self._add_vent("shields", 76, 60, 0)
        
        self._add_vent("lower_engine", 10, 65, 1)
        self._add_vent("reactor", 6, 34, 1)
        self._add_vent("upper_engine", 10, 12, 1)
        
        self._add_vent("medbay", 28, 16, 2)
        self._add_vent("security", 26, 32, 2)
        self._add_vent("electrical", 30, 48, 2)
        
        self._add_vent("cafeteria", 64, 18, 3)
        self._add_vent("admin", 68, 40, 3)
        self._add_vent("o2", 70, 30, 3)

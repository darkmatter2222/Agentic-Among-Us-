"""
Among Us Map Editor
A comprehensive tool for creating vector-based maps from PNG images.

Features:
- Load PNG background images
- Draw vector polygons for rooms and hallways
- Define player zones (walkable areas)
- Place and link vents
- Place doors with orientation
- Place task points with task type selection
- Define room names
- Place camera vision zones
- Export to JSON format compatible with the game engine
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog
from PIL import Image, ImageTk
import json
import os
from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict
from enum import Enum


class TaskType(Enum):
    """All task types from Among Us"""
    # Short Tasks
    SWIPE_CARD = "Swipe Card"
    PRIME_SHIELDS = "Prime Shields"
    EMPTY_GARBAGE = "Empty Garbage"
    CHART_COURSE = "Chart Course"
    STABILIZE_STEERING = "Stabilize Steering"
    UNLOCK_MANIFOLDS = "Unlock Manifolds"
    CLEAN_O2_FILTER = "Clean O2 Filter"
    DIVERT_POWER = "Divert Power"
    ACCEPT_POWER = "Accept Power"
    
    # Long Tasks
    START_REACTOR = "Start Reactor"
    SUBMIT_SCAN = "Submit Scan"
    INSPECT_SAMPLE = "Inspect Sample"
    FUEL_ENGINES = "Fuel Engines"
    UPLOAD_DATA = "Upload Data"
    DOWNLOAD_DATA = "Download Data"
    CLEAR_ASTEROIDS = "Clear Asteroids"
    FIX_WIRING = "Fix Wiring"
    CALIBRATE_DISTRIBUTOR = "Calibrate Distributor"
    ALIGN_ENGINE = "Align Engine Output"


class DoorOrientation(Enum):
    """Door orientations"""
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


class ObstacleType(Enum):
    """Obstacle types"""
    TABLE = "table"
    CHAIR = "chair"
    CONSOLE = "console"
    BED = "bed"


@dataclass
class Point:
    """2D point"""
    x: float
    y: float


@dataclass
class Wall:
    """Wall/barrier polygon"""
    vertices: List[Point]
    color: str = "#808080"


@dataclass
class WalkableZone:
    """Detected walkable area (internal space)"""
    vertices: List[Point]
    is_room: bool = False
    room_name: str = ""
    holes: List[List[Point]] = None  # Obstacle polygons (walls inside the zone)
    
    def __post_init__(self):
        if self.holes is None:
            self.holes = []


@dataclass
class Vent:
    """Vent location"""
    id: str
    position: Point
    connected_to: List[str]


@dataclass
class Door:
    """Door location"""
    position: Point
    orientation: DoorOrientation
    room: str


@dataclass
class TaskPoint:
    """Task location"""
    task_type: TaskType
    position: Point
    room: str


@dataclass
class Camera:
    """Security camera location"""
    position: Point
    vision_angle: float
    vision_range: float
    direction: float


@dataclass
class Obstacle:
    """Obstacle/furniture (e.g., tables in cafeteria)"""
    id: str
    obstacle_type: ObstacleType
    position: Point
    width: float = 60.0  # 6x vent size (vent is 10 radius, so 20 diameter -> 60x60)
    height: float = 60.0


@dataclass
class EmergencyButton:
    """Emergency meeting button"""
    position: Point
    room: str = "Cafeteria"


@dataclass
class LabeledZone:
    """Labeled zone for player location detection (e.g., Cafeteria, MedBay)"""
    vertices: List[Point]
    name: str


class DrawMode(Enum):
    """Drawing modes"""
    NONE = "none"
    WALL = "wall"
    SELECT_ZONE = "select_zone"
    DETECT_ZONE = "detect_zone"
    VENT = "vent"
    DOOR = "door"
    TASK = "task"
    CAMERA = "camera"
    VENT_LINK = "vent_link"
    OBSTACLE = "obstacle"
    EMERGENCY_BUTTON = "emergency_button"


class MapEditor:
    """Main map editor application"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("Among Us Map Editor")
        self.root.geometry("1600x900")
        
        # Map data
        self.background_image: Optional[Image.Image] = None
        self.background_photo: Optional[ImageTk.PhotoImage] = None
        self.image_path: str = ""
        self.scale: float = 1.0
        self.zoom: float = 1.0  # Current zoom level
        self.offset_x: float = 0
        self.offset_y: float = 0
        
        # Map elements
        self.walls: List[Wall] = []
        self.walkable_zones: List[WalkableZone] = []
        self.labeled_zones: List[LabeledZone] = []  # Player location zones
        self.vents: List[Vent] = []
        self.doors: List[Door] = []
        self.tasks: List[TaskPoint] = []
        self.cameras: List[Camera] = []
        self.obstacles: List[Obstacle] = []
        self.emergency_button: Optional[EmergencyButton] = None

        # Drawing state
        self.draw_mode: DrawMode = DrawMode.NONE
        self.current_polygon: List[Point] = []
        self.selected_vent: Optional[Vent] = None
        self.vent_counter: int = 1
        self.obstacle_counter: int = 1
        self.snap_distance: float = 10.0  # Snap distance in pixels
        self.angle_snap_degrees: float = 15.0  # Degrees tolerance for angle snapping
        self.dragging_zone: Optional[WalkableZone] = None

        # Object dragging state (Ctrl+Click)
        self.dragging_object: Optional[object] = None  # The object being dragged
        self.dragging_object_type: Optional[str] = None  # Type of object being dragged
        self.drag_offset_x: float = 0  # Offset from click to object center
        self.drag_offset_y: float = 0
        self.hover_object: Optional[object] = None  # Object under mouse with Ctrl held
        self.hover_object_type: Optional[str] = None  # Type of hovered object        # Undo/Redo history
        self.history: List[Dict] = []
        self.history_index: int = -1
        self.max_history: int = 50
        
        # UI setup
        self.setup_ui()
        
        # Keyboard shortcuts
        self.root.bind('<Control-z>', lambda e: self.undo())
        self.root.bind('<Control-Z>', lambda e: self.undo())
        self.root.bind('<Control-y>', lambda e: self.redo())
        self.root.bind('<Control-Y>', lambda e: self.redo())
        self.root.bind('<Delete>', lambda e: self.delete_mode())
        
        # Save initial state
        self.save_state()
        
    def setup_ui(self):
        """Setup the user interface"""
        # Main container
        main_container = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main_container.pack(fill=tk.BOTH, expand=True)
        
        # Left panel - Tools
        left_panel = ttk.Frame(main_container, width=300)
        main_container.add(left_panel, weight=0)
        
        # Right panel - Canvas
        right_panel = ttk.Frame(main_container)
        main_container.add(right_panel, weight=1)
        
        # Setup left panel
        self.setup_tools_panel(left_panel)
        
        # Setup canvas
        self.setup_canvas(right_panel)
        
    def setup_tools_panel(self, parent):
        """Setup the tools panel"""
        # File operations
        file_frame = ttk.LabelFrame(parent, text="File", padding=10)
        file_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Button(file_frame, text="Load PNG", command=self.load_png).pack(fill=tk.X, pady=2)
        ttk.Button(file_frame, text="Save JSON", command=self.save_json).pack(fill=tk.X, pady=2)
        ttk.Button(file_frame, text="Load JSON", command=self.load_json).pack(fill=tk.X, pady=2)
        
        # Drawing tools
        tools_frame = ttk.LabelFrame(parent, text="Drawing Tools", padding=10)
        tools_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Label(tools_frame, text="1. Draw outer boundary first", font=("Arial", 8, "italic")).pack(fill=tk.X, pady=1)
        ttk.Label(tools_frame, text="2. Draw holes/obstacles inside", font=("Arial", 8, "italic")).pack(fill=tk.X, pady=1)
        ttk.Button(tools_frame, text="Draw Walkable Zone", command=lambda: self.set_mode(DrawMode.WALL)).pack(fill=tk.X, pady=2)
        
        ttk.Label(tools_frame, text="3. Draw player location zones", font=("Arial", 8, "italic")).pack(fill=tk.X, pady=1)
        ttk.Button(tools_frame, text="Draw Labeled Zone", command=lambda: self.set_mode(DrawMode.SELECT_ZONE)).pack(fill=tk.X, pady=2)
        
        # Object placement
        objects_frame = ttk.LabelFrame(parent, text="Place Objects", padding=10)
        objects_frame.pack(fill=tk.X, padx=5, pady=5)

        ttk.Button(objects_frame, text="Place Vent", command=lambda: self.set_mode(DrawMode.VENT)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Link Vents", command=lambda: self.set_mode(DrawMode.VENT_LINK)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Place Door", command=lambda: self.set_mode(DrawMode.DOOR)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Place Task", command=lambda: self.set_mode(DrawMode.TASK)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Place Camera", command=lambda: self.set_mode(DrawMode.CAMERA)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Place Obstacle (Table)", command=lambda: self.set_mode(DrawMode.OBSTACLE)).pack(fill=tk.X, pady=2)
        ttk.Button(objects_frame, text="Place Emergency Button", command=lambda: self.set_mode(DrawMode.EMERGENCY_BUTTON)).pack(fill=tk.X, pady=2)

        # Move objects hint
        ttk.Label(objects_frame, text="Ctrl+Click+Drag to move objects", font=("Arial", 8, "italic"), foreground="gray").pack(fill=tk.X, pady=1)        # Controls
        controls_frame = ttk.LabelFrame(parent, text="Controls", padding=10)
        controls_frame.pack(fill=tk.X, padx=5, pady=5)
        
        ttk.Button(controls_frame, text="Finish Polygon", command=self.finish_polygon).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Cancel", command=self.cancel_drawing).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Straighten All Vectors", command=self.straighten_all_vectors).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Undo (Ctrl+Z)", command=self.undo).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Redo (Ctrl+Y)", command=self.redo).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Delete Mode (Del)", command=self.delete_mode).pack(fill=tk.X, pady=2)
        ttk.Button(controls_frame, text="Clear All", command=self.clear_all).pack(fill=tk.X, pady=2)
        
        # Status
        self.status_label = ttk.Label(parent, text="Ready", relief=tk.SUNKEN)
        self.status_label.pack(fill=tk.X, padx=5, pady=5, side=tk.BOTTOM)
        
        # Mode indicator
        self.mode_label = ttk.Label(parent, text="Mode: None", font=("Arial", 12, "bold"))
        self.mode_label.pack(fill=tk.X, padx=5, pady=5, side=tk.BOTTOM)
        
    def setup_canvas(self, parent):
        """Setup the drawing canvas"""
        # Canvas with scrollbars
        canvas_frame = ttk.Frame(parent)
        canvas_frame.pack(fill=tk.BOTH, expand=True)
        
        # Scrollbars
        h_scroll = ttk.Scrollbar(canvas_frame, orient=tk.HORIZONTAL)
        h_scroll.pack(side=tk.BOTTOM, fill=tk.X)
        
        v_scroll = ttk.Scrollbar(canvas_frame, orient=tk.VERTICAL)
        v_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Canvas
        self.canvas = tk.Canvas(
            canvas_frame,
            bg="#1a1a1a",
            xscrollcommand=h_scroll.set,
            yscrollcommand=v_scroll.set,
            scrollregion=(0, 0, 2000, 2000)
        )
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        h_scroll.config(command=self.canvas.xview)
        v_scroll.config(command=self.canvas.yview)
        
        # Bind events
        self.canvas.bind("<Button-1>", self.on_canvas_click)
        self.canvas.bind("<Button-3>", self.on_canvas_right_click)
        self.canvas.bind("<Motion>", self.on_canvas_motion)
        self.canvas.bind("<MouseWheel>", self.on_mouse_wheel)
        self.canvas.bind("<Button-2>", self.on_middle_click)  # Middle click for delete
        self.canvas.bind("<B1-Motion>", self.on_canvas_drag)  # Drag for zone selection
        self.canvas.bind("<ButtonRelease-1>", self.on_canvas_release)  # Release for object drag
        
    def set_mode(self, mode: DrawMode):
        """Set the current drawing mode"""
        self.draw_mode = mode
        self.mode_label.config(text=f"Mode: {mode.value.replace('_', ' ').title()}")
        self.update_status(f"Mode changed to: {mode.value.replace('_', ' ').title()}")
        
    def update_status(self, message: str):
        """Update status bar"""
        self.status_label.config(text=message)
        
    def load_png(self):
        """Load a PNG background image"""
        filename = filedialog.askopenfilename(
            title="Select PNG Image",
            initialdir="./maps/pngs",
            filetypes=[("PNG files", "*.png"), ("All files", "*.*")]
        )
        
        if filename:
            try:
                self.image_path = filename
                self.background_image = Image.open(filename)
                self.display_background()
                self.update_status(f"Loaded: {os.path.basename(filename)}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to load image: {e}")
                
    def display_background(self):
        """Display the background image on canvas"""
        if self.background_image:
            # Calculate display size with zoom
            width, height = self.background_image.size
            
            # Base scale to fit image initially
            if self.scale == 1.0:  # First time loading
                self.scale = min(1200 / width, 800 / height, 1.0)
            
            # Apply zoom to scale
            display_scale = self.scale * self.zoom
            display_size = (int(width * display_scale), int(height * display_scale))
            
            resized = self.background_image.resize(display_size, Image.Resampling.LANCZOS)
            
            self.background_photo = ImageTk.PhotoImage(resized)
            
            # Clear canvas and draw image
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, image=self.background_photo, anchor=tk.NW)
            
            # Update scroll region
            self.canvas.config(scrollregion=(0, 0, display_size[0], display_size[1]))
            
            # Redraw all elements
            self.redraw_all()
            
    def on_canvas_click(self, event):
        """Handle canvas click events"""
        x = self.canvas.canvasx(event.x)
        y = self.canvas.canvasy(event.y)

        # Convert to map coordinates (accounting for both scale and zoom)
        display_scale = self.scale * self.zoom if self.scale > 0 else 1.0
        map_x = x / display_scale
        map_y = y / display_scale

        # Check for Ctrl+Click to start dragging an object
        if event.state & 0x4:  # Ctrl key is held
            obj, obj_type = self.find_object_at(x, y)
            if obj:
                self.dragging_object = obj
                self.dragging_object_type = obj_type
                # Calculate offset from click to object center
                if obj_type in ['vent', 'door', 'task', 'camera', 'obstacle', 'emergency_button']:
                    self.drag_offset_x = map_x - obj.position.x
                    self.drag_offset_y = map_y - obj.position.y
                self.update_status(f"Dragging {obj_type}...")
                return

        if self.draw_mode == DrawMode.WALL:
            # Priority 1: Snap to existing vertices
            vertex_snap = self.find_snap_point(x, y)
            if vertex_snap:
                map_x, map_y = vertex_snap.x, vertex_snap.y
            # Priority 2: Angle snap if we have a previous point
            elif self.current_polygon and len(self.current_polygon) > 0:
                angle_snap = self.find_angle_snap_point(x, y, self.current_polygon[-1])
                if angle_snap:
                    map_x, map_y = angle_snap.x, angle_snap.y
            
            # Add point to current polygon
            self.current_polygon.append(Point(map_x, map_y))
            self.redraw_all()
            self.update_status(f"Added point {len(self.current_polygon)} at ({map_x:.1f}, {map_y:.1f})")
            
        elif self.draw_mode == DrawMode.SELECT_ZONE:
            # Draw labeled zone polygon (same as WALL mode)
            # Priority 1: Snap to existing vertices
            vertex_snap = self.find_snap_point(x, y)
            if vertex_snap:
                map_x, map_y = vertex_snap.x, vertex_snap.y
            # Priority 2: Angle snap if we have a previous point
            elif self.current_polygon and len(self.current_polygon) > 0:
                angle_snap = self.find_angle_snap_point(x, y, self.current_polygon[-1])
                if angle_snap:
                    map_x, map_y = angle_snap.x, angle_snap.y
            
            # Add point to current polygon
            self.current_polygon.append(Point(map_x, map_y))
            self.redraw_all()
            self.update_status(f"Added point {len(self.current_polygon)} at ({map_x:.1f}, {map_y:.1f})")
        
        elif self.draw_mode == DrawMode.DETECT_ZONE:
            # Detect and create zone at click point
            self.create_zone_at_point(map_x, map_y)
            
        elif self.draw_mode == DrawMode.VENT:
            self.place_vent(map_x, map_y)
            
        elif self.draw_mode == DrawMode.VENT_LINK:
            self.link_vent(x, y)
            
        elif self.draw_mode == DrawMode.DOOR:
            self.place_door(map_x, map_y)
            
        elif self.draw_mode == DrawMode.TASK:
            self.place_task(map_x, map_y)
            
        elif self.draw_mode == DrawMode.CAMERA:
            self.place_camera(map_x, map_y)

        elif self.draw_mode == DrawMode.OBSTACLE:
            self.place_obstacle(map_x, map_y)

        elif self.draw_mode == DrawMode.EMERGENCY_BUTTON:
            self.place_emergency_button(map_x, map_y)
            
    def on_canvas_drag(self, event):
        """Handle canvas drag for zone selection and object movement"""
        x = self.canvas.canvasx(event.x)
        y = self.canvas.canvasy(event.y)
        display_scale = self.scale * self.zoom if self.scale > 0 else 1.0
        map_x = x / display_scale
        map_y = y / display_scale

        # Handle object dragging (Ctrl+Drag)
        if self.dragging_object is not None:
            new_x = map_x - self.drag_offset_x
            new_y = map_y - self.drag_offset_y

            if self.dragging_object_type in ['vent', 'door', 'task', 'camera', 'obstacle', 'emergency_button']:
                self.dragging_object.position.x = new_x
                self.dragging_object.position.y = new_y
            self.redraw_all()
            return

        if self.draw_mode == DrawMode.SELECT_ZONE:
            # Visual feedback for dragging (optional)
            pass

    def on_canvas_release(self, event):
        """Handle mouse button release - finish dragging"""
        if self.dragging_object is not None:
            self.save_state()
            self.update_status(f"Moved {self.dragging_object_type}")
            self.dragging_object = None
            self.dragging_object_type = None
            self.drag_offset_x = 0
            self.drag_offset_y = 0
            self.redraw_all()
            
    def on_canvas_right_click(self, event):
        """Handle right-click to finish polygon or delete element"""
        if self.draw_mode == DrawMode.WALL or self.draw_mode == DrawMode.SELECT_ZONE:
            self.finish_polygon()
        elif self.draw_mode == DrawMode.NONE:
            # Delete mode - find and delete element at click position
            self.delete_element_at(event.x, event.y)

    def find_object_at(self, screen_x: float, screen_y: float) -> Tuple[Optional[object], Optional[str]]:
        """Find any movable object at screen position. Returns (object, type_string) or (None, None)"""
        display_scale = self.scale * self.zoom

        # Check vents (small targets)
        for vent in self.vents:
            vx = vent.position.x * display_scale
            vy = vent.position.y * display_scale
            if abs(vx - screen_x) < 15 and abs(vy - screen_y) < 15:
                return (vent, 'vent')

        # Check doors
        for door in self.doors:
            dx = door.position.x * display_scale
            dy = door.position.y * display_scale
            if abs(dx - screen_x) < 20 and abs(dy - screen_y) < 20:
                return (door, 'door')

        # Check tasks
        for task in self.tasks:
            tx = task.position.x * display_scale
            ty = task.position.y * display_scale
            if abs(tx - screen_x) < 15 and abs(ty - screen_y) < 15:
                return (task, 'task')

        # Check cameras
        for camera in self.cameras:
            cx = camera.position.x * display_scale
            cy = camera.position.y * display_scale
            if abs(cx - screen_x) < 15 and abs(cy - screen_y) < 15:
                return (camera, 'camera')

        # Check obstacles (larger targets)
        for obstacle in self.obstacles:
            ox = obstacle.position.x * display_scale
            oy = obstacle.position.y * display_scale
            hw = (obstacle.width / 2) * display_scale
            hh = (obstacle.height / 2) * display_scale
            if abs(ox - screen_x) < hw + 5 and abs(oy - screen_y) < hh + 5:
                return (obstacle, 'obstacle')

        # Check emergency button
        if self.emergency_button:
            bx = self.emergency_button.position.x * display_scale
            by = self.emergency_button.position.y * display_scale
            if abs(bx - screen_x) < 20 and abs(by - screen_y) < 20:
                return (self.emergency_button, 'emergency_button')

        return (None, None)
            
    def on_canvas_motion(self, event):
        """Handle mouse motion for preview"""
        import math
        x = self.canvas.canvasx(event.x)
        y = self.canvas.canvasy(event.y)

        # Show current coordinates (accounting for zoom)
        display_scale = self.scale * self.zoom if self.scale > 0 else 1.0
        map_x = x / display_scale
        map_y = y / display_scale

        # Remove old indicators
        self.canvas.delete("snap_indicator")
        self.canvas.delete("angle_guide")
        self.canvas.delete("hover_glow")

        # Check for Ctrl key - show hover glow on movable objects
        if event.state & 0x4:  # Ctrl key is held
            obj, obj_type = self.find_object_at(x, y)
            if obj:
                self.hover_object = obj
                self.hover_object_type = obj_type
                self.draw_hover_glow(obj, obj_type, display_scale)
                self.update_status(f"Ctrl+Click to drag {obj_type} | Position: ({map_x:.1f}, {map_y:.1f})")
                return
            else:
                self.hover_object = None
                self.hover_object_type = None        # Show snap indicators if in wall drawing mode or labeled zone mode
        if self.draw_mode == DrawMode.WALL or self.draw_mode == DrawMode.SELECT_ZONE:
            # First check for vertex snap
            snap_point = self.find_snap_point(x, y)
            if snap_point:
                snap_x = snap_point.x * display_scale
                snap_y = snap_point.y * display_scale
                # Draw vertex snap indicator (green circle)
                self.canvas.create_oval(
                    snap_x - 8, snap_y - 8, snap_x + 8, snap_y + 8,
                    outline="#00ff00", width=3, tags="snap_indicator"
                )
                self.update_status(f"VERTEX SNAP to ({snap_point.x:.1f}, {snap_point.y:.1f}) | Zoom: {self.zoom:.2f}x")
            # If we have at least one point, show angle snap guides
            elif self.current_polygon and len(self.current_polygon) > 0:
                last_point = self.current_polygon[-1]
                last_x = last_point.x * display_scale
                last_y = last_point.y * display_scale
                
                # Draw angle guide lines (faint)
                guide_length = 100
                valid_angles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330]
                
                for angle_deg in valid_angles:
                    angle_rad = math.radians(angle_deg)
                    end_x = last_x + guide_length * math.cos(angle_rad)
                    end_y = last_y + guide_length * math.sin(angle_rad)
                    self.canvas.create_line(
                        last_x, last_y, end_x, end_y,
                        fill="#444444", width=1, dash=(2, 4), tags="angle_guide"
                    )
                
                # Check for angle snap
                angle_snap_point = self.find_angle_snap_point(x, y, last_point)
                if angle_snap_point:
                    snap_x = angle_snap_point.x * display_scale
                    snap_y = angle_snap_point.y * display_scale
                    
                    # Draw preview line to snapped point (yellow)
                    self.canvas.create_line(
                        last_x, last_y, snap_x, snap_y,
                        fill="#ffff00", width=2, tags="angle_guide"
                    )
                    # Draw snap point indicator (yellow circle)
                    self.canvas.create_oval(
                        snap_x - 6, snap_y - 6, snap_x + 6, snap_y + 6,
                        outline="#ffff00", fill="#ffff00", width=2, tags="snap_indicator"
                    )
                    
                    # Calculate and show angle
                    dx = angle_snap_point.x - last_point.x
                    dy = angle_snap_point.y - last_point.y
                    angle = math.degrees(math.atan2(dy, dx)) % 360
                    distance = math.sqrt(dx*dx + dy*dy)
                    
                    self.update_status(f"ANGLE SNAP: {angle:.0f}° | Distance: {distance:.1f} | Zoom: {self.zoom:.2f}x")
                else:
                    self.update_status(f"Position: ({map_x:.1f}, {map_y:.1f}) | Zoom: {self.zoom:.2f}x")
            else:
                self.update_status(f"Position: ({map_x:.1f}, {map_y:.1f}) | Zoom: {self.zoom:.2f}x")
        else:
            self.update_status(f"Position: ({map_x:.1f}, {map_y:.1f}) | Zoom: {self.zoom:.2f}x")

    def draw_hover_glow(self, obj, obj_type: str, display_scale: float):
        """Draw a glow effect around an object when hovering with Ctrl held"""
        glow_color = "#00ffff"  # Cyan glow
        glow_width = 4

        if obj_type == 'vent':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            # Draw outer glow
            self.canvas.create_oval(
                x - 16, y - 16, x + 16, y + 16,
                outline=glow_color, width=glow_width, tags="hover_glow"
            )
        elif obj_type == 'door':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            if obj.orientation == DoorOrientation.HORIZONTAL:
                self.canvas.create_rectangle(
                    x - 20, y - 8, x + 20, y + 8,
                    outline=glow_color, width=glow_width, tags="hover_glow"
                )
            else:
                self.canvas.create_rectangle(
                    x - 8, y - 20, x + 8, y + 20,
                    outline=glow_color, width=glow_width, tags="hover_glow"
                )
        elif obj_type == 'task':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            self.canvas.create_rectangle(
                x - 13, y - 13, x + 13, y + 13,
                outline=glow_color, width=glow_width, tags="hover_glow"
            )
        elif obj_type == 'camera':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            self.canvas.create_oval(
                x - 14, y - 14, x + 14, y + 14,
                outline=glow_color, width=glow_width, tags="hover_glow"
            )
        elif obj_type == 'obstacle':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            hw = (obj.width / 2) * display_scale
            hh = (obj.height / 2) * display_scale
            self.canvas.create_rectangle(
                x - hw - 5, y - hh - 5, x + hw + 5, y + hh + 5,
                outline=glow_color, width=glow_width, tags="hover_glow"
            )
        elif obj_type == 'emergency_button':
            x = obj.position.x * display_scale
            y = obj.position.y * display_scale
            self.canvas.create_oval(
                x - 25, y - 25, x + 25, y + 25,
                outline=glow_color, width=glow_width, tags="hover_glow"
            )

    def on_mouse_wheel(self, event):
        """Handle mouse wheel for zoom"""
        # Get mouse position before zoom
        canvas_x = self.canvas.canvasx(event.x)
        canvas_y = self.canvas.canvasy(event.y)
        
        # Calculate zoom factor
        if event.delta > 0:
            zoom_factor = 1.1
        else:
            zoom_factor = 0.9
            
        # Update zoom level
        old_zoom = self.zoom
        self.zoom *= zoom_factor
        
        # Clamp zoom between 0.1x and 10x
        self.zoom = max(0.1, min(10.0, self.zoom))
        
        # If zoom didn't change (clamped), return
        if self.zoom == old_zoom:
            return
            
        # Redisplay with new zoom
        self.display_background()
        
        # Adjust scroll position to zoom towards mouse cursor
        actual_factor = self.zoom / old_zoom
        new_canvas_x = canvas_x * actual_factor
        new_canvas_y = canvas_y * actual_factor
        
        # Scroll to keep mouse position stable
        self.canvas.xview_moveto((new_canvas_x - event.x) / (self.canvas.winfo_width() * actual_factor))
        self.canvas.yview_moveto((new_canvas_y - event.y) / (self.canvas.winfo_height() * actual_factor))
        
    def on_middle_click(self, event):
        """Handle middle-click for quick delete"""
        self.delete_element_at(event.x, event.y)
        
    def finish_polygon(self):
        """Finish the current polygon"""
        if len(self.current_polygon) < 3:
            messagebox.showwarning("Invalid Polygon", "Need at least 3 points to create a polygon")
            return
            
        if self.draw_mode == DrawMode.WALL:
            # Check if this polygon is inside an existing walkable zone
            # If yes, it's a hole (obstacle). If no, it's a new walkable zone.
            parent_zone = None
            for zone in self.walkable_zones:
                # Check if first point of new polygon is inside this zone
                if self.point_in_polygon(self.current_polygon[0].x, self.current_polygon[0].y, zone.vertices):
                    parent_zone = zone
                    break
            
            if parent_zone:
                # This is a hole inside an existing zone
                parent_zone.holes.append(self.current_polygon.copy())
                self.save_state()
                self.update_status(f"Created hole (obstacle) with {len(self.current_polygon)} vertices")
            else:
                # This is a new walkable zone
                self.walkable_zones.append(WalkableZone(vertices=self.current_polygon.copy(), is_room=False, room_name="", holes=[]))
                self.save_state()
                self.update_status(f"Created walkable zone with {len(self.current_polygon)} vertices")
        
        elif self.draw_mode == DrawMode.SELECT_ZONE:
            # Create a labeled zone and ask for name
            zone_name = simpledialog.askstring("Zone Name", "Enter zone name (e.g., Cafeteria, MedBay):")
            if zone_name:
                self.labeled_zones.append(LabeledZone(vertices=self.current_polygon.copy(), name=zone_name))
                self.save_state()
                self.update_status(f"Created labeled zone '{zone_name}' with {len(self.current_polygon)} vertices")
            
        self.current_polygon = []
        self.redraw_all()
        
    def find_snap_point(self, screen_x: float, screen_y: float) -> Optional[Point]:
        """Find nearby vertex to snap to"""
        display_scale = self.scale * self.zoom
        
        # Check all walkable zone vertices
        for zone in self.walkable_zones:
            for vertex in zone.vertices:
                vx = vertex.x * display_scale
                vy = vertex.y * display_scale
                if abs(vx - screen_x) < self.snap_distance and abs(vy - screen_y) < self.snap_distance:
                    return vertex
            
            # Check hole vertices
            for hole in zone.holes:
                for vertex in hole:
                    vx = vertex.x * display_scale
                    vy = vertex.y * display_scale
                    if abs(vx - screen_x) < self.snap_distance and abs(vy - screen_y) < self.snap_distance:
                        return vertex
        
        # Check all labeled zone vertices
        for labeled_zone in self.labeled_zones:
            for vertex in labeled_zone.vertices:
                vx = vertex.x * display_scale
                vy = vertex.y * display_scale
                if abs(vx - screen_x) < self.snap_distance and abs(vy - screen_y) < self.snap_distance:
                    return vertex
        
        # Check all wall vertices (if any walls are defined)
        for wall in self.walls:
            for vertex in wall.vertices:
                vx = vertex.x * display_scale
                vy = vertex.y * display_scale
                if abs(vx - screen_x) < self.snap_distance and abs(vy - screen_y) < self.snap_distance:
                    return vertex
        
        # Check current polygon vertices
        for vertex in self.current_polygon:
            vx = vertex.x * display_scale
            vy = vertex.y * display_scale
            if abs(vx - screen_x) < self.snap_distance and abs(vy - screen_y) < self.snap_distance:
                return vertex
                
        return None
    
    def find_angle_snap_point(self, screen_x: float, screen_y: float, last_point: Point) -> Optional[Point]:
        """Snap to valid angles (0°, 30°, 45°, 60°, 90°, etc.) from last point"""
        import math
        
        display_scale = self.scale * self.zoom
        
        # Convert last point to screen coordinates
        last_x = last_point.x * display_scale
        last_y = last_point.y * display_scale
        
        # Calculate angle from last point to mouse
        dx = screen_x - last_x
        dy = screen_y - last_y
        
        if dx == 0 and dy == 0:
            return None
        
        # Current angle in degrees
        angle_rad = math.atan2(dy, dx)
        angle_deg = math.degrees(angle_rad)
        
        # Valid angles: 0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330
        valid_angles = [i * 30 for i in range(12)]  # 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330
        valid_angles.extend([45, 135, 225, 315])  # Add 45-degree angles
        valid_angles.sort()
        
        # Find nearest valid angle
        normalized_angle = angle_deg % 360
        closest_angle = min(valid_angles, key=lambda a: min(abs(normalized_angle - a), abs(normalized_angle - a + 360), abs(normalized_angle - a - 360)))
        
        # Check if we're close enough to snap
        angle_diff = min(abs(normalized_angle - closest_angle), abs(normalized_angle - closest_angle + 360), abs(normalized_angle - closest_angle - 360))
        
        if angle_diff > self.angle_snap_degrees:
            return None
        
        # Calculate distance from last point
        distance = math.sqrt(dx*dx + dy*dy)
        
        # Calculate snapped point
        snapped_angle_rad = math.radians(closest_angle)
        snapped_x = last_x + distance * math.cos(snapped_angle_rad)
        snapped_y = last_y + distance * math.sin(snapped_angle_rad)
        
        # Convert back to map coordinates
        map_x = snapped_x / display_scale
        map_y = snapped_y / display_scale
        
        return Point(map_x, map_y)
        
    def detect_walkable_zones(self):
        """Enter zone detection mode - click inside enclosed areas"""
        if not self.walls:
            messagebox.showwarning("No Walls", "Draw some walls first!")
            return
        
        self.draw_mode = DrawMode.DETECT_ZONE
        self.mode_label.config(text="Mode: Detect Zone (Click inside enclosed area)")
        self.update_status("Click inside an enclosed area to create a walkable zone")
    
    def create_zone_at_point(self, map_x: float, map_y: float):
        """Create walkable zone at click point using flood fill"""
        print(f"DEBUG: create_zone_at_point called at ({map_x}, {map_y})")
        
        # Check if already in existing zone
        for zone in self.walkable_zones:
            if self.point_in_polygon(map_x, map_y, zone.vertices):
                self.update_status("Zone already exists at this location")
                return
        
        # Use flood fill - treats walls as line boundaries
        zone_vertices = self.trace_zone_boundary(map_x, map_y)
        
        if zone_vertices and len(zone_vertices) >= 3:
            new_zone = WalkableZone(vertices=zone_vertices, is_room=False, room_name="")
            self.walkable_zones.append(new_zone)
            self.save_state()
            self.redraw_all()
            self.update_status(f"Created walkable zone with {len(zone_vertices)} vertices")
        else:
            self.update_status("Could not create zone at this location")
    
    def trace_zone_with_holes(self, start_x: float, start_y: float, outer_wall, holes: List) -> List[Point]:
        """Trace zone boundary excluding holes using flood fill"""
        all_points = []
        all_points.extend(outer_wall.vertices)
        for hole in holes:
            all_points.extend(hole.vertices)
        
        min_x = min(p.x for p in all_points) - 10
        max_x = max(p.x for p in all_points) + 10
        min_y = min(p.y for p in all_points) - 10
        max_y = max(p.y for p in all_points) + 10
        
        grid_size = 3.0
        
        start_gx = int(start_x / grid_size)
        start_gy = int(start_y / grid_size)
        
        queue = [(start_gx, start_gy)]
        visited = set(queue)
        filled_cells = set()
        
        while queue and len(filled_cells) < 30000:
            gx, gy = queue.pop(0)
            px = gx * grid_size
            py = gy * grid_size
            
            # Must be inside outer wall
            if not self.point_in_polygon(px, py, outer_wall.vertices):
                continue
            
            # Must NOT be inside any hole
            in_hole = False
            for hole in holes:
                if self.point_in_polygon(px, py, hole.vertices):
                    in_hole = True
                    break
            
            if in_hole:
                continue
            
            filled_cells.add((gx, gy))
            
            # Check 4 neighbors
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:
                nx, ny = gx + dx, gy + dy
                if (nx, ny) not in visited:
                    npx = nx * grid_size
                    npy = ny * grid_size
                    if min_x <= npx <= max_x and min_y <= npy <= max_y:
                        visited.add((nx, ny))
                        queue.append((nx, ny))
        
        if not filled_cells:
            return []
        
        # Extract boundary
        boundary_cells = set()
        for gx, gy in filled_cells:
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (-1, 1), (1, -1), (-1, -1)]:
                if (gx + dx, gy + dy) not in filled_cells:
                    boundary_cells.add((gx, gy))
                    break
        
        if not boundary_cells:
            return []
        
        # Order boundary points
        ordered_boundary = self.order_boundary_points(boundary_cells, grid_size)
        return ordered_boundary if len(ordered_boundary) >= 3 else []
    
    def polygon_area(self, vertices: List[Point]) -> float:
        """Calculate polygon area using shoelace formula"""
        if len(vertices) < 3:
            return 0
        area = 0
        for i in range(len(vertices)):
            j = (i + 1) % len(vertices)
            area += vertices[i].x * vertices[j].y
            area -= vertices[j].x * vertices[i].y
        return abs(area) / 2
    
    def polygon_contains_polygon(self, outer: List[Point], inner: List[Point]) -> bool:
        """Check if inner polygon is completely inside outer polygon"""
        # Check if all vertices of inner are inside outer
        for vertex in inner:
            if not self.point_in_polygon(vertex.x, vertex.y, outer):
                return False
        return True
    
    def trace_zone_boundary(self, start_x: float, start_y: float) -> List[Point]:
        """Trace the boundary of walkable area - walls are line boundaries only"""
        print(f"DEBUG: trace_zone_boundary called at ({start_x}, {start_y})")
        print(f"DEBUG: Number of walls: {len(self.walls)}")
        
        if not self.walls:
            return []
        
        # Get bounds from all walls
        all_points = []
        for wall in self.walls:
            all_points.extend(wall.vertices)
        
        min_x = min(p.x for p in all_points) - 100
        max_x = max(p.x for p in all_points) + 100
        min_y = min(p.y for p in all_points) - 100
        max_y = max(p.y for p in all_points) + 100
        
        print(f"DEBUG: Bounds: ({min_x}, {min_y}) to ({max_x}, {max_y})")
        print(f"DEBUG: Walls are treated as LINE BOUNDARIES only (no inside/outside until zones defined)")
        
        # Grid resolution for sampling
        grid_size = 3.0
        
        # Flood fill from start point
        visited = set()
        start_gx = int(start_x / grid_size)
        start_gy = int(start_y / grid_size)
        queue = [(start_gx, start_gy)]
        visited.add(queue[0])
        
        filled_cells = set()
        iterations = 0
        max_cells = 30000
        
        while queue and len(filled_cells) < max_cells:
            iterations += 1
            gx, gy = queue.pop(0)
            px = gx * grid_size
            py = gy * grid_size
            
            # This cell is valid
            filled_cells.add((gx, gy))
            
            # Check 4 neighbors
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0)]:
                nx, ny = gx + dx, gy + dy
                if (nx, ny) not in visited:
                    npx = nx * grid_size
                    npy = ny * grid_size
                    
                    # Check bounds
                    if not (min_x <= npx <= max_x and min_y <= npy <= max_y):
                        continue
                    
                    visited.add((nx, ny))
                    
                    # ONLY check if line crosses any wall EDGE (not if inside polygon)
                    # Walls are just line boundaries at this stage
                    if not self.line_crosses_any_wall(px, py, npx, npy):
                        queue.append((nx, ny))
        
        print(f"DEBUG: Filled {len(filled_cells)} cells after {iterations} iterations")
        
        if not filled_cells:
            return []
        
        # Extract boundary points (cells with at least one empty neighbor)
        boundary_cells = set()
        for gx, gy in filled_cells:
            for dx, dy in [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (-1, 1), (1, -1), (-1, -1)]:
                if (gx + dx, gy + dy) not in filled_cells:
                    boundary_cells.add((gx, gy))
                    break
        
        print(f"DEBUG: Found {len(boundary_cells)} boundary cells")
        
        if not boundary_cells:
            return []
        
        # Convert boundary cells to points
        boundary_points = [Point(gx * grid_size, gy * grid_size) for gx, gy in boundary_cells]
        
        # Instead of convex hull, order the boundary points by tracing the perimeter
        ordered_boundary = self.order_boundary_points(boundary_cells, grid_size)
        
        print(f"DEBUG: Ordered boundary has {len(ordered_boundary)} vertices")
        
        return ordered_boundary if len(ordered_boundary) >= 3 else []
    
    def order_boundary_points(self, boundary_cells: set, grid_size: float) -> List[Point]:
        """Order boundary cells by tracing around the perimeter"""
        if not boundary_cells:
            return []
        
        # Convert to list
        cells = list(boundary_cells)
        
        # Start with leftmost, then topmost cell
        current = min(cells, key=lambda c: (c[0], c[1]))
        ordered = [current]
        remaining = set(cells)
        remaining.remove(current)
        
        # Trace around the boundary by finding the nearest unvisited neighbor
        while remaining:
            # Find nearest neighbor (8-directional)
            best_dist = float('inf')
            best_cell = None
            
            for cell in remaining:
                dx = cell[0] - current[0]
                dy = cell[1] - current[1]
                dist = dx*dx + dy*dy
                
                # Only consider adjacent cells (8-directional, distance <= 2)
                if dist <= 2 and dist < best_dist:
                    best_dist = dist
                    best_cell = cell
            
            if best_cell is None:
                # No adjacent cells found, jump to nearest
                best_cell = min(remaining, key=lambda c: (c[0] - current[0])**2 + (c[1] - current[1])**2)
            
            ordered.append(best_cell)
            remaining.remove(best_cell)
            current = best_cell
            
            # Safety check
            if len(ordered) > len(cells) * 2:
                break
        
        # Convert grid cells to actual points
        points = [Point(gx * grid_size, gy * grid_size) for gx, gy in ordered]
        
        # Simplify the path (remove points that are nearly collinear)
        simplified = self.simplify_polygon(points, tolerance=grid_size * 2)
        
        return simplified
    
    def simplify_polygon(self, points: List[Point], tolerance: float = 5.0) -> List[Point]:
        """Simplify polygon by removing nearly collinear points"""
        if len(points) < 3:
            return points
        
        simplified = [points[0]]
        
        for i in range(1, len(points) - 1):
            prev = simplified[-1]
            curr = points[i]
            next_pt = points[i + 1]
            
            # Calculate cross product to check if points are collinear
            dx1 = curr.x - prev.x
            dy1 = curr.y - prev.y
            dx2 = next_pt.x - curr.x
            dy2 = next_pt.y - curr.y
            
            cross = abs(dx1 * dy2 - dy1 * dx2)
            
            # Keep point if not collinear (cross product is large enough)
            if cross > tolerance:
                simplified.append(curr)
        
        # Always include the last point
        simplified.append(points[-1])
        
        return simplified
    
    def is_point_blocked(self, px: float, py: float) -> bool:
        """Check if a point is blocked by wall barriers"""
        # For now, walls define barriers (outlines), not filled areas
        # A point is blocked if it's inside any wall polygon
        for wall in self.walls:
            if self.point_in_polygon(px, py, wall.vertices):
                return True
        return False
    
    def line_crosses_any_wall(self, x1: float, y1: float, x2: float, y2: float) -> bool:
        """Check if a line segment crosses any wall edge"""
        for wall in self.walls:
            # Check each edge of the wall polygon
            vertices = wall.vertices
            for i in range(len(vertices)):
                v1 = vertices[i]
                v2 = vertices[(i + 1) % len(vertices)]
                
                # Check if line (x1,y1)-(x2,y2) intersects wall edge v1-v2
                if self.line_segments_intersect(x1, y1, x2, y2, v1.x, v1.y, v2.x, v2.y):
                    return True
        return False
    
    def line_segments_intersect(self, x1: float, y1: float, x2: float, y2: float, 
                                 x3: float, y3: float, x4: float, y4: float) -> bool:
        """Check if two line segments intersect"""
        # Calculate the direction of the lines
        denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
        
        if abs(denom) < 1e-10:  # Lines are parallel
            return False
        
        ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom
        ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom
        
        # Check if intersection point is on both line segments
        return 0 <= ua <= 1 and 0 <= ub <= 1
    
    def convex_hull(self, points: List[Point]) -> List[Point]:
        """Compute convex hull using gift wrapping algorithm"""
        if len(points) < 3:
            return points
        
        # Find leftmost point
        start = min(points, key=lambda p: (p.x, p.y))
        hull = []
        current = start
        
        while True:
            hull.append(current)
            next_point = points[0]
            
            for p in points[1:]:
                if p == current:
                    continue
                # Check if p is more counterclockwise than next_point
                cross = (next_point.x - current.x) * (p.y - current.y) - (next_point.y - current.y) * (p.x - current.x)
                if next_point == current or cross > 0:
                    next_point = p
            
            current = next_point
            if current == start:
                break
            
            if len(hull) > len(points):  # Safety check
                break
        
        return hull[:-1] if hull else []
        
    def select_zone_as_room(self, map_x: float, map_y: float):
        """Select a walkable zone and mark it as a room"""
        # Find zone at click position
        for zone in self.walkable_zones:
            if self.point_in_polygon(map_x, map_y, zone.vertices):
                if zone.is_room:
                    # Toggle off or rename
                    response = messagebox.askyesno("Room Exists", f"This is '{zone.room_name}'. Remove room designation?")
                    if response:
                        zone.is_room = False
                        zone.room_name = ""
                        self.save_state()
                        self.redraw_all()
                        self.update_status("Removed room designation")
                else:
                    # Mark as room
                    room_name = simpledialog.askstring("Room Name", "Enter room name:")
                    if room_name:
                        zone.is_room = True
                        zone.room_name = room_name
                        self.save_state()
                        self.redraw_all()
                        self.update_status(f"Marked zone as room: {room_name}")
                return
                
        self.update_status("No walkable zone found at click position")
        
    def cancel_drawing(self):
        """Cancel current drawing"""
        self.current_polygon = []
        self.selected_vent = None
        self.draw_mode = DrawMode.NONE
        self.mode_label.config(text="Mode: None")
        self.redraw_all()
        self.update_status("Cancelled")
        
    def place_vent(self, x: float, y: float):
        """Place a vent"""
        vent_id = f"vent_{self.vent_counter}"
        self.vent_counter += 1
        
        vent = Vent(id=vent_id, position=Point(x, y), connected_to=[])
        self.vents.append(vent)
        
        self.save_state()
        self.redraw_all()
        self.update_status(f"Placed {vent_id}")
        
    def link_vent(self, x: float, y: float):
        """Link two vents together"""
        # Find vent at click position
        clicked_vent = self.find_vent_at(x, y)
        
        if clicked_vent:
            if self.selected_vent is None:
                self.selected_vent = clicked_vent
                self.update_status(f"Selected {clicked_vent.id}, click another vent to link")
            else:
                # Link the vents
                if clicked_vent.id not in self.selected_vent.connected_to:
                    self.selected_vent.connected_to.append(clicked_vent.id)
                if self.selected_vent.id not in clicked_vent.connected_to:
                    clicked_vent.connected_to.append(self.selected_vent.id)
                    
                self.save_state()
                self.update_status(f"Linked {self.selected_vent.id} <-> {clicked_vent.id}")
                self.selected_vent = None
                self.redraw_all()
        else:
            self.update_status("No vent found at click position")
            
    def find_vent_at(self, x: float, y: float) -> Optional[Vent]:
        """Find vent at screen position"""
        display_scale = self.scale * self.zoom
        for vent in self.vents:
            vx = vent.position.x * display_scale
            vy = vent.position.y * display_scale
            if abs(vx - x) < 15 and abs(vy - y) < 15:
                return vent
        return None
        
    def place_door(self, x: float, y: float):
        """Place a door"""
        # Ask for orientation
        orientation = messagebox.askquestion("Door Orientation", "Is this door horizontal?")
        door_orientation = DoorOrientation.HORIZONTAL if orientation == "yes" else DoorOrientation.VERTICAL
        
        # Ask for room
        room_name = simpledialog.askstring("Door Room", "Enter room name for this door:")
        if room_name:
            door = Door(position=Point(x, y), orientation=door_orientation, room=room_name)
            self.doors.append(door)
            self.save_state()
            self.redraw_all()
            self.update_status(f"Placed door in {room_name}")
            
    def place_task(self, x: float, y: float):
        """Place a task point"""
        # Create task selection dialog
        task_dialog = tk.Toplevel(self.root)
        task_dialog.title("Select Task Type")
        task_dialog.geometry("300x400")
        
        selected_task = tk.StringVar()
        
        # List of tasks
        frame = ttk.Frame(task_dialog, padding=10)
        frame.pack(fill=tk.BOTH, expand=True)
        
        ttk.Label(frame, text="Select Task Type:", font=("Arial", 12, "bold")).pack(pady=5)
        
        listbox = tk.Listbox(frame, height=15)
        listbox.pack(fill=tk.BOTH, expand=True, pady=5)
        
        for task in TaskType:
            listbox.insert(tk.END, task.value)
            
        def on_select():
            selection = listbox.curselection()
            if selection:
                task_name = listbox.get(selection[0])
                # Find matching TaskType
                for task in TaskType:
                    if task.value == task_name:
                        room_name = simpledialog.askstring("Task Room", "Enter room name for this task:")
                        if room_name:
                            task_point = TaskPoint(task_type=task, position=Point(x, y), room=room_name)
                            self.tasks.append(task_point)
                            self.save_state()
                            self.redraw_all()
                            self.update_status(f"Placed {task.value} in {room_name}")
                        break
            task_dialog.destroy()
            
        ttk.Button(frame, text="Select", command=on_select).pack(pady=5)
        
    def place_camera(self, x: float, y: float):
        """Place a security camera"""
        # Ask for camera parameters
        direction = simpledialog.askfloat("Camera Direction", "Enter direction (degrees, 0=right):", initialvalue=0)
        vision_range = simpledialog.askfloat("Vision Range", "Enter vision range (units):", initialvalue=10.0)
        vision_angle = simpledialog.askfloat("Vision Angle", "Enter vision cone angle (degrees):", initialvalue=60.0)
        
        if direction is not None and vision_range and vision_angle:
            camera = Camera(
                position=Point(x, y),
                direction=direction,
                vision_range=vision_range,
                vision_angle=vision_angle
            )
            self.cameras.append(camera)
            self.save_state()
            self.redraw_all()
            self.update_status(f"Placed camera at ({x:.1f}, {y:.1f})")

    def place_obstacle(self, x: float, y: float):
        """Place an obstacle (e.g., table)"""
        # Create obstacle type selection dialog
        obstacle_dialog = tk.Toplevel(self.root)
        obstacle_dialog.title("Select Obstacle Type")
        obstacle_dialog.geometry("300x250")

        frame = ttk.Frame(obstacle_dialog, padding=10)
        frame.pack(fill=tk.BOTH, expand=True)

        ttk.Label(frame, text="Select Obstacle Type:", font=("Arial", 12, "bold")).pack(pady=5)

        listbox = tk.Listbox(frame, height=6)
        listbox.pack(fill=tk.BOTH, expand=True, pady=5)

        for obs_type in ObstacleType:
            listbox.insert(tk.END, obs_type.value.title())

        # Width and height inputs
        size_frame = ttk.Frame(frame)
        size_frame.pack(fill=tk.X, pady=5)

        ttk.Label(size_frame, text="Width:").pack(side=tk.LEFT)
        width_var = tk.StringVar(value="60")
        width_entry = ttk.Entry(size_frame, textvariable=width_var, width=8)
        width_entry.pack(side=tk.LEFT, padx=5)

        ttk.Label(size_frame, text="Height:").pack(side=tk.LEFT)
        height_var = tk.StringVar(value="60")
        height_entry = ttk.Entry(size_frame, textvariable=height_var, width=8)
        height_entry.pack(side=tk.LEFT, padx=5)

        def on_select():
            selection = listbox.curselection()
            if selection:
                type_name = listbox.get(selection[0]).lower()
                # Find matching ObstacleType
                for obs_type in ObstacleType:
                    if obs_type.value == type_name:
                        try:
                            width = float(width_var.get())
                            height = float(height_var.get())
                        except ValueError:
                            width = 60.0
                            height = 60.0

                        obstacle_id = f"obstacle_{self.obstacle_counter}"
                        self.obstacle_counter += 1

                        obstacle = Obstacle(
                            id=obstacle_id,
                            obstacle_type=obs_type,
                            position=Point(x, y),
                            width=width,
                            height=height
                        )
                        self.obstacles.append(obstacle)
                        self.save_state()
                        self.redraw_all()
                        self.update_status(f"Placed {obs_type.value} at ({x:.1f}, {y:.1f})")
                        break
            obstacle_dialog.destroy()

        ttk.Button(frame, text="Place", command=on_select).pack(pady=5)

    def place_emergency_button(self, x: float, y: float):
        """Place the emergency button (only one allowed)"""
        if self.emergency_button:
            response = messagebox.askyesno(
                "Emergency Button Exists",
                "An emergency button already exists. Replace it?"
            )
            if not response:
                return

        room_name = simpledialog.askstring(
            "Emergency Button Room",
            "Enter room name for emergency button:",
            initialvalue="Cafeteria"
        )

        if room_name:
            self.emergency_button = EmergencyButton(
                position=Point(x, y),
                room=room_name
            )
            self.save_state()
            self.redraw_all()
            self.update_status(f"Placed emergency button in {room_name}")

    def straighten_all_vectors(self):
        """Straighten all polygon vertices to nearest 90/45/30 degree angles"""
        import math
        
        def straighten_polygon(vertices: List[Point]) -> List[Point]:
            """Straighten a polygon's edges to clean angles"""
            if len(vertices) < 2:
                return vertices
                
            straightened = []
            
            for i in range(len(vertices)):
                current = vertices[i]
                
                if i == 0:
                    # Keep first point as anchor
                    straightened.append(Point(current.x, current.y))
                else:
                    prev = straightened[-1]
                    
                    # Calculate angle from previous point
                    dx = current.x - prev.x
                    dy = current.y - prev.y
                    
                    if abs(dx) < 0.1 and abs(dy) < 0.1:
                        # Points are too close, skip
                        continue
                    
                    distance = math.sqrt(dx * dx + dy * dy)
                    angle = math.degrees(math.atan2(dy, dx))
                    
                    # Snap to nearest clean angle (0, 30, 45, 90, 135, 150, 180, etc.)
                    clean_angles = [0, 30, 45, 60, 90, 120, 135, 150, 180, -30, -45, -60, -90, -120, -135, -150]
                    snapped_angle = min(clean_angles, key=lambda a: abs(angle - a))
                    
                    # Calculate new position based on snapped angle
                    rad = math.radians(snapped_angle)
                    new_x = prev.x + distance * math.cos(rad)
                    new_y = prev.y + distance * math.sin(rad)
                    
                    straightened.append(Point(new_x, new_y))
            
            return straightened if len(straightened) >= 3 else vertices
        
        # Straighten all walls
        for wall in self.walls:
            wall.vertices = straighten_polygon(wall.vertices)
            
        # Straighten all walkable zones
        for zone in self.walkable_zones:
            zone.vertices = straighten_polygon(zone.vertices)
        
        self.save_state()
        self.redraw_all()
        self.update_status("Straightened all vectors to clean angles")
        messagebox.showinfo("Straighten Complete", "All polygon edges have been snapped to 90°, 60°, 45°, and 30° angles.")
    
    def clear_all(self):
        """Clear all map elements"""
        if messagebox.askyesno("Clear All", "Are you sure you want to clear all elements?"):
            self.walls = []
            self.walkable_zones = []
            self.labeled_zones = []
            self.vents = []
            self.doors = []
            self.tasks = []
            self.cameras = []
            self.obstacles = []
            self.emergency_button = None
            self.current_polygon = []
            self.save_state()
            self.redraw_all()
            self.update_status("Cleared all elements")
            
    def save_state(self):
        """Save current state to history for undo/redo"""
        import copy

        # Remove any future states if we're not at the end
        if self.history_index < len(self.history) - 1:
            self.history = self.history[:self.history_index + 1]

        # Save current state
        state = {
            'walls': copy.deepcopy(self.walls),
            'walkable_zones': copy.deepcopy(self.walkable_zones),
            'labeled_zones': copy.deepcopy(self.labeled_zones),
            'vents': copy.deepcopy(self.vents),
            'doors': copy.deepcopy(self.doors),
            'tasks': copy.deepcopy(self.tasks),
            'cameras': copy.deepcopy(self.cameras),
            'obstacles': copy.deepcopy(self.obstacles),
            'emergency_button': copy.deepcopy(self.emergency_button),
            'vent_counter': self.vent_counter,
            'obstacle_counter': self.obstacle_counter
        }

        self.history.append(state)
        self.history_index += 1

        # Limit history size
        if len(self.history) > self.max_history:
            self.history.pop(0)
            self.history_index -= 1

    def undo(self):
        """Undo last action"""
        if self.history_index > 0:
            self.history_index -= 1
            self.restore_state(self.history[self.history_index])
            self.update_status(f"Undo - {self.history_index + 1}/{len(self.history)}")
        else:
            self.update_status("Nothing to undo")

    def redo(self):
        """Redo last undone action"""
        if self.history_index < len(self.history) - 1:
            self.history_index += 1
            self.restore_state(self.history[self.history_index])
            self.update_status(f"Redo - {self.history_index + 1}/{len(self.history)}")
        else:
            self.update_status("Nothing to redo")

    def restore_state(self, state):
        """Restore state from history"""
        import copy
        self.walls = copy.deepcopy(state['walls'])
        self.walkable_zones = copy.deepcopy(state['walkable_zones'])
        self.labeled_zones = copy.deepcopy(state.get('labeled_zones', []))
        self.vents = copy.deepcopy(state['vents'])
        self.doors = copy.deepcopy(state['doors'])
        self.tasks = copy.deepcopy(state['tasks'])
        self.cameras = copy.deepcopy(state['cameras'])
        self.obstacles = copy.deepcopy(state.get('obstacles', []))
        self.emergency_button = copy.deepcopy(state.get('emergency_button', None))
        self.vent_counter = state['vent_counter']
        self.obstacle_counter = state.get('obstacle_counter', 1)
        self.redraw_all()

    def delete_mode(self):
        """Enable delete mode"""
        self.draw_mode = DrawMode.NONE
        self.mode_label.config(text="Mode: Delete (Right-click or Middle-click)")
        self.update_status("Delete mode - Right-click or middle-click on element to delete")
        
    def delete_element_at(self, screen_x: float, screen_y: float):
        """Delete element at screen position"""
        x = self.canvas.canvasx(screen_x)
        y = self.canvas.canvasy(screen_y)
        
        display_scale = self.scale * self.zoom
        map_x = x / display_scale
        map_y = y / display_scale
        
        deleted = False
        
        # Check vents (highest priority - small targets)
        for i, vent in enumerate(self.vents):
            vx = vent.position.x * display_scale
            vy = vent.position.y * display_scale
            if abs(vx - x) < 15 and abs(vy - y) < 15:
                # Remove all connections to this vent
                vent_id = vent.id
                for other_vent in self.vents:
                    if vent_id in other_vent.connected_to:
                        other_vent.connected_to.remove(vent_id)
                
                self.vents.pop(i)
                self.save_state()
                self.redraw_all()
                self.update_status(f"Deleted {vent_id}")
                return
        
        # Check doors
        for i, door in enumerate(self.doors):
            dx = door.position.x * display_scale
            dy = door.position.y * display_scale
            if abs(dx - x) < 20 and abs(dy - y) < 20:
                self.doors.pop(i)
                deleted = True
                self.update_status(f"Deleted door")
                break
                
        # Check tasks
        if not deleted:
            for i, task in enumerate(self.tasks):
                tx = task.position.x * display_scale
                ty = task.position.y * display_scale
                if abs(tx - x) < 15 and abs(ty - y) < 15:
                    task_name = task.task_type.value
                    self.tasks.pop(i)
                    deleted = True
                    self.update_status(f"Deleted task: {task_name}")
                    break
                    
        # Check cameras
        if not deleted:
            for i, camera in enumerate(self.cameras):
                cx = camera.position.x * display_scale
                cy = camera.position.y * display_scale
                if abs(cx - x) < 15 and abs(cy - y) < 15:
                    self.cameras.pop(i)
                    deleted = True
                    self.update_status("Deleted camera")
                    break
        
        # Check walls
        if not deleted:
            for i, wall in enumerate(self.walls):
                if self.point_in_polygon(map_x, map_y, wall.vertices):
                    self.walls.pop(i)
                    deleted = True
                    self.update_status("Deleted wall")
                    break
                    
        # Check walkable zones
        if not deleted:
            for i, zone in enumerate(self.walkable_zones):
                if self.point_in_polygon(map_x, map_y, zone.vertices):
                    zone_name = zone.room_name if zone.is_room else "walkable zone"
                    self.walkable_zones.pop(i)
                    deleted = True
                    self.update_status(f"Deleted {zone_name}")
                    break

        # Check obstacles
        if not deleted:
            for i, obstacle in enumerate(self.obstacles):
                ox = obstacle.position.x * display_scale
                oy = obstacle.position.y * display_scale
                hw = (obstacle.width / 2) * display_scale
                hh = (obstacle.height / 2) * display_scale
                if abs(ox - x) < hw + 5 and abs(oy - y) < hh + 5:
                    self.obstacles.pop(i)
                    deleted = True
                    self.update_status(f"Deleted {obstacle.obstacle_type.value}")
                    break

        # Check emergency button
        if not deleted and self.emergency_button:
            bx = self.emergency_button.position.x * display_scale
            by = self.emergency_button.position.y * display_scale
            if abs(bx - x) < 20 and abs(by - y) < 20:
                self.emergency_button = None
                deleted = True
                self.update_status("Deleted emergency button")

        if deleted:
            self.save_state()
            self.redraw_all()
        else:
            self.update_status("No element found at click position")
            
    def point_in_polygon(self, x: float, y: float, vertices: List[Point]) -> bool:
        """Check if point is inside polygon using ray casting algorithm"""
        n = len(vertices)
        inside = False
        
        p1x, p1y = vertices[0].x, vertices[0].y
        for i in range(n + 1):
            p2x, p2y = vertices[i % n].x, vertices[i % n].y
            if y > min(p1y, p2y):
                if y <= max(p1y, p2y):
                    if x <= max(p1x, p2x):
                        if p1y != p2y:
                            xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                        if p1x == p2x or x <= xinters:
                            inside = not inside
            p1x, p1y = p2x, p2y
            
        return inside
            
    def redraw_all(self):
        """Redraw all map elements"""
        # Clear and redraw background
        if self.background_photo:
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, image=self.background_photo, anchor=tk.NW)
        
        # Calculate display scale (base scale * zoom)
        display_scale = self.scale * self.zoom
        
        # Draw walkable zones (semi-transparent, behind everything)
        for zone in self.walkable_zones:
            points = [(p.x * display_scale, p.y * display_scale) for p in zone.vertices]
            if len(points) >= 3:
                if zone.is_room:
                    # Room zones - cyan gradient with label
                    self.canvas.create_polygon(points, fill="#00ffff", outline="#00ffff", width=2, stipple="gray50", tags="room_zone")
                    cx = sum(p[0] for p in points) / len(points)
                    cy = sum(p[1] for p in points) / len(points)
                    self.canvas.create_text(cx, cy, text=zone.room_name, fill="#ffffff", font=("Arial", 14, "bold"), tags="room_zone")
                else:
                    # Regular walkable zones - green gradient pattern
                    self.canvas.create_polygon(points, fill="#00ff00", outline="#00ff00", width=2, stipple="gray25", tags="zone")
                
                # Draw holes (obstacles) as black filled polygons on top
                for hole in zone.holes:
                    hole_points = [(p.x * display_scale, p.y * display_scale) for p in hole]
                    if len(hole_points) >= 3:
                        self.canvas.create_polygon(hole_points, fill="#000000", outline="#ff0000", width=2, tags="hole")
        
        # Draw labeled zones (blue with labels)
        for labeled_zone in self.labeled_zones:
            points = [(p.x * display_scale, p.y * display_scale) for p in labeled_zone.vertices]
            if len(points) >= 3:
                # Blue semi-transparent zones with labels
                self.canvas.create_polygon(points, fill="#0000ff", outline="#0088ff", width=2, stipple="gray25", tags="labeled_zone")
                # Add label in center
                cx = sum(p[0] for p in points) / len(points)
                cy = sum(p[1] for p in points) / len(points)
                self.canvas.create_text(cx, cy, text=labeled_zone.name, fill="#ffffff", font=("Arial", 12, "bold"), tags="labeled_zone")
                
        # Draw walls/barriers (outline only, no fill)
        for wall in self.walls:
            points = [(p.x * display_scale, p.y * display_scale) for p in wall.vertices]
            if len(points) >= 3:
                self.canvas.create_polygon(points, fill="", outline="#ffffff", width=3, tags="wall")
                
        # Draw current polygon being drawn (magenta with vertex dots)
        if self.current_polygon:
            points = [(p.x * display_scale, p.y * display_scale) for p in self.current_polygon]
            if len(points) >= 2:
                self.canvas.create_line(points, fill="#ff00ff", width=3, tags="current")
            for i, (px, py) in enumerate(points):
                # Draw vertex with number
                self.canvas.create_oval(px-5, py-5, px+5, py+5, fill="#ff00ff", outline="#ffffff", width=2, tags="current")
                self.canvas.create_text(px, py-12, text=str(i+1), fill="#ffffff", font=("Arial", 10, "bold"), tags="current")
                
        # Draw vents
        for vent in self.vents:
            x = vent.position.x * display_scale
            y = vent.position.y * display_scale
            self.canvas.create_oval(x-10, y-10, x+10, y+10, fill="#ff6600", outline="#ffffff", width=2, tags="vent")
            self.canvas.create_text(x, y+15, text=vent.id, fill="#ffffff", font=("Arial", 8))
            
            # Draw connections
            for connected_id in vent.connected_to:
                connected_vent = next((v for v in self.vents if v.id == connected_id), None)
                if connected_vent:
                    cx = connected_vent.position.x * display_scale
                    cy = connected_vent.position.y * display_scale
                    self.canvas.create_line(x, y, cx, cy, fill="#ff6600", width=2, dash=(5, 5), tags="vent_link")
                    
        # Draw doors
        for door in self.doors:
            x = door.position.x * display_scale
            y = door.position.y * display_scale
            
            if door.orientation == DoorOrientation.HORIZONTAL:
                self.canvas.create_rectangle(x-15, y-3, x+15, y+3, fill="#brown", outline="#ffffff", width=2, tags="door")
            else:
                self.canvas.create_rectangle(x-3, y-15, x+3, y+15, fill="#brown", outline="#ffffff", width=2, tags="door")
                
        # Draw tasks
        for task in self.tasks:
            x = task.position.x * display_scale
            y = task.position.y * display_scale
            self.canvas.create_rectangle(x-8, y-8, x+8, y+8, fill="#ffff00", outline="#000000", width=2, tags="task")
            self.canvas.create_text(x, y+15, text=task.task_type.value[:10], fill="#ffff00", font=("Arial", 8))
            
        # Draw cameras
        for camera in self.cameras:
            x = camera.position.x * display_scale
            y = camera.position.y * display_scale
            
            # Camera icon
            self.canvas.create_oval(x-8, y-8, x+8, y+8, fill="#0099ff", outline="#ffffff", width=2, tags="camera")
            
            # Vision cone
            import math
            angle_rad = math.radians(camera.direction)
            cone_angle_rad = math.radians(camera.vision_angle / 2)
            range_scaled = camera.vision_range * display_scale
            
            # Vision cone arc
            start_angle = camera.direction - camera.vision_angle / 2
            self.canvas.create_arc(
                x - range_scaled, y - range_scaled,
                x + range_scaled, y + range_scaled,
                start=start_angle, extent=camera.vision_angle,
                fill="#0099ff33", outline="#0099ff", width=1,
                tags="camera_vision"
            )

        # Draw obstacles (tables, etc.) - larger rectangles
        for obstacle in self.obstacles:
            x = obstacle.position.x * display_scale
            y = obstacle.position.y * display_scale
            hw = (obstacle.width / 2) * display_scale  # half width
            hh = (obstacle.height / 2) * display_scale  # half height

            # Different colors for different obstacle types
            colors = {
                ObstacleType.TABLE: ("#8B4513", "#D2691E"),  # Brown/chocolate
                ObstacleType.CHAIR: ("#696969", "#808080"),  # Gray
                ObstacleType.CONSOLE: ("#2F4F4F", "#708090"),  # Dark slate
                ObstacleType.BED: ("#4B0082", "#6A5ACD"),  # Indigo/slate blue
            }
            fill_color, outline_color = colors.get(obstacle.obstacle_type, ("#8B4513", "#D2691E"))

            self.canvas.create_rectangle(
                x - hw, y - hh, x + hw, y + hh,
                fill=fill_color, outline=outline_color, width=3, tags="obstacle"
            )
            # Label
            self.canvas.create_text(
                x, y,
                text=obstacle.obstacle_type.value.title(),
                fill="#ffffff", font=("Arial", 9, "bold"), tags="obstacle"
            )
            self.canvas.create_text(
                x, y + hh + 10,
                text=obstacle.id,
                fill="#aaaaaa", font=("Arial", 7), tags="obstacle"
            )

        # Draw emergency button (red button with "!" mark)
        if self.emergency_button:
            x = self.emergency_button.position.x * display_scale
            y = self.emergency_button.position.y * display_scale

            # Outer ring (larger, glow effect)
            self.canvas.create_oval(
                x - 22, y - 22, x + 22, y + 22,
                fill="#880000", outline="#ff0000", width=3, tags="emergency_button"
            )
            # Inner button
            self.canvas.create_oval(
                x - 15, y - 15, x + 15, y + 15,
                fill="#ff0000", outline="#ffffff", width=2, tags="emergency_button"
            )
            # Exclamation mark
            self.canvas.create_text(
                x, y,
                text="!", fill="#ffffff", font=("Arial", 16, "bold"), tags="emergency_button"
            )
            # Label
            self.canvas.create_text(
                x, y + 28,
                text="EMERGENCY",
                fill="#ff0000", font=("Arial", 8, "bold"), tags="emergency_button"
            )

    def save_json(self):
        """Save map data to JSON"""
        if not self.image_path:
            messagebox.showwarning("No Image", "Please load a PNG image first")
            return
            
        filename = filedialog.asksaveasfilename(
            title="Save Map JSON",
            initialdir="./maps/json",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        
        if filename:
            try:
                # Build map data structure
                map_data = {
                    "metadata": {
                        "image": os.path.basename(self.image_path),
                        "version": "2.0"
                    },
                    "walls": [
                        {
                            "vertices": [{"x": p.x, "y": p.y} for p in wall.vertices],
                            "color": wall.color
                        }
                        for wall in self.walls
                    ],
                    "walkableZones": [
                        {
                            "vertices": [{"x": p.x, "y": p.y} for p in zone.vertices],
                            "isRoom": zone.is_room,
                            "roomName": zone.room_name,
                            "holes": [
                                [{"x": p.x, "y": p.y} for p in hole]
                                for hole in zone.holes
                            ]
                        }
                        for zone in self.walkable_zones
                    ],
                    "labeledZones": [
                        {
                            "vertices": [{"x": p.x, "y": p.y} for p in zone.vertices],
                            "name": zone.name
                        }
                        for zone in self.labeled_zones
                    ],
                    "vents": [
                        {
                            "id": vent.id,
                            "position": {"x": vent.position.x, "y": vent.position.y},
                            "connectedTo": vent.connected_to
                        }
                        for vent in self.vents
                    ],
                    "doors": [
                        {
                            "position": {"x": door.position.x, "y": door.position.y},
                            "orientation": door.orientation.value,
                            "room": door.room
                        }
                        for door in self.doors
                    ],
                    "tasks": [
                        {
                            "type": task.task_type.value,
                            "position": {"x": task.position.x, "y": task.position.y},
                            "room": task.room
                        }
                        for task in self.tasks
                    ],
                    "cameras": [
                        {
                            "position": {"x": cam.position.x, "y": cam.position.y},
                            "direction": cam.direction,
                            "visionRange": cam.vision_range,
                            "visionAngle": cam.vision_angle
                        }
                        for cam in self.cameras
                    ],
                    "obstacles": [
                        {
                            "id": obs.id,
                            "type": obs.obstacle_type.value,
                            "position": {"x": obs.position.x, "y": obs.position.y},
                            "width": obs.width,
                            "height": obs.height
                        }
                        for obs in self.obstacles
                    ],
                    "emergencyButton": {
                        "position": {"x": self.emergency_button.position.x, "y": self.emergency_button.position.y},
                        "room": self.emergency_button.room
                    } if self.emergency_button else None
                }
                
                with open(filename, 'w') as f:
                    json.dump(map_data, f, indent=2)
                    
                self.update_status(f"Saved: {os.path.basename(filename)}")
                messagebox.showinfo("Success", "Map saved successfully!")
                
            except Exception as e:
                messagebox.showerror("Error", f"Failed to save map: {e}")
                
    def load_json(self):
        """Load map data from JSON"""
        filename = filedialog.askopenfilename(
            title="Load Map JSON",
            initialdir="./maps/json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        
        if filename:
            try:
                with open(filename, 'r') as f:
                    map_data = json.load(f)
                    
                # Clear existing data
                self.clear_all()
                
                # Load image if specified
                if "metadata" in map_data and "image" in map_data["metadata"]:
                    image_name = map_data["metadata"]["image"]
                    image_path = os.path.join("./maps/pngs", image_name)
                    if os.path.exists(image_path):
                        self.image_path = image_path
                        self.background_image = Image.open(image_path)
                        self.display_background()
                
                # Load walls
                for wall_data in map_data.get("walls", []):
                    vertices = [Point(p["x"], p["y"]) for p in wall_data["vertices"]]
                    self.walls.append(Wall(
                        vertices=vertices,
                        color=wall_data.get("color", "#808080")
                    ))
                    
                # Load walkable zones
                for zone_data in map_data.get("walkableZones", []):
                    vertices = [Point(p["x"], p["y"]) for p in zone_data["vertices"]]
                    holes = []
                    if "holes" in zone_data:
                        holes = [
                            [Point(p["x"], p["y"]) for p in hole]
                            for hole in zone_data["holes"]
                        ]
                    self.walkable_zones.append(WalkableZone(
                        vertices=vertices,
                        is_room=zone_data.get("isRoom", False),
                        room_name=zone_data.get("roomName", ""),
                        holes=holes
                    ))
                
                # Load labeled zones
                for zone_data in map_data.get("labeledZones", []):
                    vertices = [Point(p["x"], p["y"]) for p in zone_data["vertices"]]
                    self.labeled_zones.append(LabeledZone(
                        vertices=vertices,
                        name=zone_data.get("name", "Unknown")
                    ))
                    
                # For backwards compatibility - convert old rooms/hallways/playerZones
                for room_data in map_data.get("rooms", []):
                    vertices = [Point(p["x"], p["y"]) for p in room_data["vertices"]]
                    self.walkable_zones.append(WalkableZone(
                        vertices=vertices,
                        is_room=True,
                        room_name=room_data["name"]
                    ))
                    
                for hall_data in map_data.get("hallways", []):
                    vertices = [Point(p["x"], p["y"]) for p in hall_data["vertices"]]
                    self.walls.append(Wall(vertices=vertices))
                    
                for zone_data in map_data.get("playerZones", []):
                    vertices = [Point(p["x"], p["y"]) for p in zone_data["vertices"]]
                    self.walkable_zones.append(WalkableZone(vertices=vertices))
                    
                # Load vents
                for vent_data in map_data.get("vents", []):
                    pos = vent_data["position"]
                    self.vents.append(Vent(
                        id=vent_data["id"],
                        position=Point(pos["x"], pos["y"]),
                        connected_to=vent_data.get("connectedTo", [])
                    ))
                    
                # Load doors
                for door_data in map_data.get("doors", []):
                    pos = door_data["position"]
                    orientation = DoorOrientation.HORIZONTAL if door_data["orientation"] == "horizontal" else DoorOrientation.VERTICAL
                    self.doors.append(Door(
                        position=Point(pos["x"], pos["y"]),
                        orientation=orientation,
                        room=door_data["room"]
                    ))
                    
                # Load tasks
                for task_data in map_data.get("tasks", []):
                    pos = task_data["position"]
                    # Find matching TaskType
                    task_type = next((t for t in TaskType if t.value == task_data["type"]), TaskType.SWIPE_CARD)
                    self.tasks.append(TaskPoint(
                        task_type=task_type,
                        position=Point(pos["x"], pos["y"]),
                        room=task_data["room"]
                    ))
                    
                # Load cameras
                for cam_data in map_data.get("cameras", []):
                    pos = cam_data["position"]
                    self.cameras.append(Camera(
                        position=Point(pos["x"], pos["y"]),
                        direction=cam_data["direction"],
                        vision_range=cam_data["visionRange"],
                        vision_angle=cam_data["visionAngle"]
                    ))

                # Load obstacles
                for obs_data in map_data.get("obstacles", []):
                    pos = obs_data["position"]
                    # Find matching ObstacleType
                    obs_type = next((t for t in ObstacleType if t.value == obs_data["type"]), ObstacleType.TABLE)
                    self.obstacles.append(Obstacle(
                        id=obs_data["id"],
                        obstacle_type=obs_type,
                        position=Point(pos["x"], pos["y"]),
                        width=obs_data.get("width", 60.0),
                        height=obs_data.get("height", 60.0)
                    ))

                # Update obstacle counter
                if self.obstacles:
                    max_id = max(int(obs.id.split('_')[-1]) for obs in self.obstacles if obs.id.startswith('obstacle_'))
                    self.obstacle_counter = max_id + 1

                # Load emergency button
                eb_data = map_data.get("emergencyButton")
                if eb_data:
                    pos = eb_data["position"]
                    self.emergency_button = EmergencyButton(
                        position=Point(pos["x"], pos["y"]),
                        room=eb_data.get("room", "Cafeteria")
                    )

                self.redraw_all()
                self.update_status(f"Loaded: {os.path.basename(filename)}")
                messagebox.showinfo("Success", "Map loaded successfully!")

            except Exception as e:
                messagebox.showerror("Error", f"Failed to load map: {e}")


def main():
    """Main entry point"""
    root = tk.Tk()
    app = MapEditor(root)
    root.mainloop()


if __name__ == "__main__":
    main()

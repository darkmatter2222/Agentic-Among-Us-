import type { Position } from '../types/game.types';

export interface VectorRoom {
  id: string;
  name: string;
  vertices: Position[]; // Polygon vertices for irregular room shapes
  color: string;
  center: Position;
  entrances: Position[];
  tasks: TaskLocation[];
  vents?: VentLocation[];
  isDeadEnd: boolean;
}

export interface VectorHallway {
  id: string;
  vertices: Position[];
  color: string;
  connects: string[]; // Room IDs this hallway connects
}

export interface TaskLocation {
  id: string;
  name: string;
  position: Position;
  type: 'short' | 'long' | 'common' | 'visual';
}

export interface VentLocation {
  id: string;
  position: Position;
  connectedTo: string[];
}

export interface DoorLocation {
  id: string;
  position: Position;
  orientation: 'horizontal' | 'vertical';
  rooms: string[]; // Rooms this door connects/blocks
}

// Scale: 1 unit = 20 pixels, map is approximately 60x40 units
// Using exact coordinates from the Among Us map

export const SKELD_VECTOR_ROOMS: VectorRoom[] = [
  {
    id: 'cafeteria',
    name: 'Cafeteria',
    vertices: [
      { x: 19, y: 14 },  // Top-left
      { x: 35, y: 14 },  // Top-right
      { x: 35, y: 16 },  // Right indent
      { x: 37, y: 16 },  // Right extension
      { x: 37, y: 24 },  // Bottom-right
      { x: 35, y: 24 },  // Bottom-right inner
      { x: 35, y: 26 },  // Bottom extension
      { x: 19, y: 26 },  // Bottom-left
      { x: 19, y: 24 },  // Left bottom indent
      { x: 17, y: 24 },  // Left extension
      { x: 17, y: 16 },  // Left top extension
      { x: 19, y: 16 }   // Back to top-left area
    ],
    color: '#3B5998',  // Distinctive blue
    center: { x: 27, y: 20 },
    entrances: [
      { x: 19, y: 20 },  // Left to Storage
      { x: 27, y: 14 },  // Top to Upper Corridor
      { x: 35, y: 20 },  // Right to Admin
      { x: 27, y: 26 }   // Bottom to MedBay
    ],
    tasks: [
      { id: 'caf_wiring', name: 'Fix Wiring', position: { x: 22, y: 18 }, type: 'common' },
      { id: 'caf_garbage', name: 'Empty Garbage', position: { x: 32, y: 22 }, type: 'short' },
      { id: 'caf_download', name: 'Download Data', position: { x: 29, y: 16 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_caf', position: { x: 31, y: 20 }, connectedTo: ['vent_admin', 'vent_hallway'] }
    ],
    isDeadEnd: false
  },
  {
    id: 'weapons',
    name: 'Weapons',
    vertices: [
      { x: 38, y: 6 },
      { x: 46, y: 6 },
      { x: 46, y: 8 },
      { x: 48, y: 8 },
      { x: 48, y: 14 },
      { x: 46, y: 14 },
      { x: 46, y: 16 },
      { x: 38, y: 16 },
      { x: 38, y: 14 },
      { x: 36, y: 14 },
      { x: 36, y: 8 },
      { x: 38, y: 8 }
    ],
    color: '#4169E1',  // Royal blue
    center: { x: 42, y: 11 },
    entrances: [
      { x: 38, y: 11 }  // Single entrance from corridor
    ],
    tasks: [
      { id: 'weapons_asteroids', name: 'Clear Asteroids', position: { x: 44, y: 11 }, type: 'visual' },
      { id: 'weapons_download', name: 'Download Data', position: { x: 40, y: 10 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_weapons', position: { x: 42, y: 13 }, connectedTo: ['vent_nav', 'vent_shields'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'o2',
    name: 'O2',
    vertices: [
      { x: 38, y: 18 },
      { x: 44, y: 18 },
      { x: 44, y: 20 },
      { x: 46, y: 20 },
      { x: 46, y: 26 },
      { x: 44, y: 26 },
      { x: 44, y: 28 },
      { x: 38, y: 28 },
      { x: 38, y: 26 },
      { x: 36, y: 26 },
      { x: 36, y: 20 },
      { x: 38, y: 20 }
    ],
    color: '#87CEEB',  // Sky blue
    center: { x: 41, y: 23 },
    entrances: [
      { x: 38, y: 23 }  // Single entrance from hallway
    ],
    tasks: [
      { id: 'o2_filter', name: 'Clean O2 Filter', position: { x: 42, y: 22 }, type: 'short' },
      { id: 'o2_garbage', name: 'Empty Garbage', position: { x: 40, y: 25 }, type: 'short' }
    ],
    isDeadEnd: true
  },
  {
    id: 'navigation',
    name: 'Navigation',
    vertices: [
      { x: 48, y: 14 },
      { x: 54, y: 14 },
      { x: 56, y: 16 },
      { x: 56, y: 22 },
      { x: 54, y: 24 },
      { x: 48, y: 24 },
      { x: 48, y: 22 },
      { x: 46, y: 22 },
      { x: 46, y: 16 },
      { x: 48, y: 16 }
    ],
    color: '#3B5998',
    center: { x: 51, y: 19 },
    entrances: [
      { x: 48, y: 19 },  // Left entrance from O2 corridor
      { x: 51, y: 24 }   // Bottom entrance to shields corridor
    ],
    tasks: [
      { id: 'nav_chart', name: 'Chart Course', position: { x: 52, y: 18 }, type: 'short' },
      { id: 'nav_steering', name: 'Stabilize Steering', position: { x: 50, y: 20 }, type: 'short' },
      { id: 'nav_download', name: 'Download Data', position: { x: 53, y: 21 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_nav', position: { x: 51, y: 21 }, connectedTo: ['vent_weapons', 'vent_shields'] }
    ],
    isDeadEnd: false
  },
  {
    id: 'shields',
    name: 'Shields',
    vertices: [
      { x: 48, y: 26 },
      { x: 54, y: 26 },
      { x: 54, y: 32 },
      { x: 48, y: 32 }
    ],
    color: '#FFD700',  // Gold
    center: { x: 51, y: 29 },
    entrances: [
      { x: 51, y: 26 }  // Single entrance from Navigation corridor
    ],
    tasks: [
      { id: 'shields_prime', name: 'Prime Shields', position: { x: 51, y: 29 }, type: 'visual' },
      { id: 'shields_power', name: 'Accept Power', position: { x: 49, y: 30 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_shields', position: { x: 52, y: 30 }, connectedTo: ['vent_nav', 'vent_weapons'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'communications',
    name: 'Communications',
    vertices: [
      { x: 36, y: 30 },
      { x: 44, y: 30 },
      { x: 44, y: 36 },
      { x: 36, y: 36 }
    ],
    color: '#87CEEB',
    center: { x: 40, y: 33 },
    entrances: [
      { x: 40, y: 30 }  // Single entrance from Storage
    ],
    tasks: [
      { id: 'comms_download', name: 'Download Data', position: { x: 40, y: 33 }, type: 'short' },
      { id: 'comms_power', name: 'Accept Power', position: { x: 38, y: 34 }, type: 'short' }
    ],
    isDeadEnd: true
  },
  {
    id: 'storage',
    name: 'Storage',
    vertices: [
      { x: 18, y: 26 },
      { x: 28, y: 26 },
      { x: 28, y: 28 },
      { x: 30, y: 28 },
      { x: 30, y: 34 },
      { x: 28, y: 34 },
      { x: 28, y: 36 },
      { x: 18, y: 36 },
      { x: 18, y: 34 },
      { x: 16, y: 34 },
      { x: 16, y: 28 },
      { x: 18, y: 28 }
    ],
    color: '#CD853F',  // Peru/brown
    center: { x: 23, y: 31 },
    entrances: [
      { x: 23, y: 26 },  // Top to Cafeteria
      { x: 30, y: 31 },  // Right to Admin corridor
      { x: 18, y: 31 },  // Left to Electrical corridor
      { x: 23, y: 36 }   // Bottom to Communications corridor
    ],
    tasks: [
      { id: 'storage_wiring', name: 'Fix Wiring', position: { x: 20, y: 30 }, type: 'common' },
      { id: 'storage_fuel1', name: 'Fuel Engines (Gas Can)', position: { x: 25, y: 32 }, type: 'long' },
      { id: 'storage_fuel2', name: 'Fuel Engines (Refuel)', position: { x: 26, y: 33 }, type: 'long' }
    ],
    isDeadEnd: false
  },
  {
    id: 'admin',
    name: 'Admin',
    vertices: [
      { x: 32, y: 18 },
      { x: 40, y: 18 },
      { x: 40, y: 20 },
      { x: 42, y: 20 },
      { x: 42, y: 26 },
      { x: 40, y: 26 },
      { x: 40, y: 28 },
      { x: 32, y: 28 },
      { x: 32, y: 26 },
      { x: 30, y: 26 },
      { x: 30, y: 20 },
      { x: 32, y: 20 }
    ],
    color: '#D2B48C',  // Tan
    center: { x: 36, y: 23 },
    entrances: [
      { x: 32, y: 23 },  // Left to Storage corridor
      { x: 36, y: 18 }   // Top to Cafeteria
    ],
    tasks: [
      { id: 'admin_swipe', name: 'Swipe Card', position: { x: 38, y: 24 }, type: 'common' },
      { id: 'admin_upload', name: 'Upload Data', position: { x: 34, y: 22 }, type: 'short' },
      { id: 'admin_wiring', name: 'Fix Wiring', position: { x: 36, y: 25 }, type: 'common' }
    ],
    vents: [
      { id: 'vent_admin', position: { x: 37, y: 24 }, connectedTo: ['vent_caf', 'vent_hallway'] }
    ],
    isDeadEnd: false
  },
  {
    id: 'electrical',
    name: 'Electrical',
    vertices: [
      { x: 10, y: 24 },
      { x: 16, y: 24 },
      { x: 16, y: 32 },
      { x: 10, y: 32 }
    ],
    color: '#FFD700',
    center: { x: 13, y: 28 },
    entrances: [
      { x: 16, y: 28 }  // Single entrance - MOST DANGEROUS
    ],
    tasks: [
      { id: 'elec_wiring', name: 'Fix Wiring', position: { x: 12, y: 26 }, type: 'common' },
      { id: 'elec_power', name: 'Divert Power', position: { x: 14, y: 29 }, type: 'short' },
      { id: 'elec_calibrate', name: 'Calibrate Distributor', position: { x: 11, y: 30 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_elec', position: { x: 13, y: 30 }, connectedTo: ['vent_medbay', 'vent_security'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'lower_engine',
    name: 'Lower Engine',
    vertices: [
      { x: 2, y: 22 },
      { x: 8, y: 22 },
      { x: 8, y: 30 },
      { x: 2, y: 30 }
    ],
    color: '#CD853F',
    center: { x: 5, y: 26 },
    entrances: [
      { x: 8, y: 26 }  // Single entrance from corridor
    ],
    tasks: [
      { id: 'lower_align', name: 'Align Engine Output', position: { x: 4, y: 27 }, type: 'short' },
      { id: 'lower_fuel', name: 'Fuel Engines', position: { x: 6, y: 25 }, type: 'long' },
      { id: 'lower_power', name: 'Accept Power', position: { x: 5, y: 28 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_lower', position: { x: 5, y: 28 }, connectedTo: ['vent_reactor', 'vent_upper'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'upper_engine',
    name: 'Upper Engine',
    vertices: [
      { x: 2, y: 10 },
      { x: 8, y: 10 },
      { x: 8, y: 18 },
      { x: 2, y: 18 }
    ],
    color: '#CD853F',
    center: { x: 5, y: 14 },
    entrances: [
      { x: 8, y: 14 }  // Single entrance from corridor
    ],
    tasks: [
      { id: 'upper_align', name: 'Align Engine Output', position: { x: 4, y: 13 }, type: 'short' },
      { id: 'upper_fuel', name: 'Fuel Engines', position: { x: 6, y: 15 }, type: 'long' },
      { id: 'upper_power', name: 'Accept Power', position: { x: 5, y: 12 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_upper', position: { x: 5, y: 12 }, connectedTo: ['vent_reactor', 'vent_lower'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'reactor',
    name: 'Reactor',
    vertices: [
      { x: 2, y: 18 },
      { x: 10, y: 18 },
      { x: 10, y: 22 },
      { x: 2, y: 22 }
    ],
    color: '#90EE90',  // Light green
    center: { x: 6, y: 20 },
    entrances: [
      { x: 10, y: 20 }  // Single entrance with decontamination
    ],
    tasks: [
      { id: 'reactor_start', name: 'Start Reactor', position: { x: 4, y: 20 }, type: 'long' },
      { id: 'reactor_manifolds', name: 'Unlock Manifolds', position: { x: 8, y: 20 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_reactor', position: { x: 6, y: 21 }, connectedTo: ['vent_upper', 'vent_lower'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'security',
    name: 'Security',
    vertices: [
      { x: 10, y: 14 },
      { x: 16, y: 14 },
      { x: 16, y: 18 },
      { x: 10, y: 18 }
    ],
    color: '#808080',  // Gray
    center: { x: 13, y: 16 },
    entrances: [
      { x: 16, y: 16 }  // Single entrance from corridor
    ],
    tasks: [
      { id: 'security_wiring', name: 'Fix Wiring', position: { x: 12, y: 16 }, type: 'common' },
      { id: 'security_power', name: 'Accept Power', position: { x: 14, y: 17 }, type: 'short' }
    ],
    vents: [
      { id: 'vent_security', position: { x: 13, y: 17 }, connectedTo: ['vent_medbay', 'vent_elec'] }
    ],
    isDeadEnd: true
  },
  {
    id: 'medbay',
    name: 'MedBay',
    vertices: [
      { x: 18, y: 8 },
      { x: 26, y: 8 },
      { x: 26, y: 14 },
      { x: 18, y: 14 }
    ],
    color: '#87CEEB',
    center: { x: 22, y: 11 },
    entrances: [
      { x: 22, y: 14 }  // Single entrance from Cafeteria
    ],
    tasks: [
      { id: 'medbay_scan', name: 'Submit Scan', position: { x: 20, y: 11 }, type: 'visual' },
      { id: 'medbay_sample', name: 'Inspect Sample', position: { x: 24, y: 11 }, type: 'long' }
    ],
    vents: [
      { id: 'vent_medbay', position: { x: 22, y: 12 }, connectedTo: ['vent_security', 'vent_elec'] }
    ],
    isDeadEnd: true
  }
];

export const SKELD_VECTOR_HALLWAYS: VectorHallway[] = [
  {
    id: 'upper_corridor',
    vertices: [
      { x: 16, y: 12 },  // Start from Security area
      { x: 38, y: 12 },  // Extend to Weapons
      { x: 38, y: 14 },  // Thickness
      { x: 16, y: 14 }   // Back
    ],
    color: '#4A4A4A',
    connects: ['security', 'medbay', 'cafeteria', 'weapons']
  },
  {
    id: 'left_vertical',
    vertices: [
      { x: 8, y: 14 },   // Upper Engine exit
      { x: 10, y: 14 },  // Width
      { x: 10, y: 26 },  // Down to Lower Engine
      { x: 8, y: 26 }    // Back
    ],
    color: '#4A4A4A',
    connects: ['upper_engine', 'reactor', 'lower_engine']
  },
  {
    id: 'bottom_corridor',
    vertices: [
      { x: 16, y: 28 },  // From Electrical
      { x: 44, y: 28 },  // To Shields area
      { x: 44, y: 30 },  // Thickness
      { x: 16, y: 30 }   // Back
    ],
    color: '#4A4A4A',
    connects: ['electrical', 'storage', 'admin', 'communications', 'shields']
  },
  {
    id: 'reactor_decontam',
    vertices: [
      { x: 10, y: 19 },  // Reactor exit
      { x: 12, y: 19 },  // Decontamination chamber
      { x: 12, y: 21 },  // Thickness
      { x: 10, y: 21 }   // Back
    ],
    color: '#90EE90',  // Green tint for decontamination
    connects: ['reactor', 'security']
  },
  {
    id: 'right_vertical',
    vertices: [
      { x: 44, y: 16 },  // From O2 area
      { x: 46, y: 16 },  // Width
      { x: 46, y: 26 },  // Down to Shields
      { x: 44, y: 26 }   // Back
    ],
    color: '#4A4A4A',
    connects: ['o2', 'navigation', 'shields']
  }
];

export const SKELD_VECTOR_DOORS: DoorLocation[] = [
  { id: 'door_upper_engine', position: { x: 8, y: 14 }, orientation: 'vertical', rooms: ['upper_engine', 'left_vertical'] },
  { id: 'door_lower_engine', position: { x: 8, y: 26 }, orientation: 'vertical', rooms: ['lower_engine', 'left_vertical'] },
  { id: 'door_security', position: { x: 16, y: 16 }, orientation: 'vertical', rooms: ['security', 'upper_corridor'] },
  { id: 'door_medbay', position: { x: 22, y: 14 }, orientation: 'horizontal', rooms: ['medbay', 'cafeteria'] },
  { id: 'door_electrical', position: { x: 16, y: 28 }, orientation: 'vertical', rooms: ['electrical', 'bottom_corridor'] },
  { id: 'door_storage_left', position: { x: 18, y: 31 }, orientation: 'vertical', rooms: ['storage', 'bottom_corridor'] },
  { id: 'door_storage_top', position: { x: 23, y: 26 }, orientation: 'horizontal', rooms: ['storage', 'cafeteria'] },
  { id: 'door_storage_bottom', position: { x: 23, y: 36 }, orientation: 'horizontal', rooms: ['storage', 'communications'] },
  { id: 'door_admin_left', position: { x: 32, y: 23 }, orientation: 'vertical', rooms: ['admin', 'bottom_corridor'] },
  { id: 'door_admin_top', position: { x: 36, y: 18 }, orientation: 'horizontal', rooms: ['admin', 'cafeteria'] },
  { id: 'door_communications', position: { x: 40, y: 30 }, orientation: 'horizontal', rooms: ['communications', 'storage'] },
  { id: 'door_weapons', position: { x: 38, y: 11 }, orientation: 'vertical', rooms: ['weapons', 'upper_corridor'] },
  { id: 'door_o2', position: { x: 38, y: 23 }, orientation: 'vertical', rooms: ['o2', 'right_vertical'] },
  { id: 'door_navigation_left', position: { x: 48, y: 19 }, orientation: 'vertical', rooms: ['navigation', 'right_vertical'] },
  { id: 'door_navigation_bottom', position: { x: 51, y: 24 }, orientation: 'horizontal', rooms: ['navigation', 'right_vertical'] },
  { id: 'door_shields', position: { x: 51, y: 26 }, orientation: 'horizontal', rooms: ['shields', 'right_vertical'] }
];

// Map outline for the spaceship shape
export const SKELD_OUTLINE: Position[] = [
  // Start from top-left engines area
  { x: 0, y: 8 },
  { x: 10, y: 8 },
  { x: 10, y: 10 },
  { x: 16, y: 10 },
  { x: 16, y: 12 },
  { x: 28, y: 12 },
  { x: 28, y: 6 },
  { x: 36, y: 6 },
  { x: 36, y: 4 },
  { x: 48, y: 4 },
  { x: 56, y: 14 },
  { x: 58, y: 20 },
  { x: 56, y: 26 },
  { x: 54, y: 34 },
  { x: 48, y: 36 },
  { x: 44, y: 38 },
  { x: 36, y: 38 },
  { x: 28, y: 38 },
  { x: 16, y: 38 },
  { x: 10, y: 34 },
  { x: 10, y: 32 },
  { x: 0, y: 32 },
  { x: 0, y: 8 }
];

export const CAMERA_POSITIONS = [
  { id: 'cam_nav', position: { x: 50, y: 16 }, angle: 225 },  // Navigation hallway
  { id: 'cam_admin', position: { x: 34, y: 20 }, angle: 180 }, // Admin hallway
  { id: 'cam_security', position: { x: 14, y: 14 }, angle: 90 }, // Security entrance
  { id: 'cam_medbay', position: { x: 22, y: 8 }, angle: 180 }  // MedBay hallway
];

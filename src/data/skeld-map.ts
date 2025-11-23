/**
 * The Skeld map data - Complete implementation
 * All 14 rooms, tasks, vents, walls, and strategic locations
 * Based on comprehensive Among Us mechanics research
 */

import type { Room, Vent, Task, Camera, Door, Wall } from '../types/game.types';
import { TaskType } from '../types/game.types';

// Map scale: 1 unit = ~20 pixels for rendering
// Total map dimensions: approximately 60x40 units

export const SKELD_ROOMS: Room[] = [
  // ========== CAFETERIA (Central Hub - Spawn Point) ==========
  {
    id: 'cafeteria',
    name: 'Cafeteria',
    position: { x: 18, y: 14 },
    width: 12,
    height: 9,
    tasks: [],
    vents: [
      {
        id: 'vent_cafeteria',
        position: { x: 23, y: 21 },
        connectedVents: ['vent_admin'],
        room: 'cafeteria'
      }
    ],
    entrances: [
      { x: 19, y: 17 }, // West to Storage
      { x: 28, y: 17 }, // East to Admin
      { x: 23, y: 14 }, // North to Weapons hallway
      { x: 21, y: 22 }, // South to Storage
      { x: 25, y: 22 }  // South-East to Admin
    ],
    walls: [
      { start: { x: 20, y: 15 }, end: { x: 28, y: 15 } },
      { start: { x: 28, y: 15 }, end: { x: 28, y: 22 } },
      { start: { x: 28, y: 22 }, end: { x: 20, y: 22 } },
      { start: { x: 20, y: 22 }, end: { x: 20, y: 15 } }
    ],
    isDeadEnd: false,
    isDangerous: false // Central, high traffic
  },

  // ========== WEAPONS ==========
  {
    id: 'weapons',
    name: 'Weapons',
    position: { x: 28, y: 2 },
    width: 7,
    height: 5,
    tasks: [],
    vents: [
      {
        id: 'vent_weapons',
        position: { x: 31, y: 5 },
        connectedVents: ['vent_navigation', 'vent_shields'],
        room: 'weapons'
      }
    ],
    entrances: [
      { x: 28, y: 4 } // West entrance
    ],
    walls: [
      { start: { x: 28, y: 2 }, end: { x: 35, y: 2 } },
      { start: { x: 35, y: 2 }, end: { x: 35, y: 7 } },
      { start: { x: 35, y: 7 }, end: { x: 28, y: 7 } },
      { start: { x: 28, y: 7 }, end: { x: 28, y: 2 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== O2 ==========
  {
    id: 'o2',
    name: 'O2',
    position: { x: 38, y: 10 },
    width: 6,
    height: 6,
    tasks: [],
    vents: [],
    entrances: [
      { x: 38, y: 12 } // West entrance from Navigation
    ],
    walls: [
      { start: { x: 38, y: 10 }, end: { x: 44, y: 10 } },
      { start: { x: 44, y: 10 }, end: { x: 44, y: 16 } },
      { start: { x: 44, y: 16 }, end: { x: 38, y: 16 } },
      { start: { x: 38, y: 16 }, end: { x: 38, y: 10 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== NAVIGATION ==========
  {
    id: 'navigation',
    name: 'Navigation',
    position: { x: 32, y: 9 },
    width: 6,
    height: 7,
    tasks: [],
    vents: [
      {
        id: 'vent_navigation',
        position: { x: 35, y: 13 },
        connectedVents: ['vent_weapons', 'vent_shields'],
        room: 'navigation'
      }
    ],
    entrances: [
      { x: 32, y: 12 }, // West to hallway
      { x: 38, y: 12 }  // East to O2
    ],
    walls: [
      { start: { x: 32, y: 9 }, end: { x: 38, y: 9 } },
      { start: { x: 38, y: 9 }, end: { x: 38, y: 16 } },
      { start: { x: 38, y: 16 }, end: { x: 32, y: 16 } },
      { start: { x: 32, y: 16 }, end: { x: 32, y: 9 } }
    ],
    isDeadEnd: false,
    isDangerous: true
  },

  // ========== SHIELDS ==========
  {
    id: 'shields',
    name: 'Shields',
    position: { x: 36, y: 3 },
    width: 5,
    height: 5,
    tasks: [],
    vents: [
      {
        id: 'vent_shields',
        position: { x: 38, y: 5 },
        connectedVents: ['vent_navigation', 'vent_weapons'],
        room: 'shields'
      }
    ],
    entrances: [
      { x: 36, y: 5 } // West entrance
    ],
    walls: [
      { start: { x: 36, y: 3 }, end: { x: 41, y: 3 } },
      { start: { x: 41, y: 3 }, end: { x: 41, y: 8 } },
      { start: { x: 41, y: 8 }, end: { x: 36, y: 8 } },
      { start: { x: 36, y: 8 }, end: { x: 36, y: 3 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== COMMUNICATIONS ==========
  {
    id: 'communications',
    name: 'Communications',
    position: { x: 28, y: 20 },
    width: 6,
    height: 5,
    tasks: [],
    vents: [],
    entrances: [
      { x: 28, y: 22 } // West entrance
    ],
    walls: [
      { start: { x: 28, y: 20 }, end: { x: 34, y: 20 } },
      { start: { x: 34, y: 20 }, end: { x: 34, y: 25 } },
      { start: { x: 34, y: 25 }, end: { x: 28, y: 25 } },
      { start: { x: 28, y: 25 }, end: { x: 28, y: 20 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== STORAGE ==========
  {
    id: 'storage',
    name: 'Storage',
    position: { x: 12, y: 19 },
    width: 8,
    height: 7,
    tasks: [],
    vents: [],
    entrances: [
      { x: 19, y: 21 }, // East to Cafeteria
      { x: 15, y: 19 }  // North to hallways
    ],
    walls: [
      { start: { x: 12, y: 19 }, end: { x: 20, y: 19 } },
      { start: { x: 20, y: 19 }, end: { x: 20, y: 26 } },
      { start: { x: 20, y: 26 }, end: { x: 12, y: 26 } },
      { start: { x: 12, y: 26 }, end: { x: 12, y: 19 } }
    ],
    isDeadEnd: false,
    isDangerous: false
  },

  // ========== ADMIN ==========
  {
    id: 'admin',
    name: 'Admin',
    position: { x: 28, y: 15 },
    width: 6,
    height: 5,
    tasks: [],
    vents: [
      {
        id: 'vent_admin',
        position: { x: 31, y: 18 },
        connectedVents: ['vent_cafeteria'],
        room: 'admin'
      }
    ],
    entrances: [
      { x: 28, y: 17 }, // West to Cafeteria
      { x: 34, y: 17 }  // East to hallway
    ],
    walls: [
      { start: { x: 28, y: 15 }, end: { x: 34, y: 15 } },
      { start: { x: 34, y: 15 }, end: { x: 34, y: 20 } },
      { start: { x: 34, y: 20 }, end: { x: 28, y: 20 } },
      { start: { x: 28, y: 20 }, end: { x: 28, y: 15 } }
    ],
    isDeadEnd: false,
    isDangerous: false
  },

  // ========== ELECTRICAL ==========
  {
    id: 'electrical',
    name: 'Electrical',
    position: { x: 12, y: 13 },
    width: 5,
    height: 6,
    tasks: [],
    vents: [
      {
        id: 'vent_electrical',
        position: { x: 14, y: 17 },
        connectedVents: ['vent_medbay', 'vent_security'],
        room: 'electrical'
      }
    ],
    entrances: [
      { x: 17, y: 15 } // East entrance (only one!)
    ],
    walls: [
      { start: { x: 12, y: 13 }, end: { x: 17, y: 13 } },
      { start: { x: 17, y: 13 }, end: { x: 17, y: 19 } },
      { start: { x: 17, y: 19 }, end: { x: 12, y: 19 } },
      { start: { x: 12, y: 19 }, end: { x: 12, y: 13 } }
    ],
    isDeadEnd: true,
    isDangerous: true // Most dangerous room - single entrance
  },

  // ========== LOWER ENGINE ==========
  {
    id: 'lower_engine',
    name: 'Lower Engine',
    position: { x: 2, y: 18 },
    width: 6,
    height: 6,
    tasks: [],
    vents: [
      {
        id: 'vent_lower_engine',
        position: { x: 5, y: 21 },
        connectedVents: ['vent_upper_engine', 'vent_reactor'],
        room: 'lower_engine'
      }
    ],
    entrances: [
      { x: 8, y: 20 } // East entrance
    ],
    walls: [
      { start: { x: 2, y: 18 }, end: { x: 8, y: 18 } },
      { start: { x: 8, y: 18 }, end: { x: 8, y: 24 } },
      { start: { x: 8, y: 24 }, end: { x: 2, y: 24 } },
      { start: { x: 2, y: 24 }, end: { x: 2, y: 18 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== UPPER ENGINE ==========
  {
    id: 'upper_engine',
    name: 'Upper Engine',
    position: { x: 2, y: 6 },
    width: 6,
    height: 6,
    tasks: [],
    vents: [
      {
        id: 'vent_upper_engine',
        position: { x: 5, y: 9 },
        connectedVents: ['vent_lower_engine', 'vent_reactor'],
        room: 'upper_engine'
      }
    ],
    entrances: [
      { x: 8, y: 8 } // East entrance (decontamination)
    ],
    walls: [
      { start: { x: 2, y: 6 }, end: { x: 8, y: 6 } },
      { start: { x: 8, y: 6 }, end: { x: 8, y: 12 } },
      { start: { x: 8, y: 12 }, end: { x: 2, y: 12 } },
      { start: { x: 2, y: 12 }, end: { x: 2, y: 6 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== SECURITY ==========
  {
    id: 'security',
    name: 'Security',
    position: { x: 10, y: 8 },
    width: 5,
    height: 5,
    tasks: [],
    vents: [
      {
        id: 'vent_security',
        position: { x: 12, y: 11 },
        connectedVents: ['vent_electrical', 'vent_medbay'],
        room: 'security'
      }
    ],
    entrances: [
      { x: 15, y: 10 } // East entrance
    ],
    walls: [
      { start: { x: 10, y: 8 }, end: { x: 15, y: 8 } },
      { start: { x: 15, y: 8 }, end: { x: 15, y: 13 } },
      { start: { x: 15, y: 13 }, end: { x: 10, y: 13 } },
      { start: { x: 10, y: 13 }, end: { x: 10, y: 8 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== REACTOR ==========
  {
    id: 'reactor',
    name: 'Reactor',
    position: { x: 2, y: 12 },
    width: 6,
    height: 6,
    tasks: [],
    vents: [
      {
        id: 'vent_reactor',
        position: { x: 5, y: 15 },
        connectedVents: ['vent_upper_engine', 'vent_lower_engine'],
        room: 'reactor'
      }
    ],
    entrances: [
      { x: 8, y: 14 } // East entrance (decontamination)
    ],
    walls: [
      { start: { x: 2, y: 12 }, end: { x: 8, y: 12 } },
      { start: { x: 8, y: 12 }, end: { x: 8, y: 18 } },
      { start: { x: 8, y: 18 }, end: { x: 2, y: 18 } },
      { start: { x: 2, y: 18 }, end: { x: 2, y: 12 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  },

  // ========== MEDBAY ==========
  {
    id: 'medbay',
    name: 'MedBay',
    position: { x: 18, y: 7 },
    width: 6,
    height: 5,
    tasks: [],
    vents: [
      {
        id: 'vent_medbay',
        position: { x: 21, y: 10 },
        connectedVents: ['vent_electrical', 'vent_security'],
        room: 'medbay'
      }
    ],
    entrances: [
      { x: 18, y: 9 } // South entrance
    ],
    walls: [
      { start: { x: 18, y: 7 }, end: { x: 24, y: 7 } },
      { start: { x: 24, y: 7 }, end: { x: 24, y: 12 } },
      { start: { x: 24, y: 12 }, end: { x: 18, y: 12 } },
      { start: { x: 18, y: 12 }, end: { x: 18, y: 7 } }
    ],
    isDeadEnd: true,
    isDangerous: true
  }
];

// Add tasks to rooms
export function initializeRoomTasks(): void {
  // CAFETERIA TASKS
  const cafeteria = SKELD_ROOMS.find(r => r.id === 'cafeteria')!;
  cafeteria.tasks = [
    {
      id: 'cafeteria_wiring',
      name: 'Fix Wiring',
      type: TaskType.COMMON,
      location: 'cafeteria',
      position: { x: 22, y: 18 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'cafeteria_garbage',
      name: 'Empty Garbage',
      type: TaskType.SHORT,
      location: 'cafeteria',
      position: { x: 26, y: 20 },
      duration: 2000,
      isVisual: false,
      isCompleted: false,
      isMultiStage: true,
      stages: [
        { location: 'cafeteria', duration: 2000, description: 'Pull lever' },
        { location: 'o2', duration: 2000, description: 'Empty garbage' }
      ]
    },
    {
      id: 'cafeteria_download',
      name: 'Download Data',
      type: TaskType.LONG,
      location: 'cafeteria',
      position: { x: 24, y: 16 },
      duration: 9000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // WEAPONS TASKS
  const weapons = SKELD_ROOMS.find(r => r.id === 'weapons')!;
  weapons.tasks = [
    {
      id: 'weapons_asteroids',
      name: 'Clear Asteroids',
      type: TaskType.VISUAL,
      location: 'weapons',
      position: { x: 32, y: 4 },
      duration: 20000,
      isVisual: true,
      isCompleted: false
    },
    {
      id: 'weapons_download',
      name: 'Download Data',
      type: TaskType.SHORT,
      location: 'weapons',
      position: { x: 30, y: 5 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // O2 TASKS
  const o2 = SKELD_ROOMS.find(r => r.id === 'o2')!;
  o2.tasks = [
    {
      id: 'o2_filter',
      name: 'Clean O2 Filter',
      type: TaskType.SHORT,
      location: 'o2',
      position: { x: 41, y: 12 },
      duration: 4000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'o2_garbage',
      name: 'Empty Garbage',
      type: TaskType.SHORT,
      location: 'o2',
      position: { x: 42, y: 14 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // NAVIGATION TASKS
  const navigation = SKELD_ROOMS.find(r => r.id === 'navigation')!;
  navigation.tasks = [
    {
      id: 'nav_chart',
      name: 'Chart Course',
      type: TaskType.SHORT,
      location: 'navigation',
      position: { x: 35, y: 11 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'nav_stabilize',
      name: 'Stabilize Steering',
      type: TaskType.SHORT,
      location: 'navigation',
      position: { x: 36, y: 13 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'nav_download',
      name: 'Download Data',
      type: TaskType.SHORT,
      location: 'navigation',
      position: { x: 34, y: 14 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // SHIELDS TASKS
  const shields = SKELD_ROOMS.find(r => r.id === 'shields')!;
  shields.tasks = [
    {
      id: 'shields_prime',
      name: 'Prime Shields',
      type: TaskType.VISUAL,
      location: 'shields',
      position: { x: 38, y: 6 },
      duration: 3000,
      isVisual: true,
      isCompleted: false
    },
    {
      id: 'shields_power',
      name: 'Accept Diverted Power',
      type: TaskType.SHORT,
      location: 'shields',
      position: { x: 39, y: 5 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // COMMUNICATIONS TASKS
  const comms = SKELD_ROOMS.find(r => r.id === 'communications')!;
  comms.tasks = [
    {
      id: 'comms_download',
      name: 'Download Data',
      type: TaskType.SHORT,
      location: 'communications',
      position: { x: 31, y: 22 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'comms_power',
      name: 'Accept Diverted Power',
      type: TaskType.SHORT,
      location: 'communications',
      position: { x: 32, y: 23 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // STORAGE TASKS
  const storage = SKELD_ROOMS.find(r => r.id === 'storage')!;
  storage.tasks = [
    {
      id: 'storage_wiring',
      name: 'Fix Wiring',
      type: TaskType.COMMON,
      location: 'storage',
      position: { x: 15, y: 22 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'storage_fuel',
      name: 'Fuel Engines',
      type: TaskType.LONG,
      location: 'storage',
      position: { x: 17, y: 24 },
      duration: 5000,
      isVisual: false,
      isCompleted: false,
      isMultiStage: true,
      stages: [
        { location: 'storage', duration: 2000, description: 'Fill gas can' },
        { location: 'upper_engine', duration: 2000, description: 'Fuel upper engine' },
        { location: 'storage', duration: 2000, description: 'Refill gas can' },
        { location: 'lower_engine', duration: 2000, description: 'Fuel lower engine' }
      ]
    }
  ];

  // ADMIN TASKS
  const admin = SKELD_ROOMS.find(r => r.id === 'admin')!;
  admin.tasks = [
    {
      id: 'admin_card',
      name: 'Swipe Card',
      type: TaskType.COMMON,
      location: 'admin',
      position: { x: 30, y: 17 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'admin_wiring',
      name: 'Fix Wiring',
      type: TaskType.COMMON,
      location: 'admin',
      position: { x: 32, y: 18 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'admin_upload',
      name: 'Upload Data',
      type: TaskType.SHORT,
      location: 'admin',
      position: { x: 31, y: 16 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // ELECTRICAL TASKS
  const electrical = SKELD_ROOMS.find(r => r.id === 'electrical')!;
  electrical.tasks = [
    {
      id: 'electrical_wiring',
      name: 'Fix Wiring',
      type: TaskType.COMMON,
      location: 'electrical',
      position: { x: 14, y: 15 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'electrical_divert_power',
      name: 'Divert Power',
      type: TaskType.SHORT,
      location: 'electrical',
      position: { x: 15, y: 17 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'electrical_calibrate',
      name: 'Calibrate Distributor',
      type: TaskType.SHORT,
      location: 'electrical',
      position: { x: 13, y: 16 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // LOWER ENGINE TASKS
  const lowerEngine = SKELD_ROOMS.find(r => r.id === 'lower_engine')!;
  lowerEngine.tasks = [
    {
      id: 'lower_engine_align',
      name: 'Align Engine Output',
      type: TaskType.SHORT,
      location: 'lower_engine',
      position: { x: 5, y: 20 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'lower_engine_power',
      name: 'Accept Diverted Power',
      type: TaskType.SHORT,
      location: 'lower_engine',
      position: { x: 6, y: 22 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // UPPER ENGINE TASKS
  const upperEngine = SKELD_ROOMS.find(r => r.id === 'upper_engine')!;
  upperEngine.tasks = [
    {
      id: 'upper_engine_align',
      name: 'Align Engine Output',
      type: TaskType.SHORT,
      location: 'upper_engine',
      position: { x: 5, y: 8 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'upper_engine_power',
      name: 'Accept Diverted Power',
      type: TaskType.SHORT,
      location: 'upper_engine',
      position: { x: 6, y: 10 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // SECURITY TASKS
  const security = SKELD_ROOMS.find(r => r.id === 'security')!;
  security.tasks = [
    {
      id: 'security_power',
      name: 'Accept Diverted Power',
      type: TaskType.SHORT,
      location: 'security',
      position: { x: 12, y: 10 },
      duration: 2000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'security_wiring',
      name: 'Fix Wiring',
      type: TaskType.COMMON,
      location: 'security',
      position: { x: 13, y: 11 },
      duration: 3000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // REACTOR TASKS
  const reactor = SKELD_ROOMS.find(r => r.id === 'reactor')!;
  reactor.tasks = [
    {
      id: 'reactor_start',
      name: 'Start Reactor',
      type: TaskType.LONG,
      location: 'reactor',
      position: { x: 5, y: 14 },
      duration: 10000,
      isVisual: false,
      isCompleted: false
    },
    {
      id: 'reactor_manifolds',
      name: 'Unlock Manifolds',
      type: TaskType.SHORT,
      location: 'reactor',
      position: { x: 6, y: 16 },
      duration: 4000,
      isVisual: false,
      isCompleted: false
    }
  ];

  // MEDBAY TASKS
  const medbay = SKELD_ROOMS.find(r => r.id === 'medbay')!;
  medbay.tasks = [
    {
      id: 'medbay_scan',
      name: 'Submit Scan',
      type: TaskType.VISUAL,
      location: 'medbay',
      position: { x: 21, y: 9 },
      duration: 10000,
      isVisual: true,
      isCompleted: false
    },
    {
      id: 'medbay_sample',
      name: 'Inspect Sample',
      type: TaskType.LONG,
      location: 'medbay',
      position: { x: 22, y: 10 },
      duration: 60000,
      isVisual: false,
      isCompleted: false
    }
  ];
}

// Camera locations
export const SKELD_CAMERAS: Camera[] = [
  {
    id: 'camera_nav',
    position: { x: 30, y: 12 },
    viewingAngle: 90,
    viewingDistance: 10,
    coverageArea: { x: 28, y: 9, width: 8, height: 8 },
    isActive: true
  },
  {
    id: 'camera_admin',
    position: { x: 34, y: 17 },
    viewingAngle: 90,
    viewingDistance: 8,
    coverageArea: { x: 28, y: 15, width: 8, height: 6 },
    isActive: true
  },
  {
    id: 'camera_security',
    position: { x: 15, y: 10 },
    viewingAngle: 90,
    viewingDistance: 8,
    coverageArea: { x: 10, y: 8, width: 8, height: 6 },
    isActive: true
  },
  {
    id: 'camera_medbay',
    position: { x: 18, y: 9 },
    viewingAngle: 90,
    viewingDistance: 8,
    coverageArea: { x: 15, y: 7, width: 8, height: 6 },
    isActive: true
  }
];

// Doors
export const SKELD_DOORS: Door[] = [
  // Cafeteria doors
  { id: 'door_caf_storage', position: { x: 19, y: 17 }, start: { x: 19, y: 16.5 }, end: { x: 19, y: 17.5 }, orientation: 'vertical', room1: 'cafeteria', room2: 'storage', isOpen: true, isSabotaged: false },
  { id: 'door_caf_admin', position: { x: 28, y: 17 }, start: { x: 28, y: 16.5 }, end: { x: 28, y: 17.5 }, orientation: 'vertical', room1: 'cafeteria', room2: 'admin', isOpen: true, isSabotaged: false },
  
  // Electrical door
  { id: 'door_electrical', position: { x: 17, y: 15 }, start: { x: 17, y: 14.5 }, end: { x: 17, y: 15.5 }, orientation: 'vertical', room1: 'electrical', room2: 'hallway', isOpen: true, isSabotaged: false },
  
  // Storage doors
  { id: 'door_storage_hall', position: { x: 15, y: 19 }, start: { x: 14.5, y: 19 }, end: { x: 15.5, y: 19 }, orientation: 'horizontal', room1: 'storage', room2: 'hallway', isOpen: true, isSabotaged: false },
  
  // MedBay door
  { id: 'door_medbay', position: { x: 18, y: 9 }, start: { x: 17.5, y: 9 }, end: { x: 18.5, y: 9 }, orientation: 'horizontal', room1: 'medbay', room2: 'hallway', isOpen: true, isSabotaged: false },
  
  // Security door
  { id: 'door_security', position: { x: 15, y: 10 }, start: { x: 15, y: 9.5 }, end: { x: 15, y: 10.5 }, orientation: 'vertical', room1: 'security', room2: 'hallway', isOpen: true, isSabotaged: false }
];

// Helper functions
export const getAllVents = (): Vent[] => {
  return SKELD_ROOMS.flatMap(room => room.vents);
};

export const getAllWalls = (): Wall[] => {
  return SKELD_ROOMS.flatMap(room => room.walls);
};

export const getAllTasks = (): Task[] => {
  return SKELD_ROOMS.flatMap(room => room.tasks);
};

export const getRoomById = (roomId: string): Room | undefined => {
  return SKELD_ROOMS.find(room => room.id === roomId);
};

export const getVentById = (ventId: string): Vent | undefined => {
  return getAllVents().find(vent => vent.id === ventId);
};

export const getTaskById = (taskId: string): Task | undefined => {
  return getAllTasks().find(task => task.id === taskId);
};

// Emergency button location (center of cafeteria table)
export const EMERGENCY_BUTTON_POSITION = { x: 24, y: 18 };

// Spawn locations for players
export const SPAWN_POSITIONS = [
  { x: 23, y: 18 },
  { x: 24, y: 19 },
  { x: 25, y: 18 },
  { x: 23, y: 17 },
  { x: 25, y: 17 },
  { x: 22, y: 18 },
  { x: 26, y: 18 },
  { x: 24, y: 20 }
];

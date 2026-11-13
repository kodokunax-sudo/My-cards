import * as THREE from 'three';
import { configureDynamicInstanceBuffer, queueInstanceBufferRange, flushInstanceBuffer } from './gpu-buffers.js';

export const SAVE_KEY = 'titan-survival-v1';
const NODE_COUNT = 500;
const RESPAWN_MS = 5 * 60 * 1000;
const TREE_HP = 12;
const STONE_HP = 12;
const FIBER_NODE_COUNT = 190;
const BRANCH_NODE_COUNT = 150;
const STICK_NODE_COUNT = 4000;
const LEAF_NODE_COUNT = 4000;
const SCRAP_NODE_COUNT = 52;
const IRON_ORE_NODE_COUNT = 28;

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }
  catch (error) { return null; }
}

function numberOrZero(value) {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber > 0 ? Math.floor(valueNumber) : 0;
}

export function createSurvival(scene, camera, canvas, world, player, hud, options = {}) {
  const mobileMode = options.mobile === true;
  const FIBER_NODE_COUNT = mobileMode ? 64 : 190;
  const BRANCH_NODE_COUNT = mobileMode ? 64 : 150;
  const STICK_NODE_COUNT = mobileMode ? 360 : 4000;
  const LEAF_NODE_COUNT = mobileMode ? 360 : 4000;
  const SCRAP_NODE_COUNT = mobileMode ? 24 : 52;
  const IRON_ORE_NODE_COUNT = mobileMode ? 12 : 28;
  const saved = options.initialSave && typeof options.initialSave === 'object'
    ? options.initialSave : loadSave();
  const inventory = {
    logs: 0, planks: 0, sticks: 0, stone: 0,
    branch: 0, fiber: 0, leaves: 0, sharpShard: 0, rope: 0, handle: 0,
    stoneWedge: 0, bark: 0, ironScrap: 0, ironOre: 0, ironIngot: 0, metalFastener: 0,
    woodAxe: false, woodPickaxe: false, stoneAxe: false, stonePickaxe: false,
    ironAxe: false, ironPickaxe: false,
  };
  const RESOURCE_IDS = [
    'logs', 'planks', 'sticks', 'stone',
    'branch', 'fiber', 'leaves', 'sharpShard', 'rope', 'handle',
    'stoneWedge', 'bark', 'ironScrap', 'ironOre', 'ironIngot', 'metalFastener',
  ];
  const TOOL_IDS = ['woodAxe', 'woodPickaxe', 'stoneAxe', 'stonePickaxe', 'ironAxe', 'ironPickaxe'];
  const STATION_OUTPUTS = ['fieldWorkplace', 'woodWorkshop', 'furnace', 'fullWorkbench'];
  const ITEM_IDS = [...RESOURCE_IDS, ...TOOL_IDS];
  const STACK_LIMIT = 64;

  function cleanStack(value) {
    if (!value || !ITEM_IDS.includes(value.id)) return null;
    const count = TOOL_IDS.includes(value.id) ? 1 : Math.max(0, Math.min(STACK_LIMIT, Math.floor(Number(value.count) || 0)));
    return count > 0 ? { id: value.id, count } : null;
  }

  function normalizeSlotArray(value, length) {
    return Array.from({ length }, (_, index) => cleanStack(Array.isArray(value) ? value[index] : null));
  }

  function makeLegacyInventorySlots() {
    const slots = Array(27).fill(null);
    let cursor = 0;
    const put = (id, rawCount) => {
      let remaining = TOOL_IDS.includes(id) ? (rawCount ? 1 : 0) : Math.max(0, Math.floor(Number(rawCount) || 0));
      while (remaining > 0 && cursor < slots.length) {
        const amount = TOOL_IDS.includes(id) ? 1 : Math.min(STACK_LIMIT, remaining);
        slots[cursor++] = { id, count: amount };
        remaining -= amount;
      }
    };
    const old = saved && saved.inventory ? saved.inventory : {};
    for (const id of RESOURCE_IDS) put(id, old[id]);
    for (const id of TOOL_IDS) put(id, old[id] ? 1 : 0);
    return slots;
  }

  let inventorySlots = Array.isArray(saved && saved.inventorySlots)
    ? normalizeSlotArray(saved.inventorySlots, 27)
    : makeLegacyInventorySlots();
  let hotbarSlots = normalizeSlotArray(saved && saved.hotbarSlots, 9);
  let craftingGrid = normalizeSlotArray(saved && saved.craftingGrid, 9);
  let selectedSlot = Number.isInteger(saved && saved.selectedSlot) && saved.selectedSlot >= 0 && saved.selectedSlot < 9
    ? saved.selectedSlot : 0;
  let selectedTool = 'hands';
  let selectedCell = null;

  function syncInventoryTotals() {
    for (const id of RESOURCE_IDS) inventory[id] = 0;
    for (const id of TOOL_IDS) inventory[id] = false;
    for (const stack of [...inventorySlots, ...hotbarSlots, ...craftingGrid]) {
      if (!stack) continue;
      if (RESOURCE_IDS.includes(stack.id)) inventory[stack.id] += stack.count;
      else if (TOOL_IDS.includes(stack.id)) inventory[stack.id] = true;
    }
    const active = hotbarSlots[selectedSlot];
    selectedTool = active && TOOL_IDS.includes(active.id) ? active.id : 'hands';
  }

  syncInventoryTotals();
  let workbench = saved && saved.workbench ? saved.workbench : null;
  let woodWorkshop = saved && saved.woodWorkshop ? saved.woodWorkshop : null;
  let furnace = saved && saved.furnace ? saved.furnace : null;
  let fullWorkbench = saved && saved.fullWorkbench ? saved.fullWorkbench : null;
  let workbenchGroup = null;
  let woodWorkshopGroup = null;
  let furnaceGroup = null;
  let fullWorkbenchGroup = null;
  let fiberNodes = [];
  let branchNodes = [];
  let stickNodes = [];
  let leafNodes = [];
  let scrapNodes = [];
  let ironOreNodes = [];

  const savedTreeIds = saved && Array.isArray(saved.depletedTrees) ? saved.depletedTrees : [];
  for (const entry of savedTreeIds) world.forests.removeById(entry);
  const savedRockIds = saved && Array.isArray(saved.depletedRocks) ? saved.depletedRocks : [];
  for (const entry of savedRockIds) world.rocks.removeById(entry);
  const savedShrubs = saved && Array.isArray(saved.depletedShrubs) ? saved.depletedShrubs : [];
  world.groundCover?.restoreDepleted?.(savedShrubs);
  const savedDamagedTrees = saved && Array.isArray(saved.damagedTrees) ? saved.damagedTrees : [];
  for (const entry of savedDamagedTrees) world.forests.setHealthById?.(entry);
  const savedDamagedRocks = saved && Array.isArray(saved.damagedRocks) ? saved.damagedRocks : [];
  for (const entry of savedDamagedRocks) world.rocks.setHealthById?.(entry);
  const savedDamagedShrubs = saved && Array.isArray(saved.damagedShrubs) ? saved.damagedShrubs : [];
  for (const entry of savedDamagedShrubs) world.groundCover?.setHealthById?.(entry);

  const nodes = saved && Array.isArray(saved.nodes) && saved.nodes.length === NODE_COUNT
    ? saved.nodes.map((node, id) => ({
      id,
      x: Number(node.x) || 0,
      z: Number(node.z) || 0,
      y: Number(node.y) || 0,
      size: THREE.MathUtils.clamp(Number(node.size) || 1, 0.7, 1.6),
      angle: Number(node.angle) || 0,
      active: node.active !== false,
      hp: numberOrZero(node.hp) || STONE_HP,
      due: numberOrZero(node.due),
    }))
    : Array.from({ length: NODE_COUNT }, (_, id) => ({
      id, x: 0, y: 0, z: 0, size: 1, angle: 0, active: false, hp: STONE_HP, due: 0,
    }));

  function save() {
    try {
      const session = typeof options.getSessionState === 'function'
        ? options.getSessionState() : (saved && saved.session) || null;
      const snapshot = {
        saveVersion: 3,
        savedAt: Date.now(),
        session,
        inventory,
        inventorySlots,
        hotbarSlots,
        craftingGrid,
        selectedTool,
        selectedSlot,
        depletedTrees: world.forests.depletedIds || world.forests.trees.filter((tree) => tree.removed).map((tree) => tree.id),
        depletedRocks: world.rocks.depletedIds || [],
        depletedShrubs: world.groundCover?.depletedIds || [],
        damagedTrees: world.forests.damagedTrees || [],
        damagedRocks: world.rocks.damagedIds || [],
        damagedShrubs: world.groundCover?.damagedIds || [],
        nodes: nodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        workbench,
        woodWorkshop,
        furnace,
        fullWorkbench,
        fiberNodes: fiberNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        branchNodes: branchNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        stickNodes: stickNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        leafNodes: leafNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        scrapNodes: scrapNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          type: node.type, active: node.active, hp: node.hp, due: node.due,
        })),
        ironOreNodes: ironOreNodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
      };

      const serialized = JSON.stringify(snapshot);
      let localSaved = false;
      try {
        localStorage.setItem(SAVE_KEY, serialized);
        localSaved = true;
      } catch (storageError) {
        // IndexedDB below can still keep the full save if localStorage is full or disabled.
      }

      let indexedSaveQueued = false;
      if (typeof options.onSave === 'function') {
        try {
          const pending = options.onSave(snapshot);
          indexedSaveQueued = true;
          Promise.resolve(pending).catch((error) => {
            if (!localSaved) options.onSaveError?.(error);
          });
        } catch (error) {
          if (!localSaved) options.onSaveError?.(error);
        }
      }
      return localSaved || indexedSaveQueued;
    } catch (error) {
      // Storage is optional; the current session remains playable without it.
      return false;
    }
  }

  function findNodePosition(index, oldPosition) {
    for (let attempt = 0; attempt < 6500; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(340 * 340 + Math.random() * (5300 * 5300 - 340 * 340));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!world.canSpawnResourceAt(x, z, 10) || resourcePositionCrowded(x, z)) continue;
      if (oldPosition && Math.hypot(x - oldPosition.x, z - oldPosition.z) < 75) continue;
      let crowded = false;
      for (const other of nodes) {
        if (other.id === index || !other.active) continue;
        if (Math.hypot(x - other.x, z - other.z) < 24) { crowded = true; break; }
      }
      if (crowded) continue;
      const y = world.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      return { x, y, z, size: 0.78 + Math.random() * 0.72, angle: Math.random() * Math.PI * 2 };
    }
    return null;
  }

  // Validate saved deposits once, then fill missing slots with one shared
  // candidate search. The previous implementation could perform up to
  // 500 × 6,500 expensive world checks during a new game.
  for (const node of nodes) {
    if (node.active && !world.canSpawnResourceAt(node.x, node.z, 4)) {
      node.active = false;
      node.due = Date.now() + 15000;
    }
  }

  const occupiedCells = new Map();
  const NODE_SPACING = 24;
  const nodeCellKey = (x, z) => `${Math.floor(x / NODE_SPACING)},${Math.floor(z / NODE_SPACING)}`;
  function markOccupied(node) {
    const key = nodeCellKey(node.x, node.z);
    let cell = occupiedCells.get(key);
    if (!cell) { cell = []; occupiedCells.set(key, cell); }
    cell.push(node);
  }
  for (const node of nodes) if (node.active) markOccupied(node);

  function isCrowded(x, z) {
    const gx = Math.floor(x / NODE_SPACING);
    const gz = Math.floor(z / NODE_SPACING);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = occupiedCells.get(`${gx + dx},${gz + dz}`);
        if (!cell) continue;
        for (const other of cell) {
          if (Math.hypot(x - other.x, z - other.z) < NODE_SPACING) return true;
        }
      }
    }
    return false;
  }

  let placedNodes = nodes.filter((node) => node.active).length;
  let nextNodeIndex = 0;
  const searchLimit = 18000;
  for (let attempt = 0; attempt < searchLimit && placedNodes < NODE_COUNT; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(340 * 340 + Math.random() * (5300 * 5300 - 340 * 340));
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!world.canSpawnResourceAt(x, z, 10) || isCrowded(x, z)) continue;
    const y = world.heightAt(x, z);
    if (!Number.isFinite(y)) continue;

    while (nextNodeIndex < NODE_COUNT &&
      (nodes[nextNodeIndex].active || nodes[nextNodeIndex].due > Date.now())) nextNodeIndex++;
    if (nextNodeIndex >= NODE_COUNT) break;
    const node = nodes[nextNodeIndex];
    Object.assign(node, {
      x, y, z,
      size: 0.78 + Math.random() * 0.72,
      angle: Math.random() * Math.PI * 2,
      active: true,
      hp: STONE_HP,
      due: 0,
    });
    markOccupied(node);
    placedNodes++;
    nextNodeIndex++;
  }

  if (placedNodes < NODE_COUNT) {
    console.warn(`[Survival] Created ${placedNodes}/${NODE_COUNT} stone deposits; remaining slots will retry later.`);
  }

  const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, flatShading: true });
  const stoneMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.9, 1), stoneMaterial, NODE_COUNT);
  configureDynamicInstanceBuffer(stoneMesh);
  stoneMesh.name = 'survival-mineable-stones';
  stoneMesh.userData.noCollider = true;
  stoneMesh.userData.stoneNodes = nodes;
  const stoneColors = [0x77776f, 0x88877d, 0x686b6d, 0x999286, 0x747b80].map((value) => new THREE.Color(value));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  function writeNode(node) {
    if (!node.active) {
      matrix.makeScale(0, 0, 0);
    } else {
      rotation.setFromAxisAngle(up, node.angle);
      position.set(node.x, node.y + node.size * 0.56, node.z);
      scale.set(node.size * 1.08, node.size * 0.78, node.size);
      matrix.compose(position, rotation, scale);
      stoneMesh.setColorAt(node.id, stoneColors[node.id % stoneColors.length]);
    }
    stoneMesh.setMatrixAt(node.id, matrix);
  }

  for (const node of nodes) writeNode(node);
  stoneMesh.instanceMatrix.needsUpdate = true;
  if (stoneMesh.instanceColor) stoneMesh.instanceColor.needsUpdate = true;
  stoneMesh.computeBoundingSphere();
  scene.add(stoneMesh);

  // Loose branches and fiber-bearing shrubs are separate, collectible world resources.
  // Their positions and cooldowns are saved, just like stone deposits.
  const RESOURCE_CELL_SIZE = 22;
  const resourceCells = new Map();
  const resourceCellKey = (x, z) => `${Math.floor(x / RESOURCE_CELL_SIZE)},${Math.floor(z / RESOURCE_CELL_SIZE)}`;
  function markResourcePosition(node) {
    const key = resourceCellKey(node.x, node.z);
    let cell = resourceCells.get(key);
    if (!cell) { cell = []; resourceCells.set(key, cell); }
    if (!cell.includes(node)) cell.push(node);
  }
  function unmarkResourcePosition(node) {
    const key = resourceCellKey(node.x, node.z);
    const cell = resourceCells.get(key);
    if (!cell) return;
    const index = cell.indexOf(node);
    if (index >= 0) cell.splice(index, 1);
    if (!cell.length) resourceCells.delete(key);
  }
  function resourcePositionCrowded(x, z, minDistance = 17) {
    const gx = Math.floor(x / RESOURCE_CELL_SIZE);
    const gz = Math.floor(z / RESOURCE_CELL_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = resourceCells.get(`${gx + dx},${gz + dz}`);
        if (!cell) continue;
        for (const other of cell) {
          if (Math.hypot(x - other.x, z - other.z) < minDistance) return true;
        }
      }
    }
    return false;
  }
  for (const node of nodes) if (node.active) markResourcePosition(node);

  const resourceOrigin = { x: camera.position.x, z: camera.position.z };
  function findGatherPosition(oldPosition, clearance) {
    for (let attempt = 0; attempt < 9000; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(220 * 220 + Math.random() * (2800 * 2800 - 220 * 220));
      const x = resourceOrigin.x + Math.cos(angle) * radius;
      const z = resourceOrigin.z + Math.sin(angle) * radius;
      if (!world.canSpawnResourceAt(x, z, clearance) || resourcePositionCrowded(x, z)) continue;
      if (oldPosition && Math.hypot(x - oldPosition.x, z - oldPosition.z) < 55) continue;
      const y = world.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      return { x, y, z, size: 0.82 + Math.random() * 0.42, angle: Math.random() * Math.PI * 2 };
    }
    return null;
  }

  function findTreeGatherPosition(oldPosition) {
    const treePool = world.forests.trees;
    if (!treePool || !treePool.length) return null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const tree = treePool[Math.floor(Math.random() * treePool.length)];
      if (!tree || tree.removed) continue;
      const angle = Math.random() * Math.PI * 2;
      const radius = (tree.radius || 0.48) + 2.8 + Math.random() * 15;
      const x = tree.x + Math.cos(angle) * radius;
      const z = tree.z + Math.sin(angle) * radius;
      if (!world.canSpawnResourceAt(x, z, 1.4)) continue;
      if (!world.forests.isNearTree(x, z, 22)) continue;
      if (resourcePositionCrowded(x, z, 4.6)) continue;
      if (oldPosition && Math.hypot(x - oldPosition.x, z - oldPosition.z) < 22) continue;
      const y = world.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      return { x, y, z, size: 0.62 + Math.random() * 0.38, angle: Math.random() * Math.PI * 2 };
    }
    return null;
  }

  function initializeGatherNodes(rawNodes, count, clearance, nearTree = false) {
    // Preserve the overlapping part of saves when switching device profiles.
    const source = Array.isArray(rawNodes) ? rawNodes.slice(0, count) : null;
    const list = Array.from({ length: count }, (_, id) => {
      const raw = source && source[id] ? source[id] : {};
      return {
        id,
        x: Number(raw.x) || 0,
        y: Number(raw.y) || 0,
        z: Number(raw.z) || 0,
        size: THREE.MathUtils.clamp(Number(raw.size) || 1, 0.65, 1.5),
        angle: Number(raw.angle) || 0,
        active: raw.active === true,
        hp: 1,
        due: numberOrZero(raw.due),
      };
    });

    const now = Date.now();
    const spacing = nearTree ? 4.6 : 17;
    const valid = node => world.canSpawnResourceAt(node.x, node.z, nearTree ? 1.4 : clearance) &&
      (!nearTree || world.forests.isNearTree(node.x, node.z, 22));
    const findPosition = () => nearTree ? findTreeGatherPosition(null) : findGatherPosition(null, clearance);
    for (const node of list) {
      if (!node.active) continue;
      if (!valid(node) || resourcePositionCrowded(node.x, node.z, spacing)) {
        node.active = false; node.due = now + 15000;
      } else markResourcePosition(node);
    }
    for (const node of list) {
      if (node.active || (node.due && node.due > now)) continue;
      const position = findPosition();
      if (!position) { node.due = now + 15000; continue; }
      Object.assign(node, position, { active: true, hp: 1, due: 0 });
      markResourcePosition(node);
    }
    return list;
  }

  fiberNodes = initializeGatherNodes(saved && saved.fiberNodes, FIBER_NODE_COUNT, 7);
  branchNodes = initializeGatherNodes(saved && saved.branchNodes, BRANCH_NODE_COUNT, 5);
  stickNodes = initializeGatherNodes(saved && saved.stickNodes, STICK_NODE_COUNT, 1.4, true);
  leafNodes = initializeGatherNodes(saved && saved.leafNodes, LEAF_NODE_COUNT, 1.4, true);

  function initializeMetalNodes(rawNodes, count, isOre) {
    // Preserve the overlapping part of saves when switching device profiles.
    const source = Array.isArray(rawNodes) ? rawNodes.slice(0, count) : null;
    const list = Array.from({ length: count }, (_, id) => {
      const raw = source && source[id] ? source[id] : {};
      return {
        id,
        x: Number(raw.x) || 0,
        y: Number(raw.y) || 0,
        z: Number(raw.z) || 0,
        size: THREE.MathUtils.clamp(Number(raw.size) || 1, 0.7, 1.45),
        angle: Number(raw.angle) || 0,
        type: isOre ? 0 : (Number.isInteger(raw.type) ? THREE.MathUtils.clamp(raw.type, 0, 3) : Math.min(3, Math.floor(id / (count / 4)))),
        active: raw.active === true,
        hp: numberOrZero(raw.hp) || (isOre ? 18 : 6),
        due: numberOrZero(raw.due),
      };
    });
    const now = Date.now();
    for (const node of list) {
      if (!node.active) continue;
      if (!world.canSpawnResourceAt(node.x, node.z, isOre ? 11 : 9) || resourcePositionCrowded(node.x, node.z)) {
        node.active = false;
        node.due = now + 15000;
      } else {
        markResourcePosition(node);
      }
    }
    for (const node of list) {
      if (node.active || (node.due && node.due > now)) continue;
      const position = findGatherPosition(null, isOre ? 11 : 9);
      if (!position) {
        node.due = now + 15000;
        continue;
      }
      Object.assign(node, position, { active: true, hp: isOre ? 18 : 6, due: 0 });
      markResourcePosition(node);
    }
    return list;
  }

  scrapNodes = initializeMetalNodes(saved && saved.scrapNodes, SCRAP_NODE_COUNT, false);
  ironOreNodes = initializeMetalNodes(saved && saved.ironOreNodes, IRON_ORE_NODE_COUNT, true);

  const fiberMaterial = new THREE.MeshStandardMaterial({
    color: 0x527b3f, roughness: 1, flatShading: true,
  });
  const branchMaterial = new THREE.MeshStandardMaterial({
    color: 0x805534, roughness: 1, flatShading: true,
  });
  const stickMaterial = new THREE.MeshStandardMaterial({ color: 0x987047, roughness: 1, flatShading: true });
  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x6d8741, roughness: 1, flatShading: true });
  const fiberMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.75, 0), fiberMaterial, FIBER_NODE_COUNT
  );
  fiberMesh.name = 'survival-gatherable-fiber-shrubs';
  fiberMesh.userData.noCollider = true;
  const branchMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.075, 0.12, 1.45, 5), branchMaterial, BRANCH_NODE_COUNT
  );
  branchMesh.name = 'survival-gatherable-branches';
  branchMesh.userData.noCollider = true;
  const stickMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.045, 0.065, 0.88, 5), stickMaterial, STICK_NODE_COUNT
  );
  stickMesh.name = 'survival-tree-side-sticks';
  stickMesh.userData.noCollider = true;
  const leafMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 7, 4), leafMaterial, LEAF_NODE_COUNT
  );
  leafMesh.name = 'survival-tree-side-leaves';
  leafMesh.userData.noCollider = true;
  for (const mesh of [fiberMesh, branchMesh, stickMesh, leafMesh]) configureDynamicInstanceBuffer(mesh);
  const branchTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));

  function writeGatherNode(node, mesh, isBranch, isLeaf = false, queueBufferUpdate = false) {
    if (!node.active) {
      matrix.makeScale(0, 0, 0);
    } else {
      rotation.setFromAxisAngle(up, node.angle);
      if (isBranch) rotation.multiply(branchTilt);
      position.set(node.x, node.y + (isLeaf ? 0.045 : isBranch ? 0.12 : 0.52), node.z);
      if (isLeaf) scale.set(node.size * 0.96, node.size * 0.18, node.size * 0.62);
      else scale.set(node.size * (isBranch ? 0.82 : 1.28), node.size * (isBranch ? 0.82 : 0.84), node.size * (isBranch ? 1.35 : 1.08));
      matrix.compose(position, rotation, scale);
    }
    mesh.setMatrixAt(node.id, matrix);
    if (queueBufferUpdate) queueInstanceBufferRange(mesh, node.id);
  }
  for (const node of fiberNodes) writeGatherNode(node, fiberMesh, false);
  for (const node of branchNodes) writeGatherNode(node, branchMesh, true);
  for (const node of stickNodes) writeGatherNode(node, stickMesh, true);
  for (const node of leafNodes) writeGatherNode(node, leafMesh, false, true);
  for (const mesh of [fiberMesh, branchMesh, stickMesh, leafMesh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  scene.add(fiberMesh, branchMesh, stickMesh, leafMesh);

  const scrapTypeNames = ['barrel', 'crate', 'equipment', 'fence'];
  const scrapGeometries = [
    new THREE.CylinderGeometry(0.42, 0.48, 1.12, 10),
    new THREE.BoxGeometry(0.92, 0.82, 0.82),
    new THREE.BoxGeometry(0.92, 0.58, 0.66),
    new THREE.BoxGeometry(1.82, 0.10, 0.13),
  ];
  const scrapMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x84533a, roughness: 0.98, metalness: 0.18 }),
    new THREE.MeshStandardMaterial({ color: 0x6d6258, roughness: 0.96, metalness: 0.24 }),
    new THREE.MeshStandardMaterial({ color: 0x74736c, roughness: 0.94, metalness: 0.32 }),
    new THREE.MeshStandardMaterial({ color: 0x69533f, roughness: 0.97, metalness: 0.16 }),
  ];
  const scrapMeshes = scrapGeometries.map((geometry, type) => {
    const mesh = new THREE.InstancedMesh(geometry, scrapMaterials[type], SCRAP_NODE_COUNT);
    configureDynamicInstanceBuffer(mesh);
    mesh.name = 'survival-scrap-' + scrapTypeNames[type];
    mesh.userData.noCollider = true;
    return mesh;
  });
  function writeScrapNode(node, queueBufferUpdate = false) {
    for (let type = 0; type < scrapMeshes.length; type++) {
      if (!node.active || node.type !== type) {
        matrix.makeScale(0, 0, 0);
      } else {
        rotation.setFromAxisAngle(up, node.angle);
        position.set(node.x, node.y + (type === 0 ? 0.58 : type === 3 ? 0.28 : 0.42), node.z);
        const heightScale = type === 0 ? 1 : type === 3 ? 1 : 0.85;
        scale.set(node.size, node.size * heightScale, node.size);
        matrix.compose(position, rotation, scale);
      }
      scrapMeshes[type].setMatrixAt(node.id, matrix);
      if (queueBufferUpdate) queueInstanceBufferRange(scrapMeshes[type], node.id);
    }
  }
  for (const node of scrapNodes) writeScrapNode(node);
  for (const mesh of scrapMeshes) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }

  const ironOreMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a6250, roughness: 1, flatShading: true,
  });
  const ironOreMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.08, 1), ironOreMaterial, IRON_ORE_NODE_COUNT
  );
  configureDynamicInstanceBuffer(ironOreMesh);
  ironOreMesh.name = 'survival-iron-ore-deposits';
  ironOreMesh.userData.noCollider = true;
  function writeIronOreNode(node, queueBufferUpdate = false) {
    if (!node.active) matrix.makeScale(0, 0, 0);
    else {
      rotation.setFromAxisAngle(up, node.angle);
      position.set(node.x, node.y + node.size * 0.62, node.z);
      scale.set(node.size * 1.12, node.size * 0.86, node.size);
      matrix.compose(position, rotation, scale);
    }
    ironOreMesh.setMatrixAt(node.id, matrix);
    if (queueBufferUpdate) queueInstanceBufferRange(ironOreMesh, node.id);
  }
  for (const node of ironOreNodes) writeIronOreNode(node);
  ironOreMesh.instanceMatrix.needsUpdate = true;
  ironOreMesh.computeBoundingSphere();
  scene.add(ironOreMesh);

  // First-person tool models: crafted tools appear in the lower-right camera view.
  const viewModel = new THREE.Group();
  viewModel.name = 'survival-held-tool';
  viewModel.position.set(0.40, -0.34, -0.66);
  camera.add(viewModel);
  const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x805a38, roughness: 0.96 });
  const woodHeadMaterial = new THREE.MeshStandardMaterial({ color: 0x513a27, roughness: 1 });
  const stoneHeadMaterial = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 1, flatShading: true });
  const shrubFiberMaterial = new THREE.MeshStandardMaterial({ color: 0xb3a16d, roughness: 1 });
  const metalEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0x92989a, roughness: 0.78, metalness: 0.18 });

  const heldMotion = new THREE.Group();
  heldMotion.name = 'held-item-motion';
  viewModel.add(heldMotion);

  function toolPart(group, geometry, material, x, y, z, rotationZ = 0, scaleX = 1, scaleY = 1, scaleZ = 1, rotationX = 0, rotationY = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.scale.set(scaleX, scaleY, scaleZ);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noCollider = true;
    group.add(mesh);
    return mesh;
  }

  function makeHeldTool(id) {
    const group = new THREE.Group();
    group.name = 'held-' + id;
    group.visible = false;
    const isIron = id.startsWith('iron');
    const isStone = id.startsWith('stone');
    const isAxe = id.endsWith('Axe');
    const headMaterial = isIron ? metalEdgeMaterial : isStone ? stoneHeadMaterial : woodHeadMaterial;
    const shaftLength = 0.78;

    toolPart(group, new THREE.CylinderGeometry(0.032, 0.052, shaftLength, 9), handleMaterial, 0, -0.18, 0);
    toolPart(group, new THREE.TorusGeometry(0.049, 0.012, 5, 12), isIron ? metalEdgeMaterial : handleMaterial, 0, -0.48, 0, Math.PI / 2);
    toolPart(group, new THREE.TorusGeometry(0.047, 0.009, 5, 12), isIron ? metalEdgeMaterial : woodHeadMaterial, 0, 0.12, 0, Math.PI / 2);
    toolPart(group, new THREE.BoxGeometry(0.075, 0.12, 0.075), handleMaterial, 0, -0.31, 0);

    if (isAxe) {
      if (isIron) {
        toolPart(group, new THREE.BoxGeometry(0.20, 0.25, 0.18), metalEdgeMaterial, -0.105, 0.20, 0);
        toolPart(group, new THREE.CylinderGeometry(0.018, 0.22, 0.36, 8), metalEdgeMaterial, -0.245, 0.20, 0, Math.PI / 2);
        toolPart(group, new THREE.BoxGeometry(0.13, 0.17, 0.17), metalEdgeMaterial, 0.105, 0.20, 0);
        toolPart(group, new THREE.TorusGeometry(0.055, 0.012, 5, 12), handleMaterial, 0, 0.075, 0, Math.PI / 2);
      } else if (isStone) {
        toolPart(group, new THREE.DodecahedronGeometry(0.22, 1), stoneHeadMaterial, -0.16, 0.19, 0, 0, 0.92, 1.18, 0.78);
        toolPart(group, new THREE.ConeGeometry(0.11, 0.20, 5), stoneHeadMaterial, -0.32, 0.19, 0, -Math.PI / 2, 1, 1, 0.8);
        toolPart(group, new THREE.BoxGeometry(0.09, 0.18, 0.12), handleMaterial, -0.015, 0.18, 0);
        toolPart(group, new THREE.TorusGeometry(0.063, 0.018, 5, 10), handleMaterial, 0.015, 0.08, 0, Math.PI / 2);
        toolPart(group, new THREE.TorusGeometry(0.061, 0.018, 5, 10), handleMaterial, 0.015, 0.29, 0, Math.PI / 2);
      } else {
        toolPart(group, new THREE.BoxGeometry(0.18, 0.20, 0.15), woodHeadMaterial, -0.12, 0.19, 0);
        toolPart(group, new THREE.CylinderGeometry(0.02, 0.15, 0.30, 6), woodHeadMaterial, -0.245, 0.19, 0, Math.PI / 2);
        toolPart(group, new THREE.BoxGeometry(0.08, 0.15, 0.13), woodHeadMaterial, 0.04, 0.19, 0);
        toolPart(group, new THREE.TorusGeometry(0.055, 0.014, 5, 10), handleMaterial, 0, 0.08, 0, Math.PI / 2);
      }
    } else {
      if (isIron) {
        toolPart(group, new THREE.BoxGeometry(0.58, 0.115, 0.15), metalEdgeMaterial, 0, 0.20, 0);
        toolPart(group, new THREE.ConeGeometry(0.085, 0.32, 7), metalEdgeMaterial, -0.31, 0.20, 0, Math.PI / 2, 1, 1, 1, 0, 0);
        toolPart(group, new THREE.ConeGeometry(0.085, 0.32, 7), metalEdgeMaterial, 0.31, 0.20, 0, -Math.PI / 2, 1, 1, 1, 0, 0);
        toolPart(group, new THREE.BoxGeometry(0.10, 0.18, 0.18), metalEdgeMaterial, 0, 0.20, 0);
      } else if (isStone) {
        toolPart(group, new THREE.BoxGeometry(0.50, 0.12, 0.15), stoneHeadMaterial, 0, 0.20, 0);
        toolPart(group, new THREE.ConeGeometry(0.085, 0.30, 5), stoneHeadMaterial, -0.30, 0.20, 0, Math.PI / 2, 1.05, 1, 0.85);
        toolPart(group, new THREE.ConeGeometry(0.085, 0.30, 5), stoneHeadMaterial, 0.30, 0.20, 0, -Math.PI / 2, 1.05, 1, 0.85);
        toolPart(group, new THREE.TorusGeometry(0.064, 0.018, 5, 10), handleMaterial, 0, 0.08, 0, Math.PI / 2);
        toolPart(group, new THREE.TorusGeometry(0.064, 0.018, 5, 10), handleMaterial, 0, 0.30, 0, Math.PI / 2);
      } else {
        toolPart(group, new THREE.BoxGeometry(0.50, 0.12, 0.13), woodHeadMaterial, 0, 0.20, 0);
        toolPart(group, new THREE.ConeGeometry(0.07, 0.26, 5), woodHeadMaterial, -0.29, 0.20, 0, -Math.PI / 2);
        toolPart(group, new THREE.ConeGeometry(0.07, 0.26, 5), woodHeadMaterial, 0.29, 0.20, 0, Math.PI / 2);
        toolPart(group, new THREE.TorusGeometry(0.059, 0.014, 5, 10), handleMaterial, 0, 0.08, 0, Math.PI / 2);
      }
    }
    group.userData.swingType = isAxe ? 'axe' : 'pickaxe';
    heldMotion.add(group);
    return group;
  }

  const heldTools = {
    woodAxe: makeHeldTool('woodAxe'),
    woodPickaxe: makeHeldTool('woodPickaxe'),
    stoneAxe: makeHeldTool('stoneAxe'),
    stonePickaxe: makeHeldTool('stonePickaxe'),
    ironAxe: makeHeldTool('ironAxe'),
    ironPickaxe: makeHeldTool('ironPickaxe'),
  };

  const heldResources = {};
  function makeHeldResource(id) {
    const group = new THREE.Group();
    group.name = 'held-' + id;
    group.visible = false;

    if (id === 'logs') {
      toolPart(group, new THREE.CylinderGeometry(0.12, 0.13, 0.58, 9), woodHeadMaterial, 0, -0.06, 0, Math.PI / 2);
      toolPart(group, new THREE.CircleGeometry(0.12, 9), handleMaterial, 0, -0.06, 0.292, 0, 1, 1, 1, Math.PI / 2);
      toolPart(group, new THREE.CircleGeometry(0.12, 9), handleMaterial, 0, -0.06, -0.292, 0, 1, 1, 1, -Math.PI / 2);
      toolPart(group, new THREE.TorusGeometry(0.07, 0.007, 4, 9), woodHeadMaterial, 0, -0.06, 0.30, 0, 1, 1, 1, Math.PI / 2);
    } else if (id === 'planks') {
      toolPart(group, new THREE.BoxGeometry(0.52, 0.085, 0.25), handleMaterial, 0, -0.14, 0);
      toolPart(group, new THREE.BoxGeometry(0.52, 0.085, 0.25), woodHeadMaterial, 0.025, -0.045, -0.018, 0.035);
      toolPart(group, new THREE.BoxGeometry(0.52, 0.085, 0.25), handleMaterial, -0.018, 0.05, 0.02, -0.025);
      toolPart(group, new THREE.BoxGeometry(0.28, 0.012, 0.012), woodHeadMaterial, 0, -0.14, 0.128);
    } else if (id === 'sticks') {
      for (let i = 0; i < 4; i++) {
        toolPart(group, new THREE.CylinderGeometry(0.025, 0.033, 0.48, 6), i % 2 ? woodHeadMaterial : handleMaterial,
          -0.09 + i * 0.06, -0.08 + (i % 2) * 0.035, 0, (i - 1.5) * 0.075);
      }
      toolPart(group, new THREE.TorusGeometry(0.075, 0.014, 4, 10), shrubFiberMaterial, 0, -0.08, 0.08, 0, 1, 1, 1, Math.PI / 2);
    } else if (id === 'stone') {
      toolPart(group, new THREE.DodecahedronGeometry(0.19, 1), stoneHeadMaterial, -0.10, -0.08, 0, 0.18, 1, 0.88, 0.92);
      toolPart(group, new THREE.DodecahedronGeometry(0.15, 0), stoneHeadMaterial, 0.09, -0.11, 0.07, -0.25, 0.94, 0.85, 1);
      toolPart(group, new THREE.DodecahedronGeometry(0.10, 0), metalEdgeMaterial, 0.04, 0.12, -0.02, 0.12, 1, 0.8, 0.75);
    } else if (id === 'branch') {
      toolPart(group, new THREE.CylinderGeometry(0.047, 0.065, 0.62, 7), handleMaterial, 0, -0.08, 0, Math.PI / 2);
      toolPart(group, new THREE.CylinderGeometry(0.022, 0.035, 0.24, 6), woodHeadMaterial, -0.06, 0.015, 0, -0.82);
      toolPart(group, new THREE.CylinderGeometry(0.022, 0.032, 0.20, 6), handleMaterial, 0.11, -0.03, 0, 0.8);
      toolPart(group, new THREE.CylinderGeometry(0.018, 0.025, 0.15, 5), woodHeadMaterial, -0.18, -0.10, 0, 0.7);
    } else if (id === 'fiber') {
      for (let i = 0; i < 5; i++) {
        const x = -0.12 + i * 0.06;
        toolPart(group, new THREE.CylinderGeometry(0.012, 0.016, 0.42, 5),
          i % 2 ? shrubFiberMaterial : handleMaterial, x, -0.08, 0, (i - 2) * 0.16);
      }
      toolPart(group, new THREE.TorusGeometry(0.12, 0.018, 5, 12), handleMaterial, 0, -0.13, 0.035, 0.22, 1, 1, 0.62);
      toolPart(group, new THREE.TorusGeometry(0.12, 0.018, 5, 12), shrubFiberMaterial, 0, -0.01, -0.025, -0.18, 1, 1, 0.62);
    } else if (id === 'leaves') {
      const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x6f9145, roughness: 0.96, flatShading: true });
      const leafVeinMaterial = new THREE.MeshStandardMaterial({ color: 0xa8b978, roughness: 1 });
      const leafShape = new THREE.SphereGeometry(0.13, 7, 5);
      toolPart(group, new THREE.CylinderGeometry(0.018, 0.024, 0.48, 5), handleMaterial, 0, -0.08, 0, 0.08);
      toolPart(group, leafShape, leafMaterial, -0.105, 0.01, 0.005, -0.38, 0.72, 0.14, 1.72, 0.12);
      toolPart(group, leafShape, leafMaterial, 0.09, 0.105, 0.015, 0.34, 0.72, 0.14, 1.72, -0.1);
      toolPart(group, leafShape, leafMaterial, -0.095, -0.145, 0.035, -0.50, 0.65, 0.13, 1.48, -0.16);
      toolPart(group, leafShape, leafMaterial, 0.105, -0.12, -0.025, 0.48, 0.65, 0.13, 1.48, 0.16);
      toolPart(group, leafShape, leafMaterial, 0.0, 0.245, 0.015, 0.05, 0.66, 0.13, 1.58);
      toolPart(group, new THREE.CylinderGeometry(0.006, 0.008, 0.34, 4), leafVeinMaterial, -0.045, 0.02, 0.12, -0.24, 1, 1, 1, Math.PI / 2);
      toolPart(group, new THREE.CylinderGeometry(0.006, 0.008, 0.34, 4), leafVeinMaterial, 0.055, -0.095, 0.10, 0.18, 1, 1, 1, Math.PI / 2);
      toolPart(group, new THREE.TorusGeometry(0.06, 0.012, 4, 10), shrubFiberMaterial, 0, -0.2, 0.045, 0.12, 1, 1, 0.72);
    } else if (id === 'sharpShard') {
      toolPart(group, new THREE.TetrahedronGeometry(0.25, 0), stoneHeadMaterial, 0, -0.08, 0, 0.14, 0.75, 1.25, 0.7);
      toolPart(group, new THREE.TetrahedronGeometry(0.12, 0), metalEdgeMaterial, 0.13, -0.16, 0.08, -0.3, 0.8, 1.15, 0.8);
      toolPart(group, new THREE.DodecahedronGeometry(0.07, 0), stoneHeadMaterial, -0.14, -0.18, -0.04);
    } else if (id === 'rope') {
      toolPart(group, new THREE.TorusGeometry(0.17, 0.035, 6, 16), handleMaterial, -0.045, -0.08, 0, 0.45, 1.2, 1, 0.65);
      toolPart(group, new THREE.TorusGeometry(0.14, 0.025, 5, 14), shrubFiberMaterial, 0.055, -0.06, 0.02, -0.42, 1, 1, 0.65);
      toolPart(group, new THREE.CylinderGeometry(0.024, 0.024, 0.35, 5), handleMaterial, 0, -0.08, 0, Math.PI / 2);
    } else if (id === 'handle') {
      toolPart(group, new THREE.CylinderGeometry(0.04, 0.052, 0.68, 8), handleMaterial, 0, -0.08, 0, 0, 1, 1, 1, 0, 0);
      toolPart(group, new THREE.BoxGeometry(0.13, 0.11, 0.10), woodHeadMaterial, -0.01, 0.25, 0);
      toolPart(group, new THREE.BoxGeometry(0.08, 0.10, 0.13), woodHeadMaterial, 0, 0.20, 0);
      toolPart(group, new THREE.TorusGeometry(0.048, 0.012, 5, 12), shrubFiberMaterial, 0, 0.08, 0, Math.PI / 2);
    } else if (id === 'stoneWedge') {
      toolPart(group, new THREE.ConeGeometry(0.18, 0.42, 5), stoneHeadMaterial, 0, -0.08, 0, 0, 1, 1, 0.78);
      toolPart(group, new THREE.BoxGeometry(0.09, 0.09, 0.12), stoneHeadMaterial, 0, -0.28, 0);
    } else if (id === 'bark') {
      toolPart(group, new THREE.BoxGeometry(0.38, 0.045, 0.22), woodHeadMaterial, -0.04, -0.10, 0, 0.12);
      toolPart(group, new THREE.BoxGeometry(0.32, 0.04, 0.19), handleMaterial, 0.025, -0.035, -0.025, -0.10);
      toolPart(group, new THREE.BoxGeometry(0.24, 0.035, 0.16), woodHeadMaterial, -0.02, 0.03, 0.015, 0.06);
    } else if (id === 'ironScrap') {
      toolPart(group, new THREE.BoxGeometry(0.38, 0.08, 0.23), metalEdgeMaterial, 0, -0.13, 0, 0.18, 1, 1, 1, 0.14);
      toolPart(group, new THREE.BoxGeometry(0.26, 0.07, 0.18), woodHeadMaterial, -0.04, -0.035, 0.02, -0.32, 1, 1, 1, -0.18);
      toolPart(group, new THREE.BoxGeometry(0.18, 0.055, 0.14), metalEdgeMaterial, 0.10, 0.035, -0.02, 0.28, 1, 1, 1, 0.26);
    } else if (id === 'ironOre') {
      toolPart(group, new THREE.DodecahedronGeometry(0.18, 1), stoneHeadMaterial, -0.08, -0.08, 0, 0.2, 1.1, 0.92, 0.9);
      toolPart(group, new THREE.DodecahedronGeometry(0.12, 0), metalEdgeMaterial, 0.09, -0.10, 0.06, -0.2, 1, 1, 0.7);
      toolPart(group, new THREE.DodecahedronGeometry(0.09, 0), woodHeadMaterial, 0.02, 0.09, -0.04, 0.12, 0.8, 1.2, 0.7);
    } else if (id === 'ironIngot') {
      toolPart(group, new THREE.BoxGeometry(0.42, 0.17, 0.25), metalEdgeMaterial, 0, -0.10, 0, 0, 1, 1, 1, 0.12);
      toolPart(group, new THREE.BoxGeometry(0.33, 0.055, 0.18), stoneHeadMaterial, 0, 0.005, 0, 0, 1, 1, 1, 0.12);
    } else if (id === 'metalFastener') {
      toolPart(group, new THREE.CylinderGeometry(0.025, 0.025, 0.45, 7), metalEdgeMaterial, -0.10, -0.08, 0, 0, 1, 1, 1, 0, 0);
      toolPart(group, new THREE.CylinderGeometry(0.025, 0.025, 0.38, 7), metalEdgeMaterial, 0.10, -0.08, 0, 0.12);
      toolPart(group, new THREE.CylinderGeometry(0.065, 0.065, 0.065, 7), metalEdgeMaterial, -0.10, 0.16, 0);
      toolPart(group, new THREE.CylinderGeometry(0.065, 0.065, 0.065, 7), metalEdgeMaterial, 0.10, 0.12, 0, 0.12);
    } else {
      throw new Error('Missing held 3D model: ' + id);
    }

    group.userData.swingType = 'resource';
    heldMotion.add(group);
    return group;
  }

  for (const id of RESOURCE_IDS) heldResources[id] = makeHeldResource(id);
  const handSkinMaterial = new THREE.MeshStandardMaterial({
    color: 0xc99575, roughness: 0.88, metalness: 0,
  });
  const handShadeMaterial = new THREE.MeshStandardMaterial({
    color: 0xb77d60, roughness: 0.94, metalness: 0,
  });
  const sleeveMaterial = new THREE.MeshStandardMaterial({
    color: 0x315d83, roughness: 0.94,
  });
  const sleeveTrimMaterial = new THREE.MeshStandardMaterial({
    color: 0x203f5a, roughness: 0.96,
  });
  const heldHands = new THREE.Group();
  heldHands.name = 'held-right-arm';

  // A clean, fingerless right arm: one tapered forearm, a blue sleeve and
  // one short rounded cylinder for the fist. The overlapping joints hide seams.
  toolPart(heldHands, new THREE.CylinderGeometry(0.084, 0.106, 0.49, 20, 1),
    handSkinMaterial, 0, -0.315, 0.055, -0.08);
  toolPart(heldHands, new THREE.SphereGeometry(1, 16, 12),
    handSkinMaterial, 0, -0.075, 0.035, 0, 0.084, 0.083, 0.072);

  const heldFist = new THREE.Group();
  heldFist.name = 'right-rounded-mitten';
  heldFist.position.set(0, -0.025, -0.018);
  heldHands.add(heldFist);
  // One compact oval mitten, aligned with the forearm. No side protrusions,
  // thumb-like tips or finger geometry.
  toolPart(heldFist, new THREE.SphereGeometry(1, 20, 16),
    handSkinMaterial, 0, 0, 0, 0, 0.094, 0.086, 0.080);

  // Sleeve enters from the bottom-right, with a narrow cuff over the wrist.
  toolPart(heldHands, new THREE.CylinderGeometry(0.100, 0.126, 0.32, 20, 1),
    sleeveMaterial, 0, -0.625, 0.09, -0.08);
  toolPart(heldHands, new THREE.TorusGeometry(0.108, 0.010, 8, 20),
    sleeveTrimMaterial, 0, -0.465, 0.09, Math.PI / 2);

  heldHands.userData.swingType = 'hands';
  heldHands.userData.fist = heldFist;
  heldMotion.add(heldHands);

  // The tool version uses the same simplified cylindrical hand, wrapped
  // crosswise around the handle. No separate fingers or thumb geometry.
  const heldToolGrip = new THREE.Group();
  heldToolGrip.name = 'held-tool-gripping-right-hand';
  heldToolGrip.visible = false;

  toolPart(heldToolGrip, new THREE.CylinderGeometry(0.084, 0.106, 0.49, 20, 1),
    handSkinMaterial, 0.01, -0.35, 0.075, -0.08);
  toolPart(heldToolGrip, new THREE.SphereGeometry(1, 16, 12),
    handSkinMaterial, 0.01, -0.105, 0.055, 0, 0.084, 0.083, 0.072);
  toolPart(heldToolGrip, new THREE.CylinderGeometry(0.100, 0.126, 0.32, 20, 1),
    sleeveMaterial, 0.01, -0.66, 0.105, -0.08);
  toolPart(heldToolGrip, new THREE.TorusGeometry(0.108, 0.010, 8, 20),
    sleeveTrimMaterial, 0.01, -0.50, 0.105, Math.PI / 2);
  // A single smooth palm shape wraps over the handle. The handle remains
  // visible above and below it, without separate thumb-like side pieces.
  toolPart(heldToolGrip, new THREE.SphereGeometry(1, 18, 14),
    handSkinMaterial, 0, -0.165, 0.045, 0, 0.112, 0.082, 0.078);
  heldMotion.add(heldToolGrip);

  let activeHeldModel = heldHands;
  let activeHeldId = 'hands';
  let toolSwing = 0;
  let toolSwingSpeed = 3.8;
  let toolAction = 'idle';
  let heldIdleTime = 0;

  function refreshHeldTool() {
    const activeStack = hotbarSlots[selectedSlot];
    selectedTool = activeStack && TOOL_IDS.includes(activeStack.id) ? activeStack.id : 'hands';
    const gathering = toolAction === 'gather' && toolSwing > 0;
    for (const [id, group] of Object.entries(heldTools)) {
      group.visible = selectedTool === id && !gathering;
    }
    for (const [id, group] of Object.entries(heldResources)) {
      group.visible = !gathering && !!activeStack && activeStack.id === id && activeStack.count > 0;
    }
    heldHands.visible = !activeStack || gathering;
    heldToolGrip.visible = !gathering && selectedTool !== 'hands';
    const selectedResource = activeStack && heldResources[activeStack.id] ? heldResources[activeStack.id] : null;
    activeHeldId = gathering ? 'hands' : selectedTool !== 'hands' ? selectedTool :
      selectedResource ? activeStack.id : 'hands';
    activeHeldModel = gathering ? heldHands : selectedTool !== 'hands' ? heldTools[selectedTool] :
      selectedResource || heldHands;
    viewModel.visible = player.mode !== 'cinematic' && !player.swimming;
  }

  function smoothStep(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function sampleMotion(keys, progress) {
    if (progress <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const next = keys[i];
      if (progress > next[0]) continue;
      const previous = keys[i - 1];
      const t = smoothStep((progress - previous[0]) / (next[0] - previous[0]));
      return previous[1] + (next[1] - previous[1]) * t;
    }
    return keys[keys.length - 1][1];
  }

  const HELD_SWING_PROFILES = {
    woodAxe: {
      x: [[0, 0], [0.30, -0.78], [0.49, 0.58], [0.68, -0.10], [1, 0]],
      y: [[0, 0], [0.30, -0.12], [0.49, 0.20], [1, 0]],
      z: [[0, 0], [0.30, -0.60], [0.49, 0.48], [0.68, -0.08], [1, 0]],
      py: [[0, 0], [0.30, 0.075], [0.49, -0.075], [1, 0]],
      pz: [[0, 0], [0.30, 0.045], [0.49, -0.15], [1, 0]],
    },
    stoneAxe: {
      x: [[0, 0], [0.36, -1.12], [0.55, 0.72], [0.76, -0.16], [1, 0]],
      y: [[0, 0], [0.36, 0.15], [0.55, -0.18], [1, 0]],
      z: [[0, 0], [0.36, -0.42], [0.55, 0.38], [0.76, -0.10], [1, 0]],
      py: [[0, 0], [0.36, 0.12], [0.55, -0.11], [1, 0]],
      pz: [[0, 0], [0.36, 0.08], [0.55, -0.18], [1, 0]],
    },
    ironAxe: {
      x: [[0, 0], [0.25, -0.72], [0.43, 0.88], [0.60, -0.10], [1, 0]],
      y: [[0, 0], [0.25, -0.10], [0.43, 0.16], [1, 0]],
      z: [[0, 0], [0.25, -0.70], [0.43, 0.58], [0.60, -0.14], [1, 0]],
      py: [[0, 0], [0.25, 0.055], [0.43, -0.10], [1, 0]],
      pz: [[0, 0], [0.25, 0.025], [0.43, -0.18], [1, 0]],
    },
    woodPickaxe: {
      x: [[0, 0], [0.28, -0.66], [0.47, 0.48], [0.66, -0.08], [1, 0]],
      y: [[0, 0], [0.28, 0.08], [0.47, -0.08], [1, 0]],
      z: [[0, 0], [0.28, 0.18], [0.47, -0.22], [0.66, 0.06], [1, 0]],
      py: [[0, 0], [0.28, 0.055], [0.47, -0.065], [1, 0]],
      pz: [[0, 0], [0.28, 0.025], [0.47, -0.12], [1, 0]],
    },
    stonePickaxe: {
      x: [[0, 0], [0.35, -1.10], [0.54, 0.74], [0.73, -0.14], [1, 0]],
      y: [[0, 0], [0.35, 0.12], [0.54, -0.14], [1, 0]],
      z: [[0, 0], [0.35, 0.28], [0.54, -0.35], [0.73, 0.08], [1, 0]],
      py: [[0, 0], [0.35, 0.105], [0.54, -0.12], [1, 0]],
      pz: [[0, 0], [0.35, 0.045], [0.54, -0.17], [1, 0]],
    },
    ironPickaxe: {
      x: [[0, 0], [0.32, -1.22], [0.50, 0.88], [0.68, -0.18], [1, 0]],
      y: [[0, 0], [0.32, -0.08], [0.50, 0.12], [1, 0]],
      z: [[0, 0], [0.32, 0.14], [0.50, -0.24], [0.68, 0.06], [1, 0]],
      py: [[0, 0], [0.32, 0.12], [0.50, -0.13], [1, 0]],
      pz: [[0, 0], [0.32, 0.05], [0.50, -0.20], [1, 0]],
    },
  };

  function animateHeldItem(dt) {
    heldIdleTime += dt;
    const model = activeHeldModel || heldHands;
    const isSwinging = toolSwing > 0;
    const progress = THREE.MathUtils.clamp(1 - toolSwing, 0, 1);

    heldMotion.position.set(0, Math.sin(heldIdleTime * 2.1) * 0.008, 0);
    heldMotion.rotation.set(0, Math.sin(heldIdleTime * 0.85) * 0.012, 0);

    if (!isSwinging) {
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      if (model.userData.swingType === 'axe' || model.userData.swingType === 'pickaxe') {
        heldToolGrip.position.set(0, 0, 0);
        heldToolGrip.rotation.set(0, 0, 0);
      }
      if (model.userData.fist) {
        model.userData.fist.rotation.set(
          Math.sin(heldIdleTime * 1.25) * 0.012,
          Math.sin(heldIdleTime * 0.75) * 0.014,
          Math.sin(heldIdleTime * 1.6) * 0.008
        );
      }
      return;
    }

    if (model.userData.swingType === 'hands' && toolAction === 'gather') {
      // Open, reach, close around the branch/leaf, then draw the hand back.
      const reachX = sampleMotion([[0, 0], [0.22, -0.18], [0.48, 0.22], [0.72, -0.08], [1, 0]], progress);
      const reachY = sampleMotion([[0, 0], [0.22, 0.045], [0.48, -0.075], [0.72, -0.025], [1, 0]], progress);
      const reachZ = sampleMotion([[0, 0], [0.22, 0.06], [0.48, -0.34], [0.72, -0.16], [1, 0]], progress);
      model.rotation.set(reachX, sampleMotion([[0, 0], [0.48, -0.08], [1, 0]], progress), 0);
      model.position.set(0, reachY, reachZ);
      model.userData.fist.rotation.set(
        sampleMotion([[0, 0], [0.22, -0.12], [0.48, 0.12], [0.72, -0.035], [1, 0]], progress),
        0,
        sampleMotion([[0, 0], [0.22, -0.09], [0.48, 0.08], [0.72, -0.025], [1, 0]], progress)
      );
      return;
    }

    let rotationX;
    let rotationY;
    let rotationZ;
    let positionY;
    let positionZ;

    if (model.userData.swingType === 'hands') {
      // A compact pull-back, straight punch, impact and wrist recoil.
      rotationX = sampleMotion([[0, 0], [0.22, -0.24], [0.43, 0.76], [0.58, -0.12], [1, 0]], progress);
      rotationY = sampleMotion([[0, 0], [0.22, 0.08], [0.43, -0.10], [0.58, 0.035], [1, 0]], progress);
      rotationZ = sampleMotion([[0, 0], [0.22, -0.16], [0.43, 0.20], [0.58, -0.045], [1, 0]], progress);
      positionY = sampleMotion([[0, 0], [0.22, 0.055], [0.43, -0.035], [0.58, -0.015], [1, 0]], progress);
      positionZ = sampleMotion([[0, 0], [0.22, 0.095], [0.43, -0.29], [0.58, -0.105], [1, 0]], progress);
      // Punching keeps a firm closed fist. No opening/closing motion here.
    } else {
      // Each material/tool family has its own weight, wind-up and follow-through.
      const profile = HELD_SWING_PROFILES[activeHeldId] || HELD_SWING_PROFILES.woodAxe;
      rotationX = sampleMotion(profile.x, progress);
      rotationY = sampleMotion(profile.y, progress);
      rotationZ = sampleMotion(profile.z, progress);
      positionY = sampleMotion(profile.py, progress);
      positionZ = sampleMotion(profile.pz, progress);
    }

    model.rotation.set(rotationX, rotationY, rotationZ);
    model.position.set(0, positionY, positionZ);
    if (model.userData.swingType === 'axe' || model.userData.swingType === 'pickaxe') {
      heldToolGrip.rotation.copy(model.rotation);
      heldToolGrip.position.copy(model.position);
    }
  }
  refreshHeldTool();

  function addWorkbenchMesh() {
    if (!workbench || workbenchGroup) return;
    const group = new THREE.Group();
    group.name = 'survival-field-workplace';
    group.position.set(workbench.x, workbench.y, workbench.z);
    group.rotation.y = workbench.rotation || 0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x765335, roughness: 0.96 });
    const top = new THREE.MeshStandardMaterial({ color: 0x9a7045, roughness: 0.94 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x66645d, roughness: 1, flatShading: true });
    const part = (geometry, material, x, y, z, rotationZ = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.z = rotationZ;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noCollider = true;
      group.add(mesh);
    };
    // A low field-made surface: rough stones support two split logs.
    for (const x of [-0.62, 0.62]) {
      for (const z of [-0.23, 0.23]) {
        part(new THREE.DodecahedronGeometry(0.30, 0), stone, x, 0.22, z);
      }
    }
    for (const z of [-0.19, 0.19]) {
      part(new THREE.CylinderGeometry(0.11, 0.15, 1.72, 7), wood, 0, 0.49, z, Math.PI / 2);
    }
    part(new THREE.BoxGeometry(1.78, 0.12, 0.58), top, 0, 0.63, 0);
    part(new THREE.DodecahedronGeometry(0.17, 0), stone, -0.48, 0.79, -0.06);
    part(new THREE.BoxGeometry(0.38, 0.06, 0.13), wood, 0.43, 0.75, 0.12, -0.08);
    workbenchGroup = group;
    scene.add(group);
  }
  addWorkbenchMesh();

  function addWoodWorkshopMesh() {
    if (!woodWorkshop || woodWorkshopGroup) return;
    const group = new THREE.Group();
    group.name = 'survival-wooden-workshop';
    group.position.set(woodWorkshop.x, woodWorkshop.y, woodWorkshop.z);
    group.rotation.y = woodWorkshop.rotation || 0;
    const timber = new THREE.MeshStandardMaterial({ color: 0x795333, roughness: 0.98 });
    const top = new THREE.MeshStandardMaterial({ color: 0xa87949, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4b3829, roughness: 1 });
    const part = (geometry, material, x, y, z, rotationY = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotationY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noCollider = true;
      group.add(mesh);
    };
    for (const x of [-0.72, 0.72]) for (const z of [-0.42, 0.42]) {
      part(new THREE.BoxGeometry(0.13, 0.92, 0.13), timber, x, 0.46, z);
    }
    for (let i = 0; i < 4; i++) part(new THREE.BoxGeometry(1.62, 0.13, 0.24), top, 0, 0.91, -0.34 + i * 0.22);
    part(new THREE.BoxGeometry(0.46, 0.18, 0.18), dark, -0.48, 1.06, -0.15);
    part(new THREE.BoxGeometry(0.16, 0.22, 0.42), timber, 0.60, 1.02, 0.20);
    part(new THREE.CylinderGeometry(0.055, 0.055, 0.72, 7), dark, 0.42, 0.98, -0.28, Math.PI / 2);
    woodWorkshopGroup = group;
    scene.add(group);
  }

  function addFurnaceMesh() {
    if (!furnace || furnaceGroup) return;
    const group = new THREE.Group();
    group.name = 'survival-smelting-furnace';
    group.position.set(furnace.x, furnace.y, furnace.z);
    group.rotation.y = furnace.rotation || 0;
    const stone = new THREE.MeshStandardMaterial({ color: 0x66645e, roughness: 1, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x201e1a, roughness: 1 });
    const ember = new THREE.MeshStandardMaterial({
      color: 0xd65b1f, emissive: 0xb52d09, emissiveIntensity: 1.2, roughness: 1,
    });
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noCollider = true;
      group.add(mesh);
    };
    for (let layer = 0; layer < 2; layer++) {
      for (const x of [-0.47, 0.47]) {
        part(new THREE.BoxGeometry(0.42, 0.42, 0.42), stone, x, 0.22 + layer * 0.42, 0);
      }
      part(new THREE.BoxGeometry(0.42, 0.42, 0.42), stone, 0, 0.22 + layer * 0.42, -0.46);
      part(new THREE.BoxGeometry(0.42, 0.42, 0.42), stone, 0, 0.22 + layer * 0.42, 0.46);
    }
    part(new THREE.BoxGeometry(0.64, 0.48, 0.07), dark, 0, 0.34, 0.48);
    part(new THREE.BoxGeometry(0.38, 0.16, 0.04), ember, 0, 0.26, 0.525);
    part(new THREE.BoxGeometry(0.24, 0.06, 0.05), ember, -0.10, 0.42, 0.525);
    furnaceGroup = group;
    scene.add(group);
  }

  function addFullWorkbenchMesh() {
    if (!fullWorkbench || fullWorkbenchGroup) return;
    const group = new THREE.Group();
    group.name = 'survival-full-workbench';
    group.position.set(fullWorkbench.x, fullWorkbench.y, fullWorkbench.z);
    group.rotation.y = fullWorkbench.rotation || 0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x64452f, roughness: 0.94 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x7c8587, roughness: 0.72, metalness: 0.62 });
    const top = new THREE.MeshStandardMaterial({ color: 0x343a3b, roughness: 0.78, metalness: 0.42 });
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noCollider = true;
      group.add(mesh);
    };
    for (const x of [-0.66, 0.66]) for (const z of [-0.38, 0.38]) {
      part(new THREE.BoxGeometry(0.16, 0.94, 0.16), wood, x, 0.47, z);
      part(new THREE.BoxGeometry(0.20, 0.16, 0.20), iron, x, 0.12, z);
    }
    part(new THREE.BoxGeometry(1.58, 0.18, 0.94), top, 0, 0.98, 0);
    part(new THREE.BoxGeometry(1.58, 0.06, 0.08), iron, 0, 0.84, 0.40);
    part(new THREE.BoxGeometry(0.52, 0.13, 0.16), iron, -0.38, 1.13, -0.18);
    part(new THREE.CylinderGeometry(0.07, 0.07, 0.56, 8), iron, 0.46, 1.14, -0.18, Math.PI / 2);
    fullWorkbenchGroup = group;
    scene.add(group);
  }

  function addStationMesh(kind) {
    if (kind === 'field') addWorkbenchMesh();
    else if (kind === 'woodWorkshop') addWoodWorkshopMesh();
    else if (kind === 'furnace') addFurnaceMesh();
    else if (kind === 'fullWorkbench') addFullWorkbenchMesh();
  }
  addWoodWorkshopMesh();
  addFurnaceMesh();
  addFullWorkbenchMesh();

  const ui = document.getElementById('ui') || document.body;
  const toggle = document.createElement('button');
  toggle.id = 'survival-toggle';
  toggle.type = 'button';
  toggle.innerHTML = mobileMode
    ? '<span>ИНВЕНТАРЬ</span>'
    : '<span class="inventory-key">E</span><span>ИНВЕНТАРЬ</span>';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'survival-panel');
  ui.appendChild(toggle);

  const panel = document.createElement('section');
  panel.id = 'survival-panel';
  panel.className = 'survival-panel';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="inventory-window">' +
      '<div class="survival-heading"><div><h2>ИНВЕНТАРЬ</h2><p>Перетаскивай или выбирай предметы по очереди</p></div><button type="button" data-close aria-label="Закрыть инвентарь">×</button></div>' +
      '<div class="inventory-layout">' +
        '<div class="inventory-left">' +
          '<div class="inventory-character">' +
            '<div class="inventory-label">ПЕРСОНАЖ</div>' +
            '<div class="character-preview">' +
              '<svg viewBox="0 0 112 150" role="img" aria-label="Модель персонажа">' +
                '<ellipse cx="56" cy="140" rx="34" ry="6" fill="#222" opacity=".45"/>' +
                '<path d="M36 12 48 5 68 5 80 12 80 43 68 51 48 51 36 43Z" fill="#b88b64" stroke="#654b37" stroke-width="2"/>' +
                '<path d="M36 12 48 5 68 5 80 12 56 21Z" fill="#d7ad83"/>' +
                '<path d="M36 12 56 21 56 50 36 43Z" fill="#a97853"/>' +
                '<path d="M80 12 56 21 56 50 80 43Z" fill="#c9956b"/>' +
                '<path d="M42 58 56 50 70 58 70 99 56 106 42 99Z" fill="#537a9b" stroke="#253d51" stroke-width="2"/>' +
                '<path d="M42 58 56 66 56 106 42 99Z" fill="#3f6482"/>' +
                '<path d="M70 58 56 66 56 106 70 99Z" fill="#6e95b3"/>' +
                '<path d="M23 61 40 55 45 61 39 103 24 108 17 100Z" fill="#b88b64" stroke="#654b37" stroke-width="2"/>' +
                '<path d="M89 61 72 55 67 61 73 103 88 108 95 100Z" fill="#c9956b" stroke="#654b37" stroke-width="2"/>' +
                '<path d="M42 103 56 108 56 139 37 139 36 112Z" fill="#35465d" stroke="#202b39" stroke-width="2"/>' +
                '<path d="M70 103 56 108 56 139 75 139 76 112Z" fill="#405675" stroke="#202b39" stroke-width="2"/>' +
                '<path d="M37 139 56 139 56 145 33 145Z" fill="#242424"/><path d="M56 139 75 139 79 145 56 145Z" fill="#303030"/>' +
                '<path d="M44 32h5v5h-5zM63 32h5v5h-5z" fill="#2a2724"/>' +
              '</svg>' +
            '</div>' +
            '<div class="character-caption">В РУКАХ</div>' +
            '<div class="character-held" id="survival-held-name">Руки</div>' +
          '</div>' +
          '<div class="inventory-items">' +
            '<div class="inventory-label">ИНВЕНТАРЬ · 27 ЯЧЕЕК</div>' +
            '<div class="survival-resources" id="survival-resources"></div>' +
            '<div class="inventory-footnote">Выбери ячейку → место назначения · ПКМ: отделить 1 предмет.</div>' +
          '</div>' +
        '</div>' +
        '<div class="inventory-right">' +
          '<div class="inventory-label">РУЧНОЙ КРАФТ · 3 × 3</div>' +
          '<div class="crafting-workspace">' +
            '<div class="crafting-grid" id="survival-crafting-grid" aria-label="Сетка крафта 3 на 3"></div>' +
            '<div class="crafting-arrow" aria-hidden="true">➜</div>' +
            '<div class="crafting-result-wrap">' +
              '<div class="inventory-label">РЕЗУЛЬТАТ</div>' +
              '<button type="button" class="crafting-result" id="survival-craft-output" disabled aria-label="Результат крафта"></button>' +
            '</div>' +
          '</div>' +
          '<div class="crafting-note" id="survival-bench-status"></div>' +
          '<div class="survival-foot"><span>Ресурсы на карте</span><b id="survival-stone-count"></b></div>' +
        '</div>' +
      '</div>' +
      '<div class="inventory-bottom-hint">Выбери предмет → место назначения · ПКМ / долгое нажатие: разделить стопку · E / I / ESC</div>' +
    '</div>';
  ui.appendChild(panel);

  const hotbar = document.createElement('div');
  hotbar.id = 'survival-hotbar';
  hotbar.setAttribute('role', 'group');
  hotbar.setAttribute('aria-label', 'Быстрая панель предметов');
  ui.appendChild(hotbar);

  const status = document.createElement('div');
  status.id = 'survival-status';
  status.setAttribute('aria-live', 'polite');
  ui.appendChild(status);
  const mobileHit = document.createElement('button');
  mobileHit.id = 'survival-hit';
  mobileHit.type = 'button';
  mobileHit.textContent = 'УДАР';
  ui.appendChild(mobileHit);

  const resourceEl = panel.querySelector('#survival-resources');
  const heldNameEl = panel.querySelector('#survival-held-name');
  const benchStatusEl = panel.querySelector('#survival-bench-status');
  const craftingGridEl = panel.querySelector('#survival-crafting-grid');
  const craftOutputEl = panel.querySelector('#survival-craft-output');
  const nodeCountEl = panel.querySelector('#survival-stone-count');
  const toolNames = {
    hands: 'Руки',
    woodAxe: 'Деревянный топор',
    woodPickaxe: 'Деревянная кирка',
    stoneAxe: 'Каменный топор',
    stonePickaxe: 'Каменная кирка',
    ironAxe: 'Железный топор',
    ironPickaxe: 'Железная кирка',
  };
  const itemNames = {
    logs: 'Древесина', planks: 'Грубые доски', sticks: 'Палки', stone: 'Крупный камень',
    branch: 'Толстая ветка', fiber: 'Растительные волокна', leaves: 'Листья',
    sharpShard: 'Острый каменный осколок', rope: 'Верёвка', handle: 'Деревянная рукоятка',
    stoneWedge: 'Каменный клин', bark: 'Кора',
    ironScrap: 'Железный лом', ironOre: 'Железная руда',
    ironIngot: 'Железный слиток', metalFastener: 'Металлическое крепление',
    ...toolNames,
  };

  let panelOpen = false;
  let mouseHeld = false;
  let hitCooldown = 0;
  let messageCooldown = 0;
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);

  function nearWorkbench() {
    return !!workbench && Math.hypot(camera.position.x - workbench.x, camera.position.z - workbench.z) <= 4.2;
  }
  function nearWoodWorkshop() {
    return !!woodWorkshop && Math.hypot(camera.position.x - woodWorkshop.x, camera.position.z - woodWorkshop.z) <= 5.0;
  }
  function nearFurnace() {
    return !!furnace && Math.hypot(camera.position.x - furnace.x, camera.position.z - furnace.z) <= 4.5;
  }
  function nearFullWorkbench() {
    return !!fullWorkbench && Math.hypot(camera.position.x - fullWorkbench.x, camera.position.z - fullWorkbench.z) <= 5.0;
  }
  function nearStation(kind) {
    if (kind === 'field') return nearWorkbench();
    if (kind === 'wood') return nearWoodWorkshop();
    if (kind === 'furnace') return nearFurnace();
    if (kind === 'full') return nearFullWorkbench();
    return true;
  }

  const ITEM_MODELS = {
    logs: '<g stroke-linejoin="round"><path d="M14 24 42 12 56 20 28 33Z" fill="#bd8750" stroke="#65452a" stroke-width="2"/><path d="M14 24 28 33 28 51 14 42Z" fill="#89572f" stroke="#65452a" stroke-width="2"/><path d="M28 33 56 20 56 38 28 51Z" fill="#a96e3b" stroke="#65452a" stroke-width="2"/><ellipse cx="14" cy="33" rx="7" ry="9" fill="#d7a16a" stroke="#65452a" stroke-width="2"/><ellipse cx="14" cy="33" rx="3.5" ry="5" fill="none" stroke="#8e5b34" stroke-width="2"/></g>',
    planks: '<g stroke-linejoin="round" stroke="#704827" stroke-width="1.8"><path d="M10 33 40 20 55 28 25 42Z" fill="#d5a36a"/><path d="M10 33 25 42 25 50 10 41Z" fill="#956238"/><path d="M25 42 55 28 55 36 25 50Z" fill="#b77e49"/><path d="M15 22 43 10 54 16 26 29Z" fill="#e1b47d"/><path d="M15 22 26 29 26 36 15 29Z" fill="#a16b3e"/><path d="M26 29 54 16 54 23 26 36Z" fill="#c18b53"/></g>',
    sticks: '<g stroke-linecap="round" stroke-width="5"><path d="M20 49 43 12" stroke="#704728"/><path d="M20 49 43 12" stroke="#c18a54" stroke-width="2"/><path d="M34 49 51 24" stroke="#704728"/><path d="M34 49 51 24" stroke="#d2a16a" stroke-width="2"/></g>',
    stone: '<g stroke-linejoin="round" stroke="#484b4c" stroke-width="2"><path d="m9 39 7-17 14-8 17 7 9 15-9 14-22 4-15-6Z" fill="#898d8b"/><path d="m9 39 7-17 14-8-3 21-6 19-12-6Z" fill="#686e70"/><path d="m30 14 17 7 9 15-29-1Z" fill="#aeb1aa"/><path d="m27 35 29 1-9 14-22 4Z" fill="#777d7d"/><path d="m18 24 8-4 5 4-7 6Z" fill="#c3c3b8" opacity=".8"/></g>',
    branch: '<g stroke-linecap="round" stroke-width="6"><path d="M10 48 53 13" stroke="#66452b"/><path d="M10 48 53 13" stroke="#b17c4b" stroke-width="3"/><path d="m31 31-8-15m8 15 14 8" stroke="#805531" stroke-width="4"/></g>',
    leaves: '<g fill="#6f9145" stroke="#40592e" stroke-width="2"><path d="M8 42Q11 14 34 10Q35 32 8 42Z"/><path d="M22 53Q25 27 55 25Q54 47 22 53Z"/><path d="M13 30 33 11M25 45 51 27" fill="none" stroke="#b0c27a" stroke-width="2"/></g>',
    fiber: '<g fill="none" stroke="#c4b17a" stroke-width="4" stroke-linecap="round"><path d="M14 48Q24 30 18 12M25 50Q39 29 33 10M37 50Q52 28 47 14"/><path d="M14 29 7 20m26 17 10-12"/></g>',
    sharpShard: '<g stroke="#414749" stroke-width="2" stroke-linejoin="round"><path d="m10 45 11-28 15-7 18 19-8 21-25 5Z" fill="#999f9c"/><path d="m21 17 15-7-3 23-23 12Z" fill="#d0d2c8"/><path d="m33 33 21-4-8 21-25 5Z" fill="#6c7475"/></g>',
    rope: '<g fill="none" stroke="#9c7849" stroke-width="6" stroke-linecap="round"><path d="M17 18c28-14 36 31 9 29-18-2-17-25 9-26 18 0 18 22 2 27"/><path d="M17 18 29 9m11 39 8 7" stroke="#c39a60" stroke-width="3"/></g>',
    handle: '<g stroke="#604126" stroke-width="2" stroke-linejoin="round"><path d="m25 55 12-46 7 2-12 46Z" fill="#a87745"/><path d="m26 18 14-7 6 4-14 8Z" fill="#d1a16b"/><path d="m22 41 16-5" stroke="#e0b37c" stroke-width="3"/></g>',
    woodAxe: '<g stroke-linejoin="round"><path d="m25 53 13-43 5 2-13 43Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m39 13 3-5 5 2-3 6Z" fill="#d39b61"/><path d="m34 19 5-11 17 3 2 9-10 8-12-2Z" fill="#a97443" stroke="#644324" stroke-width="2"/><path d="m39 9 17 2 5 8-10 1-14-4Z" fill="#c18b53"/></g>',
    woodPickaxe: '<g stroke-linejoin="round" stroke-linecap="round"><path d="m27 57 12-48 5 1-12 48Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="M12 22 24 13 41 17 55 9 59 14 43 27 24 23 14 29Z" fill="#a97443" stroke="#644324" stroke-width="3"/><path d="m13 22 11-9 17 4-5 5-13-2-7 8Z" fill="#d09a61"/></g>',
    stoneWedge: '<g stroke="#444b4c" stroke-width="2" stroke-linejoin="round"><path d="m8 45 21-35 26 8-12 38-25-2Z" fill="#858c8a"/><path d="m29 10 26 8-12 38-4-23Z" fill="#c0c4bd"/></g>',
    bark: '<g stroke="#5d3b24" stroke-width="2" stroke-linejoin="round"><path d="m12 48 8-36 31-3-7 38-18 8Z" fill="#8b5a31"/><path d="m20 12 31-3-12 12-25-4Z" fill="#ba8150"/><path d="m18 30 24-8-4 8-22 8Z" fill="#654326"/></g>',
    ironScrap: '<g stroke="#493d35" stroke-width="2"><path d="m9 17 22-8 24 14-8 29-28 4-10-18Z" fill="#786f68"/><path d="m9 17 22-8-3 22-9 25-10-18Z" fill="#4e5453"/><path d="m31 9 24 14-8 29-19-21Z" fill="#a06b47"/></g>',
    ironOre: '<g stroke="#4d4741" stroke-width="2"><path d="m8 40 7-23 20-8 21 14 1 22-21 10-21-5Z" fill="#77736c"/><path d="m15 17 20-8-3 22-24 9Z" fill="#a16b4c"/><path d="m32 31 24-8 1 22-21 10Z" fill="#5d615e"/></g>',
    ironIngot: '<g stroke="#42484a" stroke-width="2" stroke-linejoin="round"><path d="m9 25 36-11 11 9-36 13Z" fill="#aeb5b4"/><path d="m20 36 36-13v14L20 50Z" fill="#747d80"/><path d="m9 25 11 11v14L9 38Z" fill="#8d9797"/></g>',
    metalFastener: '<g stroke="#50595a" stroke-width="3" fill="#9aa3a2"><path d="M13 17h38v8H13zM28 9h8v37h-8z"/><circle cx="32" cy="13" r="5" fill="#c7cccc"/></g>',
    stoneAxe: '<g stroke-linejoin="round"><path d="m25 55 13-45 5 2-13 45Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m38 14 5-12 18 4 1 15-12 8-13-4Z" fill="#7e8585" stroke="#42494b" stroke-width="2"/><path d="m43 4 18 2 1 15-8-4-12-2Z" fill="#b9bfbb"/><path d="m38 14 5-10 4 15-2 8Z" fill="#60696b"/></g>',
    stonePickaxe: '<g stroke-linejoin="round" stroke-linecap="round"><path d="m27 57 12-48 5 1-12 48Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m10 21 14-13 19 5 12-6 7 7-17 15-22-5-11 6Z" fill="#7e8585" stroke="#42494b" stroke-width="3"/><path d="m24 8 19 5 19-6-7 9-17 6-19-5Z" fill="#b9bfbb"/></g>',
    ironAxe: '<g stroke="#41494a" stroke-width="2" stroke-linejoin="round"><path d="m25 55 13-45 5 2-13 45Z" fill="#a46e3d"/><path d="m38 14 5-12 18 4 1 15-12 8-13-4Z" fill="#abb4b5"/><path d="m43 4 18 2 1 15-8-4-12-2Z" fill="#e0e5e3"/></g>',
    ironPickaxe: '<g stroke="#41494a" stroke-width="3" stroke-linejoin="round"><path d="m27 57 12-48 5 1-12 48Z" fill="#a46e3d"/><path d="m10 21 14-13 19 5 12-6 7 7-17 15-22-5-11 6Z" fill="#aeb8b9"/><path d="m24 8 19 5 19-6-7 9-17 6-19-5Z" fill="#e0e5e3"/></g>',
    workbench: '<g stroke-linejoin="round" stroke="#563a25" stroke-width="2"><path d="M10 20 35 8 57 20 31 33Z" fill="#d1a06b"/><path d="m10 20 21 13v23L10 44Z" fill="#94613a"/><path d="m31 33 26-13v24L31 56Z" fill="#754b2e"/><path d="m16 22 19-9 17 8-21 10Z" fill="#e2b77e"/><path d="M17 24 17 43M23 27 23 47M29 30 29 50M36 29 36 49M43 25 43 46" stroke="#563a25" stroke-width="1.5"/></g>',
    woodWorkshop: '<g stroke="#573a24" stroke-width="2"><path d="M8 22 34 9 57 20 31 34Z" fill="#c18b54"/><path d="m8 22 23 12v24L8 45Z" fill="#80532f"/><path d="m31 34 26-14v24L31 58Z" fill="#684329"/><path d="M15 20 15 45M22 18 22 49M29 15 29 52M37 15 37 48M45 17 45 44" fill="none" stroke="#e0b47c"/></g>',
    furnace: '<g stroke="#4c4942" stroke-width="2"><path d="m8 23 8-12h33l8 12v32H8Z" fill="#858078"/><path d="m19 37 7-7h14l7 7v18H19Z" fill="#272522"/><path d="m25 49 7-10 9 10Z" fill="#d35e20" stroke="#f2a04d"/><path d="M13 17h39M13 25h39" stroke="#aaa59a"/></g>',
    fullWorkbench: '<g stroke="#454b4b" stroke-width="2"><path d="M7 18 36 7 58 19 29 31Z" fill="#aab1b0"/><path d="m7 18 22 13v27L7 46Z" fill="#70513a"/><path d="m29 31 29-12v27L29 58Z" fill="#4e3c2d"/><path d="m13 20 23-9 15 8-23 10Z" fill="#e0e5e3"/><path d="M16 21v24m8-21v28m8-25v25m8-28v25m8-27v23" stroke="#778183"/></g>',
    hands: '<g stroke-linejoin="round" stroke="#64462d" stroke-width="2"><path d="M18 35 18 26q0-5 4-5t4 5v-9q0-5 4-5t4 5v8-12q0-5 4-5t4 5v14-9q0-5 4-5t4 5v13l4 6-3 14q-2 6-9 6H29q-9 0-11-8l-3-9q-2-5 2-7 3-1 5 3Z" fill="#bd8a63"/><path d="m30 27 0 8m8-10v10m8-7v7" fill="none" stroke="#e1b38b"/></g>'
  };


  function itemModelMarkup(id) {
    const model = ITEM_MODELS[id] || ITEM_MODELS.stone;
    return '<svg class="item-model" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' + model + '</svg>';
  }

  function getCellArray(kind) {
    if (kind === 'inventory') return inventorySlots;
    if (kind === 'hotbar') return hotbarSlots;
    if (kind === 'craft') return craftingGrid;
    return null;
  }

  function getCell(kind, index) {
    const array = getCellArray(kind);
    return array && Number.isInteger(index) && index >= 0 && index < array.length ? array[index] : null;
  }

  function setCell(kind, index, value) {
    const array = getCellArray(kind);
    if (!array || index < 0 || index >= array.length) return false;
    array[index] = cleanStack(value);
    return true;
  }

  function cellIsSelected(kind, index) {
    return !!selectedCell && selectedCell.kind === kind && selectedCell.index === index;
  }

  function createItemCell(kind, index, stack) {
    const button = document.createElement('button');
    button.type = 'button';
    button.draggable = !!stack;
    button.dataset.cellKind = kind;
    button.dataset.cellIndex = String(index);
    const className = kind === 'hotbar' ? 'hotbar-slot' : kind === 'craft' ? 'craft-slot' : 'inventory-slot';
    button.className = className +
      (kind === 'hotbar' && selectedSlot === index ? ' selected' : '') +
      (cellIsSelected(kind, index) ? ' moving' : '') +
      (!stack ? ' empty' : '');
    if (kind === 'hotbar') {
      const key = document.createElement('span');
      key.className = 'slot-key';
      key.textContent = String(index + 1);
      button.appendChild(key);
    }
    const model = document.createElement('span');
    model.className = 'slot-model-wrap';
    model.innerHTML = stack ? itemModelMarkup(stack.id) : '';
    const count = document.createElement('span');
    count.className = 'slot-count';
    count.textContent = stack && stack.count > 1 ? String(stack.count) : '';
    button.append(model, count);
    button.setAttribute('aria-label',
      (kind === 'hotbar' ? 'Быстрый слот ' + (index + 1) : kind === 'craft' ? 'Ячейка крафта ' + (index + 1) : 'Ячейка инвентаря ' + (index + 1)) +
      (stack ? ': ' + (itemNames[stack.id] || stack.id) + ', ' + stack.count : ': пусто'));
    return button;
  }

  function renderHotbar() {
    hotbar.replaceChildren(...hotbarSlots.map((stack, index) => createItemCell('hotbar', index, stack)));
  }

  function renderInventoryGrid() {
    resourceEl.replaceChildren(...inventorySlots.map((stack, index) => createItemCell('inventory', index, stack)));
  }

  function renderCraftingGrid() {
    craftingGridEl.replaceChildren(...craftingGrid.map((stack, index) => createItemCell('craft', index, stack)));
  }

  function addToInventory(id, amount) {
    let remaining = Math.max(0, Math.floor(Number(amount) || 0));
    if (!ITEM_IDS.includes(id) || remaining <= 0) return remaining;
    const isTool = TOOL_IDS.includes(id);
    if (isTool && [...inventorySlots, ...hotbarSlots, ...craftingGrid].some((stack) => stack && stack.id === id)) {
      return remaining;
    }

    const storageAreas = [inventorySlots, hotbarSlots];
    if (!isTool) {
      for (const area of storageAreas) {
        for (const stack of area) {
          if (!stack || stack.id !== id || stack.count >= STACK_LIMIT) continue;
          const moved = Math.min(remaining, STACK_LIMIT - stack.count);
          stack.count += moved;
          remaining -= moved;
          if (!remaining) break;
        }
        if (!remaining) break;
      }
    }

    for (const area of storageAreas) {
      for (let index = 0; index < area.length && remaining > 0; index++) {
        if (area[index]) continue;
        const moved = isTool ? 1 : Math.min(STACK_LIMIT, remaining);
        area[index] = { id, count: moved };
        remaining -= moved;
        if (isTool) break;
      }
      if (!remaining) break;
    }
    syncInventoryTotals();
    return remaining;
  }

  function canStoreItem(id, amount) {
    const isTool = TOOL_IDS.includes(id);
    if (isTool) {
      if ([...inventorySlots, ...hotbarSlots, ...craftingGrid].some((stack) => stack && stack.id === id)) return false;
      return inventorySlots.some((stack) => !stack) || hotbarSlots.some((stack) => !stack);
    }
    let remaining = amount;
    for (const area of [inventorySlots, hotbarSlots]) {
      for (const stack of area) {
        if (!stack || stack.id !== id || stack.count >= STACK_LIMIT) continue;
        remaining -= Math.min(remaining, STACK_LIMIT - stack.count);
        if (remaining <= 0) return true;
      }
    }
    const emptySlots = inventorySlots.filter((stack) => !stack).length + hotbarSlots.filter((stack) => !stack).length;
    return remaining <= emptySlots * STACK_LIMIT;
  }

  function transferCell(source, destination) {
    if (!source || !destination || source.kind === destination.kind && source.index === destination.index) return false;
    const sourceStack = getCell(source.kind, source.index);
    if (!sourceStack) return false;
    const destinationStack = getCell(destination.kind, destination.index);

    if (destinationStack && destinationStack.id === sourceStack.id && !TOOL_IDS.includes(sourceStack.id)) {
      const moved = Math.min(sourceStack.count, STACK_LIMIT - destinationStack.count);
      if (moved <= 0) return false;
      destinationStack.count += moved;
      sourceStack.count -= moved;
      if (sourceStack.count <= 0) setCell(source.kind, source.index, null);
    } else {
      setCell(destination.kind, destination.index, sourceStack);
      setCell(source.kind, source.index, destinationStack);
    }

    if (destination.kind === 'hotbar') selectedSlot = destination.index;
    syncInventoryTotals();
    save();
    renderPanel();
    return true;
  }

  function handleCellClick(kind, index) {
    const target = { kind, index };
    const stack = getCell(kind, index);
    if (!selectedCell) {
      if (stack) {
        selectedCell = target;
        renderPanel();
      } else if (kind === 'hotbar' && !panelOpen) {
        selectHotbarSlot(index);
      }
      return;
    }

    if (cellIsSelected(kind, index)) {
      selectedCell = null;
      renderPanel();
      return;
    }
    const source = selectedCell;
    selectedCell = null;
    if (!transferCell(source, target)) renderPanel();
  }

  function splitOneFromCell(kind, index) {
    const source = getCell(kind, index);
    if (!source || source.count <= 1 || TOOL_IDS.includes(source.id)) return false;

    const preferredKinds = [kind, 'inventory', 'hotbar', 'craft'];
    const visited = new Set();
    let destination = null;
    for (const candidateKind of preferredKinds) {
      if (visited.has(candidateKind)) continue;
      visited.add(candidateKind);
      const area = getCellArray(candidateKind);
      if (!area) continue;
      const emptyIndex = area.findIndex((stack, slotIndex) =>
        !stack && !(candidateKind === kind && slotIndex === index)
      );
      if (emptyIndex >= 0) {
        destination = { kind: candidateKind, index: emptyIndex };
        break;
      }
    }
    if (!destination) {
      toast('Нет свободной ячейки, чтобы разделить стопку.');
      return false;
    }

    source.count -= 1;
    setCell(destination.kind, destination.index, { id: source.id, count: 1 });
    selectedCell = null;
    syncInventoryTotals();
    save();
    renderPanel();
    return true;
  }

  function findCraftRecipe() {
    const recipes = [
      {
        id: 'sharpShard', output: 'sharpShard', count: 1, width: 1, height: 2,
        cells: [{ x: 0, y: 0, id: 'stone' }, { x: 0, y: 1, id: 'stone' }],
      },
      {
        id: 'rope', output: 'rope', count: 1, width: 1, height: 3,
        cells: [
          { x: 0, y: 0, id: 'fiber' }, { x: 0, y: 1, id: 'fiber' },
          { x: 0, y: 2, id: 'fiber' },
        ],
      },
      {
        id: 'fieldWorkplace', output: 'fieldWorkplace', count: 1, width: 3, height: 3,
        cells: [
          { x: 0, y: 0, id: 'logs' }, { x: 1, y: 0, id: 'logs' }, { x: 2, y: 0, id: 'logs' },
          { x: 0, y: 1, id: 'fiber' }, { x: 1, y: 1, id: 'fiber' }, { x: 2, y: 1, id: 'fiber' },
          { x: 0, y: 2, id: 'stone' }, { x: 1, y: 2, id: 'stone' }, { x: 2, y: 2, id: 'stone' },
        ],
      },
      {
        id: 'handle', output: 'handle', count: 1, width: 2, height: 1, station: 'field',
        cells: [{ x: 0, y: 0, id: 'branch' }, { x: 1, y: 0, id: 'sharpShard' }],
      },
      {
        id: 'stoneAxe', output: 'stoneAxe', count: 1, width: 3, height: 2, station: 'field',
        cells: [
          { x: 0, y: 0, id: 'sharpShard' }, { x: 1, y: 0, id: 'handle' },
          { x: 1, y: 1, id: 'rope' }, { x: 2, y: 1, id: 'rope' },
        ],
      },
      {
        id: 'stonePickaxe', output: 'stonePickaxe', count: 1, width: 3, height: 2, station: 'field',
        cells: [
          { x: 0, y: 0, id: 'sharpShard' }, { x: 1, y: 0, id: 'handle' },
          { x: 0, y: 1, id: 'rope' }, { x: 2, y: 1, id: 'rope' },
        ],
      },
      {
        id: 'stoneWedge', output: 'stoneWedge', count: 1, width: 3, height: 1, station: 'field',
        cells: [
          { x: 0, y: 0, id: 'stone' }, { x: 1, y: 0, id: 'stone' },
          { x: 2, y: 0, id: 'stone' },
        ],
      },
      {
        id: 'bark', output: 'bark', count: 2, width: 2, height: 1, station: 'field',
        cells: [{ x: 0, y: 0, id: 'logs' }, { x: 1, y: 0, id: 'sharpShard' }],
      },
      {
        id: 'roughBoards', output: 'planks', count: 2, width: 1, height: 1,
        station: 'field', tools: ['stoneAxe', 'stoneWedge'],
        cells: [{ x: 0, y: 0, id: 'logs' }],
      },
      {
        id: 'woodWorkshop', output: 'woodWorkshop', count: 1, width: 3, height: 1,
        station: 'field',
        cells: [
          { x: 0, y: 0, id: 'planks', count: 8 },
          { x: 1, y: 0, id: 'logs', count: 4 },
          { x: 2, y: 0, id: 'rope', count: 6 },
        ],
      },
      {
        id: 'furnace', output: 'furnace', count: 1, width: 3, height: 1,
        station: 'wood',
        cells: [
          { x: 0, y: 0, id: 'stone', count: 6 },
          { x: 1, y: 0, id: 'planks', count: 4 },
          { x: 2, y: 0, id: 'bark', count: 2 },
        ],
      },
      {
        id: 'ironIngotScrap', output: 'ironIngot', count: 1, width: 2, height: 1,
        station: 'furnace',
        cells: [
          { x: 0, y: 0, id: 'ironScrap', count: 3 },
          { x: 1, y: 0, id: 'bark', count: 2 },
        ],
      },
      {
        id: 'ironIngotOre', output: 'ironIngot', count: 1, width: 2, height: 1,
        station: 'furnace',
        cells: [
          { x: 0, y: 0, id: 'ironOre', count: 2 },
          { x: 1, y: 0, id: 'bark', count: 2 },
        ],
      },
      {
        id: 'metalFastener', output: 'metalFastener', count: 2, width: 1, height: 1,
        station: 'furnace',
        cells: [{ x: 0, y: 0, id: 'ironIngot' }],
      },
      {
        id: 'fullWorkbench', output: 'fullWorkbench', count: 1, width: 2, height: 2,
        station: 'wood',
        cells: [
          { x: 0, y: 0, id: 'planks', count: 10 },
          { x: 1, y: 0, id: 'ironIngot', count: 6 },
          { x: 0, y: 1, id: 'stone', count: 4 },
          { x: 1, y: 1, id: 'metalFastener', count: 2 },
        ],
      },
      {
        id: 'ironAxe', output: 'ironAxe', count: 1, width: 3, height: 2,
        station: 'full',
        cells: [
          { x: 0, y: 0, id: 'ironIngot', count: 2 },
          { x: 1, y: 0, id: 'handle' },
          { x: 0, y: 1, id: 'metalFastener' },
          { x: 2, y: 1, id: 'metalFastener' },
        ],
      },
      {
        id: 'ironPickaxe', output: 'ironPickaxe', count: 1, width: 3, height: 3,
        station: 'full',
        cells: [
          { x: 0, y: 0, id: 'ironIngot' },
          { x: 1, y: 0, id: 'ironIngot' },
          { x: 2, y: 0, id: 'ironIngot' },
          { x: 1, y: 1, id: 'handle' },
          { x: 0, y: 2, id: 'metalFastener' },
          { x: 2, y: 2, id: 'metalFastener' },
        ],
      },
    ];

    for (const recipe of recipes) {
      if (recipe.station && !nearStation(recipe.station)) continue;
      if (recipe.tools && recipe.tools.some((tool) => !inventory[tool])) continue;
      if (recipe.output === 'fieldWorkplace' && workbench) continue;
      if (recipe.output === 'woodWorkshop' && woodWorkshop) continue;
      if (recipe.output === 'furnace' && furnace) continue;
      if (recipe.output === 'fullWorkbench' && fullWorkbench) continue;
      if (TOOL_IDS.includes(recipe.output) && inventory[recipe.output]) continue;
      for (const mirrored of [false, true]) {
        for (let offsetY = 0; offsetY <= 3 - recipe.height; offsetY++) {
          for (let offsetX = 0; offsetX <= 3 - recipe.width; offsetX++) {
            const expected = new Map();
            for (const part of recipe.cells) {
              const x = mirrored ? recipe.width - 1 - part.x : part.x;
              const index = (offsetY + part.y) * 3 + offsetX + x;
              expected.set(index, part);
            }
            let matches = true;
            for (let index = 0; index < 9; index++) {
              const stack = craftingGrid[index];
              const part = expected.get(index);
              if (part) {
                if (!stack || stack.id !== part.id || stack.count < (part.count || 1)) {
                  matches = false;
                  break;
                }
              } else if (stack) {
                matches = false;
                break;
              }
            }
            if (matches) {
              return {
                recipe,
                ingredients: [...expected.entries()].map(([index, part]) => ({ index, id: part.id, count: part.count || 1 })),
              };
            }
          }
        }
      }
    }
    return null;
  }

  function renderCraftingOutput() {
    const match = findCraftRecipe();
    craftOutputEl.replaceChildren();
    craftOutputEl.disabled = !match;
    craftOutputEl.classList.toggle('available', !!match);
    craftOutputEl.setAttribute('aria-label', match ? 'Забрать изготовленный предмет' : 'Результат крафта пока пуст');
    if (match) {
      const model = document.createElement('span');
      model.className = 'slot-model-wrap';
      const stationModel = {
        fieldWorkplace: 'workbench',
        woodWorkshop: 'woodWorkshop',
        furnace: 'furnace',
        fullWorkbench: 'fullWorkbench',
      }[match.recipe.output] || match.recipe.output;
      model.innerHTML = itemModelMarkup(stationModel);
      const count = document.createElement('span');
      count.className = 'slot-count';
      count.textContent = match.recipe.count > 1 ? String(match.recipe.count) : '';
      craftOutputEl.append(model, count);
    }
  }

  function takeCraftResult() {
    const match = findCraftRecipe();
    if (!match) return;
    const { recipe, ingredients } = match;
    const isStation = STATION_OUTPUTS.includes(recipe.output);
    if (recipe.output === 'fieldWorkplace') {
      if (!placeWorkbench()) return;
    } else if (isStation) {
      if (!placeStation(recipe.output)) return;
    } else if (!canStoreItem(recipe.output, recipe.count)) {
      toast('В инвентаре нет места для результата.');
      return;
    }

    for (const ingredient of ingredients) {
      const stack = craftingGrid[ingredient.index];
      if (!stack || stack.count < ingredient.count) return;
      stack.count -= ingredient.count;
      if (stack.count <= 0) craftingGrid[ingredient.index] = null;
    }
    if (!isStation) addToInventory(recipe.output, recipe.count);
    selectedCell = null;
    syncInventoryTotals();
    save();
    renderPanel();
    const stationMessages = {
      fieldWorkplace: 'Полевое рабочее место установлено.',
      woodWorkshop: 'Деревянная мастерская установлена.',
      furnace: 'Печь установлена.',
      fullWorkbench: 'Полноценный верстак установлен.',
    };
    toast(stationMessages[recipe.output] || 'Предмет изготовлен.');
  }

  function renderPanel() {
    syncInventoryTotals();
    renderInventoryGrid();
    renderHotbar();
    renderCraftingGrid();
    refreshHeldTool();
    const activeStack = hotbarSlots[selectedSlot];
    heldNameEl.textContent = activeStack ? (itemNames[activeStack.id] || activeStack.id) : 'Руки';

    const stationLines = [
      'Полевое место: ' + (workbench ? (nearWorkbench() ? 'рядом' : 'установлено') : 'нет'),
      'Деревянная мастерская: ' + (woodWorkshop ? (nearWoodWorkshop() ? 'рядом' : 'установлена') : 'нет'),
      'Печь: ' + (furnace ? (nearFurnace() ? 'рядом' : 'установлена') : 'нет'),
      'Полноценный верстак: ' + (fullWorkbench ? (nearFullWorkbench() ? 'рядом' : 'установлен') : 'нет'),
    ];
    benchStatusEl.textContent = stationLines.join(' · ');

    renderCraftingOutput();
    const active = nodes.filter((node) => node.active).length + world.rocks.activeCount;
    const activeScrap = scrapNodes.filter((node) => node.active).length;
    const activeOre = ironOreNodes.filter((node) => node.active).length;
    nodeCountEl.textContent = active + ' камней · ' + activeOre + ' жил · ' + activeScrap + ' объектов';
    status.textContent = 'Слот ' + (selectedSlot + 1) + ' · ' +
      (activeStack ? (itemNames[activeStack.id] || activeStack.id) : 'Пусто') +
      ' · Камни на карте: ' + active + '/2000';
  }

  function selectHotbarSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= hotbarSlots.length) return;
    selectedCell = null;
    selectedSlot = index;
    syncInventoryTotals();
    save();
    if (panelOpen) renderPanel();
    else {
      renderHotbar();
      refreshHeldTool();
    }
  }

  function toast(message) {
    if (hud && hud.toast) hud.toast(message);
    else status.textContent = message;
  }

  function showPanel(open) {
    panelOpen = !!open;
    panel.hidden = !panelOpen;
    toggle.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    document.body.classList.toggle('inventory-open', panelOpen);
    if (!panelOpen) selectedCell = null;
    if (panelOpen) {
      mouseHeld = false;
      if (player.unlock) player.unlock();
      renderPanel();
    }
  }

  function placeStation(kind) {
    const existing = kind === 'field' ? workbench :
      kind === 'woodWorkshop' ? woodWorkshop :
      kind === 'furnace' ? furnace : fullWorkbench;
    if (existing) return true;
    if (player.mode === 'fly' || player.swimming || !player.grounded) {
      toast('Станцию можно установить только на земле.');
      return false;
    }

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();

    const occupiedStations = [workbench, woodWorkshop, furnace, fullWorkbench].filter(Boolean);
    const distances = [2.6, 3.4, 4.2, 5.0];
    let chosen = null;
    for (const distance of distances) {
      const x = camera.position.x + forward.x * distance;
      const z = camera.position.z + forward.z * distance;
      const y = world.heightAt(x, z);
      if (!Number.isFinite(y) || world.getWaterRegionAt(x, z)) continue;
      if (world.forests.isNearTree(x, z, 1.9)) continue;
      if (occupiedStations.some((station) => Math.hypot(x - station.x, z - station.z) < 3.8)) continue;
      chosen = { x, y, z, rotation: Math.atan2(forward.x, forward.z) };
      break;
    }
    if (!chosen) {
      toast('Рядом нет свободного места для установки станции.');
      return false;
    }

    if (kind === 'field') workbench = chosen;
    else if (kind === 'woodWorkshop') woodWorkshop = chosen;
    else if (kind === 'furnace') furnace = chosen;
    else if (kind === 'fullWorkbench') fullWorkbench = chosen;
    addStationMesh(kind);
    return true;
  }

  function placeWorkbench() {
    return placeStation('field');
  }

  function currentTarget() {
    raycaster.setFromCamera(center, camera);
    const localTrees = world.forests.getInteractiveMeshes(camera.position.x, camera.position.z);
    const localRocks = world.rocks.getInteractiveMeshes(camera.position.x, camera.position.z);
    const localShrubs = world.groundCover?.getInteractiveMeshes?.(camera.position.x, camera.position.z) || [];
    const hits = raycaster.intersectObjects(localTrees.concat(
      localRocks, localShrubs, stoneMesh, fiberMesh, branchMesh, stickMesh, leafMesh, ...scrapMeshes, ironOreMesh
    ), false);
    for (const hit of hits) {
      if (hit.distance > 6.2 || hit.instanceId === undefined) continue;
      if (hit.object === stoneMesh) {
        const node = nodes[hit.instanceId];
        if (node && node.active) return { type: 'stone', node };
      } else if (hit.object === fiberMesh) {
        const node = fiberNodes[hit.instanceId];
        if (node && node.active) return { type: 'fiber', node };
      } else if (hit.object === branchMesh) {
        const node = branchNodes[hit.instanceId];
        if (node && node.active) return { type: 'branch', node };
      } else if (hit.object === stickMesh) {
        const node = stickNodes[hit.instanceId];
        if (node && node.active) return { type: 'stick', node };
      } else if (hit.object === leafMesh) {
        const node = leafNodes[hit.instanceId];
        if (node && node.active) return { type: 'leaf', node };
      } else if (hit.object.userData.shrubInstances) {
        const shrub = hit.object.userData.shrubInstances[hit.instanceId];
        if (shrub && shrub.active) return { type: 'bush', shrub };
      } else if (hit.object.userData.rockInstances) {
        const rock = hit.object.userData.rockInstances[hit.instanceId];
        if (rock && rock.active) return { type: 'decorRock', rock };
      } else if (scrapMeshes.includes(hit.object)) {
        const node = scrapNodes[hit.instanceId];
        const type = scrapMeshes.indexOf(hit.object);
        if (node && node.active && node.type === type) return { type: 'scrap', node };
      } else if (hit.object === ironOreMesh) {
        const node = ironOreNodes[hit.instanceId];
        if (node && node.active) return { type: 'ironOre', node };
      } else {
        const tree = hit.object.userData.treeInstances && hit.object.userData.treeInstances[hit.instanceId];
        if (tree && !tree.removed) return { type: 'tree', tree };
      }
    }
    return null;
  }

  function startHeldAction(action) {
    toolAction = action;
    toolSwing = 1;
    if (action === 'gather') toolSwingSpeed = 2.3;
    else if (action === 'punch') toolSwingSpeed = 3.0;
    else if (selectedTool.endsWith('Pickaxe')) toolSwingSpeed = 2.55;
    else toolSwingSpeed = 2.85;
  }

  function hitTarget() {
    if (panelOpen || player.mode === 'fly' || player.swimming) return;
    refreshHeldTool();
    const target = currentTarget();
    if (!target) {
      if (messageCooldown <= 0) {
        messageCooldown = 0.6;
        toast('Наведи прицел на дерево, камень, ветку, куст или старый металл.');
      }
      return;
    }

    if (target.type === 'fiber' || target.type === 'branch' || target.type === 'stick' || target.type === 'leaf') {
      startHeldAction('gather');
      const isFiber = target.type === 'fiber';
      const isStick = target.type === 'stick';
      const isLeaf = target.type === 'leaf';
      const isBranch = target.type === 'branch' || isStick;
      const gatherMesh = isFiber ? fiberMesh : isLeaf ? leafMesh : isStick ? stickMesh : branchMesh;
      unmarkResourcePosition(target.node);
      target.node.active = false;
      target.node.due = Date.now() + RESPAWN_MS;
      writeGatherNode(target.node, gatherMesh, isBranch, isLeaf, true);
      flushInstanceBuffer(gatherMesh);
      const itemId = isFiber ? 'fiber' : isLeaf ? 'leaves' : isStick ? 'sticks' : 'branch';
      const amount = isFiber || isLeaf ? 2 + Math.floor(Math.random() * 3) : 1 + (Math.random() < 0.18 ? 1 : 0);
      const missing = addToInventory(itemId, amount);
      save(); renderPanel();
      const label = isFiber ? 'волокна' : isLeaf ? 'листьев' : isStick ? 'палок' : 'ветку';
      const message = isFiber ? 'Куст собран: +' : isLeaf ? 'Листья собраны: +' : isStick ? 'Палки подобраны: +' : 'Ветка подобрана: +';
      toast(message + (amount - missing) + ' ' + label + '.' + (missing ? ' Инвентарь заполнен.' : ''));
      return;
    }

    if (selectedTool === 'hands') startHeldAction('punch');
    else startHeldAction('tool');

    if (target.type === 'bush') {
      const damage = selectedTool.endsWith('Axe') ? 2 : 1;
      target.shrub.hp = Math.max(0, target.shrub.hp - damage);
      if (target.shrub.hp > 0) {
        world.groundCover?.setHealthById?.({ id: target.shrub.id, hp: target.shrub.hp });
      }
      if (target.shrub.hp <= 0) {
        world.groundCover.remove(target.shrub);
        const fiberAmount = 1 + Math.floor(Math.random() * 2);
        const leafAmount = 2 + Math.floor(Math.random() * 3);
        const missingFiber = addToInventory('fiber', fiberAmount);
        const missingLeaves = addToInventory('leaves', leafAmount);
        save();
        renderPanel();
        toast('Куст сломан: +' + (fiberAmount - missingFiber) + ' волокна, +' +
          (leafAmount - missingLeaves) + ' листьев. Через 5 минут вырастет снова.' +
          (missingFiber + missingLeaves ? ' Инвентарь заполнен.' : ''));
      } else {
        save();
        toast('Куст повреждён: осталось ' + target.shrub.hp + '/2 прочности.');
      }
      return;
    }

    if (target.type === 'decorRock') {
      const damage = selectedTool === 'ironPickaxe' ? 18 : selectedTool === 'stonePickaxe' ? 9 : selectedTool === 'woodPickaxe' ? 3 : 1;
      target.rock.hp -= damage;
      if (target.rock.hp <= 0) {
        world.rocks.remove(target.rock);
        const amount = 2 + Math.floor(Math.random() * 3);
        const missing = addToInventory('stone', amount);
        save(); renderPanel();
        toast('Декоративный камень разбит: +' + (amount - missing) + ' камня.' + (missing ? ' Инвентарь заполнен.' : ' Через 5 минут здесь появится новый.'));
      } else {
        save();
        toast('Декоративный камень: осталось ' + target.rock.hp + '/' + target.rock.maxHp + ' прочности.');
      }
      return;
    }

    if (target.type === 'tree') {
      const damage = selectedTool === 'ironAxe' ? 12 :
        selectedTool === 'stoneAxe' ? 8 : selectedTool === 'woodAxe' ? 4 : 1;
      target.tree.health = target.tree.health || TREE_HP;
      target.tree.health -= damage;
      if (target.tree.health > 0) world.forests.setHealthById?.({ id: target.tree.id, health: target.tree.health });
      if (target.tree.health <= 0) {
        world.forests.remove(target.tree);
        let sticksChanged = false, leavesChanged = false;
        const clearTreeResources = (list, mesh, isStick, isLeaf) => {
          for (const node of list) {
            if (!node.active || Math.hypot(node.x - target.tree.x, node.z - target.tree.z) > 23) continue;
            unmarkResourcePosition(node);
            node.active = false;
            node.due = Date.now() + 15000;
            writeGatherNode(node, mesh, isStick, isLeaf, true);
            if (isLeaf) leavesChanged = true; else sticksChanged = true;
          }
        };
        clearTreeResources(stickNodes, stickMesh, true, false);
        clearTreeResources(leafNodes, leafMesh, false, true);
        if (sticksChanged) flushInstanceBuffer(stickMesh);
        if (leavesChanged) flushInstanceBuffer(leafMesh);
        const woodYield = 2 + Math.floor(Math.random() * 6);
        const missingLogs = addToInventory('logs', woodYield);
        save();
        renderPanel();
        toast('Дерево срублено: +' + (woodYield - missingLogs) + ' древесины.' +
          (missingLogs ? ' Инвентарь заполнен.' : ' Через 10 минут оно вырастет на этом же месте.'));
      } else {
        save();
        toast('Удар по дереву: осталось ' + target.tree.health + '/' + TREE_HP + '.');
      }
      return;
    }

    if (target.type === 'scrap') {
      if (!['stoneAxe', 'stonePickaxe', 'ironAxe', 'ironPickaxe'].includes(selectedTool)) {
        toast('Для разбора старого металла нужен каменный или железный инструмент.');
        return;
      }
      const damage = selectedTool.startsWith('iron') ? 4 : 2;
      target.node.hp -= damage;
      if (target.node.hp <= 0) {
        unmarkResourcePosition(target.node);
        target.node.active = false;
        target.node.due = Date.now() + RESPAWN_MS;
        writeScrapNode(target.node, true);
        for (const mesh of scrapMeshes) flushInstanceBuffer(mesh);
        const amount = target.node.type === 2 ? 4 + Math.floor(Math.random() * 3) :
          target.node.type === 1 ? 3 + Math.floor(Math.random() * 2) :
          target.node.type === 3 ? 1 + Math.floor(Math.random() * 2) :
          2 + Math.floor(Math.random() * 2);
        const missing = addToInventory('ironScrap', amount);
        save();
        renderPanel();
        toast('Старый объект разобран: +' + (amount - missing) + ' железного лома.' +
          (missing ? ' Инвентарь заполнен.' : ' Через 5 минут объект заменится другим.'));
      } else {
        save();
        toast('Металл поддаётся: осталось ' + target.node.hp + ' прочности.');
      }
      return;
    }

    if (target.type === 'ironOre') {
      if (selectedTool !== 'stonePickaxe' && selectedTool !== 'ironPickaxe') {
        toast('Железную жилу можно добыть каменной или железной киркой.');
        return;
      }
      target.node.hp -= selectedTool === 'ironPickaxe' ? 9 : 4;
      if (target.node.hp <= 0) {
        unmarkResourcePosition(target.node);
        target.node.active = false;
        target.node.due = Date.now() + RESPAWN_MS;
        writeIronOreNode(target.node, true);
        flushInstanceBuffer(ironOreMesh);
        const amount = 2 + Math.floor(Math.random() * 3);
        const missing = addToInventory('ironOre', amount);
        save();
        renderPanel();
        toast('Железная жила добыта: +' + (amount - missing) + ' руды.' +
          (missing ? ' Инвентарь заполнен.' : ' Через 5 минут появится новая жила.'));
      } else {
        save();
        toast('Железная жила: осталось ' + target.node.hp + '/18 прочности.');
      }
      return;
    }

    // Stone deposits can be cracked by hand, but pickaxes make the work much faster.
    target.node.hp -= selectedTool === 'ironPickaxe' ? 12 :
      selectedTool === 'stonePickaxe' ? 6 : selectedTool === 'woodPickaxe' ? 3 : 1;
    if (target.node.hp <= 0) {
      unmarkResourcePosition(target.node);
      target.node.active = false;
      target.node.due = Date.now() + RESPAWN_MS;
      target.node.hp = STONE_HP;
      writeNode(target.node, true);
      flushInstanceBuffer(stoneMesh);
      const stoneYield = 2 + Math.floor(Math.random() * 3);
      const missingStone = addToInventory('stone', stoneYield);
      save();
      renderPanel();
      toast('Каменная глыба разрушена: +' + (stoneYield - missingStone) + ' камня.' +
        (missingStone ? ' Инвентарь заполнен.' : ' Через 5 минут она появится в другом месте.'));
    } else {
      save();
      toast('Камень раскалывается: осталось ' + target.node.hp + '/' + STONE_HP + '.');
    }
  }

  function writeNode(node, queueBufferUpdate = false) {
    if (!node.active) matrix.makeScale(0, 0, 0);
    else {
      rotation.setFromAxisAngle(up, node.angle);
      position.set(node.x, node.y + node.size * 0.56, node.z);
      scale.set(node.size * 1.08, node.size * 0.78, node.size);
      matrix.compose(position, rotation, scale);
    }
    stoneMesh.setMatrixAt(node.id, matrix);
    if (queueBufferUpdate) queueInstanceBufferRange(stoneMesh, node.id);
  }

  function readCellElement(target) {
    const cell = target && target.closest && target.closest('[data-cell-kind][data-cell-index]');
    if (!cell) return null;
    return { kind: cell.dataset.cellKind, index: Number(cell.dataset.cellIndex) };
  }

  function handleCellDrop(source, destination) {
    if (!source || !destination) return;
    selectedCell = null;
    if (!transferCell(source, destination)) renderPanel();
  }

  function bindCellInteractions(container) {
    container.addEventListener('click', (event) => {
      const cell = readCellElement(event.target);
      if (!cell) return;
      if (panelOpen) handleCellClick(cell.kind, cell.index);
      else if (cell.kind === 'hotbar') selectHotbarSlot(cell.index);
    });
    container.addEventListener('dragstart', (event) => {
      const cell = readCellElement(event.target);
      if (!cell || !getCell(cell.kind, cell.index)) {
        event.preventDefault();
        return;
      }
      selectedCell = cell;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', cell.kind + ':' + cell.index);
      }
      event.target.classList.add('moving');
    });
    container.addEventListener('dragover', (event) => {
      if (readCellElement(event.target)) event.preventDefault();
    });
    container.addEventListener('drop', (event) => {
      const destination = readCellElement(event.target);
      if (!destination) return;
      event.preventDefault();
      const encoded = event.dataTransfer && event.dataTransfer.getData('text/plain');
      let source = selectedCell;
      if (encoded) {
        const parts = encoded.split(':');
        if (parts.length === 2) source = { kind: parts[0], index: Number(parts[1]) };
      }
      handleCellDrop(source, destination);
    });
    container.addEventListener('dragend', () => {
      selectedCell = null;
      if (panelOpen) renderPanel();
    });
  }

  bindCellInteractions(resourceEl);
  bindCellInteractions(craftingGridEl);
  bindCellInteractions(hotbar);

  toggle.addEventListener('click', () => showPanel(!panelOpen));
  panel.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (close) showPanel(false);
  });
  craftOutputEl.addEventListener('click', () => takeCraftResult());
  mobileHit.addEventListener('click', () => hitTarget());

  window.addEventListener('keydown', (event) => {
    if (!mobileMode && event.code === 'KeyE' && !event.repeat) {
      event.preventDefault();
      showPanel(!panelOpen);
    } else if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
      const index = Number(event.code.slice(-1)) - 1;
      if (panelOpen && selectedCell) handleCellClick('hotbar', index);
      else selectHotbarSlot(index);
    } else if (event.code === 'Escape' && panelOpen) {
      showPanel(false);
    }
  });
  panel.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (!panelOpen) return;
    const cell = readCellElement(event.target);
    if (cell) splitOneFromCell(cell.kind, cell.index);
  });
  hotbar.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (!panelOpen) return;
    const cell = readCellElement(event.target);
    if (cell) splitOneFromCell(cell.kind, cell.index);
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || panelOpen) return;
    mouseHeld = true;
    hitTarget();
    hitCooldown = 0.42;
  });
  window.addEventListener('mouseup', () => { mouseHeld = false; });
  window.addEventListener('blur', () => { mouseHeld = false; });

  function update(dt) {
    messageCooldown = Math.max(0, messageCooldown - dt);
    hitCooldown = Math.max(0, hitCooldown - dt);
    toolSwing = Math.max(0, toolSwing - dt * toolSwingSpeed);
    if (toolSwing <= 0) toolAction = 'idle';
    viewModel.rotation.set(-0.12, 0, -0.28);
    viewModel.position.set(0.40, -0.34, -0.66);
    refreshHeldTool();
    animateHeldItem(dt);
    if (mouseHeld && hitCooldown <= 0) {
      hitTarget();
      hitCooldown = selectedTool === 'hands' ? 0.72 : 0.46;
    }
    let changed = false;
    let stoneBufferChanged = false;
    const now = Date.now();
    for (const node of nodes) {
      if (node.active || !node.due || now < node.due) continue;
      const oldPosition = { x: node.x, z: node.z };
      const nextPosition = findNodePosition(node.id, oldPosition);
      if (!nextPosition) {
        node.due = now + 15000;
        continue;
      }
      Object.assign(node, nextPosition, { active: true, hp: STONE_HP, due: 0 });
      markResourcePosition(node);
      writeNode(node, true);
      stoneBufferChanged = true;
      changed = true;
    }

    const gatherBufferChanged = new Set();
    const respawnGatherNodes = (list, mesh, isBranch, isLeaf = false, nearTree = false) => {
      let meshChanged = false;
      for (const node of list) {
        if (node.active || !node.due || now < node.due) continue;
        const oldPosition = { x: node.x, z: node.z };
        const nextPosition = nearTree ? findTreeGatherPosition(oldPosition) : findGatherPosition(oldPosition, isBranch ? 5 : 7);
        if (!nextPosition) { node.due = now + 15000; continue; }
        Object.assign(node, nextPosition, { active: true, hp: 1, due: 0 });
        markResourcePosition(node); writeGatherNode(node, mesh, isBranch, isLeaf, true); meshChanged = true;
      }
      if (meshChanged) { gatherBufferChanged.add(mesh); mesh.computeBoundingSphere(); changed = true; }
    };
    respawnGatherNodes(fiberNodes, fiberMesh, false);
    respawnGatherNodes(branchNodes, branchMesh, true);
    respawnGatherNodes(stickNodes, stickMesh, true, false, true);
    respawnGatherNodes(leafNodes, leafMesh, false, true, true);
    for (const mesh of gatherBufferChanged) flushInstanceBuffer(mesh);

    let scrapChanged = false;
    for (const node of scrapNodes) {
      if (node.active || !node.due || now < node.due) continue;
      const nextPosition = findGatherPosition({ x: node.x, z: node.z }, 9);
      if (!nextPosition) {
        node.due = now + 15000;
        continue;
      }
      Object.assign(node, nextPosition, { active: true, hp: 6, due: 0 });
      markResourcePosition(node);
      writeScrapNode(node, true);
      scrapChanged = true;
    }
    if (scrapChanged) {
      for (const mesh of scrapMeshes) {
        flushInstanceBuffer(mesh);
        mesh.computeBoundingSphere();
      }
      changed = true;
    }

    let oreChanged = false;
    for (const node of ironOreNodes) {
      if (node.active || !node.due || now < node.due) continue;
      const nextPosition = findGatherPosition({ x: node.x, z: node.z }, 11);
      if (!nextPosition) {
        node.due = now + 15000;
        continue;
      }
      Object.assign(node, nextPosition, { active: true, hp: 18, due: 0 });
      markResourcePosition(node);
      writeIronOreNode(node, true);
      oreChanged = true;
    }
    if (oreChanged) {
      flushInstanceBuffer(ironOreMesh);
      ironOreMesh.computeBoundingSphere();
      changed = true;
    }

    if (stoneBufferChanged) {
      flushInstanceBuffer(stoneMesh);
      // Respawned stone deposits may move, so refresh their frustum bounds.
      stoneMesh.computeBoundingSphere();
    }
    if (changed) {
      save();
      renderPanel();
    }
  }

  renderPanel();
  return {
    update,
    save,
    open() { showPanel(true); },
    close() { showPanel(false); },
    get inventory() { return inventory; },
    get selectedTool() { return selectedTool; },
    get activeStoneNodes() { return nodes.filter((node) => node.active).length + world.rocks.activeCount; },
  };
}
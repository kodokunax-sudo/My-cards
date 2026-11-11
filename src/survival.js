import * as THREE from 'three';

const SAVE_KEY = 'titan-survival-v1';
const NODE_COUNT = 500;
const RESPAWN_MS = 5 * 60 * 1000;
const TREE_HP = 12;
const STONE_HP = 12;

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); }
  catch (error) { return null; }
}

function numberOrZero(value) {
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) && valueNumber > 0 ? Math.floor(valueNumber) : 0;
}

export function createSurvival(scene, camera, canvas, world, player, hud) {
  const saved = loadSave();
  const inventory = {
    logs: 0, planks: 0, sticks: 0, stone: 0,
    woodAxe: false, woodPickaxe: false, stoneAxe: false, stonePickaxe: false,
  };
  const RESOURCE_IDS = ['logs', 'planks', 'sticks', 'stone'];
  const TOOL_IDS = ['woodAxe', 'woodPickaxe', 'stoneAxe', 'stonePickaxe'];
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
  let workbenchGroup = null;

  const savedTreeIds = saved && Array.isArray(saved.depletedTrees) ? saved.depletedTrees : [];
  for (const id of savedTreeIds) {
    if (Number.isInteger(id) && id >= 0) world.forests.removeById(id);
  }

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
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        inventory,
        inventorySlots,
        hotbarSlots,
        craftingGrid,
        selectedTool,
        selectedSlot,
        depletedTrees: world.forests.depletedIds || world.forests.trees.filter((tree) => tree.removed).map((tree) => tree.id),
        nodes: nodes.map((node) => ({
          x: node.x, y: node.y, z: node.z, size: node.size, angle: node.angle,
          active: node.active, hp: node.hp, due: node.due,
        })),
        workbench,
      }));
    } catch (error) {
      // Storage is optional; the current session remains playable without it.
    }
  }

  function findNodePosition(index, oldPosition) {
    for (let attempt = 0; attempt < 6500; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(340 * 340 + Math.random() * (5300 * 5300 - 340 * 340));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (!world.canSpawnResourceAt(x, z, 10)) continue;
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

  // First-person tool models: crafted tools appear in the lower-right camera view.
  const viewModel = new THREE.Group();
  viewModel.name = 'survival-held-tool';
  viewModel.position.set(0.40, -0.34, -0.66);
  camera.add(viewModel);
  const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x805a38, roughness: 0.96 });
  const woodHeadMaterial = new THREE.MeshStandardMaterial({ color: 0x513a27, roughness: 1 });
  const stoneHeadMaterial = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 1, flatShading: true });
  const metalEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0x92989a, roughness: 0.78, metalness: 0.18 });

  function toolPart(group, geometry, material, x, y, z, rotationZ = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotationZ;
    mesh.castShadow = false;
    mesh.userData.noCollider = true;
    group.add(mesh);
  }

  function makeHeldTool(type, stone) {
    const group = new THREE.Group();
    group.visible = false;
    toolPart(group, new THREE.CylinderGeometry(0.032, 0.045, 0.68, 9), handleMaterial, 0, -0.20, 0);
    const headMaterial = stone ? stoneHeadMaterial : woodHeadMaterial;
    if (type === 'axe') {
      toolPart(group, new THREE.BoxGeometry(0.32, 0.17, 0.13), headMaterial, -0.05, 0.17, 0);
      if (stone) toolPart(group, new THREE.BoxGeometry(0.075, 0.20, 0.145), metalEdgeMaterial, -0.205, 0.17, 0);
    } else {
      toolPart(group, new THREE.BoxGeometry(0.44, 0.10, 0.12), headMaterial, 0, 0.17, 0);
      toolPart(group, new THREE.ConeGeometry(0.075, 0.20, 6), headMaterial, -0.24, 0.17, 0, -Math.PI / 2);
      toolPart(group, new THREE.ConeGeometry(0.075, 0.20, 6), headMaterial, 0.24, 0.17, 0, Math.PI / 2);
    }
    viewModel.add(group);
    return group;
  }

  const heldTools = {
    woodAxe: makeHeldTool('axe', false),
    woodPickaxe: makeHeldTool('pickaxe', false),
    stoneAxe: makeHeldTool('axe', true),
    stonePickaxe: makeHeldTool('pickaxe', true),
  };
  const heldResources = {};
  function makeHeldResource(id) {
    const group = new THREE.Group();
    group.visible = false;
    if (id === 'logs') {
      toolPart(group, new THREE.CylinderGeometry(0.105, 0.105, 0.34, 8), woodHeadMaterial, 0, -0.08, 0, Math.PI / 2);
      toolPart(group, new THREE.CircleGeometry(0.105, 8), handleMaterial, 0, -0.08, 0.17);
    } else if (id === 'planks') {
      toolPart(group, new THREE.BoxGeometry(0.30, 0.19, 0.15), handleMaterial, 0, -0.08, 0);
    } else if (id === 'sticks') {
      toolPart(group, new THREE.CylinderGeometry(0.025, 0.025, 0.38, 6), handleMaterial, -0.045, -0.08, 0, -0.16);
      toolPart(group, new THREE.CylinderGeometry(0.025, 0.025, 0.38, 6), handleMaterial, 0.045, -0.08, 0, 0.16);
    } else {
      toolPart(group, new THREE.DodecahedronGeometry(0.15, 0), stoneHeadMaterial, 0, -0.08, 0);
    }
    viewModel.add(group);
    return group;
  }
  for (const id of ['logs', 'planks', 'sticks', 'stone']) heldResources[id] = makeHeldResource(id);
  let toolSwing = 0;

  function refreshHeldTool() {
    const activeStack = hotbarSlots[selectedSlot];
    selectedTool = activeStack && TOOL_IDS.includes(activeStack.id) ? activeStack.id : 'hands';
    for (const [id, group] of Object.entries(heldTools)) group.visible = selectedTool === id;
    const resourceIds = ['logs', 'planks', 'sticks', 'stone'];
    for (const id of resourceIds) {
      heldResources[id].visible = !!activeStack && activeStack.id === id && activeStack.count > 0;
    }
    const holdingResource = resourceIds.some((id) => heldResources[id].visible);
    viewModel.visible = (selectedTool !== 'hands' || holdingResource) &&
      player.mode !== 'cinematic' && !player.swimming;
  }

  refreshHeldTool();

  function addWorkbenchMesh() {
    if (!workbench || workbenchGroup) return;
    const group = new THREE.Group();
    group.name = 'survival-workbench';
    group.position.set(workbench.x, workbench.y, workbench.z);
    group.rotation.y = workbench.rotation || 0;
    const wood = new THREE.MeshStandardMaterial({ color: 0x765335, roughness: 0.96 });
    const top = new THREE.MeshStandardMaterial({ color: 0x9a7045, roughness: 0.94 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x66645d, roughness: 1, flatShading: true });
    const part = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.noCollider = true;
      group.add(mesh);
    };
    for (const x of [-0.58, 0.58]) {
      for (const z of [-0.34, 0.34]) {
        part(new THREE.BoxGeometry(0.14, 0.76, 0.14), wood, x, 0.38, z);
        part(new THREE.BoxGeometry(0.19, 0.13, 0.19), stone, x, 0.13, z);
      }
    }
    for (let i = 0; i < 3; i++) {
      part(new THREE.BoxGeometry(1.45, 0.14, 0.28), top, 0, 0.84, -0.28 + i * 0.28);
    }
    workbenchGroup = group;
    scene.add(group);
  }
  addWorkbenchMesh();

  const ui = document.getElementById('ui') || document.body;
  const toggle = document.createElement('button');
  toggle.id = 'survival-toggle';
  toggle.type = 'button';
  toggle.innerHTML = '<span class="inventory-key">E</span><span>ИНВЕНТАРЬ</span>';
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
            '<div class="inventory-footnote">Выбери ячейку, затем место назначения. Одинаковые предметы складываются.</div>' +
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
          '<div class="survival-foot"><span>Каменные залежи в мире</span><b id="survival-stone-count"></b></div>' +
        '</div>' +
      '</div>' +
      '<div class="inventory-bottom-hint">Выбери предмет → выбери слот · Перетаскивание работает мышью · E / I / ESC</div>' +
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
  };
  const itemNames = {
    logs: 'Дерево', planks: 'Доски', sticks: 'Палки', stone: 'Камень',
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

  const ITEM_MODELS = {
    logs: '<g stroke-linejoin="round"><path d="M14 24 42 12 56 20 28 33Z" fill="#bd8750" stroke="#65452a" stroke-width="2"/><path d="M14 24 28 33 28 51 14 42Z" fill="#89572f" stroke="#65452a" stroke-width="2"/><path d="M28 33 56 20 56 38 28 51Z" fill="#a96e3b" stroke="#65452a" stroke-width="2"/><ellipse cx="14" cy="33" rx="7" ry="9" fill="#d7a16a" stroke="#65452a" stroke-width="2"/><ellipse cx="14" cy="33" rx="3.5" ry="5" fill="none" stroke="#8e5b34" stroke-width="2"/></g>',
    planks: '<g stroke-linejoin="round" stroke="#704827" stroke-width="1.8"><path d="M10 33 40 20 55 28 25 42Z" fill="#d5a36a"/><path d="M10 33 25 42 25 50 10 41Z" fill="#956238"/><path d="M25 42 55 28 55 36 25 50Z" fill="#b77e49"/><path d="M15 22 43 10 54 16 26 29Z" fill="#e1b47d"/><path d="M15 22 26 29 26 36 15 29Z" fill="#a16b3e"/><path d="M26 29 54 16 54 23 26 36Z" fill="#c18b53"/></g>',
    sticks: '<g stroke-linecap="round" stroke-width="5"><path d="M20 49 43 12" stroke="#704728"/><path d="M20 49 43 12" stroke="#c18a54" stroke-width="2"/><path d="M34 49 51 24" stroke="#704728"/><path d="M34 49 51 24" stroke="#d2a16a" stroke-width="2"/></g>',
    stone: '<g stroke-linejoin="round" stroke="#484b4c" stroke-width="2"><path d="m9 39 7-17 14-8 17 7 9 15-9 14-22 4-15-6Z" fill="#898d8b"/><path d="m9 39 7-17 14-8-3 21-6 19-12-6Z" fill="#686e70"/><path d="m30 14 17 7 9 15-29-1Z" fill="#aeb1aa"/><path d="m27 35 29 1-9 14-22 4Z" fill="#777d7d"/><path d="m18 24 8-4 5 4-7 6Z" fill="#c3c3b8" opacity=".8"/></g>',
    woodAxe: '<g stroke-linejoin="round"><path d="m25 53 13-43 5 2-13 43Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m39 13 3-5 5 2-3 6Z" fill="#d39b61"/><path d="m34 19 5-11 17 3 2 9-10 8-12-2Z" fill="#a97443" stroke="#644324" stroke-width="2"/><path d="m39 9 17 2 5 8-10 1-14-4Z" fill="#c18b53"/></g>',
    woodPickaxe: '<g stroke-linejoin="round" stroke-linecap="round"><path d="m27 57 12-48 5 1-12 48Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="M12 22 24 13 41 17 55 9 59 14 43 27 24 23 14 29Z" fill="#a97443" stroke="#644324" stroke-width="3"/><path d="m13 22 11-9 17 4-5 5-13-2-7 8Z" fill="#d09a61"/></g>',
    stoneAxe: '<g stroke-linejoin="round"><path d="m25 55 13-45 5 2-13 45Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m38 14 5-12 18 4 1 15-12 8-13-4Z" fill="#7e8585" stroke="#42494b" stroke-width="2"/><path d="m43 4 18 2 1 15-8-4-12-2Z" fill="#b9bfbb"/><path d="m38 14 5-10 4 15-2 8Z" fill="#60696b"/></g>',
    stonePickaxe: '<g stroke-linejoin="round" stroke-linecap="round"><path d="m27 57 12-48 5 1-12 48Z" fill="#a46e3d" stroke="#583b25" stroke-width="2"/><path d="m10 21 14-13 19 5 12-6 7 7-17 15-22-5-11 6Z" fill="#7e8585" stroke="#42494b" stroke-width="3"/><path d="m24 8 19 5 19-6-7 9-17 6-19-5Z" fill="#b9bfbb"/></g>',
    workbench: '<g stroke-linejoin="round" stroke="#563a25" stroke-width="2"><path d="M10 20 35 8 57 20 31 33Z" fill="#d1a06b"/><path d="m10 20 21 13v23L10 44Z" fill="#94613a"/><path d="m31 33 26-13v24L31 56Z" fill="#754b2e"/><path d="m16 22 19-9 17 8-21 10Z" fill="#e2b77e"/><path d="M17 24 17 43M23 27 23 47M29 30 29 50M36 29 36 49M43 25 43 46" stroke="#563a25" stroke-width="1.5"/></g>',
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

  function findCraftRecipe() {
    const recipes = [
      { id: 'planks', output: 'planks', count: 4, width: 1, height: 1, cells: [{ x: 0, y: 0, id: 'logs' }] },
      { id: 'sticks', output: 'sticks', count: 4, width: 1, height: 2, cells: [{ x: 0, y: 0, id: 'planks' }, { x: 0, y: 1, id: 'planks' }] },
      { id: 'woodAxe', output: 'woodAxe', count: 1, width: 2, height: 3, cells: [
        { x: 0, y: 0, id: 'planks' }, { x: 1, y: 0, id: 'planks' },
        { x: 0, y: 1, id: 'planks' }, { x: 1, y: 1, id: 'sticks' },
        { x: 1, y: 2, id: 'sticks' },
      ] },
      { id: 'woodPickaxe', output: 'woodPickaxe', count: 1, width: 3, height: 3, cells: [
        { x: 0, y: 0, id: 'planks' }, { x: 1, y: 0, id: 'planks' }, { x: 2, y: 0, id: 'planks' },
        { x: 1, y: 1, id: 'sticks' }, { x: 1, y: 2, id: 'sticks' },
      ] },
      { id: 'workbench', output: 'workbench', count: 1, width: 2, height: 2, cells: [
        { x: 0, y: 0, id: 'planks' }, { x: 1, y: 0, id: 'planks' },
        { x: 0, y: 1, id: 'planks' }, { x: 1, y: 1, id: 'planks' },
      ] },
      { id: 'stoneAxe', output: 'stoneAxe', count: 1, width: 2, height: 3, bench: true, cells: [
        { x: 0, y: 0, id: 'stone' }, { x: 1, y: 0, id: 'stone' },
        { x: 0, y: 1, id: 'stone' }, { x: 1, y: 1, id: 'sticks' },
        { x: 1, y: 2, id: 'sticks' },
      ] },
      { id: 'stonePickaxe', output: 'stonePickaxe', count: 1, width: 3, height: 3, bench: true, cells: [
        { x: 0, y: 0, id: 'stone' }, { x: 1, y: 0, id: 'stone' }, { x: 2, y: 0, id: 'stone' },
        { x: 1, y: 1, id: 'sticks' }, { x: 1, y: 2, id: 'sticks' },
      ] },
    ];

    for (const recipe of recipes) {
      if (recipe.bench && !nearWorkbench()) continue;
      if (recipe.output === 'workbench' && workbench) continue;
      if (TOOL_IDS.includes(recipe.output) && inventory[recipe.output]) continue;
      for (const mirrored of [false, true]) {
        for (let offsetY = 0; offsetY <= 3 - recipe.height; offsetY++) {
          for (let offsetX = 0; offsetX <= 3 - recipe.width; offsetX++) {
            const expected = new Map();
            for (const part of recipe.cells) {
              const x = mirrored ? recipe.width - 1 - part.x : part.x;
              const index = (offsetY + part.y) * 3 + offsetX + x;
              expected.set(index, part.id);
            }
            let matches = true;
            for (let index = 0; index < 9; index++) {
              const stack = craftingGrid[index];
              const expectedId = expected.get(index);
              if (expectedId) {
                if (!stack || stack.id !== expectedId || stack.count < 1) { matches = false; break; }
              } else if (stack) {
                matches = false;
                break;
              }
            }
            if (matches) return { recipe, cells: [...expected.keys()] };
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
      model.innerHTML = itemModelMarkup(match.recipe.output);
      const count = document.createElement('span');
      count.className = 'slot-count';
      count.textContent = match.recipe.count > 1 ? String(match.recipe.count) : '';
      craftOutputEl.append(model, count);
    }
  }

  function takeCraftResult() {
    const match = findCraftRecipe();
    if (!match) return;
    const { recipe, cells } = match;
    if (recipe.output === 'workbench') {
      if (!placeWorkbench()) return;
    } else if (!canStoreItem(recipe.output, recipe.count)) {
      toast('В инвентаре нет места для результата.');
      return;
    }

    for (const index of cells) {
      const stack = craftingGrid[index];
      if (!stack) continue;
      stack.count -= 1;
      if (stack.count <= 0) craftingGrid[index] = null;
    }
    if (recipe.output !== 'workbench') {
      addToInventory(recipe.output, recipe.count);
    }
    selectedCell = null;
    syncInventoryTotals();
    save();
    renderPanel();
    toast(recipe.output === 'workbench' ? 'Верстак установлен.' : 'Предмет изготовлен.');
  }

  function renderPanel() {
    syncInventoryTotals();
    renderInventoryGrid();
    renderHotbar();
    renderCraftingGrid();
    refreshHeldTool();
    const activeStack = hotbarSlots[selectedSlot];
    heldNameEl.textContent = activeStack ? (itemNames[activeStack.id] || activeStack.id) : 'Руки';

    benchStatusEl.textContent = workbench
      ? (nearWorkbench() ? 'Верстак: рядом' : 'Верстак: установлен в мире')
      : 'Верстак: ещё не установлен';

    renderCraftingOutput();
    const active = nodes.filter((node) => node.active).length;
    nodeCountEl.textContent = active + ' / ' + NODE_COUNT;
    status.textContent = 'Слот ' + (selectedSlot + 1) + ' · ' +
      (activeStack ? (itemNames[activeStack.id] || activeStack.id) : 'Пусто') +
      ' · Камни на карте: ' + active + '/' + NODE_COUNT;
  }

  function selectHotbarSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= hotbarSlots.length) return;
    selectedSlot = index;
    syncInventoryTotals();
    save();
    renderHotbar();
    refreshHeldTool();
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
    if (panelOpen) {
      mouseHeld = false;
      if (player.unlock) player.unlock();
      renderPanel();
    }
  }

  function placeWorkbench() {
    if (workbench) return true;
    if (player.mode === 'fly' || player.swimming || !player.grounded) {
      toast('Верстак можно поставить только на земле.');
      return false;
    }
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const distances = [2.5, 3.2, 4.0];
    let chosen = null;
    for (const distance of distances) {
      const x = camera.position.x + forward.x * distance;
      const z = camera.position.z + forward.z * distance;
      const y = world.heightAt(x, z);
      if (!Number.isFinite(y) || world.getWaterRegionAt(x, z)) continue;
      if (world.forests.isNearTree(x, z, 1.65)) continue;
      chosen = { x, y, z, rotation: Math.atan2(forward.x, forward.z) };
      break;
    }
    if (!chosen) {
      toast('Рядом нет свободного места для верстака.');
      return false;
    }
    workbench = chosen;
    addWorkbenchMesh();
    return true;
  }

  function currentTarget() {
    raycaster.setFromCamera(center, camera);
    const localTrees = world.forests.getInteractiveMeshes(camera.position.x, camera.position.z);
    const hits = raycaster.intersectObjects(localTrees.concat(stoneMesh), false);
    for (const hit of hits) {
      if (hit.distance > 6.2 || hit.instanceId === undefined) continue;
      if (hit.object === stoneMesh) {
        const node = nodes[hit.instanceId];
        if (node && node.active) return { type: 'stone', node };
      } else {
        const tree = hit.object.userData.treeInstances && hit.object.userData.treeInstances[hit.instanceId];
        if (tree && !tree.removed) return { type: 'tree', tree };
      }
    }
    return null;
  }

  function hitTarget() {
    if (panelOpen || player.mode === 'fly' || player.swimming) return;
    toolSwing = 1;
    const target = currentTarget();
    if (!target) {
      if (messageCooldown <= 0) {
        messageCooldown = 0.6;
        toast('Наведи прицел на дерево или каменную глыбу.');
      }
      return;
    }

    if (target.type === 'tree') {
      const damage = selectedTool === 'stoneAxe' ? 8 : selectedTool === 'woodAxe' ? 4 : 1;
      target.tree.health = target.tree.health || TREE_HP;
      target.tree.health -= damage;
      if (target.tree.health <= 0) {
        world.forests.remove(target.tree);
        const woodYield = 2 + Math.floor(Math.random() * 6);
        const missingLogs = addToInventory('logs', woodYield);
        const missingSticks = addToInventory('sticks', 1);
        save();
        renderPanel();
        toast('Дерево срублено: +' + (woodYield - missingLogs) + ' древесины, +' + (1 - missingSticks) + ' палка.' +
          (missingLogs || missingSticks ? ' Инвентарь заполнен.' : ''));
      } else {
        toast('Удар по дереву: осталось ' + target.tree.health + '/' + TREE_HP + '.');
      }
      return;
    }

    if (selectedTool !== 'woodPickaxe' && selectedTool !== 'stonePickaxe') {
      toast('Для добычи камня нужна кирка. Сделай деревянную из досок и палок.');
      return;
    }
    target.node.hp -= selectedTool === 'stonePickaxe' ? 6 : 3;
    if (target.node.hp <= 0) {
      target.node.active = false;
      target.node.due = Date.now() + RESPAWN_MS;
      target.node.hp = STONE_HP;
      writeNode(target.node);
      stoneMesh.instanceMatrix.needsUpdate = true;
      const stoneYield = 2 + Math.floor(Math.random() * 3);
      const missingStone = addToInventory('stone', stoneYield);
      save();
      renderPanel();
      toast('Каменная глыба разрушена: +' + (stoneYield - missingStone) + ' камня.' +
        (missingStone ? ' Инвентарь заполнен.' : ' Через 5 минут она появится в другом месте.'));
    } else {
      toast('Камень раскалывается: осталось ' + target.node.hp + '/' + STONE_HP + '.');
    }
  }

  function writeNode(node) {
    if (!node.active) matrix.makeScale(0, 0, 0);
    else {
      rotation.setFromAxisAngle(up, node.angle);
      position.set(node.x, node.y + node.size * 0.56, node.z);
      scale.set(node.size * 1.08, node.size * 0.78, node.size);
      matrix.compose(position, rotation, scale);
    }
    stoneMesh.setMatrixAt(node.id, matrix);
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
    if ((event.code === 'KeyE' || event.code === 'KeyI') && !event.repeat) {
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
  panel.addEventListener('contextmenu', (event) => event.preventDefault());
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
    toolSwing = Math.max(0, toolSwing - dt * 3.8);
    const swingArc = Math.sin((1 - toolSwing) * Math.PI) * toolSwing;
    viewModel.rotation.x = -0.12 + swingArc * 0.78;
    viewModel.rotation.z = -0.28 - swingArc * 0.18;
    viewModel.position.y = -0.34 - swingArc * 0.045;
    refreshHeldTool();
    if (mouseHeld && hitCooldown <= 0) {
      hitTarget();
      hitCooldown = selectedTool === 'hands' ? 0.72 : 0.46;
    }
    let changed = false;
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
      writeNode(node);
      changed = true;
    }
    if (changed) {
      stoneMesh.instanceMatrix.needsUpdate = true;
      // Nodes respawn far away, so refresh the aggregate bounds used by frustum culling.
      stoneMesh.computeBoundingSphere();
      save();
      renderPanel();
    }
  }

  renderPanel();
  return {
    update,
    open() { showPanel(true); },
    close() { showPanel(false); },
    get inventory() { return inventory; },
    get selectedTool() { return selectedTool; },
    get activeStoneNodes() { return nodes.filter((node) => node.active).length; },
  };
}
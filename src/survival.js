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
    logs: numberOrZero(saved && saved.inventory && saved.inventory.logs),
    planks: numberOrZero(saved && saved.inventory && saved.inventory.planks),
    sticks: numberOrZero(saved && saved.inventory && saved.inventory.sticks),
    stone: numberOrZero(saved && saved.inventory && saved.inventory.stone),
    woodAxe: !!(saved && saved.inventory && saved.inventory.woodAxe),
    woodPickaxe: !!(saved && saved.inventory && saved.inventory.woodPickaxe),
    stoneAxe: !!(saved && saved.inventory && saved.inventory.stoneAxe),
    stonePickaxe: !!(saved && saved.inventory && saved.inventory.stonePickaxe),
  };
  let selectedTool = saved && ['hands', 'woodAxe', 'woodPickaxe', 'stoneAxe', 'stonePickaxe'].includes(saved.selectedTool)
    ? saved.selectedTool : 'hands';
  let selectedSlot = Number.isInteger(saved && saved.selectedSlot) && saved.selectedSlot >= 0 && saved.selectedSlot < 9
    ? saved.selectedSlot
    : selectedTool === 'hands' ? 2 : selectedTool.includes('Pickaxe') ? 1 : 0;
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
    for (const [id, group] of Object.entries(heldTools)) group.visible = selectedTool === id;
    const resourceIds = ['logs', 'planks', 'sticks', 'stone'];
    for (let index = 0; index < resourceIds.length; index++) {
      const id = resourceIds[index];
      heldResources[id].visible = selectedSlot === index + 3 && inventory[id] > 0;
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
      '<div class="survival-heading"><div><h2>ИНВЕНТАРЬ</h2><p>Предметы · инструменты · создание</p></div><button type="button" data-close aria-label="Закрыть инвентарь">×</button></div>' +
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
            '<div class="character-caption">Снаряжение</div>' +
            '<div class="character-held" id="survival-held-name">Руки</div>' +
          '</div>' +
          '<div class="inventory-items">' +
            '<div class="inventory-label">ПРЕДМЕТЫ</div>' +
            '<div class="survival-resources" id="survival-resources"></div>' +
            '<div class="inventory-footnote">Выбери предмет, чтобы назначить его в быстрый слот.</div>' +
          '</div>' +
        '</div>' +
        '<div class="inventory-right">' +
          '<div class="inventory-label">СОЗДАНИЕ ПРЕДМЕТОВ</div>' +
          '<div class="crafting-note" id="survival-bench-status"></div>' +
          '<div class="survival-recipes" id="survival-recipes"></div>' +
          '<div class="survival-foot"><span>Каменные залежи в мире</span><b id="survival-stone-count"></b></div>' +
        '</div>' +
      '</div>' +
      '<div class="inventory-bottom-hint">E / I или ESC · Выбор слота: 1–9 · ЛКМ: добыча ресурсов</div>' +
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
  const recipesEl = panel.querySelector('#survival-recipes');
  const nodeCountEl = panel.querySelector('#survival-stone-count');
  const toolNames = {
    hands: 'Руки',
    woodAxe: 'Деревянный топор',
    woodPickaxe: 'Деревянная кирка',
    stoneAxe: 'Каменный топор',
    stonePickaxe: 'Каменная кирка',
  };
  const recipes = [
    { id: 'planks', title: 'Доски ×4', cost: { logs: 1 }, text: '1 дерево' },
    { id: 'sticks', title: 'Палки ×4', cost: { planks: 2 }, text: '2 доски' },
    { id: 'woodAxe', title: 'Деревянный топор', cost: { planks: 3, sticks: 2 }, text: '3 доски · 2 палки' },
    { id: 'woodPickaxe', title: 'Деревянная кирка', cost: { planks: 3, sticks: 2 }, text: '3 доски · 2 палки' },
    { id: 'workbench', title: 'Верстак', cost: { planks: 6, stone: 6 }, text: '6 досок · 6 камней' },
    { id: 'stoneAxe', title: 'Каменный топор', cost: { stone: 3, sticks: 2 }, text: '3 камня · 2 палки', bench: true },
    { id: 'stonePickaxe', title: 'Каменная кирка', cost: { stone: 3, sticks: 2 }, text: '3 камня · 2 палки', bench: true },
  ];

  let panelOpen = false;
  let mouseHeld = false;
  let hitCooldown = 0;
  let messageCooldown = 0;
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector2(0, 0);

  function nearWorkbench() {
    return !!workbench && Math.hypot(camera.position.x - workbench.x, camera.position.z - workbench.z) <= 4.2;
  }

  function owns(id) {
    if (['woodAxe', 'woodPickaxe', 'stoneAxe', 'stonePickaxe'].includes(id)) return !!inventory[id];
    if (id === 'workbench') return !!workbench;
    return false;
  }

  function affordable(cost) {
    return Object.entries(cost).every(([key, amount]) => inventory[key] >= amount);
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

  const hotbarDefinitions = [
    { id: 'axe', name: 'Топор', modelId: 'woodAxe', kind: 'tool' },
    { id: 'pickaxe', name: 'Кирка', modelId: 'woodPickaxe', kind: 'tool' },
    { id: 'hands', name: 'Руки', modelId: 'hands', kind: 'hands' },
    { id: 'logs', name: 'Дерево', modelId: 'logs', kind: 'resource', resource: 'logs' },
    { id: 'planks', name: 'Доски', modelId: 'planks', kind: 'resource', resource: 'planks' },
    { id: 'sticks', name: 'Палки', modelId: 'sticks', kind: 'resource', resource: 'sticks' },
    { id: 'stone', name: 'Камень', modelId: 'stone', kind: 'resource', resource: 'stone' },
    { id: 'empty-8', name: 'Пустой слот', modelId: null, kind: 'empty' },
    { id: 'empty-9', name: 'Пустой слот', modelId: null, kind: 'empty' },
  ];

  function slotState(index) {
    const definition = hotbarDefinitions[index];
    if (!definition) return { ...hotbarDefinitions[8], hasItem: false, count: 0 };
    if (definition.kind === 'tool') {
      const toolId = definition.id === 'axe'
        ? (inventory.stoneAxe ? 'stoneAxe' : inventory.woodAxe ? 'woodAxe' : null)
        : (inventory.stonePickaxe ? 'stonePickaxe' : inventory.woodPickaxe ? 'woodPickaxe' : null);
      const modelId = toolId || (definition.id === 'axe' ? 'woodAxe' : 'woodPickaxe');
      return { ...definition, toolId, modelId, hasItem: !!toolId, count: toolId ? 1 : 0 };
    }
    if (definition.kind === 'hands') return { ...definition, hasItem: true, count: 0 };
    if (definition.kind === 'resource') {
      const count = inventory[definition.resource] || 0;
      return { ...definition, hasItem: count > 0, count };
    }
    return { ...definition, hasItem: false, count: 0 };
  }

  function createHotbarSlot(index, compact = false) {
    const item = slotState(index);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotbar-slot' + (compact ? ' compact' : '') +
      (selectedSlot === index ? ' selected' : '') + (!item.hasItem ? ' empty' : '');
    button.dataset.slot = String(index);
    button.disabled = !item.hasItem;
    button.setAttribute('aria-pressed', selectedSlot === index ? 'true' : 'false');
    button.setAttribute('aria-label', (index + 1) + ': ' + item.name +
      (item.count > 0 ? ', количество ' + item.count : ''));

    const key = document.createElement('span');
    key.className = 'slot-key';
    key.textContent = String(index + 1);
    const icon = document.createElement('span');
    icon.className = 'slot-model-wrap';
    icon.innerHTML = item.hasItem && item.modelId ? itemModelMarkup(item.modelId) : '';
    const count = document.createElement('span');
    count.className = 'slot-count';
    count.textContent = item.kind === 'resource' && item.count > 0 ? String(item.count) : '';
    button.append(key, icon, count);
    return button;
  }

  function renderHotbar() {
    hotbar.replaceChildren(...hotbarDefinitions.map((item, index) => createHotbarSlot(index)));
  }

  function renderInventoryGrid() {
    const items = [
      { id: 'logs', name: 'Дерево', count: inventory.logs, slot: 3 },
      { id: 'planks', name: 'Доски', count: inventory.planks, slot: 4 },
      { id: 'sticks', name: 'Палки', count: inventory.sticks, slot: 5 },
      { id: 'stone', name: 'Камень', count: inventory.stone, slot: 6 },
      { id: 'woodAxe', name: 'Деревянный топор', count: inventory.woodAxe ? 1 : 0, slot: 0 },
      { id: 'woodPickaxe', name: 'Деревянная кирка', count: inventory.woodPickaxe ? 1 : 0, slot: 1 },
      { id: 'stoneAxe', name: 'Каменный топор', count: inventory.stoneAxe ? 1 : 0, slot: 0 },
      { id: 'stonePickaxe', name: 'Каменная кирка', count: inventory.stonePickaxe ? 1 : 0, slot: 1 },
    ].filter((item) => item.count > 0);
    if (workbench) items.push({ id: 'workbench', name: 'Верстак', count: 1, slot: null });

    resourceEl.replaceChildren();
    items.slice(0, 27).forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-slot';
      button.title = item.name;
      button.setAttribute('aria-label', item.name + ', количество ' + item.count);
      if (item.slot === null) button.disabled = true;
      else button.dataset.slot = String(item.slot);

      const model = document.createElement('span');
      model.className = 'slot-model-wrap';
      model.innerHTML = itemModelMarkup(item.id);
      const count = document.createElement('span');
      count.className = 'slot-count';
      count.textContent = String(item.count);
      button.append(model, count);
      resourceEl.appendChild(button);
    });

    while (resourceEl.children.length < 27) {
      const empty = document.createElement('div');
      empty.className = 'inventory-slot empty';
      empty.setAttribute('aria-hidden', 'true');
      resourceEl.appendChild(empty);
    }
  }
  function renderPanel() {
    refreshHeldTool();
    renderInventoryGrid();
    renderHotbar();
    heldNameEl.textContent = toolNames[selectedTool];

    const atBench = nearWorkbench();
    benchStatusEl.textContent = workbench
      ? (atBench ? 'Верстак рядом: каменные инструменты доступны.' : 'Верстак уже установлен. Подойди к нему для каменного крафта.')
      : 'Для каменных инструментов сначала создай и поставь верстак.';

    recipesEl.replaceChildren();
    recipes.forEach((recipe) => {
      const owned = owns(recipe.id);
      const canCraftHere = !recipe.bench || atBench;
      const row = document.createElement('div');
      row.className = 'survival-recipe';

      const output = document.createElement('div');
      output.className = 'recipe-output';
      output.innerHTML = itemModelMarkup(recipe.id === 'planks' || recipe.id === 'sticks' ? recipe.id : recipe.id);
      const info = document.createElement('div');
      info.className = 'recipe-info';
      const title = document.createElement('b');
      title.textContent = recipe.title;
      const needs = document.createElement('div');
      needs.className = 'recipe-needs';
      Object.entries(recipe.cost).forEach(([key, amount]) => {
        const need = document.createElement('span');
        need.className = 'recipe-need';
        need.innerHTML = itemModelMarkup(key) + '<b>' + amount + '</b>';
        needs.appendChild(need);
      });
      info.append(title, needs);

      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.craft = recipe.id;
      button.textContent = owned ? 'ГОТОВО' : recipe.bench && !canCraftHere ? 'ВЕРСТАК' : 'СОЗДАТЬ';
      button.disabled = owned || !affordable(recipe.cost) || !canCraftHere;
      row.append(output, info, button);
      recipesEl.appendChild(row);
    });

    const active = nodes.filter((node) => node.active).length;
    nodeCountEl.textContent = active + ' / ' + NODE_COUNT;
    status.textContent = 'Слот ' + (selectedSlot + 1) + ' · ' + toolNames[selectedTool] +
      ' · Камни на карте: ' + active + '/' + NODE_COUNT;
  }

  function selectHotbarSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= hotbarDefinitions.length) return;
    const item = slotState(index);
    if (!item.hasItem) return;
    selectedSlot = index;
    selectedTool = item.toolId || 'hands';
    save();
    renderHotbar();
    if (panelOpen) {
      renderInventoryGrid();
      toolsEl.replaceChildren(...hotbarDefinitions.map((slot, slotIndex) => createHotbarSlot(slotIndex, true)));
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

  function craft(id) {
    const recipe = recipes.find((item) => item.id === id);
    if (!recipe || owns(id)) return;
    if (recipe.bench && !nearWorkbench()) {
      toast('Для каменных инструментов подойди к верстаку.');
      return;
    }
    if (!affordable(recipe.cost)) {
      toast('Не хватает ресурсов.');
      return;
    }
    if (id === 'workbench' && !placeWorkbench()) return;
    Object.entries(recipe.cost).forEach(([key, amount]) => { inventory[key] -= amount; });
    if (id === 'planks') inventory.planks += 4;
    else if (id === 'sticks') inventory.sticks += 4;
    else if (['woodAxe', 'woodPickaxe', 'stoneAxe', 'stonePickaxe'].includes(id)) {
      inventory[id] = true;
      selectedTool = id;
      selectedSlot = id.includes('Pickaxe') ? 1 : 0;
    }
    save();
    renderPanel();
    toast('Создано: ' + recipe.title);
  }

  function equip(id) {
    if (id !== 'hands' && !inventory[id]) return;
    selectedTool = id;
    selectedSlot = id === 'hands' ? 2 : id.includes('Pickaxe') ? 1 : 0;
    save();
    renderPanel();
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
        inventory.logs += woodYield;
        inventory.sticks += 1;
        save();
        renderPanel();
        toast('Дерево срублено: +' + woodYield + ' древесины, +1 палка.');
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
      inventory.stone += stoneYield;
      save();
      renderPanel();
      toast('Каменная глыба разрушена: +' + stoneYield + ' камня. Через 5 минут она появится в другом месте.');
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

  toggle.addEventListener('click', () => showPanel(!panelOpen));
  hotbar.addEventListener('click', (event) => {
    const slot = event.target.closest('[data-slot]');
    if (slot) selectHotbarSlot(Number(slot.dataset.slot));
  });
  panel.addEventListener('click', (event) => {
    const target = event.target;
    const close = target.closest('[data-close]');
    const craftButton = target.closest('[data-craft]');
    const slot = target.closest('[data-slot]');
    if (close) showPanel(false);
    else if (craftButton) craft(craftButton.dataset.craft);
    else if (slot) selectHotbarSlot(Number(slot.dataset.slot));
  });
  mobileHit.addEventListener('click', () => hitTarget());

  window.addEventListener('keydown', (event) => {
    if ((event.code === 'KeyE' || event.code === 'KeyI') && !event.repeat) {
      event.preventDefault();
      showPanel(!panelOpen);
    } else if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
      selectHotbarSlot(Number(event.code.slice(-1)) - 1);
    } else if (event.code === 'Digit0' && !event.repeat) {
      selectHotbarSlot(2);
    } else if (event.code === 'Escape' && panelOpen) {
      showPanel(false);
    }
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
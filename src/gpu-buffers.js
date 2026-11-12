import * as THREE from 'three';

/**
 * Configure an InstancedMesh matrix buffer that changes after construction.
 * Usage must be selected before the first render uploads the buffer.
 */
export function configureDynamicInstanceBuffer(mesh) {
  const attribute = mesh && mesh.instanceMatrix;
  if (!attribute) return false;

  if (typeof attribute.setUsage === 'function') {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.userData = mesh.userData || {};
  mesh.userData.dynamicInstanceBuffer = true;
  return true;
}

/**
 * Queue one instance matrix for a partial GPU upload.
 * Offsets are measured in attribute components, not bytes.
 */
export function queueInstanceBufferRange(mesh, instanceId) {
  const attribute = mesh && mesh.instanceMatrix;
  if (!attribute || !Number.isInteger(instanceId) || instanceId < 0) return false;

  if (typeof attribute.addUpdateRange === 'function') {
    const itemSize = Number(attribute.itemSize) || 16;
    attribute.addUpdateRange(instanceId * itemSize, itemSize);
  }
  return true;
}

/** Flush all queued instance matrix ranges to the GPU on the next render. */
export function flushInstanceBuffer(mesh) {
  const attribute = mesh && mesh.instanceMatrix;
  if (!attribute) return false;
  attribute.needsUpdate = true;
  return true;
}

/**
 * Pack the terrain's position, normal, color and UV attributes into one
 * interleaved GPU vertex buffer. The source arrays are CPU-side build data;
 * this runs before the geometry's first render/upload.
 */
export function interleaveStaticGeometryVBO(geometry) {
  if (!geometry || !geometry.attributes) return null;

  const names = ['position', 'normal', 'color', 'uv'];
  const attributes = names.map((name) => geometry.getAttribute(name));
  if (attributes.some((attribute) => !attribute || !attribute.isBufferAttribute ||
    attribute.isInterleavedBufferAttribute || attribute.isInstancedBufferAttribute ||
    !(attribute.array instanceof Float32Array))) return null;

  const vertexCount = attributes[0].count;
  if (!vertexCount || attributes.some((attribute) => attribute.count !== vertexCount)) return null;

  const stride = attributes.reduce((total, attribute) => total + attribute.itemSize, 0);
  if (!Number.isInteger(stride) || stride <= 0) return null;

  const packed = new Float32Array(vertexCount * stride);
  const offsets = [];
  let offset = 0;

  for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex++) {
    const attribute = attributes[attributeIndex];
    offsets.push(offset);
    const source = attribute.array;
    const itemSize = attribute.itemSize;

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      const sourceStart = vertex * itemSize;
      const targetStart = vertex * stride + offset;
      for (let component = 0; component < itemSize; component++) {
        packed[targetStart + component] = source[sourceStart + component];
      }
    }
    offset += itemSize;
  }

  const interleaved = new THREE.InterleavedBuffer(packed, stride);
  interleaved.setUsage(THREE.StaticDrawUsage);

  for (let index = 0; index < names.length; index++) {
    const attribute = attributes[index];
    geometry.setAttribute(names[index], new THREE.InterleavedBufferAttribute(
      interleaved, attribute.itemSize, offsets[index], attribute.normalized
    ));
  }

  geometry.userData = geometry.userData || {};
  geometry.userData.interleavedVBO = true;
  geometry.userData.interleavedVBOBytes = packed.byteLength;
  geometry.userData.interleavedVBOAttributes = names.slice();

  return {
    vertexCount,
    stride,
    bytes: packed.byteLength,
    attributes: names.length,
  };
}

// Test voxel indexing to verify Y-axis orientation
// For a 32x32x32 chunk with index = Z * 1024 + Y * 32 + X

// Bottom-left-front corner (0,0,0)
const idx_000 = 0 * 1024 + 0 * 32 + 0;
console.log(`Voxel (0,0,0) → index ${idx_000}`);

// Bottom-right-front corner (31,0,0)
const idx_310 = 0 * 1024 + 0 * 32 + 31;
console.log(`Voxel (31,0,0) → index ${idx_310}`);

// Top-left-front corner (0,31,0)
const idx_0310 = 0 * 1024 + 31 * 32 + 0;
console.log(`Voxel (0,31,0) → index ${idx_0310}`);

// Bottom-left-back corner (0,0,31)
const idx_0031 = 31 * 1024 + 0 * 32 + 0;
console.log(`Voxel (0,0,31) → index ${idx_0031}`);

console.log('\nFor terrain at height 76.8:');
console.log('Chunk (0,0,0) Y=0-31: All voxels should be SOLID');
console.log('Chunk (0,1,0) Y=32-63: All voxels should be SOLID');
console.log('Chunk (0,2,0) Y=64-95: Y<77 solid, Y>=77 air → ~13 solid layers');
console.log('Chunk (0,3,0) Y=96-127: All voxels should be AIR');

console.log('\nIf world is "upside down", we would see:');
console.log('- Air below (chunks 0,1)');
console.log('- Solid above (chunks 2,3)');
console.log('- Camera falling through terrain');

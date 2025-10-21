// Manual SVDAG decoder to verify structure
const nodes = [0, 5, 4, 4, 0, 5, 8, 8, 0, 5, 12, 12, 0, 5, 16, 16, 0, 5, 20, 20, 1, 0, 0];
const leaves = [1];

function decodeNode(idx, depth = 0) {
  const indent = '  '.repeat(depth);
  const tag = nodes[idx];
  const data = nodes[idx + 1];
  
  console.log(`${indent}Node @${idx}, depth=${depth}:`);
  
  if (tag === 1) {
    console.log(`${indent}  LEAF: leaf_idx=${data}, block_id=${leaves[data]}`);
    return;
  }
  
  // Inner node
  const childMask = data;
  console.log(`${indent}  INNER: childMask=${childMask.toString(2).padStart(8, '0')} (${childMask})`);
  
  let childSlot = 0;
  for (let octant = 0; octant < 8; octant++) {
    if (childMask & (1 << octant)) {
      const childIdx = nodes[idx + 2 + childSlot];
      console.log(`${indent}    Octant ${octant}: child @${childIdx}`);
      decodeNode(childIdx, depth + 1);
      childSlot++;
    }
  }
}

console.log('Decoding SVDAG for chunk (0,1,0):');
console.log('Root at index 0, maxDepth should be 5 (32^3 chunk = 2^5)');
console.log('');
decodeNode(0);

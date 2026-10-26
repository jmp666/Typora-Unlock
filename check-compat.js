// check-compat.js —— 检测任意 Typora 版本是否兼容本补丁
// 用法: node check-compat.js <path-to-app.asar>
const fs = require('fs'), path = require('path');

function extract(src, out) {
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
  const hdrSize = head.readUInt32LE(12);
  const hdr = Buffer.alloc(hdrSize); fs.readSync(fd, hdr, 0, hdrSize, 16);
  const json = JSON.parse(hdr.slice(0, hdr.readUInt32LE(4)).toString('utf8'));
  const base = 8 + head.readUInt32LE(4);
  const res = {};
  function walk(node, p) {
    for (const [k, v] of Object.entries(node.files || {})) {
      const q = path.join(p, k);
      if (v.files) { walk(v, q); }
      else if (v.unpacked) { res[q] = Buffer.alloc(0); }
      else {
        const off = Number(v.offset);
        if (!Number.isFinite(off) || !Number.isFinite(v.size)) { res[q] = Buffer.alloc(0); continue; }
        const b = Buffer.alloc(v.size);
        if (v.size) fs.readSync(fd, b, 0, v.size, base + off);
        res[q] = b;
      }
    }
  }
  walk(json, '');
  fs.closeSync(fd);
  return res;
}

const asar = process.argv[2];
if (!asar) { console.log('用法: node check-compat.js <app.asar>'); process.exit(1); }

const files = extract(asar);
const pkg = JSON.parse(files['package.json'].toString('utf8'));
console.log('=== Typora ' + pkg.version + ' (releaseId ' + pkg.releaseId + ') ===');
console.log('main 入口: ' + pkg.main);

const checks = [
  ['launch.dist.js 存在', !!files['launch.dist.js']],
  ['atom.compiled.dist.jsc 存在', !!files['atom.compiled.dist.jsc']],
  ['main 可重定向 (launch.dist.js 或 unlock.js)', pkg.main === 'launch.dist.js' || pkg.main === 'unlock.js'],
];

const jsc = files['atom.compiled.dist.jsc'];
if (jsc) {
  const s = jsc.toString('latin1');
  const anchors = [
    'File.option.hasLicense = false',
    'license.html',
    'dayRemains=',
    'UNREGISTERED',
    'watch L',
    'onUnfillLicense',
    'trailRemains',
    'profile.data',
    '_iD',
    'IDate',
    'renewLicense',
  ];
  console.log('\n--- jsc 锚点检测 ---');
  let ok = 0;
  for (const a of anchors) {
    const found = s.includes(a);
    if (found) ok++;
    console.log('  ' + (found ? '✓' : '✗') + ' ' + a);
  }
  checks.push(['锚点完整度 ' + ok + '/' + anchors.length, ok === anchors.length]);
  checks.push(['锚点关键子集 (前4项)', anchors.slice(0, 4).every(a => s.includes(a))]);
}

console.log('\n--- 结论 ---');
let allOk = true;
for (const [name, pass] of checks) {
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name);
  if (!pass) allOk = false;
}
console.log('\n' + (allOk ? '✅ 兼容：可直接部署本补丁' : '⚠️  部分不兼容：需调整'));

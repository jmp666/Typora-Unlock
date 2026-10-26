const fs=require('fs'),path=require('path');
function collect(dir){ const files={}; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const full=path.join(dir,e.name);
  if(e.isDirectory()) files[e.name]={files:collect(full)}; else files[e.name]={size:fs.statSync(full).size, offset:'0', executable:false}; } return files; }
function flatten(node, prefix, out){ for(const [k,v] of Object.entries(node.files||{})){ if(v.files) flatten(v, prefix+k+'/', out); else out.push({key:prefix+k,node:v}); } }
const src=process.argv[2], dst=process.argv[3];
const root=collect(src); const flat=[]; flatten({files:root},'',flat);
let offset=0; const bufs=[];
for(const f of flat){ const buf=fs.readFileSync(path.join(src,f.key)); f.node.size=buf.length; f.node.offset=String(offset); offset+=buf.length; bufs.push(buf); }
const headerBuf=Buffer.from(JSON.stringify({files:root}),'utf8');
const headerSize=headerBuf.length, padding=(4-(headerSize%4))%4, headerTotal=headerSize+padding;
const prefix=Buffer.alloc(16); prefix.writeUInt32LE(4,0); prefix.writeUInt32LE(8+headerTotal,4); prefix.writeUInt32LE(4+headerTotal,8); prefix.writeUInt32LE(headerSize,12);
const out=fs.openSync(dst,'w'); fs.writeSync(out,prefix,0,16,0); fs.writeSync(out,headerBuf,0,headerSize,16);
if(padding) fs.writeSync(out,Buffer.alloc(padding),0,padding,16+headerSize);
let pos=16+headerTotal; for(const b of bufs){ fs.writeSync(out,b,0,b.length,pos); pos+=b.length; }
fs.closeSync(out); console.log('packed NO-INTEGRITY', dst, fs.statSync(dst).size);

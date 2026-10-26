const fs=require('fs'),path=require('path');
const src=process.argv[2], out=process.argv[3];
const fd=fs.openSync(src,'r');
const head=Buffer.alloc(16); fs.readSync(fd,head,0,16,0);
const hdrSize=head.readUInt32LE(12);
const hdr=Buffer.alloc(hdrSize); fs.readSync(fd,hdr,0,hdrSize,16);
const json=JSON.parse(hdr.slice(0,hdr.readUInt32LE(4)).toString('utf8'));
const base=8+head.readUInt32LE(4);
function walk(node,p){ for(const [k,v] of Object.entries(node.files||{})){ const q=path.join(p,k); if(v.files){ fs.mkdirSync(path.join(out,q),{recursive:true}); walk(v,path.join(p,k)); } else { const b=Buffer.alloc(v.size); if(v.size) fs.readSync(fd,b,0,v.size,base+Number(v.offset)); fs.mkdirSync(path.dirname(path.join(out,q)),{recursive:true}); fs.writeFileSync(path.join(out,q),b); } } }
fs.mkdirSync(out,{recursive:true}); walk(json,'');
console.log('extracted to',out);

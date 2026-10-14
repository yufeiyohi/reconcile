import { readFile, readdir, writeFile } from 'node:fs/promises';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const seen=new Set(), sections=[];
for(const [folder,entry] of Object.entries(lock.packages)){
  if(!folder||entry.dev||!folder.includes('node_modules/'))continue;
  let pkg, files;try{pkg=JSON.parse(await readFile(folder+'/package.json','utf8'));files=await readdir(folder);}catch{continue;}
  const key=pkg.name+'@'+pkg.version;if(seen.has(key))continue;seen.add(key);
  const names=files.filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\.|-|$)/i.test(n)).sort();
  const texts=[];for(const name of names){try{texts.push((await readFile(folder+'/'+name,'utf8')).replaceAll('\r\n','\n'));}catch{}}
  sections.push(`===== ${key} =====\nLicense: ${pkg.license||entry.license||'See upstream package'}\n${texts.join('\n')||'License metadata is included in this installed package; consult its upstream distribution for full terms.'}`);
}
sections.sort();await writeFile('THIRD-PARTY-NOTICES.txt','Third-party production dependency notices. Generated from the installed lockfile packages.\n\n'+sections.join('\n\n').trimEnd()+'\n');
console.log(`Recorded ${sections.length} production dependency notices.`);

// Saf Node modulu (electron'a bagimli degil) - test edilebilir.
// Amac: kayit islemleri arayuzu (klavye girdisini) bekletmesin.
const fs = require('fs');
const path = require('path');

function createStore(dataDir, opts){
  opts = opts || {};
  const gecikmeMs = opts.gecikmeMs != null ? opts.gecikmeMs : 400;
  const writerId = opts.writerId || '';
  const yedekAraligiMs = opts.yedekAraligiMs != null ? opts.yedekAraligiMs : 10*60*1000;
  const dataFile = path.join(dataDir, 'psys-data.json');
  const backupDir = path.join(dataDir, 'yedekler');
  let cache = null;
  let dirty = false;
  let writing = false;
  let timer = null;
  let lastBackup = 0;

  function ensureDirs(){
    if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if(!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  }
  function load(){
    if(cache) return cache;
    ensureDirs();
    try{ cache = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {}; }
    catch(e){ cache = {}; }
    return cache;
  }
  async function yedekAl(json){
    try{
      const today = new Date().toISOString().slice(0,10);
      await fs.promises.writeFile(path.join(backupDir, `psys-data-${today}.json`), json, 'utf8');
      const files = (await fs.promises.readdir(backupDir)).filter(f=>f.startsWith('psys-data-')).sort();
      if(files.length > 30){
        for(const f of files.slice(0, files.length-30)){ try{ await fs.promises.unlink(path.join(backupDir,f)); }catch(e){} }
      }
    }catch(e){}
  }
  async function flush(){
    if(!dirty || !cache) return;
    if(writing) return; // yazma bitince tekrar denenecek
    writing = true; dirty = false;
    if(writerId) cache.__meta = { lastWriterId: writerId, lastSavedAt: Date.now() };
    const json = JSON.stringify(cache);
    try{
      ensureDirs();
      const tmp = dataFile + '.tmp';
      await fs.promises.writeFile(tmp, json, 'utf8');
      await fs.promises.rename(tmp, dataFile);
      if(Date.now() - lastBackup > yedekAraligiMs){ lastBackup = Date.now(); await yedekAl(json); }
    }catch(e){ dirty = true; }
    writing = false;
    if(dirty) schedule();
  }
  function schedule(){
    if(timer) return;
    timer = setTimeout(()=>{ timer = null; flush(); }, gecikmeMs);
  }
  function flushSync(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(dirty && cache){
      try{
        ensureDirs();
        if(writerId) cache.__meta = { lastWriterId: writerId, lastSavedAt: Date.now() };
        const tmp = dataFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
        fs.renameSync(tmp, dataFile);
        dirty = false;
      }catch(e){}
    }
  }
  return {
    get(key){ const d = load(); return (key in d) ? { key, value: d[key] } : null; },
    set(key, value){ const d = load(); d[key] = value; dirty = true; schedule(); return { key, value }; },
    del(key){ const d = load(); const existed = key in d; delete d[key]; dirty = true; schedule(); return { key, deleted: existed }; },
    list(prefix){ const d = load(); return { keys: Object.keys(d).filter(k => !prefix || k.startsWith(prefix)) }; },
    flushSync,
    invalidate(){ flushSync(); cache = null; },
    _durumu(){ return { dirty, writing, cacheVar: !!cache }; }
  };
}
module.exports = { createStore };

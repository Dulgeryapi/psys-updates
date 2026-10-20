// Saf Node modulu (electron'a bagimli degil) - test edilebilir.
// Amac: kayit islemleri arayuzu (klavye girdisini) bekletmesin.
// GUVENLIK: her gercek diske yazma aninda (flush), dosya TAZE okunur ve SADECE
// bu instance'in kendi bekleyen degisiklikleri uygulanir - baska bir bilgisayarin
// bu arada yazdigi, henuz bizim tarafimizdan gorulmemis diger anahtarlar KORUNUR.
const fs = require('fs');
const path = require('path');

function createStore(dataDir, opts){
  opts = opts || {};
  const gecikmeMs = opts.gecikmeMs != null ? opts.gecikmeMs : 400;
  const writerId = opts.writerId || '';
  const yedekAraligiMs = opts.yedekAraligiMs != null ? opts.yedekAraligiMs : 10*60*1000;
  const dataFile = path.join(dataDir, 'psys-data.json');
  const backupDir = path.join(dataDir, 'yedekler');
  let pendingSet = {};       // {key: value} - henuz diske yazilmamis, bu instance'in yaptigi degisiklikler
  let pendingDel = new Set(); // bu instance'in sildigi, henuz diske yansimamis anahtarlar
  let lastKnownDisk = null;  // en son (biz ya da baskasi tarafindan) diskten okunan TUM veri - sadece okuma icin referans
  let lastKnownMtimeMs = 0;
  let dirty = false;
  let writing = false;
  let timer = null;
  let lastBackup = 0;

  function ensureDirs(){
    if(!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if(!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  }
  function dosyayiTazeOku(){
    ensureDirs();
    try{
      if(!fs.existsSync(dataFile)) return {};
      const veri = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      try{ lastKnownMtimeMs = fs.statSync(dataFile).mtimeMs; }catch(e){}
      return veri;
    }catch(e){ return {}; }
  }
  // ASENKRON versiyon - Yandex/bulut senkron klasorlerinde dosya "sanal" (henuz
  // tam inmemis) olabilir; boyle durumda okuma gecikebilir. Senkron versiyon (readFileSync)
  // bu gecikme suresince TUM main process'i (ve dolayisiyla programin tepki vermesini) bloke
  // ederdi. Bu asenkron versiyon, gecikme olsa bile sureci bloke etmez - kullanici yazmaya,
  // tiklamaya devam edebilir, islem arka planda bitince devam eder.
  async function dosyayiTazeOkuAsync(){
    ensureDirs();
    try{
      if(!fs.existsSync(dataFile)) return {};
      const raw = await fs.promises.readFile(dataFile, 'utf8');
      const veri = JSON.parse(raw);
      try{ const st = await fs.promises.stat(dataFile); lastKnownMtimeMs = st.mtimeMs; }catch(e){}
      return veri;
    }catch(e){ return {}; }
  }
  function okumaReferansiGetir(){
    if(!lastKnownDisk) lastKnownDisk = dosyayiTazeOku();
    return lastKnownDisk;
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
    if(!dirty) return;
    if(writing) return; // yazma bitince tekrar denenecek (dirty hala true kalirsa)
    writing = true; dirty = false;
    const uygulanacakSet = pendingSet; pendingSet = {};
    const uygulanacakDel = pendingDel; pendingDel = new Set();
    try{
      const tazeVeri = await dosyayiTazeOkuAsync(); // KRITIK: baskasinin bu arada yazdigi her seyi al - ASENKRON, programi bloke etmez
      Object.keys(uygulanacakSet).forEach(k => { tazeVeri[k] = uygulanacakSet[k]; });
      uygulanacakDel.forEach(k => { delete tazeVeri[k]; });
      if(writerId) tazeVeri.__meta = { lastWriterId: writerId, lastSavedAt: Date.now() };
      const json = JSON.stringify(tazeVeri);
      ensureDirs();
      const tmp = dataFile + '.tmp';
      await fs.promises.writeFile(tmp, json, 'utf8');
      await fs.promises.rename(tmp, dataFile);
      lastKnownDisk = tazeVeri;
      try{ lastKnownMtimeMs = fs.statSync(dataFile).mtimeMs; }catch(e){}
      if(Date.now() - lastBackup > yedekAraligiMs){ lastBackup = Date.now(); await yedekAl(json); }
    }catch(e){
      Object.assign(pendingSet, uygulanacakSet, pendingSet);
      uygulanacakDel.forEach(k=>{ if(!(k in pendingSet)) pendingDel.add(k); });
      dirty = true;
    }
    writing = false;
    if(dirty || Object.keys(pendingSet).length || pendingDel.size) schedule();
  }
  function schedule(){
    dirty = true;
    if(timer) return;
    timer = setTimeout(()=>{ timer = null; flush(); }, gecikmeMs);
  }
  function flushSync(){
    if(timer){ clearTimeout(timer); timer = null; }
    if(!dirty && Object.keys(pendingSet).length===0 && pendingDel.size===0) return;
    const uygulanacakSet = pendingSet; pendingSet = {};
    const uygulanacakDel = pendingDel; pendingDel = new Set();
    try{
      const tazeVeri = dosyayiTazeOku();
      Object.keys(uygulanacakSet).forEach(k => { tazeVeri[k] = uygulanacakSet[k]; });
      uygulanacakDel.forEach(k => { delete tazeVeri[k]; });
      if(writerId) tazeVeri.__meta = { lastWriterId: writerId, lastSavedAt: Date.now() };
      ensureDirs();
      const tmp = dataFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(tazeVeri), 'utf8');
      fs.renameSync(tmp, dataFile);
      lastKnownDisk = tazeVeri;
      dirty = false;
    }catch(e){
      Object.assign(pendingSet, uygulanacakSet, pendingSet);
      uygulanacakDel.forEach(k=>{ if(!(k in pendingSet)) pendingDel.add(k); });
      dirty = true;
    }
  }
  function tazeOkuGerekliMi(){
    try{
      if(!fs.existsSync(dataFile)) return false;
      const mt = fs.statSync(dataFile).mtimeMs;
      return mt > lastKnownMtimeMs;
    }catch(e){ return false; }
  }
  function tumuTazele(){
    const tazeVeri = dosyayiTazeOku();
    Object.keys(pendingSet).forEach(k => { tazeVeri[k] = pendingSet[k]; });
    pendingDel.forEach(k => { delete tazeVeri[k]; });
    lastKnownDisk = tazeVeri;
    return tazeVeri;
  }
  async function tumuTazeleAsync(){
    const tazeVeri = await dosyayiTazeOkuAsync();
    Object.keys(pendingSet).forEach(k => { tazeVeri[k] = pendingSet[k]; });
    pendingDel.forEach(k => { delete tazeVeri[k]; });
    lastKnownDisk = tazeVeri;
    return tazeVeri;
  }
  return {
    get(key){
      if(pendingDel.has(key)) return null;
      if(key in pendingSet) return { key, value: pendingSet[key] };
      const d = okumaReferansiGetir();
      return (key in d) ? { key, value: d[key] } : null;
    },
    set(key, value){ pendingSet[key] = value; pendingDel.delete(key); schedule(); return { key, value }; },
    del(key){ const d = okumaReferansiGetir(); const existed = (key in pendingSet) || (key in d && !pendingDel.has(key)); pendingDel.add(key); delete pendingSet[key]; schedule(); return { key, deleted: existed }; },
    list(prefix){
      const d = okumaReferansiGetir();
      const anahtarlar = new Set(Object.keys(d));
      Object.keys(pendingSet).forEach(k=>anahtarlar.add(k));
      pendingDel.forEach(k=>anahtarlar.delete(k));
      return { keys: [...anahtarlar].filter(k => !prefix || k.startsWith(prefix)) };
    },
    flushSync,
    invalidate(){ flushSync(); lastKnownDisk = null; },
    tazeOkuGerekliMi,
    tumuTazele,
    tumuTazeleAsync,
    _durumu(){ return { dirty, writing, pendingSetSayisi: Object.keys(pendingSet).length, pendingDelSayisi: pendingDel.size }; }
  };
}
module.exports = { createStore };

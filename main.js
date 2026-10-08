const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createStore } = require('./storage');
const nodemailer = require('nodemailer');
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
let mainWindowRef = null;

const CONFIG_FILE = path.join(app.getPath('appData'), 'dulger-psys', 'config.json');
const MAIL_CONFIG_FILE = path.join(app.getPath('appData'), 'dulger-psys', 'mail-config.json'); // YEREL - Yandex'e hic senkron olmaz

function loadMailConfig(){
  try{ return JSON.parse(fs.readFileSync(MAIL_CONFIG_FILE, 'utf8')); }catch(e){ return null; }
}
function saveMailConfig(cfg){
  const dir = path.dirname(MAIL_CONFIG_FILE);
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MAIL_CONFIG_FILE, JSON.stringify(cfg), 'utf8');
}

function loadConfig(){
  try{ return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }catch(e){ return {}; }
}
function saveConfig(cfg){
  try{
    const dir = path.dirname(CONFIG_FILE);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg), 'utf8');
  }catch(e){}
}

const WRITER_ID = Math.random().toString(36).slice(2) + '-' + Date.now();
const config = loadConfig();
const DATA_DIR = (config.ortakKlasor && fs.existsSync(config.ortakKlasor))
  ? config.ortakKlasor
  : path.join(app.getPath('appData'), 'dulger-psys');
const DATA_FILE = path.join(DATA_DIR, 'psys-data.json');
const BACKUP_DIR = path.join(DATA_DIR, 'yedekler');

function ensureDirs(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/* ---------- meşgul kilidi (ortak klasör kullanılıyorsa) ---------- */
const LOCK_FILE = path.join(DATA_DIR, 'psys-lock.json');
const BILGISAYAR_ADI = os.hostname();
const LOCK_BAYAT_SANIYE = 20; // bu suredir heartbeat gelmediyse kilit bayat sayilir
let heartbeatTimer = null;

function kilitOku(){
  try{ return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }catch(e){ return null; }
}
function kilitYaz(){
  fs.promises.writeFile(LOCK_FILE, JSON.stringify({ bilgisayar: BILGISAYAR_ADI, zaman: Date.now() }), 'utf8').catch(()=>{});
}
function kilitSil(){
  try{ if(fs.existsSync(LOCK_FILE)){ const k = kilitOku(); if(k && k.bilgisayar===BILGISAYAR_ADI) fs.unlinkSync(LOCK_FILE); } }catch(e){}
}
function kilitDurumu(){
  const k = kilitOku();
  if(!k) return { mesgul: false };
  const gecenSaniye = (Date.now() - k.zaman) / 1000;
  if(k.bilgisayar === BILGISAYAR_ADI) return { mesgul: false }; // kendi kilidimiz
  if(gecenSaniye > LOCK_BAYAT_SANIYE) return { mesgul: false, bayatKilit: k }; // baska bilgisayarin bayat kilidi
  return { mesgul: true, bilgisayar: k.bilgisayar, saniyeOnce: Math.round(gecenSaniye) };
}
function heartbeatBaslat(){
  if(heartbeatTimer) return;
  kilitYaz();
  heartbeatTimer = setInterval(kilitYaz, 8000);
}
function heartbeatDurdur(){
  if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer=null; }
  kilitSil();
}

const store = createStore(DATA_DIR, { writerId: WRITER_ID });
let sonGorulenSavedAt = 0; // "Yenile" ile en son gordugumuz dis degisiklik zamani

ipcMain.handle('storage-get', (event, key) => store.get(key));
ipcMain.handle('storage-set', (event, key, value) => store.set(key, value));
ipcMain.handle('storage-delete', (event, key) => store.del(key));
ipcMain.handle('storage-list', (event, prefix) => store.list(prefix));

ipcMain.handle('veri-konumu-al', () => {
  return { ortakKlasor: config.ortakKlasor || '', aktifKlasor: DATA_DIR };
});
ipcMain.handle('veri-konumu-sec', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Ortak Veri Klasörünü Seçin (örn. Yandex Disk klasörünü)' });
  if(result.canceled || !result.filePaths[0]) return { iptal: true };
  return { klasor: result.filePaths[0] };
});
ipcMain.handle('veri-konumu-kaydet', (event, klasor) => {
  const yeniConfig = { ortakKlasor: klasor || '' };
  saveConfig(yeniConfig);
  return { basarili: true };
});
ipcMain.handle('uygulamayi-yeniden-baslat', () => {
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('mesgul-kontrol', () => {
  ensureDirs();
  return kilitDurumu();
});
ipcMain.handle('mesgul-yine-de-devam', () => {
  const yeniDevralma = !heartbeatTimer;
  heartbeatBaslat();
  if(yeniDevralma) store.invalidate(); // diger bilgisayar bu arada yazmis olabilir: diskten taze oku
  return { basarili: true };
});

/* ---------- baska bir bilgisayar veri degistirdi mi (sessiz kontrol, kilit mekanizmasina dokunmaz) ---------- */
function disDegisiklikBilgisi(){
  try{
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    const meta = d.__meta || {};
    return { writerId: meta.lastWriterId || '', savedAt: meta.lastSavedAt || 0 };
  }catch(e){ return { writerId: '', savedAt: 0 }; }
}
ipcMain.handle('veri-dis-degisiklik-var-mi', () => {
  const bilgi = disDegisiklikBilgisi();
  const baskaYazan = bilgi.writerId && bilgi.writerId !== WRITER_ID;
  return { degisti: !!(baskaYazan && bilgi.savedAt > sonGorulenSavedAt), savedAt: bilgi.savedAt };
});
ipcMain.handle('veri-degisiklik-onayla', () => {
  sonGorulenSavedAt = disDegisiklikBilgisi().savedAt;
  return { basarili: true };
});

/* ---------- PDF olarak kaydet (proje/usta/hakedis adini dosya adi olarak onerir) ---------- */
/* ---------- Mail Ayarlari (bu bilgisayara ozel, Yandex'e hic gitmez) ve gercek SMTP gonderimi ---------- */
function mailTransporterOlustur(cfg){
  const guvenlik = cfg.guvenlik || 'ssl'; // 'ssl' | 'starttls' | 'yok'
  return nodemailer.createTransport({
    host: cfg.host, port: Number(cfg.port) || 465,
    secure: guvenlik === 'ssl',
    requireTLS: guvenlik === 'starttls',
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}
function zamanAsimliCalistir(promise, msg, ms){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ]);
}
ipcMain.handle('mail-ayarlari-oku', () => {
  const cfg = loadMailConfig();
  if(!cfg) return { ayarliMi: false };
  return { ayarliMi: true, host: cfg.host, port: cfg.port, guvenlik: cfg.guvenlik||'ssl', user: cfg.user }; // sifre asla geri donmez
});
ipcMain.handle('mail-ayarlari-kaydet', (event, cfg) => {
  try{
    if(!cfg || !cfg.host || !cfg.port || !cfg.user || !cfg.pass) return { error: 'Tüm alanlar zorunludur.' };
    saveMailConfig({ host: String(cfg.host).trim(), port: Number(cfg.port), guvenlik: cfg.guvenlik||'ssl', user: String(cfg.user).trim(), pass: String(cfg.pass) });
    return { basarili: true };
  }catch(e){ return { error: e.message }; }
});
ipcMain.handle('mail-ayarlari-sifirla', () => {
  try{ if(fs.existsSync(MAIL_CONFIG_FILE)) fs.unlinkSync(MAIL_CONFIG_FILE); return { basarili: true }; }catch(e){ return { error: e.message }; }
});
ipcMain.handle('mail-test-gonder', async () => {
  const cfg = loadMailConfig();
  if(!cfg) return { error: 'Önce mail ayarlarını kaydedin.' };
  try{
    const transporter = mailTransporterOlustur(cfg);
    await zamanAsimliCalistir(transporter.verify(), 'Sunucuya 20 saniyede bağlanılamadı (sunucu adresi/port yanlış veya erişilemiyor olabilir).', 20000);
    await zamanAsimliCalistir(transporter.sendMail({
      from: cfg.user, to: cfg.user, subject: 'Kurumsal Üretim Sistemleri — Test Maili',
      text: 'Bu bir test mailidir. Mail ayarlarınız doğru çalışıyor.',
    }), 'Mail gönderimi 20 saniyede tamamlanamadı.', 20000);
    return { basarili: true };
  }catch(e){ return { error: e.message }; }
});
ipcMain.handle('mail-gonder', async (event, { to, subject, text }) => {
  const cfg = loadMailConfig();
  if(!cfg) return { ayarliDegil: true };
  try{
    const transporter = mailTransporterOlustur(cfg);
    await zamanAsimliCalistir(transporter.sendMail({ from: cfg.user, to, subject, text }), 'Mail gönderimi 20 saniyede tamamlanamadı.', 20000);
    return { basarili: true };
  }catch(e){ return { error: e.message }; }
});

ipcMain.handle('save-pdf', async (event, suggestedName) => {
  try{
    const safeName = String(suggestedName || 'belge').replace(/[\\/:*?"<>|]/g, '').trim() || 'belge';
    const secim = await dialog.showSaveDialog({
      title: 'PDF Olarak Kaydet',
      defaultPath: safeName + '.pdf',
      filters: [{ name: 'PDF Dosyası', extensions: ['pdf'] }]
    });
    if(secim.canceled || !secim.filePath) return { canceled: true };
    const pdfBuffer = await event.sender.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
    });
    fs.writeFileSync(secim.filePath, pdfBuffer);
    return { filePath: secim.filePath };
  }catch(e){
    return { error: e.message };
  }
});

function createWindow(){
  const win = new BrowserWindow({
    width: 1400, height: 900,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  win.loadFile('app.html');
  win.setMenuBarVisibility(false);
  mainWindowRef = win;
}

/* ---------- Otomatik guncelleme (GitHub Releases uzerinden) ---------- */
autoUpdater.on('update-downloaded', () => {
  if(mainWindowRef) mainWindowRef.webContents.send('guncelleme-hazir');
});
autoUpdater.on('error', (err) => { console.error('Güncelleme kontrolü hatası:', err.message); });
ipcMain.handle('guncelleme-yeniden-baslat', () => { autoUpdater.quitAndInstall(); });

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if(BrowserWindow.getAllWindows().length===0) createWindow(); });
  setTimeout(() => { autoUpdater.checkForUpdates().catch(()=>{}); }, 5000); // acilista biraz bekleyip sessizce kontrol et
});
app.on('window-all-closed', () => { store.flushSync(); heartbeatDurdur(); if(process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { store.flushSync(); heartbeatDurdur(); });

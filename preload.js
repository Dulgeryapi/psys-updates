const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storage', {
  get: (key, shared) => ipcRenderer.invoke('storage-get', key),
  set: (key, value, shared) => ipcRenderer.invoke('storage-set', key, value),
  delete: (key, shared) => ipcRenderer.invoke('storage-delete', key),
  list: (prefix, shared) => ipcRenderer.invoke('storage-list', prefix)
});

contextBridge.exposeInMainWorld('veriKonumu', {
  al: () => ipcRenderer.invoke('veri-konumu-al'),
  klasorSec: () => ipcRenderer.invoke('veri-konumu-sec'),
  kaydet: (klasor) => ipcRenderer.invoke('veri-konumu-kaydet', klasor),
  yenidenBaslat: () => ipcRenderer.invoke('uygulamayi-yeniden-baslat')
});

contextBridge.exposeInMainWorld('mesgulDurumu', {
  kontrolEt: () => ipcRenderer.invoke('mesgul-kontrol'),
  yineDeDevamEt: () => ipcRenderer.invoke('mesgul-yine-de-devam')
});

contextBridge.exposeInMainWorld('disDegisiklik', {
  kontrolEt: () => ipcRenderer.invoke('veri-dis-degisiklik-var-mi'),
  onayla: () => ipcRenderer.invoke('veri-degisiklik-onayla')
});

contextBridge.exposeInMainWorld('electronPDF', {
  savePDF: (suggestedName) => ipcRenderer.invoke('save-pdf', suggestedName)
});

contextBridge.exposeInMainWorld('kaynakDosya', {
  indir: () => ipcRenderer.invoke('kaynak-dosya-indir')
});

contextBridge.exposeInMainWorld('guncelleme', {
  onHazir: (callback) => ipcRenderer.on('guncelleme-hazir', () => callback()),
  onDurum: (callback) => ipcRenderer.on('guncelleme-durum', (event, veri) => callback(veri)),
  yenidenBaslat: () => ipcRenderer.invoke('guncelleme-yeniden-baslat'),
  kontrolEt: () => ipcRenderer.invoke('guncelleme-kontrol-et'),
  surumAl: () => ipcRenderer.invoke('guncelleme-surum-al')
});

contextBridge.exposeInMainWorld('githubSenkron', {
  tokenVarMi: () => ipcRenderer.invoke('github-token-al'),
  tokenKaydet: (token) => ipcRenderer.invoke('github-token-kaydet', token),
  durumAl: () => ipcRenderer.invoke('github-senkron-durum-al'),
  onDurum: (callback) => ipcRenderer.on('github-senkron-durum', (event, veri) => callback(veri)),
  simdiSenkronEt: () => ipcRenderer.invoke('github-senkron-simdi'),
  onVeriGuncellendi: (callback) => ipcRenderer.on('github-veri-guncellendi', () => callback())
});

contextBridge.exposeInMainWorld('mailAyarlari', {
  oku: () => ipcRenderer.invoke('mail-ayarlari-oku'),
  kaydet: (cfg) => ipcRenderer.invoke('mail-ayarlari-kaydet', cfg),
  sifirla: () => ipcRenderer.invoke('mail-ayarlari-sifirla'),
  testGonder: () => ipcRenderer.invoke('mail-test-gonder'),
  gonder: (to, subject, text) => ipcRenderer.invoke('mail-gonder', { to, subject, text })
});

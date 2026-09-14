// Preload della finestra che carica la web app remota di Pos Generator.
//
// Espone SOLO le due azioni sotto (window.posDesktop) — niente accesso a
// filesystem/Node/altre API Electron: quella finestra mostra contenuto
// remoto (posgenerator.vercel.app), quindi qualunque cosa esposta qui
// diventa raggiungibile da quel sito, non da codice che controlliamo a
// build time. contextIsolation/sandbox restano attivi lato BrowserWindow
// (vedi main.js): senza contextBridge, il sito remoto non avrebbe alcun
// modo di toccare Electron/Node comunque.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  getVersion: () => ipcRenderer.invoke("app:version"),
});

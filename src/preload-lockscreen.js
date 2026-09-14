// Preload della sola finestra di lock (contenuto locale, fidato). Espone un ponte minimo
// e tipizzato verso il main process — mai window.require/ipcRenderer diretto nella pagina.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posDesktop", {
  requestUnlock: () => ipcRenderer.invoke("hello:request"),
  quit: () => ipcRenderer.send("app:quit"),
});

// Processo main dell'app desktop Pos Generator.
//
// E' un wrapper nativo attorno alla web app esistente (Next.js + NextAuth, gia'
// deployata) protetto da un gate Windows Hello locale: nessuna logica di business o
// backend nuova qui, solo finestra nativa + verifica biometrica del PC condiviso.
const { app, BrowserWindow, Menu, ipcMain, powerMonitor, session, shell } = require("electron");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const { requestWindowsHello } = require("./windows-hello");

const APP_ORIGIN = (process.env.POS_DESKTOP_URL || "https://posgenerator.vercel.app").replace(/\/$/, "");
// L'app deve aprirsi dentro l'applicazione, non sulla home page marketing del sito
// (quella con "Inizia gratis" / "Ho già un account" — e' un sito, non un'app). "/dashboard"
// e' dietro il layout autenticato: se non c'e' ancora una sessione valida mostra
// direttamente il login dell'app (src/app/(app)/layout.tsx fa redirect("/login") — vedi
// quel file), se la sessione e' gia' persistita apre subito i documenti.
const APP_URL = `${APP_ORIGIN}/dashboard`;
const SESSION_PARTITION = "persist:posgenerator";
const APP_TITLE = "Pos Generator";
// In sviluppo (electron .) l'icona sta nella cartella build/ del sorgente. Una volta
// pacchettizzata, build/ non fa parte di app.asar (solo src/** e package.json — vedi
// "files" in package.json): l'icona per la finestra viene invece copiata in
// resources/icon.ico via "extraResources", da qui il path diverso a runtime.
const ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "icon.ico")
  : path.join(__dirname, "..", "build", "icon.ico");

// Nessun menu applicativo (File/Modifica/Visualizza/...): e' l'elemento che piu' di
// ogni altro tradisce "e' solo un sito dentro una finestra". Un'app nativa vera ha la
// propria UI, non i comandi da browser di Chromium.
Menu.setApplicationMenu(null);

// Host della web app + domini Stripe necessari al checkout in-app: qualunque altro link
// (email, terze parti, ecc.) si apre nel browser di sistema, non nella finestra dell'app.
const ALLOWED_HOSTS = new Set([
  new URL(APP_URL).host,
  "checkout.stripe.com",
  "js.stripe.com",
  "billing.stripe.com",
]);

/** @type {BrowserWindow | null} */
let lockWindow = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
let unlocked = false;

function isAllowedNavigation(targetUrl) {
  try {
    return ALLOWED_HOSTS.has(new URL(targetUrl).host);
  } catch {
    return false;
  }
}

function guardNavigation(win) {
  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl)) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function createLockWindow() {
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.show();
    lockWindow.focus();
    return;
  }

  lockWindow = new BrowserWindow({
    width: 400,
    height: 360,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    center: true,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload-lockscreen.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  lockWindow.loadFile(path.join(__dirname, "lock-screen.html"));
  // NIENTE auto-show qui: lock-screen.js lancia da solo un primo tentativo di verifica
  // appena la pagina carica (vedi "Prova automaticamente allo start" in quel file), che
  // arriva quasi sempre PRIMA che "ready-to-show" scatti. Se mostrassimo la finestra qui
  // comunque, si sovrapporrebbe al popup nativo "Sicurezza di Windows" di quel primo
  // tentativo (più piccolo della nostra finestra) invece di restarne fuori — è
  // esattamente il bug che il commento sotto in "hello:request" descrive, solo che
  // capitava anche quando l'utente non aveva ancora cliccato nulla. La finestra compare
  // solo quando l'handler IPC decide che serve mostrarla (verifica fallita/annullata) o
  // quando viene riusata da createLockWindow() per un nuovo blocco.
  lockWindow.on("closed", () => {
    lockWindow = null;
    if (!unlocked) app.quit();
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-content.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: session.fromPartition(SESSION_PARTITION),
    },
  });

  guardNavigation(mainWindow);

  // Titolo fisso "Pos Generator": senza questo, il titolo della finestra rifletterebbe
  // il <title> della pagina web caricata, con effetto "scheda di browser" invece che
  // app nativa.
  mainWindow.setTitle(APP_TITLE);
  mainWindow.on("page-title-updated", (event) => event.preventDefault());

  // Niente pinch-zoom/ctrl+rotella e nessuna scorciatoia da devtools del browser: un
  // programma nativo non si "zooma" o apre l'ispettore come una pagina Chrome.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.setVisualZoomLevelLimits(1, 1);
  });
  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const key = input.key.toLowerCase();
      const blocked =
        key === "f12" ||
        (input.control && input.shift && (key === "i" || key === "j" || key === "c")) ||
        (input.control && key === "u");
      if (blocked) event.preventDefault();
    });
  }

  mainWindow.loadURL(APP_URL);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function completeUnlock() {
  unlocked = true;
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.close();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
}

function requireUnlock() {
  unlocked = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  createLockWindow();
}

ipcMain.handle("hello:request", async () => {
  // Il vero popup di sistema "Sicurezza di Windows" e' piu' piccolo della nostra
  // finestra e non la copre: restando in primo piano, la nostra finestra si vede
  // intorno/dietro il popup e sembra "inghiottirlo". Nascondendola durante la verifica
  // resta visibile solo il popup nativo. Non c'e' bisogno di ricordarsi se era visibile
  // prima (era il bug: al primo tentativo automatico allo start non lo era ancora,
  // quindi qui non scattava — ma "ready-to-show" la mostrava comunque poco dopo, in
  // corsa con l'arrivo del popup nativo): nasconderla se visibile e' un no-op innocuo
  // quando non lo e' ancora.
  if (lockWindow && !lockWindow.isDestroyed() && lockWindow.isVisible()) {
    lockWindow.hide();
  }

  const result = await requestWindowsHello("Sblocca Pos Generator");

  // Solo "verified" sblocca. "unavailable" (nessun sensore/PIN configurato, o disabilitato
  // da policy) NON sblocca più: la finestra principale usa una sessione persistente
  // (persist:posgenerator), quindi bypassare qui riesporrebbe a chiunque sul PC condiviso
  // la sessione NextAuth già salvata su disco, senza alcuna verifica — il caso esatto che
  // questo gate esiste per coprire. Se Hello non è disponibile, il PC va configurato prima
  // di poter usare l'app.
  if (result.status === "verified") {
    completeUnlock();
  } else if (lockWindow && !lockWindow.isDestroyed()) {
    // Sempre mostrata su esito non positivo, non solo se lo era già prima: altrimenti un
    // annullamento/fallimento al primissimo tentativo (finestra ancora mai mostrata)
    // lasciava l'app bloccata su una finestra invisibile, senza modo di riprovare.
    lockWindow.show();
    lockWindow.focus();
  }
  return result;
});

ipcMain.on("app:quit", () => app.quit());

// Auto-update: ogni push su desktop/** su main pubblica una nuova release GitHub (vedi
// .github/workflows/desktop-release.yml + build.publish in package.json). L'app già
// installata la trova da sola, la scarica in background e la installa al prossimo
// riavvio — nessuna UI dedicata: coerente col resto dell'app (nessun menu, nessun
// popup non necessario), e comunque non toglie mai il controllo perché l'installer NSIS
// resta scaricabile a parte se qualcuno preferisce reinstallare a mano.
function setupAutoUpdate() {
  // In sviluppo (electron .) non esiste alcun app-update.yml da leggere: qui
  // autoUpdater cercherebbe solo di fallire rumorosamente ad ogni avvio.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => console.error("[auto-update]", err?.message || err));
  autoUpdater.on("update-available", (info) => console.log("[auto-update] disponibile:", info.version));
  autoUpdater.on("update-downloaded", (info) =>
    console.log("[auto-update] scaricato, verrà installato al prossimo riavvio:", info.version),
  );

  // Nessun retry loop: un errore di rete (PC offline, proxy aziendale) non deve mai
  // impedire l'uso dell'app — vedi il listener "error" sopra, che si limita a loggare.
  autoUpdater.checkForUpdates().catch(() => null);
}

app.whenReady().then(() => {
  requireUnlock();
  setupAutoUpdate();

  // Su un PC condiviso, quando Windows viene sbloccato si richiede di nuovo Windows
  // Hello prima di rimostrare i documenti di sicurezza — non solo all'avvio dell'app.
  powerMonitor.on("lock-screen", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  powerMonitor.on("unlock-screen", () => {
    if (unlocked) requireUnlock();
    // L'app può restare aperta a lungo su un PC condiviso: ricontrolla gli aggiornamenti
    // a ogni sblocco Windows invece che solo all'avvio dell'app.
    if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => null);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) requireUnlock();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

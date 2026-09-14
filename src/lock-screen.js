// Renderer della schermata di lock. Nessuna API Node diretta: passa sempre dal ponte
// sicuro esposto in preload-lockscreen.js via contextBridge.
const statusEl = document.getElementById("status");
const unlockBtn = document.getElementById("unlock");
const quitBtn = document.getElementById("quit");

async function tryUnlock() {
  unlockBtn.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = "Verifica in corso…";

  const result = await window.posDesktop.requestUnlock();

  if (result.status === "verified") {
    statusEl.textContent = "Sblocco riuscito.";
    return;
  }

  unlockBtn.disabled = false;
  statusEl.classList.add("error");
  if (result.status === "canceled") {
    statusEl.textContent = "Verifica annullata. Riprova quando vuoi.";
  } else if (result.status === "failed") {
    statusEl.textContent = "Verifica non riuscita. Riprova.";
  } else if (result.status === "unavailable") {
    // Nessun bypass: senza Windows Hello configurato l'app non si apre su questo PC —
    // vedi il commento in main.js sul perché (sessione persistente + PC condiviso).
    statusEl.textContent =
      "Windows Hello non è configurato su questo PC. Configura un PIN, l'impronta o il riconoscimento facciale in Impostazioni Windows, poi riprova.";
  } else {
    statusEl.textContent = "Windows Hello non disponibile in questo momento. Riprova.";
  }
}

unlockBtn.addEventListener("click", tryUnlock);
quitBtn.addEventListener("click", () => window.posDesktop.quit());

// Prova automaticamente allo start, senza dover cliccare.
tryUnlock();

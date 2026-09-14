// Wrapper Node attorno a windows-hello.ps1: lancia lo script PowerShell che parla con
// l'API WinRT UserConsentVerifier e ne interpreta l'esito. Vedi windows-hello.ps1 per il
// perche' di questo approccio (nessun modulo nativo compilato per Node/Electron).

const { spawn } = require("node:child_process");
const path = require("node:path");
const { app } = require("electron");

/**
 * Risolve un percorso sotto src/ tenendo conto dell'asar: gli script .ps1 non possono
 * essere eseguiti da dentro app.asar (non e' un file reale su disco), quindi in build
 * "asarUnpack" li estrae in una cartella gemella app.asar.unpacked — qui si sostituisce
 * il segmento del path di conseguenza quando l'app e' pacchettizzata.
 */
function resolveUnpacked(...segments) {
  const resolved = path.join(__dirname, ...segments);
  if (app.isPackaged) {
    return resolved.split("app.asar").join("app.asar.unpacked");
  }
  return resolved;
}

/**
 * @param {string} message Messaggio mostrato nel prompt di Windows Hello.
 * @returns {Promise<{status: "verified"|"unavailable"|"canceled"|"failed"|"error", raw: string}>}
 */
function requestWindowsHello(message = "Sblocca Pos Generator") {
  const scriptPath = resolveUnpacked("windows-hello.ps1");

  return new Promise((resolve) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, message],
      { windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    ps.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    ps.on("error", (err) => {
      resolve({ status: "error", raw: err.message });
    });

    ps.on("close", () => {
      const raw = stdout.trim() || stderr.trim();
      resolve({ status: classify(raw), raw });
    });
  });
}

function classify(raw) {
  if (raw === "Verified") return "verified";
  if (raw === "Canceled") return "canceled";
  if (raw === "DeviceBusy" || raw === "RetriesExhausted") return "failed";
  if (
    raw.startsWith("Unavailable:") ||
    raw === "DeviceNotPresent" ||
    raw === "NotConfiguredForUser" ||
    raw === "DisabledByPolicy"
  ) {
    return "unavailable";
  }
  return "error";
}

module.exports = { requestWindowsHello };

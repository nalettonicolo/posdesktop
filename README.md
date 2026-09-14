# Pos Generator — app desktop Windows

Wrapper Electron nativo attorno alla web app [Pos Generator](https://posgenerator.vercel.app),
con un gate locale Windows Hello (volto/impronta/PIN configurato sul PC) prima di mostrare i
documenti. Non duplica nessuna logica: carica la stessa web app di produzione in una finestra
nativa e riusa il login NextAuth già esistente — nessun backend nuovo.

Questo repository contiene **solo il wrapper desktop** (finestra nativa + gate Windows Hello +
auto-update): nessuna riga del codice sorgente della web app (wizard, API, billing, ecc., che
resta in un repository privato separato). È pubblico apposta — serve a `electron-updater`
per controllare e scaricare gli aggiornamenti senza dover spedire una credenziale dentro
l'app installata.

## Sviluppo

```bash
npm install
npm run dev
```

Per puntare l'app a un server locale invece che a produzione (utile mentre si sviluppa la
web app in parallelo con `next dev`):

```bash
# Windows (PowerShell)
$env:POS_DESKTOP_URL = "http://localhost:3000"; npm run dev
```

## Cosa fa il gate Windows Hello

All'avvio (e ogni volta che Windows viene sbloccato mentre l'app è aperta) appare una
piccola finestra locale che chiede la verifica Windows Hello prima di mostrare la web app.
Se Windows Hello non è configurato sul PC, l'app **resta bloccata** (non procede al login
web): la finestra principale usa una sessione NextAuth persistente su disco
(`persist:posgenerator`), quindi saltare il gate riesporrebbe a chiunque sul PC condiviso
la sessione già salvata dell'ultimo utente, senza alcuna verifica. Il PC va configurato con
Windows Hello (PIN, impronta o volto) prima di poter usare l'app.

Dettagli tecnici in [`src/windows-hello.ps1`](src/windows-hello.ps1) e
[`src/windows-hello.js`](src/windows-hello.js).

## Build dell'installer Windows

```bash
npm run build
```

Genera un installer `.exe` (NSIS) in `release/`, senza pubblicarlo da nessuna parte — build
locale di prova. Per una build che finisce anche su GitHub Releases, vedi sotto.

**Fuori scope in questa prima versione** (da valutare in seguito): firma del codice con
certificato di code-signing — la build attuale produce un installer non firmato, Windows
SmartScreen potrebbe mostrare un avviso "editore sconosciuto" al primo avvio.

## Download e aggiornamenti automatici

Ogni push su `main` fa partire [`.github/workflows/release.yml`](.github/workflows/release.yml):
builda l'installer su un runner `windows-latest` e lo pubblica come
[GitHub Release](https://github.com/nalettonicolo/posdesktop/releases) — è lì che si trova
sempre l'ultimo `.exe` da scaricare e installare la prima volta.

Da lì in poi l'app **si aggiorna da sola**: a ogni avvio (e a ogni sblocco di Windows, utile
perché resta aperta a lungo su un PC condiviso) controlla in background se su GitHub è
comparsa una release più recente della propria, la scarica e la installa al riavvio
successivo — nessun popup, nessuna azione richiesta. Meccanismo: `electron-updater` +
`build.publish` in `package.json` (provider GitHub, repository pubblico), wired in
[`src/main.js`](src/main.js).

**Per pubblicare una nuova versione**: alzare `version` in `package.json` prima di fare
push (o eseguire `npm run release` a mano da un PC Windows con `GH_TOKEN` impostato —
pubblica direttamente, senza passare dalla Action). Se la versione non viene alzata, il
workflow ripubblica la stessa release senza errori, ma le copie già installate non vedono
nulla di nuovo (`electron-updater` confronta i numeri di versione).

## Perché un repository separato (e pubblico)

`electron-updater` controlla gli aggiornamenti dall'app già installata, senza alcuna
credenziale incorporata (spedire un token GitHub dentro un eseguibile distribuito è
un rischio di sicurezza — chiunque potrebbe estrarlo). Le GitHub Release di un repository
**privato** non sono raggiungibili da richieste anonime, quindi l'auto-update non
funzionerebbe per nessun utente reale. Tenere qui solo il wrapper (nessuna logica di
business) permette di renderlo pubblico senza esporre il codice del prodotto.

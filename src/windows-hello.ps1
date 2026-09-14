# Richiede una verifica Windows Hello (volto, impronta o PIN configurato dall'utente su
# Windows) tramite l'API WinRT Windows.Security.Credentials.UI.UserConsentVerifier.
# Nessun modulo nativo per Node richiesto: PowerShell puo' attivare direttamente i tipi
# WinRT via [Type,Assembly,ContentType=WindowsRuntime], evitando compilazioni node-gyp
# che si romperebbero ad ogni aggiornamento major di Electron/Node ABI.
#
# Stampa su stdout una singola riga tra:
#   Verified              -> utente verificato con successo
#   DeviceNotPresent       -> nessun sensore/hello configurato sul dispositivo
#   NotConfiguredForUser   -> Windows Hello non configurato per l'utente corrente
#   DisabledByPolicy       -> disabilitato da policy di sistema
#   DeviceBusy              -> sensore occupato, riprovare
#   RetriesExhausted        -> troppi tentativi falliti
#   Canceled                -> utente ha annullato la richiesta
#   Unavailable:<motivo>    -> CheckAvailabilityAsync ha restituito un esito diverso da Available
#   Error:<messaggio>       -> eccezione imprevista

$ErrorActionPreference = "Stop"

try {
    [void][Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]

    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
    })[0]

    function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    }

    $availability = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) `
        ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])

    if ($availability -ne [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) {
        Write-Output "Unavailable:$availability"
        exit 0
    }

    $message = if ($args.Count -gt 0) { $args[0] } else { "Sblocca Pos Generator" }
    $result = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($message)) `
        ([Windows.Security.Credentials.UI.UserConsentVerificationResult])

    Write-Output "$result"
    exit 0
} catch {
    Write-Output "Error:$($_.Exception.Message)"
    exit 1
}

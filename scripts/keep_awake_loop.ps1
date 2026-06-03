# keep_awake_loop.ps1 — persistent keep-awake, runs until killed
# Launches as hidden process via Start-Process from Claude
while ($true) {
    $ts = Get-Date -Format 'HH:mm:ss'
    Add-Content -Path 'C:\tools\tmp.txt' -Value "$ts keep-awake" -Encoding UTF8
    $p = Start-Process -FilePath 'C:\tools\Notepad++\notepad++.exe' -ArgumentList 'C:\tools\tmp.txt' -PassThru
    Start-Sleep -Seconds 3
    if (-not $p.HasExited) { $p.CloseMainWindow() | Out-Null }
    Start-Sleep -Seconds 540
}

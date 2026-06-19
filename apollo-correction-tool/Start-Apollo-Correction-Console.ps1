$ErrorActionPreference = "Stop"

$Python = "C:\Users\danie\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$Server = Join-Path $PSScriptRoot "server.py"
$Port = 8787
$Url = "http://127.0.0.1:$Port"

Start-Process $Url
& $Python $Server --port $Port

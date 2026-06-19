param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$RepoUrl = "https://github.com/prismo1020/apollo-kb-tool.git"
$RepoName = "prismo1020/apollo-kb-tool"
$AuthorName = "prismo1020"
$AuthorEmail = "284166312+prismo1020@users.noreply.github.com"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Set-Location -LiteralPath $Root

Write-Host ""
Write-Host "Apollo KB Tool Publisher" -ForegroundColor Cyan
Write-Host "Target repo: $RepoName"
Write-Host ""

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is not installed or is not available in this PowerShell window."
}

$SafeRoot = $Root.Replace("\", "/")
git config --global --add safe.directory $SafeRoot

if (Get-Command gh -ErrorAction SilentlyContinue) {
    $Visibility = ""
    try {
        $Visibility = gh repo view $RepoName --json visibility --jq ".visibility" 2>$null
    }
    catch {
        Write-Host "Could not confirm repo visibility with GitHub CLI. Continuing because the target repo is explicitly set to $RepoName." -ForegroundColor Yellow
    }
    if ($Visibility -and $Visibility.ToUpperInvariant() -ne "PRIVATE") {
        throw "Safety stop: $RepoName is $Visibility, not PRIVATE."
    }
    if ($Visibility) {
        Write-Host "Confirmed private GitHub repo." -ForegroundColor Green
    }
}
else {
    Write-Host "GitHub CLI was not found, so repo privacy could not be double-checked automatically." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "This will push the Apollo correction tool and non-ignored KB files to:"
Write-Host $RepoUrl -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to continue, or close this window to cancel."
Read-Host | Out-Null

if ($DryRun) {
    Write-Host "Dry run complete. No git changes were made." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path -LiteralPath ".git")) {
    git init -b main
}

git config user.name $AuthorName
git config user.email $AuthorEmail

$CurrentBranch = git branch --show-current
if (-not $CurrentBranch) {
    git checkout -B main
}
elseif ($CurrentBranch -ne "main") {
    git branch -M main
}

$OriginUrl = ""
try {
    $OriginUrl = git remote get-url origin 2>$null
}
catch {
    $OriginUrl = ""
}

if ($OriginUrl) {
    git remote set-url origin $RepoUrl
}
else {
    git remote add origin $RepoUrl
}

git add -A

$HasStagedChanges = $true
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    $HasStagedChanges = $false
}

if ($HasStagedChanges) {
    git commit -m "Publish Apollo KB correction tool"
    if ($LASTEXITCODE -ne 0) {
        throw "Git could not create the local publish commit."
    }
}
else {
    Write-Host "No local file changes to commit." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Syncing with the starter GitHub commit..." -ForegroundColor Cyan
git fetch origin main
if ($LASTEXITCODE -ne 0) {
    throw "Could not fetch the current GitHub main branch."
}

git merge origin/main --allow-unrelated-histories --no-edit
if ($LASTEXITCODE -ne 0) {
    throw "Could not merge the starter GitHub commit. If Git reports a conflict, open the files it names, keep the Apollo content, then run this again."
}

git push -u origin main
if ($LASTEXITCODE -ne 0) {
    throw "GitHub rejected the push. The files were committed locally, but they were not published online."
}

Write-Host ""
Write-Host "Published to GitHub:" -ForegroundColor Green
Write-Host "https://github.com/prismo1020/apollo-kb-tool"

# ab-narrow.ps1 — A/B: does authoring-time narrowing actually shrink the surface?
#
# Two throwaway profiles, one task, one audited call log each:
#
#   wide    = dsh-base + dsh-headless + the REAL dsh-plugin-maker
#             → model sees 6 tools: plugin_maker_{checklist,impact,scaffold,check,vet,adopt}
#   narrow  = dsh-base + dsh-headless + dsh-narrow-maker
#             → model sees 1 tool: maker_check
#
# The narrow arm has the maker package present in node_modules (the narrow plugin
# imports its pure functions) but NOT mounted as a bundle, so none of the maker's
# tools are registered. Same logic, different surface.
#
#   pwsh -File experiments/ab-narrow/ab-narrow.ps1
#
# Nothing here touches the caller's profiles; both throwaway profiles are removed.

param(
  [string]$Task = 'Check the directory C:\Users\14100\Documents\plugins\dsh-plugin-maker: does it pass, and what exactly needs fixing? Answer in at most 5 lines.',
  [string]$SourceProfile = 'web-b',
  [string]$MakerDir = 'C:\Users\14100\Documents\plugins\dsh-plugin-maker',
  [int]$Runs = 2,
  [string]$Label = ''
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$src = Join-Path $dshHome "profiles\$SourceProfile"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$auditDir = Join-Path $root 'experiments\ab-narrow\audit'
New-Item -ItemType Directory -Path $auditDir -Force | Out-Null

if (-not (Test-Path $src)) { throw "source profile not found: $src" }
if (-not (Test-Path $MakerDir)) { throw "maker dir not found: $MakerDir" }

function Invoke-Dsh([string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $text = & dsh @arguments 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  return @{ code = $code; text = $text }
}

function Copy-Package([string]$from, [string]$to, [string[]]$subs) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  foreach ($sub in $subs) {
    $f = Join-Path $from $sub
    if (Test-Path $f) { Copy-Item $f (Join-Path $to $sub) -Recurse -Force }
  }
}

function New-ArmProfile([string]$name, [bool]$narrow) {
  $dst = Join-Path $dshHome "profiles\$name"
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  foreach ($f in @('cordis.yml', 'profile.yaml', 'pnpm-workspace.yaml')) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
  cmd /c mklink /J "$dst\node_modules" "$src\node_modules" | Out-Null

  # the maker package is always present in node_modules (the narrow arm imports its functions)
  Copy-Package $MakerDir (Join-Path $dst 'node_modules\dsh-plugin-maker') @('lib', 'facts', 'skills', 'package.json', 'cordis.patch.yml')
  # the audit plugin is always mounted
  Copy-Package (Join-Path $root 'experiments\ab-make\audit-plugin') (Join-Path $dst 'node_modules\dsh-call-audit') @('index.mjs', 'package.json', 'cordis.patch.yml')

  $deps = [ordered]@{
    'dsh-plugin-maker' = 'file:./node_modules/dsh-plugin-maker'
    'dsh-call-audit'   = 'file:./node_modules/dsh-call-audit'
  }
  if ($narrow) {
    Copy-Package (Join-Path $root 'experiments\ab-narrow\narrow-maker') (Join-Path $dst 'node_modules\dsh-narrow-maker') @('index.mjs', 'package.json', 'cordis.patch.yml')
    $deps['dsh-narrow-maker'] = 'file:./node_modules/dsh-narrow-maker'
    $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-narrow-maker', 'dsh-call-audit')
  } else {
    $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-plugin-maker', 'dsh-call-audit')
  }
  $pkg = [ordered]@{ name = "dsh-profile-$name"; private = $true; dependencies = $deps; dsh = @{ profile = @{ bundles = $bundles } } }
  [System.IO.File]::WriteAllText((Join-Path $dst 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
  Set-Content (Join-Path $dst 'cordis.patch.yml') '[]' -Encoding UTF8
  return $dst
}

$results = @()
foreach ($arm in @(@{ name = 'an-wide'; narrow = $false }, @{ name = 'an-narrow'; narrow = $true })) {
  $profile = New-ArmProfile -name $arm.name -narrow $arm.narrow
  for ($i = 1; $i -le $Runs; $i += 1) {
    $tag = if ($Label -ne '') { "$($arm.name)-$Label-$i" } else { "$($arm.name)-$i" }
    $auditFile = Join-Path $auditDir "calls-$tag.jsonl"
    Remove-Item $auditFile -ErrorAction SilentlyContinue
    Write-Host "=== arm $($arm.name) run $i (narrow: $($arm.narrow)) ==="
    $env:AUDIT_FILE = $auditFile
    $env:AUDIT_ARM = $tag
    $run = Invoke-Dsh @('--profile', $arm.name, $Task)
    ($run.text -split "`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 3) -join "`n"
    $callRows = if (Test-Path $auditFile) { @(Get-Content $auditFile | ConvertFrom-Json | Where-Object { $_.event -eq 'call' }) } else { @() }
    $calls = $callRows.Count
    $tools = (($callRows.tool | Sort-Object -Unique) -join ',')
    Write-Host "  exit=$($run.code) calls=$calls tools=[$tools]"
    $results += [pscustomobject]@{ arm = $arm.name; run = $i; narrow = $arm.narrow; exit = $run.code; calls = $calls; tools = $tools }
  }
  $nm = Join-Path $profile 'node_modules'
  if (Test-Path $nm) { (Get-Item $nm).Delete() }
  Remove-Item $profile -Recurse -Force
}

Write-Host ''
Write-Host '=== summary ==='
$results | Format-Table -AutoSize | Out-String
Write-Host "audit logs: $auditDir"

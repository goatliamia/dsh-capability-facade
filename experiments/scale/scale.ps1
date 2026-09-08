# scale.ps1 — three-arm experiment at realistic scale (157 pool tools)
#
# Arms (one throwaway profile each, all mounting the same measure + audit plugins):
#   raw        = 157 model-facing pool tools           (what an MCP bridge produces)
#   toolsearch = pool_search + pool_call                (the community answer: #2588 / #2137)
#   facade     = 15 semantic operations, 0 primitives   (this repository's answer)
#
# Each profile uses its OWN real node_modules with only the official
# `@deepseek-ai` scope linked from the global install. Nothing is written into
# another profile's node_modules — an earlier version used a junction to a
# shared profile and polluted it.
#
# Measurements per arm:
#   1. surface size — the measure plugin samples `tools.schemas(agent)` from
#      `agent/created` (the root view is empty: visibility resolves per scope)
#   2. behavior — one headless task, every settled call audited to JSONL
#
#   pwsh -File experiments/scale/scale.ps1
#   pwsh -File experiments/scale/scale.ps1 -Task "<your task>"

param(
  [string]$Task = 'Two questions, answer both: (1) how many pages does the PDF at C:\temp\report.pdf have? (2) what is the current branch of the git repository at C:\Users\14100\Documents\plugins\dsh-plugin-maker? Do not write any files.',
  [string]$SourceProfile = 'web-b'
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$src = Join-Path $dshHome "profiles\$SourceProfile"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $root 'experiments\scale\out'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$globalScope = 'C:\Users\14100\AppData\Roaming\npm\node_modules\@deepseek-ai'

if (-not (Test-Path $src)) { throw "source profile not found: $src" }
if (-not (Test-Path $globalScope)) { throw "global @deepseek-ai scope not found: $globalScope" }

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

$arms = @(
  @{ name = 'sc-raw';    plugin = 'pool-plugin';       package = 'dsh-scale-pool' },
  @{ name = 'sc-search'; plugin = 'toolsearch-plugin'; package = 'dsh-scale-toolsearch' },
  @{ name = 'sc-facade'; plugin = 'facade-plugin';     package = 'dsh-scale-facade' }
)
$subs = @('index.mjs', 'pool-spec.mjs', 'pool-fake-data.mjs', 'package.json', 'cordis.patch.yml')

$summary = @()
foreach ($arm in $arms) {
  $dst = Join-Path $dshHome "profiles\$($arm.name)"
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Path "$dst\node_modules" -Force | Out-Null
  foreach ($f in @('cordis.yml', 'profile.yaml', 'pnpm-workspace.yaml')) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
  cmd /c mklink /J "$dst\node_modules\@deepseek-ai" $globalScope | Out-Null

  Copy-Package (Join-Path $PSScriptRoot 'pool-plugin') (Join-Path $dst 'node_modules\dsh-scale-pool') $subs
  Copy-Package (Join-Path $PSScriptRoot 'measure-plugin') (Join-Path $dst 'node_modules\dsh-surface-measure') @('index.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package (Join-Path $root 'experiments\ab-make\audit-plugin') (Join-Path $dst 'node_modules\dsh-call-audit') @('index.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package (Join-Path $PSScriptRoot 'guard-plugin') (Join-Path $dst 'node_modules\dsh-pool-guard') @('index.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package (Join-Path $PSScriptRoot $arm.plugin) (Join-Path $dst "node_modules\$($arm.package)") $subs

  $deps = [ordered]@{
    'dsh-surface-measure' = 'file:./node_modules/dsh-surface-measure'
    'dsh-call-audit'      = 'file:./node_modules/dsh-call-audit'
    'dsh-pool-guard'      = 'file:./node_modules/dsh-pool-guard'
    $arm.package          = "file:./node_modules/$($arm.package)"
  }
  $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', $arm.package, 'dsh-pool-guard', 'dsh-surface-measure', 'dsh-call-audit')
  $pkg = [ordered]@{ name = "dsh-profile-$($arm.name)"; private = $true; dependencies = $deps; dsh = @{ profile = @{ bundles = $bundles } } }
  [System.IO.File]::WriteAllText((Join-Path $dst 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
  Set-Content (Join-Path $dst 'cordis.patch.yml') '[]' -Encoding UTF8

  $surfaceFile = Join-Path $outDir "surface-$($arm.name).json"
  $auditFile = Join-Path $outDir "calls-$($arm.name).jsonl"
  Remove-Item $surfaceFile, $auditFile -ErrorAction SilentlyContinue
  $env:MEASURE_FILE = $surfaceFile
  $env:MEASURE_ARM = $arm.name
  $env:AUDIT_FILE = $auditFile
  $env:AUDIT_ARM = $arm.name

  Write-Host "=== arm $($arm.name): $($arm.package) ==="
  $run = Invoke-Dsh @('--profile', $arm.name, $Task)
  ($run.text -split "`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 5) -join "`n"

  $surface = if (Test-Path $surfaceFile) { Get-Content $surfaceFile -Raw | ConvertFrom-Json } else { $null }
  $last = if ($surface -and $surface.samples.Count -gt 0) { $surface.samples[-1] } else { $null }
  $callRows = if (Test-Path $auditFile) { @(Get-Content $auditFile -Encoding UTF8 | ConvertFrom-Json | Where-Object { $_.event -eq 'call' }) } else { @() }
  $rootCalls = @($callRows | Where-Object { -not $_.nested } | Select-Object -ExpandProperty rootCallId -Unique).Count
  $toolSet = (($callRows.tool | Sort-Object -Unique) -join ',')
  Write-Host "  surface=$($last.count) tools / $($last.bytes) bytes | calls=$($callRows.Count) rootCalls=$rootCalls errors=$(@($callRows | Where-Object { $_.isError }).Count)"
  Write-Host "  tools=[$toolSet]"

  $summary += [pscustomobject]@{
    arm         = $arm.name
    visible     = if ($last) { $last.count } else { -1 }
    schemaBytes = if ($last) { $last.bytes } else { -1 }
    calls       = $callRows.Count
    rootCalls   = $rootCalls
    errors      = @($callRows | Where-Object { $_.isError }).Count
    tools       = $toolSet
  }
}

Write-Host ''
Write-Host '=== summary ==='
$summary | Format-Table -AutoSize | Out-String
Write-Host "outputs: $outDir"

# exit-test.ps1 鈥?does an escape hatch rescue the facade's uncovered tasks?
#
# Two arms, same 15 semantic operations over the same 157-tool pool:
#   sc-facade = operations only        (a closed world)
#   sc-exit   = operations + ONE escape hatch (`pool_primitive`)
#
# Tasks T3/T4 are NOT covered by any declared operation (title, log errors);
# T5 IS covered (git_inspect) after the `from` wiring fix. The question is
# whether the escape hatch turns "uncovered" from a dead end into one call.
#
#   pwsh -File experiments/scale/exit-test.ps1
#
# The mock upstream must already be running on 127.0.0.1:8791.

param(
  [string]$BaseUrl = 'http://127.0.0.1:8791'
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$globalScope = 'C:\Users\14100\AppData\Roaming\npm\node_modules\@deepseek-ai'
$outDir = Join-Path $PSScriptRoot 'exit'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

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
  # PowerShell here-strings write a UTF-8 BOM; the loader parses these as JSON.
  $manifest = Join-Path $to 'package.json'
  if (Test-Path $manifest) { [System.IO.File]::WriteAllText($manifest, (Get-Content $manifest -Raw), (New-Object System.Text.UTF8Encoding($false))) }
}

function New-Arm([string]$name, [string]$pluginDir, [string]$packageName) {
  $dst = Join-Path $dshHome "profiles\$name"
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Path "$dst\node_modules" -Force | Out-Null
  foreach ($f in @('cordis.yml', 'profile.yaml', 'pnpm-workspace.yaml')) { Copy-Item (Join-Path $dshHome "profiles\web-b\$f") (Join-Path $dst $f) -Force }
  cmd /c mklink /J "$dst\node_modules\@deepseek-ai" $globalScope | Out-Null

  $subs = @('index.mjs', 'pool-spec.mjs', 'pool-fake-data.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package $pluginDir (Join-Path $dst "node_modules\$packageName") $subs
  Copy-Package (Join-Path $PSScriptRoot 'measure-plugin') (Join-Path $dst 'node_modules\dsh-surface-measure') @('index.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package (Join-Path $root 'experiments\ab-make\audit-plugin') (Join-Path $dst 'node_modules\dsh-call-audit') @('index.mjs', 'package.json', 'cordis.patch.yml')
  Copy-Package (Join-Path $PSScriptRoot 'guard-plugin') (Join-Path $dst 'node_modules\dsh-pool-guard') @('index.mjs', 'package.json', 'cordis.patch.yml')

  $deps = [ordered]@{
    $packageName          = "file:./node_modules/$packageName"
    'dsh-surface-measure' = 'file:./node_modules/dsh-surface-measure'
    'dsh-call-audit'      = 'file:./node_modules/dsh-call-audit'
    'dsh-pool-guard'      = 'file:./node_modules/dsh-pool-guard'
  }
  $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', $packageName, 'dsh-pool-guard', 'dsh-surface-measure', 'dsh-call-audit')
  $pkg = [ordered]@{ name = "dsh-profile-$name"; private = $true; dependencies = $deps; dsh = @{ profile = @{ bundles = $bundles } } }
  [System.IO.File]::WriteAllText((Join-Path $dst 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
  Set-Content (Join-Path $dst 'cordis.patch.yml') '[]' -Encoding UTF8
}

$arms = @(
  @{ name = 'sc-facade'; dir = (Join-Path $PSScriptRoot 'facade-plugin');        package = 'dsh-scale-facade' },
  @{ name = 'sc-exit';   dir = (Join-Path $PSScriptRoot 'facade-exit-plugin');   package = 'dsh-scale-facade-exit' },
  @{ name = 'sc-signal'; dir = (Join-Path $PSScriptRoot 'facade-signal-plugin'); package = 'dsh-scale-facade-signal' },
  @{ name = 'sc-find';   dir = (Join-Path $PSScriptRoot 'facade-find-plugin');     package = 'dsh-scale-facade-find' }
)
$tasks = @(
  @{ id = 'T3'; text = 'Do not read any files. Using ONLY the capability pool: what is the title of document "report"? Answer with the title only.' },
  @{ id = 'T4'; text = 'Do not read any files. Using ONLY the capability pool: how many ERROR lines are in the service logs? Answer with the number only.' },
  @{ id = 'T5'; text = 'Do not read any files. Using ONLY the capability pool: is the "diverged" repository dirty, and how many commits is it ahead and behind? Answer in one line.' }
)

foreach ($arm in $arms) { New-Arm -name $arm.name -pluginDir $arm.dir -packageName $arm.package }

$rows = @()
foreach ($arm in $arms) {
  $surfaceFile = Join-Path $outDir "surface-$($arm.name).json"
  Remove-Item $surfaceFile -ErrorAction SilentlyContinue
  $env:MEASURE_FILE = $surfaceFile
  $env:MEASURE_ARM = $arm.name
  foreach ($task in $tasks) {
    $auditFile = Join-Path $outDir "calls-$($arm.name)-$($task.id).jsonl"
    Remove-Item $auditFile -ErrorAction SilentlyContinue
    $env:AUDIT_FILE = $auditFile
    $env:AUDIT_ARM = "$($arm.name)-$($task.id)"
    $run = Invoke-Dsh @('--profile', $arm.name, $task.text)
    $answer = (($run.text -split "`n") | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
    $calls = if (Test-Path $auditFile) { @(Get-Content $auditFile -Encoding UTF8 | ConvertFrom-Json | Where-Object { $_.event -eq 'call' }) } else { @() }
    $tools = (($calls.tool | Sort-Object -Unique) -join ',')
    $rows += [pscustomobject]@{ arm = $arm.name; task = $task.id; calls = $calls.Count; errors = @($calls | Where-Object { $_.isError }).Count; tools = $tools; answer = $answer.Substring(0, [Math]::Min(90, $answer.Length)) }
    Write-Host "$($arm.name) $($task.id): calls=$($calls.Count) tools=[$tools]"
    Write-Host "   $($answer.Substring(0, [Math]::Min(90, $answer.Length)))"
  }
}

Write-Host ''
Write-Host '=== summary ==='
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 200
$rows | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outDir 'summary.json') -Encoding UTF8
Write-Host "outputs: $outDir"

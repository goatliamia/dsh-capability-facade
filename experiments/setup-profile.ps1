# 一次性实验 profile：dsh-base + dsh-headless + facade + fixture
#
# 依赖一个已存在的 profile 提供 node_modules（默认 web-b）；本脚本只复用它的包图，
# 不改动它。用完 `Remove-Item $env:DSH_HOME\profiles\facade-test -Recurse -Force` 即可。
#
#   pwsh -File experiments/setup-profile.ps1
#   $env:FACADE_ARM='capability'; dsh --profile facade-test "<task>"

param(
  [string]$ProfileName = 'facade-test',
  [string]$SourceProfile = 'web-b'
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$dst = Join-Path $dshHome "profiles\$ProfileName"
$src = Join-Path $dshHome "profiles\$SourceProfile"
$root = Split-Path -Parent $PSScriptRoot   # repository root

if (-not (Test-Path $src)) { throw "source profile not found: $src (pass -SourceProfile <name>)" }
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

foreach ($f in @('cordis.yml', 'profile.yaml', 'pnpm-workspace.yaml')) {
  Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force
}

# Reuse the installed package graph instead of a fresh network install.
cmd /c mklink /J "$dst\node_modules" "$src\node_modules" | Out-Null

# Place the two local packages where the profile's module resolution finds them.
foreach ($p in @(
    @{ src = $root;                       name = 'dsh-capability-facade' },
    @{ src = "$root\experiments\fixture"; name = 'dsh-facade-fixture' }
  )) {
  $target = Join-Path $dst "node_modules\$($p.name)"
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  foreach ($sub in @('lib', 'package.json', 'cordis.patch.yml')) {
    $from = Join-Path $p.src $sub
    if (Test-Path $from) { Copy-Item $from (Join-Path $target $sub) -Recurse -Force }
  }
}

$pkg = [ordered]@{
  name         = "dsh-profile-$ProfileName"
  private      = $true
  dependencies = [ordered]@{
    'dsh-capability-facade' = 'file:./node_modules/dsh-capability-facade'
    'dsh-facade-fixture'    = 'file:./node_modules/dsh-facade-fixture'
  }
  dsh          = @{
    profile = @{
      bundles = @(
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-headless',
        'dsh-capability-facade',
        'dsh-facade-fixture'
      )
    }
  }
}

# No BOM: the loader parses this file as JSON.
[System.IO.File]::WriteAllText(
  (Join-Path $dst 'package.json'),
  ($pkg | ConvertTo-Json -Depth 10),
  (New-Object System.Text.UTF8Encoding($false))
)
Set-Content (Join-Path $dst 'cordis.patch.yml') '[]' -Encoding UTF8

Write-Host "profile ready: $dst"
dsh --profile $ProfileName --dump-config | Select-String 'capability-facade|facade-fixture' | ForEach-Object { $_.Line }

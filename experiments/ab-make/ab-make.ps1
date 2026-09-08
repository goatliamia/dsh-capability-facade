# ab-make.ps1 — A/B: does a capability surface change what the model does?
#
# Two throwaway profiles, one task, one audited tool-call log each:
#   raw  = dsh-base + dsh-headless + the REAL dsh-plugin-maker (6 model-facing tools)
#   cap  = the same, plus the capability demo (maker_check = plugin_maker_check → plugin_maker_vet)
#
# Both profiles also mount experiments/ab-make/audit-plugin, which appends every
# settled tool call to a JSONL file. The comparison is then mechanical: how many
# tool calls, which tools, did the two maker checks run.
#
#   pwsh -File experiments/ab-make/ab-make.ps1
#   pwsh -File experiments/ab-make/ab-make.ps1 -Task "<your task>"
#
# Nothing here touches the caller's profiles; both throwaway profiles are removed.

param(
  [string]$Task = 'Use the plugin workshop tools to check the directory C:\Users\14100\Documents\plugins\dsh-plugin-maker: does it pass, and what exactly needs fixing? Answer in at most 5 lines.',
  [string]$SourceProfile = 'web-b',
  [string]$MakerDir = 'C:\Users\14100\Documents\plugins\dsh-plugin-maker'
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$src = Join-Path $dshHome "profiles\$SourceProfile"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # repo root
$auditDir = Join-Path $root 'experiments\ab-make\audit'
New-Item -ItemType Directory -Path $auditDir -Force | Out-Null

if (-not (Test-Path $src)) { throw "source profile not found: $src" }
if (-not (Test-Path $MakerDir)) { throw "maker dir not found: $MakerDir" }

function Invoke-Dsh([string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $text = & dsh @arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
  return @{ code = $code; text = $text }
}

function New-ArmProfile([string]$name, [bool]$withCapability, [string]$auditFile) {
  $dst = Join-Path $dshHome "profiles\$name"
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  foreach ($f in @('cordis.yml', 'profile.yaml', 'pnpm-workspace.yaml')) {
    Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force
  }
  cmd /c mklink /J "$dst\node_modules" "$src\node_modules" | Out-Null

  # local packages: maker (working tree), audit plugin, and optionally the demo
  $local = @(
    @{ src = $MakerDir; name = 'dsh-plugin-maker'; sub = @('lib', 'facts', 'skills', 'package.json', 'cordis.patch.yml') },
    @{ src = (Join-Path $PSScriptRoot 'audit-plugin'); name = 'dsh-call-audit'; sub = @('index.mjs', 'package.json', 'cordis.patch.yml') }
  )
  if ($withCapability) {
    $local += @{ src = (Join-Path $root 'experiments\rewrite\demo-capability'); name = 'dsh-capability-demo'; sub = @('index.mjs', 'package.json', 'cordis.patch.yml') }
    $local += @{ src = $root; name = 'dsh-capability-facade'; sub = @('lib', 'package.json', 'cordis.patch.yml') }
  }
  $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-plugin-maker', 'dsh-call-audit')
  $deps = [ordered]@{
    'dsh-plugin-maker' = 'file:./node_modules/dsh-plugin-maker'
    'dsh-call-audit'   = 'file:./node_modules/dsh-call-audit'
  }
  if ($withCapability) {
    $bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-capability-facade', 'dsh-plugin-maker', 'dsh-capability-demo', 'dsh-call-audit')
    $deps['dsh-capability-facade'] = 'file:./node_modules/dsh-capability-facade'
    $deps['dsh-capability-demo'] = 'file:./node_modules/dsh-capability-demo'
  }
  foreach ($p in $local) {
    $target = Join-Path $dst "node_modules\$($p.name)"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($sub in $p.sub) {
      $from = Join-Path $p.src $sub
      if (Test-Path $from) { Copy-Item $from (Join-Path $target $sub) -Recurse -Force }
    }
  }
  $pkg = [ordered]@{ name = "dsh-profile-$name"; private = $true; dependencies = $deps; dsh = @{ profile = @{ bundles = $bundles } } }
  [System.IO.File]::WriteAllText((Join-Path $dst 'package.json'), ($pkg | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
  Set-Content (Join-Path $dst 'cordis.patch.yml') '[]' -Encoding UTF8
  return $dst
}

$results = @()
foreach ($arm in @(@{ name = 'ab-raw'; cap = $false }, @{ name = 'ab-cap'; cap = $true })) {
  $auditFile = Join-Path $auditDir "calls-$($arm.name).jsonl"
  Remove-Item $auditFile -ErrorAction SilentlyContinue
  $profile = New-ArmProfile -name $arm.name -withCapability $arm.cap -auditFile $auditFile
  Write-Host "=== arm $($arm.name) (capability: $($arm.cap)) ==="
  $env:AUDIT_FILE = $auditFile
  $env:AUDIT_ARM = $arm.name
  $run = Invoke-Dsh @('--profile', $arm.name, $Task)
  ($run.text -split "`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 4) -join "`n"
  $callRows = if (Test-Path $auditFile) { @(Get-Content $auditFile | ConvertFrom-Json | Where-Object { $_.event -eq 'call' }) } else { @() }
  $calls = $callRows.Count
  $tools = (($callRows.tool | Sort-Object -Unique) -join ',')
  Write-Host "  exit=$($run.code) calls=$calls tools=[$tools]"
  $results += [pscustomobject]@{ arm = $arm.name; capability = $arm.cap; exit = $run.code; calls = $calls; tools = $tools }
  # tear down the throwaway profile
  $nm = Join-Path $profile 'node_modules'
  if (Test-Path $nm) { (Get-Item $nm).Delete() }
  Remove-Item $profile -Recurse -Force
}

Write-Host ''
Write-Host '=== summary ==='
$results | Format-Table -AutoSize | Out-String
Write-Host "audit logs: $auditDir"

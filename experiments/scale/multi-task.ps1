# multi-task.ps1 — which operation boundaries hold across tasks?
#
# The single-task scale experiment showed Facade and ToolSearch trade surface
# size for round trips. This one asks the harder question: for the SAME plugin,
# which semantic operations stay valid across different tasks, and where does a
# facade's fixed pipeline fail to cover the case?
#
# Tasks are chosen so the facade's declared operations sometimes fit and
# sometimes cannot:
#   T1 page count of the normal report          -> facade operation covers it
#   T2 page count of the ENCRYPTED report       -> same operation, different case
#   T3 title of the report                      -> covered by metadata step
#   T4 how many ERROR lines in the logs         -> no facade operation covers logs
#   T5 is the diverged repo dirty, ahead/behind -> facade's git pipeline is read-only status
#
# Each task runs on every arm; every settled call is audited.
#
#   pwsh -File experiments/scale/multi-task.ps1

param(
  [string]$SourceProfile = 'web-b'
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outDir = Join-Path $PSScriptRoot 'multi'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$tasks = @(
  @{ id = 'T1'; text = 'How many pages does the report at C:\temp\report.pdf have? Answer with the number only.' },
  @{ id = 'T2'; text = 'How many pages does the encrypted report at C:\temp\locked.pdf have? Answer with the number only.' },
  @{ id = 'T3'; text = 'What is the title of the report at C:\temp\report.pdf? Answer with the title only.' },
  @{ id = 'T4'; text = 'How many ERROR lines are in the service logs? Answer with the number only.' },
  @{ id = 'T5'; text = 'Is the diverged repository dirty, and how many commits is it ahead and behind? Answer in one line.' }
)
$arms = @('sc-raw', 'sc-search', 'sc-facade')

function Invoke-Dsh([string[]]$arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $text = & dsh @arguments 2>&1 | Out-String; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $previous }
  return @{ code = $code; text = $text }
}

$rows = @()
foreach ($arm in $arms) {
  $profile = Join-Path $dshHome "profiles\$arm"
  if (-not (Test-Path $profile)) { Write-Host "SKIP $arm (profile missing)"; continue }
  foreach ($task in $tasks) {
    $auditFile = Join-Path $outDir "calls-$arm-$($task.id).jsonl"
    Remove-Item $auditFile -ErrorAction SilentlyContinue
    $env:AUDIT_FILE = $auditFile
    $env:AUDIT_ARM = "$arm-$($task.id)"
    $run = Invoke-Dsh @('--profile', $arm, $task.text)
    $answer = ($run.text -split "`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
    $callRows = if (Test-Path $auditFile) { @(Get-Content $auditFile -Encoding UTF8 | ConvertFrom-Json | Where-Object { $_.event -eq 'call' }) } else { @() }
    $tools = (($callRows.tool | Sort-Object -Unique) -join ',')
    $rows += [pscustomobject]@{ arm = $arm; task = $task.id; calls = $callRows.Count; tools = $tools; answer = $answer }
    Write-Host "$arm $($task.id): calls=$($callRows.Count) tools=[$tools] answer=$answer"
  }
}

Write-Host ''
Write-Host '=== summary ==='
$rows | Format-Table -AutoSize -Wrap | Out-String -Width 200
$rows | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outDir 'summary.json') -Encoding UTF8
Write-Host "outputs: $outDir"

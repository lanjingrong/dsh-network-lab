<#
.SYNOPSIS
  把 dsh-network-lab 链接进当前 DSH 桌面 profile。
.DESCRIPTION
  修改 profile 的 package.json（link 依赖 + bundle 列表）、追加 cordis.patch.yml，
  并在 node_modules 下建立目录联接。执行后重启 DSH。
  会先备份 package.json 和 cordis.patch.yml。
.PARAMETER Profile
  DSH profile 名称，桌面版默认 desktop。
.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File .\install.ps1
#>
param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome (Join-Path 'profiles' $Profile)
$packagePath = Join-Path $profileDir 'package.json'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path $packagePath)) {
  throw "找不到 profile：$profileDir。请确认 DSH 已启动过，或用 -Profile 指定名称。"
}
if (-not (Test-Path (Join-Path $source 'index.js'))) {
  throw "当前目录不是 dsh-network-lab 包目录：$source"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $packagePath "$packagePath.bak-$stamp" -Force
if (Test-Path $patchPath) { Copy-Item $patchPath "$patchPath.bak-$stamp" -Force }

$env:NETLAB_SOURCE = $source
$env:NETLAB_PACKAGE = $packagePath
& node -e @'
const fs = require('node:fs')
const file = process.env.NETLAB_PACKAGE
const source = process.env.NETLAB_SOURCE
const pkg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies['dsh-network-lab'] = 'link:' + source
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!pkg.dsh.profile.bundles.includes('dsh-network-lab')) {
  pkg.dsh.profile.bundles.push('dsh-network-lab')
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
'@
if ($LASTEXITCODE -ne 0) { throw 'package.json 更新失败' }

$entry = @'
- insert:
    - id: dsh-network-lab
      name: 'dsh-network-lab'
      config: {}
'@
$patchText = if (Test-Path $patchPath) { Get-Content $patchPath -Raw } else { '' }
if ($patchText -notmatch 'dsh-network-lab') {
  Add-Content -Path $patchPath -Value "`n$entry" -Encoding utf8
}

$linkPath = Join-Path $profileDir 'node_modules\dsh-network-lab'
$nodeModules = Split-Path -Parent $linkPath
if (-not (Test-Path $nodeModules)) { New-Item -ItemType Directory -Path $nodeModules -Force | Out-Null }
if (Test-Path $linkPath) {
  $item = Get-Item $linkPath -Force
  if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') {
    Remove-Item $linkPath -Force
  } else {
    throw "$linkPath 已存在且不是链接，请先手动移走。"
  }
}
New-Item -ItemType Junction -Path $linkPath -Target $source | Out-Null

$skillSource = Join-Path $source 'skills\network-lab'
$skillTarget = Join-Path $dshHome 'skills\network-lab'
if (Test-Path $skillSource) {
  New-Item -ItemType Directory -Path $skillTarget -Force | Out-Null
  Copy-Item (Join-Path $skillSource 'SKILL.md') (Join-Path $skillTarget 'SKILL.md') -Force
}

Write-Host ''
Write-Host 'dsh-network-lab 已链接到 profile：' -ForegroundColor Green
Write-Host "  $profileDir"
Write-Host ''
Write-Host '下一步：完全退出并重新启动 DSH，然后新建会话。' -ForegroundColor Yellow
Write-Host '重启后会多出 netlab_devices / netlab_exec / netlab_reboot / netlab_lab / netlab_verify / netlab_quiz / netlab_reference / netlab_curriculum / netlab_fault / netlab_skillcheck / netlab_standard / netlab_checklist 共 12 个工具。'
Write-Host "如浏览器页面未更新，刷新 $env:DSH_WEB_URL 。"

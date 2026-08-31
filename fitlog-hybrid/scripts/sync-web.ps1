<#
.SYNOPSIS
  fitlog-main 의 웹 파일을 안드로이드 앱의 assets 로 복사합니다.

.DESCRIPTION
  웹 코드의 원본은 fitlog-main 하나뿐입니다. 안드로이드 앱은 그 사본을 APK
  안에 넣어 첫 화면을 네트워크 없이 띄웁니다. 사본을 손으로 관리하면 반드시
  어긋나므로, 웹을 고친 뒤에는 항상 이 스크립트를 돌리고 빌드하세요.

  iOS 는 사본이 필요 없습니다(원격 출처로 띄웁니다 — 이유는 ios/FitLog/
  Config.swift 주석에 적어 두었습니다).

.PARAMETER Source
  웹 원본 폴더. 기본값은 이 저장소 옆의 fitlog-main.

.PARAMETER NoMedia
  운동 그림(media/, 약 7MB)을 빼고 복사합니다. APK 가 작아지는 대신, 그림은
  처음 볼 때 네트워크에서 받아 옵니다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\sync-web.ps1
#>
[CmdletBinding()]
param(
    [string]$Source,
    [switch]$NoMedia
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
if (-not $Source) {
    # 웹 원본은 이 저장소의 부모(= 저장소 루트)에 그대로 있습니다. 예전에는 옆에
    # fitlog-main 폴더를 따로 두었는데, 사본이 둘로 갈라지면서 웹만 고쳐지고 앱은
    # 옛 파일로 빌드되는 일이 생겨 하나로 합쳤습니다.
    $Source = Split-Path -Parent $repo
}
$dest = Join-Path $repo 'android\app\src\main\assets\web'

if (-not (Test-Path $Source)) {
    throw "웹 원본을 찾을 수 없습니다: $Source  (-Source 로 직접 지정하세요)"
}
if (-not (Test-Path (Join-Path $Source 'index.html'))) {
    throw "$Source 안에 index.html 이 없습니다. 폴더가 맞는지 확인하세요."
}

# 앱 안에 들어가면 안 되는 것들. 배포 설정 파일과 CI 설정은 웹 호스팅용이라
# APK 에 넣어 봐야 용량만 차지하고, 저장소 메타데이터는 새어 나가면 곤란합니다.
$exclude = @(
    'firebase.json', '.firebaserc', 'firestore.rules', 'firestore.indexes.json',
    '.gitignore', '.nojekyll', 'README.md'
)
# fitlog-hybrid 는 이 스크립트가 들어 있는 앱 프로젝트 자신입니다. 빼지 않으면
# 안드로이드 프로젝트가 통째로 APK 의 assets 안으로 들어갑니다.
$excludeDirs = @('.git', '.github', 'fitlog-hybrid')
if ($NoMedia) { $excludeDirs += 'media' }

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$copied = 0
Get-ChildItem -Path $Source -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($Source.Length).TrimStart('\', '/')
    $top = ($rel -split '[\\/]')[0]
    if ($excludeDirs -contains $top) { return }
    if ($exclude -contains $rel) { return }

    $target = Join-Path $dest $rel
    $dir = Split-Path -Parent $target
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $_.FullName $target -Force
    $script:copied++
}

$size = (Get-ChildItem $dest -Recurse -File | Measure-Object -Property Length -Sum).Sum
"{0}개 파일, {1:N1} MB → {2}" -f $copied, ($size / 1MB), $dest | Write-Host
Write-Host "이제 Android Studio 에서 빌드하거나 gradlew assembleDebug 를 실행하세요."

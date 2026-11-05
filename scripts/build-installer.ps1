# Builds TEMPEST's Windows installer from a built win-x64 folder (scripts/build-binaries.js
# runs this after building it). The installer's code, scripts/installer/Setup.cs, is
# compiled with the C# compiler that comes with Windows (.NET Framework 4.x), and the
# folder is packed inside it as a zip resource: nothing to download or install.
#
#   powershell -File scripts/build-installer.ps1 -Stage dist/tempest-<v>-win-x64 -Version <v> -Out dist/TEMPEST-Setup-<v>.exe

param(
  [Parameter(Mandatory = $true)][string]$Stage,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Icon = ''
)
$ErrorActionPreference = 'Stop'
# (Windows PowerShell 5.1 has no $PSScriptRoot yet while parameter defaults are worked out.)
if (-not $Icon) { $Icon = Join-Path $PSScriptRoot '..\assets\tempest.ico' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler (csc.exe) was not found.' }
$Stage = (Resolve-Path $Stage).Path
if (-not (Test-Path (Join-Path $Stage 'tempest.exe'))) { throw "$Stage holds no tempest.exe" }

$work = Join-Path ([IO.Path]::GetTempPath()) ("tempest-installer-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  # The payload: every file in the folder, with forward-slash names relative to it.
  $zipPath = Join-Path $work 'payload.zip'
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in Get-ChildItem -Path $Stage -Recurse -File) {
      if ($f.Extension -eq '.lnk') { continue } # shortcuts someone made in the build folder
      $rel = $f.FullName.Substring($Stage.Length).TrimStart('\').Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $zip.Dispose() }

  # 1.1.0-alpha → 1.1.0.0 for the file's version resource.
  $nums = @(([regex]::Matches($Version, '\d+') | ForEach-Object { $_.Value }) + @('0', '0', '0', '0'))[0..3] -join '.'
  $src = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'installer\Setup.cs'), [Text.Encoding]::UTF8).Replace('@VERSION@', $Version).Replace('@NUMERIC_VERSION@', $nums)
  $cs = Join-Path $work 'Setup.cs'
  [IO.File]::WriteAllText($cs, $src, (New-Object Text.UTF8Encoding($true)))

  $outFull = [IO.Path]::GetFullPath($Out)
  New-Item -ItemType Directory -Force -Path (Split-Path $outFull) | Out-Null
  if (Test-Path $outFull) { Remove-Item $outFull -Force }
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$outFull" `
    "/win32icon:$((Resolve-Path $Icon).Path)" "/win32manifest:$(Join-Path $PSScriptRoot 'installer\setup.manifest')" `
    "/resource:$zipPath,payload.zip" `
    /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    $cs
  if ($LASTEXITCODE -ne 0) { throw "csc.exe failed ($LASTEXITCODE)" }
  Write-Host ("  {0}  ({1:N1} MB)" -f $Out, ((Get-Item $outFull).Length / 1MB))
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

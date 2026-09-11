$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path $PSScriptRoot -Parent
$sourceFile = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'assets/icons') -Filter '*.png'
if (@($sourceFile).Count -ne 1) { throw 'Expected exactly one master PNG in assets/icons.' }
$source = [System.Drawing.Image]::FromFile($sourceFile.FullName)
try {
  foreach ($size in @(16, 32, 48, 180, 192, 512)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.Clear([System.Drawing.Color]::White)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
      $width = [single]($source.Width * $scale)
      $height = [single]($source.Height * $scale)
      $graphics.DrawImage($source, [single](($size - $width) / 2), [single](($size - $height) / 2), $width, $height)
      $name = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icons/smile-bike-v3-$size.png" }
      $bitmap.Save((Join-Path $projectRoot "public/$name"), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $source.Dispose() }

# ICO directory with PNG frames: all frames come from the same uncropped source.
$frames = @(16, 32, 48)
$stream = [System.IO.File]::Create((Join-Path $projectRoot 'public/favicon.ico'))
$writer = [System.IO.BinaryWriter]::new($stream)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
  $offset = 6 + 16 * $frames.Count
  foreach ($size in $frames) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $projectRoot "public/icons/smile-bike-v3-$size.png"))
    $writer.Write([byte]$size); $writer.Write([byte]$size)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]$offset)
    $offset += $bytes.Length
  }
  foreach ($size in $frames) {
    $writer.Write([System.IO.File]::ReadAllBytes((Join-Path $projectRoot "public/icons/smile-bike-v3-$size.png")))
  }
} finally { $writer.Dispose() }

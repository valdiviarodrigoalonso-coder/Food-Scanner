# Draws the app icon (blue gradient, white progress ring, barcode bars) at the sizes iOS needs.
# Run from the project folder:  powershell -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $c1 = [System.Drawing.Color]::FromArgb(255, 29, 78, 216)
  $c2 = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 50
  $g.FillRectangle($brush, $rect)

  $s = $size / 512.0
  # faint full ring + bright 75% progress arc
  $penBg = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), (44 * $s)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (44 * $s)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $ring = New-Object System.Drawing.RectangleF (96 * $s), (96 * $s), (320 * $s), (320 * $s)
  $g.DrawEllipse($penBg, $ring)
  $g.DrawArc($pen, $ring, -90, 270)

  # barcode bars in the middle
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $x = 186.0
  foreach ($w in 14, 8, 20, 8, 14, 22, 8) {
    $g.FillRectangle($white, [single]($x * $s), [single](196 * $s), [single]($w * $s), [single](120 * $s))
    $x += $w + 10
  }
  $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 253, 224, 71))
  $g.FillEllipse($accent, [single](360 * $s), [single](86 * $s), [single](64 * $s), [single](64 * $s))

  $g.Dispose()
  $bmp.Save((Join-Path $outDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Write-Output "Icons written to $outDir"

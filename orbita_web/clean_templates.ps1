$files = @('auxiliares-enf-rcf.html','consulta-cx-imdx.html','dash-eco.html','dash-stats.html','dashboard-citas-cx-imx.html','otros-eco.html','predictor-los.html')
$tplDir = 'src\main\resources\templates'
foreach ($f in $files) {
    $path = Join-Path $tplDir $f
    $fullPath = Resolve-Path $path
    $content = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)
    $headEnd = $content.IndexOf('</head>')
    $bodyStart = $content.IndexOf('<body')
    if ($headEnd -lt 0 -or $bodyStart -lt 0) { Write-Host "SKIP: $f"; continue }
    $between = $content.Substring($headEnd + 7, $bodyStart - $headEnd - 7)
    if (-not ($between -match '<(style|script|link)')) { Write-Host "ALREADY CLEAN: $f"; continue }
    # Remove the dirty content between </head> and <body>
    $clean = $content.Substring(0, $headEnd + 7) + "`n`n" + $content.Substring($bodyStart)
    [System.IO.File]::WriteAllText($fullPath, $clean, [System.Text.Encoding]::UTF8)
    Write-Host "FIXED: $f"
}

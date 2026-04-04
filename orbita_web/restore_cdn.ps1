$tplDir = 'src\main\resources\templates'

$jobs = @(
    @{
        file = 'consulta-cx-imdx.html'
        cdn  = @("<link href=""https://fonts.googleapis.com/icon?family=Material+Icons"" rel=""stylesheet"">")
    },
    @{
        file = 'dash-eco.html'
        cdn  = @(
            "<script src=""https://cdn.tailwindcss.com""></script>",
            "<script src=""https://cdn.jsdelivr.net/npm/chart.js""></script>",
            "<link href=""https://fonts.googleapis.com/icon?family=Material+Icons"" rel=""stylesheet"">"
        )
    },
    @{
        file = 'dashboard-citas-cx-imx.html'
        cdn  = @("<script src=""https://cdn.jsdelivr.net/npm/chart.js""></script>")
    }
)

foreach ($job in $jobs) {
    $path = Resolve-Path (Join-Path $tplDir $job.file)
    $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
    
    # Find </body> and insert CDN lines before it
    $bodyClose = $content.LastIndexOf('</body>')
    if ($bodyClose -lt 0) { Write-Host "NO BODY: $($job.file)"; continue }
    
    $insertion = "`r`n    <!-- CDN Libraries -->`r`n"
    foreach ($cdn in $job.cdn) {
        $insertion += "    $cdn`r`n"
    }
    
    $newContent = $content.Substring(0, $bodyClose) + $insertion + '</body>' + $content.Substring($bodyClose + 7)
    [System.IO.File]::WriteAllText($path, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "FIXED: $($job.file)"
}

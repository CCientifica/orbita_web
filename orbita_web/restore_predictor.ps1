$path = Resolve-Path 'src\main\resources\templates\predictor-los.html'
$content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

$bodyClose = $content.LastIndexOf('</body>')
$insertion = @"

    <!-- CDN Libraries -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        if (typeof tailwind !== 'undefined') tailwind.config = {
            theme: { extend: { colors: { rcf: { alert: '#f43f5e', warn: '#f59e0b', success: '#10b981' } } } }
        };
    </script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xlsx@0.19.3/dist/xlsx.full.min.js"></script>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <div th:replace="~{layout :: scripts}"></div>

"@

$newContent = $content.Substring(0, $bodyClose) + $insertion + '</body>' + $content.Substring($bodyClose + 7)
[System.IO.File]::WriteAllText($path, $newContent, [System.Text.Encoding]::UTF8)
Write-Host "FIXED: predictor-los.html"

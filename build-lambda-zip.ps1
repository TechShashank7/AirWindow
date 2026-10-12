$zipPath = "lambda-deployment.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
$tempDir = "temp_deploy_pkg"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Path "$tempDir\alerts" | Out-Null
New-Item -ItemType Directory -Path "$tempDir\observations" | Out-Null
New-Item -ItemType Directory -Path "$tempDir\googleAirQuality" | Out-Null
Copy-Item "lambda\recommendation.js" "$tempDir\"
Copy-Item "lambda\handler.js" "$tempDir\"
Copy-Item "lambda\package.json" "$tempDir\"
Copy-Item "lambda\alerts\*.js" "$tempDir\alerts\"
Copy-Item "lambda\observations\*.js" "$tempDir\observations\"
Copy-Item "lambda\googleAirQuality\*.js" "$tempDir\googleAirQuality\"
Start-Sleep -Milliseconds 300
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
Remove-Item -Recurse -Force $tempDir
Write-Host "Contents of ${zipPath}:"
tar -tf $zipPath

$zipPath = "lambda-deployment.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
$tempDir = "temp_deploy_pkg"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Path "$tempDir\alerts" | Out-Null
Copy-Item "lambda\recommendation.js" "$tempDir\"
Copy-Item "lambda\handler.js" "$tempDir\"
Copy-Item "lambda\package.json" "$tempDir\"
Copy-Item "lambda\alerts\*.js" "$tempDir\alerts\"
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
Remove-Item -Recurse -Force $tempDir
Write-Host "Contents of ${zipPath}:"
tar -tf $zipPath

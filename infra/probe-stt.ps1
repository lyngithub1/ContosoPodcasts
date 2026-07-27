$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Clear-Host
Add-Type -AssemblyName System.Net.Http

. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting SpeechEndpoint
$endpoint = $Studio.SpeechEndpoint
$apiVersion = '2024-11-15'
$mp3 = Join-Path $env:TEMP 'smoke-audio.mp3'
if (-not (Test-Path $mp3)) { throw "Missing $mp3 - run smoke-audio.ps1 first" }
$bytes = [System.IO.File]::ReadAllBytes($mp3)
Write-Host ("audio: {0} bytes" -f $bytes.Length)

$token = az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv
Write-Host ("token len: {0}" -f $token.Length)

$client = [System.Net.Http.HttpClient]::new()
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)

$content = [System.Net.Http.MultipartFormDataContent]::new()
$audioContent = [System.Net.Http.ByteArrayContent]::new($bytes)
$audioContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('audio/mpeg')
$content.Add($audioContent, 'audio', 'audio.mp3')

$defJson = '{"locales":["en-US"]}'
$defContent = [System.Net.Http.StringContent]::new($defJson)
$content.Add($defContent, 'definition')

$url = "$endpoint/speechtotext/transcriptions:transcribe?api-version=$apiVersion"
Write-Host "POST $url"
$resp = $client.PostAsync($url, $content).Result
$body = $resp.Content.ReadAsStringAsync().Result
Write-Host ("HTTP {0}" -f [int]$resp.StatusCode)
Write-Host '--- BODY ---'
Write-Host $body

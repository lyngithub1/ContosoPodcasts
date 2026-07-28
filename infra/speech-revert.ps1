$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting SpeechAccountName
$RG = $Studio.ResourceGroup
$log = "$PSScriptRoot\_speech-revert.log"
Set-Content -Path $log -Value ("speech revert " + (Get-Date -Format o))
function Log($m) { Add-Content -Path $log -Value $m }
$ids = Get-Content "$PSScriptRoot\_ids.json" -Raw | ConvertFrom-Json

# 1) Re-enable public network access (AAD/RBAC only - no keys) so TTS/STT work again.
az resource update --ids $ids.speech --set properties.publicNetworkAccess=Enabled properties.networkAcls.defaultAction=Allow -o none 2>&1 | Add-Content -Path $log
Log ("speech publicAccess ENABLED exit={0}" -f $LASTEXITCODE)

# 2) Delete the francecentral private endpoint (its cross-region PE breaks TTS) so the
#    in-VNet app resolves Speech to the public endpoint again. This also removes the
#    speech A record from the shared privatelink.cognitiveservices.azure.com zone
#    (docintel's A record is unaffected).
az network private-endpoint delete -g $RG -n pe-speech -o none 2>&1 | Add-Content -Path $log
Log ("pe-speech deleted exit={0}" -f $LASTEXITCODE)

Log "=== post-state ==="
Log ("speech public=" + (az cognitiveservices account show -n $Studio.SpeechAccountName -g $RG --query "properties.publicNetworkAccess" -o tsv 2>$null))
Log "cognitiveservices zone A records (should list ONLY docintel):"
$recs = az network private-dns record-set a list -g $RG -z 'privatelink.cognitiveservices.azure.com' --query "[].{n:name,ip:aRecords[0].ipv4Address}" -o tsv 2>$null
foreach ($r in $recs) { Log "   $r" }

Log "=== restart container app revision ==="
az containerapp revision restart -n podstudio-api -g $RG --revision podstudio-api--0000007 -o none 2>&1 | Add-Content -Path $log
Log ("restart exit={0}" -f $LASTEXITCODE)
Log "=== DONE ==="

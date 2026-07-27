$ErrorActionPreference = 'Continue'
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting SearchServiceName
$RG = $Studio.ResourceGroup
$log = "$PSScriptRoot\_rollback.log"
Set-Content -Path $log -Value ("ROLLBACK re-enable public " + (Get-Date -Format o))
function Log($m) { Add-Content -Path $log -Value $m }
$ids = Get-Content "$PSScriptRoot\_ids.json" -Raw | ConvertFrom-Json

foreach ($p in @(@{n = 'speech'; id = $ids.speech }, @{n = 'docintel'; id = $ids.docintel })) {
  az resource update --ids $p.id --set properties.publicNetworkAccess=Enabled properties.networkAcls.defaultAction=Allow -o none 2>&1 | Add-Content -Path $log
  Log ("{0} publicAccess ENABLED exit={1}" -f $p.n, $LASTEXITCODE)
}
az search service update -n $Studio.SearchServiceName -g $RG --public-network-access enabled -o none 2>&1 | Add-Content -Path $log
Log ("search publicAccess ENABLED exit={0}" -f $LASTEXITCODE)
Log "=== rollback DONE — services reachable publicly again ==="

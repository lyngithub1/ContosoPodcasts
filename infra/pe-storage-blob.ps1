$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Clear-Host
. "$PSScriptRoot/_env.ps1"
Assert-StudioSetting SubscriptionId, StorageAccountName
$rg = $Studio.ResourceGroup
$vnet = $Studio.VNetName
$subnet = $Studio.PrivateEndpointSubnet
$vnetId = Get-StudioResourceId -Provider 'Microsoft.Network/virtualNetworks' -Name $vnet
$stgId = Get-StudioResourceId -Provider 'Microsoft.Storage/storageAccounts' -Name $Studio.StorageAccountName
$zone = 'privatelink.blob.core.windows.net'

Write-Host "1) Ensure private DNS zone $zone"
$exists = az network private-dns zone list -g $rg --query "[?name=='$zone'].name" -o tsv
if (-not $exists) {
  az network private-dns zone create -g $rg -n $zone -o none
  Write-Host '   created'
} else { Write-Host '   already exists' }

Write-Host "2) Ensure VNet link"
$linkExists = az network private-dns link vnet list -g $rg -z $zone --query "[?name=='link-podstudio'].name" -o tsv
if (-not $linkExists) {
  az network private-dns link vnet create -g $rg -z $zone -n link-podstudio --virtual-network $vnetId --registration-enabled false -o none
  Write-Host '   created'
} else { Write-Host '   already exists' }

Write-Host "3) Create private endpoint pe-storage-blob"
$peExists = az network private-endpoint list -g $rg --query "[?name=='pe-storage-blob'].name" -o tsv
if (-not $peExists) {
  az network private-endpoint create -g $rg -n pe-storage-blob `
    --vnet-name $vnet --subnet $subnet `
    --private-connection-resource-id $stgId `
    --group-id blob `
    --connection-name pe-storage-blob-conn -o none
  Write-Host '   created'
} else { Write-Host '   already exists' }

Write-Host "4) Create DNS zone group (auto A-record registration)"
$zgExists = az network private-endpoint dns-zone-group list -g $rg --endpoint-name pe-storage-blob --query "[?name=='default'].name" -o tsv 2>$null
if (-not $zgExists) {
  az network private-endpoint dns-zone-group create -g $rg --endpoint-name pe-storage-blob `
    --name default --private-dns-zone $zone --zone-name blob -o none
  Write-Host '   created'
} else { Write-Host '   already exists' }

Write-Host "`n5) Verify A record"
az network private-dns record-set a list -g $rg -z $zone --query "[].{name:name, ip:aRecords[0].ipv4Address}" -o table
Write-Host "`nDONE"

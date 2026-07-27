$ProgressPreference = 'SilentlyContinue'
. "$PSScriptRoot/_env.ps1"
$rg = $Studio.ResourceGroup
Write-Host '=== Container App env vars ==='
az containerapp show -n $Studio.ContainerAppName -g $rg --query "properties.template.containers[0].env[].name" -o tsv
Write-Host "`n=== APIM studio-api serviceUrl ==="
if ($Studio.ApimName) {
  az apim api show --service-name $Studio.ApimName -g $rg --api-id studio-api --query "serviceUrl" -o tsv 2>$null
} else {
  Write-Host '(set PODSTUDIO_RESOURCE_SUFFIX or PODSTUDIO_APIM_NAME to query APIM)'
}
Write-Host "`n=== Storage account + containers ==="
$st = az storage account list -g $rg --query "[0].name" -o tsv
Write-Host "account: $st"
az storage container list --account-name $st --auth-mode login --query "[].name" -o tsv 2>$null
Write-Host "`n=== Service Bus namespace + queues ==="
$sb = az servicebus namespace list -g $rg --query "[0].name" -o tsv
Write-Host "namespace: $sb"
az servicebus queue list --namespace-name $sb -g $rg --query "[].name" -o tsv 2>$null
Write-Host "`n=== Cognitive Services accounts (kinds) ==="
az cognitiveservices account list -g $rg --query "[].{name:name, kind:kind, endpoint:properties.endpoint}" -o json
Write-Host "`n=== Search service ==="
az search service list -g $rg --query "[].{name:name, sku:sku.name}" -o json 2>$null
Write-Host "`n=== MI role assignments (podstudio-id) ==="
$miPrincipal = az identity show -n 'podstudio-id' -g $rg --query principalId -o tsv 2>$null
if ($miPrincipal) {
  az role assignment list --assignee $miPrincipal --all --query "[].{role:roleDefinitionName, scope:scope}" -o json 2>$null
} else {
  Write-Host '(managed identity podstudio-id not found in this resource group)'
}
Write-Host "`n=== DONE ==="

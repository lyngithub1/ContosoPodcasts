$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-grant.txt'
if (Test-Path $o) { Remove-Item $o }

. "$PSScriptRoot/../_env.ps1"
Assert-StudioSetting SubscriptionId, FoundryAccount, FoundryResourceGroup

# Object id of the platform user-assigned managed identity (podstudio-id).
# Resolved at run time so no principal id has to be committed.
$miName = [Environment]::GetEnvironmentVariable('PODSTUDIO_IDENTITY_NAME')
if (-not $miName) { $miName = 'podstudio-id' }
$principal = az identity show -n $miName -g $Studio.ResourceGroup --query principalId -o tsv
if (-not $principal) { throw "Could not resolve the principal id for managed identity '$miName' in '$($Studio.ResourceGroup)'." }

$scope = Get-StudioResourceId -Provider 'Microsoft.CognitiveServices/accounts' -Name $Studio.FoundryAccount -ResourceGroup $Studio.FoundryResourceGroup

foreach ($role in @('Cognitive Services User', 'Azure AI Developer')) {
  "== granting '$role' to MI ==" | Add-Content $o
  az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role "$role" --scope $scope --query "{role:roleDefinitionName, principal:principalId}" -o json 2>&1 | Add-Content $o
}

"== resulting MI assignments on account ==" | Add-Content $o
az role assignment list --assignee $principal --scope $scope --query "[].roleDefinitionName" -o json 2>&1 | Add-Content $o

Get-Content $o

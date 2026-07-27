$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Continue'
$o = Join-Path $env:TEMP 'foundry-disc.txt'
if (Test-Path $o) { Remove-Item $o }
. "$PSScriptRoot/../_env.ps1"
"== current subscription ==" | Add-Content $o
az account show --query "{name:name, id:id, tenant:tenantId}" -o json 2>&1 | Add-Content $o
"== AI Services / OpenAI accounts (this sub) ==" | Add-Content $o
az cognitiveservices account list --query "[].{name:name, rg:resourceGroup, kind:kind, ep:properties.endpoint}" -o json 2>&1 | Add-Content $o
"== MI podstudio-id ==" | Add-Content $o
az identity show -n podstudio-id -g $Studio.ResourceGroup --query "{principalId:principalId, clientId:clientId}" -o json 2>&1 | Add-Content $o
Get-Content $o

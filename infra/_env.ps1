# Shared configuration for the Podcast Studio operational scripts.
#
# NO SECRETS LIVE HERE. This file only resolves *resource coordinates*
# (subscription id, resource group, resource-name suffix, endpoints) so that no
# tenant-specific value has to be hard-coded into a script that gets committed.
#
# Resolution order for every setting:
#   1. an existing PODSTUDIO_* environment variable
#   2. a value set by ./_env.local.ps1 (git-ignored — your personal overrides)
#   3. the safe default below (usually empty, which makes scripts fail loudly)
#
# To configure your own environment:
#   Copy-Item infra/_env.local.ps1.example infra/_env.local.ps1
#   # then edit infra/_env.local.ps1
#
# Dot-source this from a script:
#   . "$PSScriptRoot/_env.ps1"        # scripts in infra/
#   . "$PSScriptRoot/../_env.ps1"     # scripts in infra/foundry/

# Local, git-ignored overrides (may set PODSTUDIO_* env vars).
$__studioLocal = Join-Path $PSScriptRoot '_env.local.ps1'
if (Test-Path $__studioLocal) { . $__studioLocal }

function Get-StudioSetting {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$Default = ''
    )
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value
}

$__sub    = Get-StudioSetting 'PODSTUDIO_SUBSCRIPTION_ID'
$__rg     = Get-StudioSetting 'PODSTUDIO_RESOURCE_GROUP' 'rg-podstudio-dev'
$__suffix = Get-StudioSetting 'PODSTUDIO_RESOURCE_SUFFIX'

$Studio = [ordered]@{
    SubscriptionId         = $__sub
    ResourceGroup          = $__rg
    Location               = Get-StudioSetting 'PODSTUDIO_LOCATION' 'francecentral'
    ResourceSuffix         = $__suffix

    # Deployed endpoints (no default — set them for your environment).
    ApiBaseUrl             = (Get-StudioSetting 'PODSTUDIO_API_BASE_URL').TrimEnd('/')
    SpeechEndpoint         = Get-StudioSetting 'PODSTUDIO_SPEECH_ENDPOINT'

    # Networking
    VNetName               = Get-StudioSetting 'PODSTUDIO_VNET_NAME' 'vnet-podstudio'
    PrivateEndpointSubnet  = Get-StudioSetting 'PODSTUDIO_PE_SUBNET' 'snet-pe'
    PrivateDnsLinkName     = Get-StudioSetting 'PODSTUDIO_DNS_LINK_NAME' 'link-podstudio'

    # Conventional resource names derived from the suffix (override individually
    # with PODSTUDIO_<THING>_NAME if your naming differs).
    ContainerAppName       = Get-StudioSetting 'PODSTUDIO_CONTAINERAPP_NAME' 'podstudio-api'
    StorageAccountName     = Get-StudioSetting 'PODSTUDIO_STORAGE_NAME'   $(if ($__suffix) { "st$__suffix" } else { '' })
    CosmosAccountName      = Get-StudioSetting 'PODSTUDIO_COSMOS_NAME'    $(if ($__suffix) { "cosmos-$__suffix" } else { '' })
    SearchServiceName      = Get-StudioSetting 'PODSTUDIO_SEARCH_NAME'    $(if ($__suffix) { "podstudio-search-$__suffix" } else { '' })
    SpeechAccountName      = Get-StudioSetting 'PODSTUDIO_SPEECH_NAME'    $(if ($__suffix) { "podstudio-speech-$__suffix" } else { '' })
    DocIntelAccountName    = Get-StudioSetting 'PODSTUDIO_DOCINTEL_NAME'  $(if ($__suffix) { "podstudio-docintel-$__suffix" } else { '' })
    ApimName               = Get-StudioSetting 'PODSTUDIO_APIM_NAME'      $(if ($__suffix) { "podstudio-apim-$__suffix" } else { '' })
    AcrName                = Get-StudioSetting 'PODSTUDIO_ACR_NAME'       $(if ($__suffix) { "acr$__suffix" } else { '' })

    # Microsoft Foundry (agents live in their own resource group/account).
    FoundryResourceGroup   = Get-StudioSetting 'PODSTUDIO_FOUNDRY_RESOURCE_GROUP'
    FoundryAccount         = Get-StudioSetting 'PODSTUDIO_FOUNDRY_ACCOUNT'
    FoundryProjectEndpoint = (Get-StudioSetting 'PODSTUDIO_FOUNDRY_PROJECT_ENDPOINT').TrimEnd('/')
    FoundryApiVersion      = Get-StudioSetting 'PODSTUDIO_FOUNDRY_API_VERSION' 'v1'
}

<#
.SYNOPSIS
Fail fast with an actionable message when a required setting is missing.

.EXAMPLE
Assert-StudioSetting ApiBaseUrl, SubscriptionId
#>
function Assert-StudioSetting {
    param([Parameter(Mandatory)][string[]]$Name)
    $missing = @($Name | Where-Object { [string]::IsNullOrWhiteSpace($Studio[$_]) })
    if ($missing.Count -gt 0) {
        throw @"
Missing required Podcast Studio setting(s): $($missing -join ', ')

Set them for this session, e.g.:
  `$env:PODSTUDIO_SUBSCRIPTION_ID = '<your-subscription-guid>'
  `$env:PODSTUDIO_RESOURCE_SUFFIX = '<your-resource-suffix>'
  `$env:PODSTUDIO_API_BASE_URL    = 'https://<your-container-app>.azurecontainerapps.io'

…or copy infra/_env.local.ps1.example to infra/_env.local.ps1 and fill it in
(that file is git-ignored and never committed).
"@
    }
}

<# .SYNOPSIS Build a full ARM resource id under the configured subscription. #>
function Get-StudioResourceId {
    param(
        [Parameter(Mandatory)][string]$Provider,   # e.g. Microsoft.Storage/storageAccounts
        [Parameter(Mandatory)][string]$Name,
        [string]$ResourceGroup = $Studio.ResourceGroup
    )
    Assert-StudioSetting SubscriptionId
    "/subscriptions/$($Studio.SubscriptionId)/resourceGroups/$ResourceGroup/providers/$Provider/$Name"
}

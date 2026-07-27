// Virtual network for private connectivity (§5 security posture).
//
// Corporate Azure Policy (`MCAPSGovDeployPolicies` → `CosmosDB_PublicNetwork_Modify`)
// force-disables public network access on every Cosmos DB account. The Container
// Apps API therefore reaches Cosmos over a private endpoint, which requires the
// environment to be VNet-integrated. This module provides:
//   - snet-aca-infra: delegated subnet for the Container Apps environment.
//   - snet-pe:        subnet that hosts the Cosmos private endpoint.
//   - privatelink.documents.azure.com: private DNS zone, linked to the VNet, so
//     in-VNet callers resolve the account name to its private IP.
//
// The VNet, the Container Apps environment, and the Cosmos account must share the
// same region for the private endpoint to bind.

@description('Virtual network name.')
param name string

@description('Location (must match the Container Apps environment and Cosmos DB region).')
param location string

@description('Resource tags.')
param tags object

@description('VNet address space.')
param addressPrefix string = '10.20.0.0/16'

@description('Container Apps infrastructure subnet prefix (delegated to Microsoft.App/environments).')
param infraSubnetPrefix string = '10.20.0.0/23'

@description('Private endpoint subnet prefix.')
param peSubnetPrefix string = '10.20.2.0/27'

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [
      {
        name: 'snet-aca-infra'
        properties: {
          addressPrefix: infraSubnetPrefix
          delegations: [
            {
              name: 'aca'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-pe'
        properties: {
          addressPrefix: peSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// Private DNS zones for every privately-reachable service, each linked to the
// VNet so in-VNet callers resolve the public hostname to the private IP.
//
// Note: Speech and Document Intelligence share
// `privatelink.cognitiveservices.azure.com`. Speech currently keeps public
// network access (its TTS/STT data plane rejected a cross-region private
// endpoint); co-locating Speech with this VNet is the production fix, after
// which it can reuse this same zone.
var privateDnsZoneNames = [
  'privatelink.documents.azure.com'
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.vaultcore.azure.net'
  'privatelink.search.windows.net'
  'privatelink.cognitiveservices.azure.com'
]

resource privateDnsZones 'Microsoft.Network/privateDnsZones@2020-06-01' = [
  for zone in privateDnsZoneNames: {
    name: zone
    location: 'global'
    tags: tags
  }
]

resource privateDnsLinks 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = [
  for (zone, i) in privateDnsZoneNames: {
    name: '${zone}/link-${name}'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: {
        id: vnet.id
      }
    }
    dependsOn: [privateDnsZones[i]]
  }
]

output vnetId string = vnet.id
output infraSubnetId string = '${vnet.id}/subnets/snet-aca-infra'
output peSubnetId string = '${vnet.id}/subnets/snet-pe'
output cosmosDnsZoneId string = privateDnsZones[0].id
output blobDnsZoneId string = privateDnsZones[1].id
output keyVaultDnsZoneId string = privateDnsZones[2].id
output searchDnsZoneId string = privateDnsZones[3].id
output cognitiveServicesDnsZoneId string = privateDnsZones[4].id


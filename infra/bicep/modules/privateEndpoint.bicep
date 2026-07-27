// Reusable private endpoint + private DNS zone group.
//
// Every data service in this platform is reachable only from the VNet. Rather
// than repeat the same two resources in each service module, they are declared
// once here and instantiated per service from main.bicep.

@description('Private endpoint name, e.g. pe-cosmos.')
param name string

@description('Location (must match the VNet region).')
param location string

@description('Resource tags.')
param tags object

@description('Resource id of the subnet that hosts the private endpoint.')
param subnetId string

@description('Resource id of the service being exposed privately.')
param targetResourceId string

@description('Private link group id for the target, e.g. blob, vault, searchService, account.')
param groupId string

@description('Resource id of the matching privatelink private DNS zone.')
param privateDnsZoneId string

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${name}-conn'
        properties: {
          privateLinkServiceId: targetResourceId
          groupIds: [groupId]
        }
      }
    ]
  }
}

resource dnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: privateEndpoint
  name: 'zg-${groupId}'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: groupId
        properties: {
          privateDnsZoneId: privateDnsZoneId
        }
      }
    ]
  }
}

output id string = privateEndpoint.id
output name string = privateEndpoint.name

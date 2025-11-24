import { App, Duration } from 'aws-cdk-lib'
import { join } from 'path'
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53'
import { Construct } from 'constructs'
import { RemovalPolicy } from 'aws-cdk-lib'
import { IWickrEnvironmentConfig } from './types/wickr-environment-config'

const CTX_ROUTE53_HOSTED_ZONE_ID = 'wickr/route53:hostedZoneId'
const CTX_ROUTE53_HOSTED_ZONE_NAME = 'wickr/route53:hostedZoneName'

export function parseBoolean(input: string | boolean | undefined, defaultValue: boolean = false) {
  if (typeof input === 'boolean') return input
  if (typeof input === 'undefined') return defaultValue
  return input.toLowerCase() === 'true'
}

// Try to get a HostedZone object based on the supplied context values
export function tryGetHostedZone(scope: Construct, config: IWickrEnvironmentConfig): IHostedZone | undefined {
  const hostedZoneId = config.hostedZoneId
  const zoneName = config.zoneName

  if (!hostedZoneId || !zoneName) {
    console.warn(
      `⚠️   WARNING: ${CTX_ROUTE53_HOSTED_ZONE_ID} and ${CTX_ROUTE53_HOSTED_ZONE_NAME} are not defined. Skipping DNS and Certificate creation. ⚠️`
    )
    return undefined
  }

  return HostedZone.fromHostedZoneAttributes(scope, 'HostedZone', {
    zoneName,
    hostedZoneId,
  })
}

export function parseRemovalPolicy(input: string, dfault: RemovalPolicy = RemovalPolicy.SNAPSHOT): RemovalPolicy {
  let policy: RemovalPolicy = dfault

  switch (input.toLowerCase()) {
    case 'snapshot':
      policy = RemovalPolicy.SNAPSHOT
      break
    case 'destroy':
      policy = RemovalPolicy.DESTROY
      break
    case 'retain':
      policy = RemovalPolicy.RETAIN
      break
    default:
      console.warn(`Invalid removal policy '${input}'. Defaulting to '${dfault}'`)
      break
  }

  return policy
}

export function getEnvironmentConfig(app: App): IWickrEnvironmentConfig {
  return {
    licensePath: app.node.tryGetContext('wickr/licensePath'),
    caPath: app.node.tryGetContext('wickr/caPath') || join(__dirname, '../lib/assets/certificate/amazon-ca.pem'),
    importedCertArn: app.node.tryGetContext('wickr/acm:certificateArn'),
    domain: app.node.tryGetContext('wickr/domainName'),
    clusterVersion: app.node.tryGetContext('wickr/eks:clusterVersion') || '1.30',
    eksEnableAutoscaler: parseBoolean(app.node.tryGetContext('wickr/eks:enableAutoscaler'), false),
    eksDefaultInstanceTypes: app.node.tryGetContext('wickr/eks:instanceTypes') || 'm5.xlarge',
    eksCallingInstanceTypes: app.node.tryGetContext('wickr/eks:instanceTypesCalling') || 'c5n.large',
    eksDefaultDesiredSize: parseInt(app.node.tryGetContext('wickr/eks:defaultCapacity')) || 3,
    eksCallingDesiredSize: parseInt(app.node.tryGetContext('wickr/eks:defaultCapacityCalling')) || 2,
    rdsInstanceType: app.node.tryGetContext('wickr/rds:instanceType'),
    rdsReaderCount: parseInt(app.node.tryGetContext('wickr/rds:readerCount')),
    rdsRemovalPolicy: app.node.tryGetContext('wickr/rds:removalPolicy') || 'snapshot',
    rdsDeletionProtection: parseBoolean(app.node.tryGetContext('wickr/rds:deletionProtection'), true),
    rdsRetention: Duration.days(parseInt(app.node.tryGetContext('wickr/rds:backupRetentionDays')) || 7),
    rdsMySqlVersion: app.node.tryGetContext('wickr/rds:mySqlVersion') || '5.7',
    vpcCidr: app.node.tryGetContext('wickr/vpc:cidr'),
    hostedZoneId: app.node.tryGetContext('wickr/route53:hostedZoneId'),
    zoneName: app.node.tryGetContext('wickr/route53:hostedZoneName'),
    s3Expiration: Duration.days(parseInt(app.node.tryGetContext('wickr/s3:expireAfterDays')) || 1095),
    namespace: app.node.tryGetContext('wickr/eks:namespace') || 'wickr',
    importedVpcId: app.node.tryGetContext('wickr/vpc:id'),
    importedVpcCidr: app.node.tryGetContext('wickr/vpc:cidr'),
    importedVpcAZs: app.node.tryGetContext('wickr/vpc:availabilityZones') || '',
    importedVpcPublicSubnetIds: app.node.tryGetContext('wickr/vpc:publicSubnetIds') || '',
    importedVpcPrivateSubnetIds: app.node.tryGetContext('wickr/vpc:privateSubnetIds') || '',
    importedVpcIsolatedSubnetIds: app.node.tryGetContext('wickr/vpc:isolatedSubnetIds') || '',
    albDisableIpv6: parseBoolean(app.node.tryGetContext('wickr/alb:disableIpv6'), false),
    albPrivateAddress: parseBoolean(app.node.tryGetContext('wickr/alb:privateAddress'), false),
    stackSuffix: app.node.tryGetContext('wickr/stackSuffix') || '',
    autoDeployWickr: parseBoolean(app.node.tryGetContext('wickr/autoDeployWickr'), true),
    importedKmsKeyArn: app.node.tryGetContext('wickr/kms:kmsKey'),
    enableCallingIngress: app.node.tryGetContext('wickr/enableCallingIngress') || false,
    replicatedChannel: app.node.tryGetContext('wickr/replicatedChannel') || '',
  }
}

import { Duration, RemovalPolicy } from 'aws-cdk-lib'

export interface IWickrEnvironmentConfig {
  licensePath: string
  caPath: string
  importedCertArn: string
  domain: string
  eksDefaultDesiredSize: number
  eksCallingDesiredSize: number
  rdsInstanceType: string
  rdsReaderCount: number
  rdsDeletionProtection: boolean
  rdsRetention: Duration
  vpcCidr: string
  hostedZoneId: string
  zoneName: string
  s3Expiration: Duration
  namespace: string
  clusterVersion: string
  eksEnableAutoscaler: boolean
  eksDefaultInstanceTypes: string
  eksCallingInstanceTypes: string
  rdsRemovalPolicy: RemovalPolicy
  importedVpcId: string
  importedVpcCidr: string
  importedVpcAZs: string
  importedVpcPublicSubnetIds: string
  importedVpcPrivateSubnetIds: string
  importedVpcIsolatedSubnetIds: string
  albDisableIpv6: boolean
  albPrivateAddress: boolean
  stackSuffix: string
  autoDeployWickr: boolean
  importedKmsKeyArn: string
}

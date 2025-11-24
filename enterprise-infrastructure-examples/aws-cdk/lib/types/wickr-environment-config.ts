import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import { RDS_MYSQL_VERSION } from '../constants'

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
  rdsMySqlVersion: keyof typeof RDS_MYSQL_VERSION
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
  enableCallingIngress: boolean
  replicatedChannel: string
}

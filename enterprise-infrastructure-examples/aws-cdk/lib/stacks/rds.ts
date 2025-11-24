import * as cdk from 'aws-cdk-lib'
import { IVpc, InstanceType, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { IKey } from 'aws-cdk-lib/aws-kms'
import {
  AuroraMysqlEngineVersion,
  CaCertificate,
  ClusterInstance,
  DatabaseCluster,
  DatabaseClusterEngine,
  IClusterInstance,
  InstanceUpdateBehaviour,
  ProvisionedClusterInstanceProps,
} from 'aws-cdk-lib/aws-rds'
import { Construct } from 'constructs'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'
import { RDS_MYSQL_VERSION } from '../constants'

export interface RdsStackProps extends cdk.StackProps {
  key: IKey
  vpc: IVpc
}
export class RdsStack extends cdk.Stack {
  readonly cluster: DatabaseCluster

  private readonly DEFAULT_DATABASE_NAME = 'wickrdb'
  private readonly DEFAULT_INSTANCE_TYPE = 'r6g.xlarge'
  private readonly DEFAULT_READER_COUNT = 1

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, props: RdsStackProps) {
    super(scope, id, props)

    if (!RDS_MYSQL_VERSION[config.rdsMySqlVersion]) {
      throw new Error(`Unsupported RDS MySQL version: ${config.rdsMySqlVersion}, supported versions: ${Object.keys(RDS_MYSQL_VERSION)}`)
    }

    const instanceType: InstanceType = new InstanceType(config.rdsInstanceType || this.DEFAULT_INSTANCE_TYPE)
    const instanceProps: ProvisionedClusterInstanceProps = {
      instanceType,
      autoMinorVersionUpgrade: true,
      publiclyAccessible: false,
      caCertificate: CaCertificate.RDS_CA_ECC384_G1,
    }

    const readers: Array<IClusterInstance> = []
    const readerCount = config.rdsReaderCount ?? this.DEFAULT_READER_COUNT
    for (let i = 0; i < readerCount; i++) {
      readers.push(ClusterInstance.provisioned(`Instance${i + 1}`, instanceProps))
    }

    this.cluster = new DatabaseCluster(this, 'Db', {
      engine: DatabaseClusterEngine.auroraMysql({
        version: RDS_MYSQL_VERSION[config.rdsMySqlVersion]
      }),
      parameters: {
        tls_version: 'tlsv1.2',
      },
      defaultDatabaseName: this.DEFAULT_DATABASE_NAME,
      deletionProtection: config.rdsDeletionProtection,
      removalPolicy: config.rdsRemovalPolicy,
      instanceUpdateBehaviour: InstanceUpdateBehaviour.ROLLING,
      cloudwatchLogsExports: ['error', 'slowquery', 'audit'],
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      storageEncryptionKey: props.key,
      writer: ClusterInstance.provisioned('Instance0', instanceProps),
      readers,
      backup: {
        retention: config.rdsRetention,
      },
    })

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
    })

    if (readerCount > 0) {
      new cdk.CfnOutput(this, 'DatabaseEndpointRO', {
        value: this.cluster.clusterReadEndpoint.hostname,
      })
    }

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      description: 'ARN of the Secrets Manager Secret with admin credentials',
      value: this.cluster.secret!.secretArn,
    })
  }
}

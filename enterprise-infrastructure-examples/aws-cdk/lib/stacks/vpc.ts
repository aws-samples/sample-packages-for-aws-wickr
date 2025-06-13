import * as cdk from 'aws-cdk-lib'
import {
  GatewayVpcEndpointAwsService,
  IVpc,
  InterfaceVpcEndpointAwsService,
  IpAddresses,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs'
import { Ipv6Vpc } from '../constructs/ipv6-vpc'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export interface VpcStackProps extends cdk.StackProps {
  config: IWickrEnvironmentConfig,
}

export class VpcStack extends cdk.Stack {
  readonly vpc: IVpc

  private readonly DEFAULT_CIDR = '172.16.0.0/16'
    
  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props)

    const { config } = props;

    if (config.importedVpcId) {
      this.vpc = Vpc.fromVpcAttributes(this, 'WickrImportedVpc', {
        vpcId: config.importedVpcId,
        vpcCidrBlock: config.importedVpcCidr,
        availabilityZones: config.importedVpcAZs.split(','),
        publicSubnetIds: config.importedVpcPublicSubnetIds.split(','),
        privateSubnetIds: config.importedVpcPrivateSubnetIds.split(','),
        isolatedSubnetIds: config.importedVpcIsolatedSubnetIds.split(','),
      })
    } else {
      this.vpc = new Ipv6Vpc(this, 'WickrVpc', {
        ipAddresses: IpAddresses.cidr(config.vpcCidr || this.DEFAULT_CIDR),
        maxAzs: 3,
        subnetConfiguration: [
          {
            cidrMask: 21,
            name: 'public',
            subnetType: SubnetType.PUBLIC,
          },
          {
            cidrMask: 21,
            name: 'private',
            subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          },
          {
            cidrMask: 24,
            name: 'isolated',
            subnetType: SubnetType.PRIVATE_ISOLATED,
          },
        ],
        gatewayEndpoints: {
          S3: {
            service: GatewayVpcEndpointAwsService.S3,
          },
        },
      })

      this.addVpcInterfaces(this.vpc)
    }
  }

  private addVpcInterfaces(vpc: IVpc) {
    const services = [
      InterfaceVpcEndpointAwsService.CLOUDWATCH,
      InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      InterfaceVpcEndpointAwsService.EC2,
      InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      InterfaceVpcEndpointAwsService.ECR,
      InterfaceVpcEndpointAwsService.ECR_DOCKER,
      InterfaceVpcEndpointAwsService.ELASTIC_LOAD_BALANCING,
      InterfaceVpcEndpointAwsService.KMS,
      InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      InterfaceVpcEndpointAwsService.SSM,
      InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    ]

    for (const service of services) {
      // service.shortName is e.g. com.amazonaws.us-east-1.ecs
      vpc.addInterfaceEndpoint(`VpcEndpoint-${service.shortName}`, { service })
    }
  }
}

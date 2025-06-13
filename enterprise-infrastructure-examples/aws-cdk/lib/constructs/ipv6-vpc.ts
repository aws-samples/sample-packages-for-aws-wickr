import { Fn, Stack } from 'aws-cdk-lib'
import {
  CfnInternetGateway,
  CfnSubnet,
  CfnVPCCidrBlock,
  ISubnet,
  RouterType,
  Subnet,
  Vpc,
  VpcProps,
} from 'aws-cdk-lib/aws-ec2'
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources'
import { Construct } from 'constructs'

export class Ipv6Vpc extends Vpc {
  constructor(scope: Construct, id: string, props?: VpcProps) {
    super(scope, id, props)

    // Associate an IPv6 CIDR block to our VPC
    const ipv6Block = new CfnVPCCidrBlock(this, 'IPv6Block', {
      amazonProvidedIpv6CidrBlock: true,
      vpcId: this.vpcId,
    })

    // Using escape hatches to assign an Ipv6 address to every subnet
    this.publicSubnets.forEach((subnet: ISubnet, idx: number) => {
      const unboxedSubnet = subnet as Subnet

      unboxedSubnet.addRoute('IPv6Default', {
        routerId: (this.node.children.find((c) => c instanceof CfnInternetGateway) as CfnInternetGateway)?.ref,
        routerType: RouterType.GATEWAY,
        destinationIpv6CidrBlock: '::/0',
      })

      const vpcCidrBlock = Fn.select(0, this.vpcIpv6CidrBlocks)
      const ipv6Cidrs = Fn.cidr(vpcCidrBlock, this.publicSubnets.length, '64')
      const cfnSubnet =
        (subnet.node.children.find((c) => c instanceof CfnSubnet) as CfnSubnet) ?? new Error("Couldn't find subnet")
      cfnSubnet.ipv6CidrBlock = Fn.select(idx, ipv6Cidrs)
      cfnSubnet.addDependency(ipv6Block)

      // Define a custom resource to auto-assign IPv6 addresses to all of our subnets
      const AutoAssignCustomResourceId = `AutoAssignIPv6CustomResource-Subnet-${idx}`

      new AwsCustomResource(this, AutoAssignCustomResourceId, {
        policy: AwsCustomResourcePolicy.fromSdkCalls({
          resources: AwsCustomResourcePolicy.ANY_RESOURCE,
        }),
        onCreate: {
          physicalResourceId: PhysicalResourceId.of(`${AutoAssignCustomResourceId}-Create`),
          service: 'EC2',
          action: 'modifySubnetAttribute',
          parameters: {
            AssignIpv6AddressOnCreation: { Value: true },
            SubnetId: subnet.subnetId,
          },
        },
      })
    })
  }
}

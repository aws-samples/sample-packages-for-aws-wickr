import { CfnLaunchTemplate, InstanceType, SecurityGroup, SubnetSelection } from 'aws-cdk-lib/aws-ec2'
import { Cluster, Nodegroup, NodegroupAmiType } from 'aws-cdk-lib/aws-eks'
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

export interface EksNodeGroupProps {
  cluster: Cluster
  clusterVersion: string
  instanceTypes: Array<InstanceType>
  desiredSize: number
  labels?: { [name: string]: string }
  securityGroups: Array<SecurityGroup>
  subnets?: SubnetSelection
  releaseVersion?: string
  amiType?: NodegroupAmiType
}

export class EksNodeGroup extends Construct {
  readonly nodegroup: Nodegroup
  private readonly DEFAULT_VOLUME_SIZE = 60

  constructor(scope: Construct, id: string, props: EksNodeGroupProps) {
    super(scope, id)

    const { cluster, clusterVersion, instanceTypes, labels, desiredSize, releaseVersion, securityGroups, subnets, amiType } = props

    const securityGroupIds = securityGroups.map((sg) => sg.securityGroupId)
    // cluster security group is required to communicate w/ control plane
    securityGroupIds.push(cluster.clusterSecurityGroupId)

    const lt = new CfnLaunchTemplate(this, `${id}-LaunchTemplate`, {
      launchTemplateData: {
        blockDeviceMappings: [
          {
            deviceName: '/dev/xvda',
            ebs: {
              encrypted: true,
              volumeSize: this.DEFAULT_VOLUME_SIZE,
            },
          },
        ],
        metadataOptions: {
          // enforce IMDSv2
          httpEndpoint: 'enabled',
          httpTokens: 'required',
          httpPutResponseHopLimit: 3,
        },
        securityGroupIds,
        // The cluster_version tag is used to update the launchTemplate in use to
        // correspond with the EKS version of the cluster. This allows for the
        // nodeGroups to trigger updates when the EKS cluster is updated and
        // the releaseVersion of the ami's are the same across EKS versions.
        tagSpecifications: [
          {
            resourceType: 'instance',
            tags: [
              {
                key: 'cluster_version',
                value: clusterVersion ,
              }
            ],
          },
        ],
      },
    })

    this.nodegroup = cluster.addNodegroupCapacity(id, {
      amiType: NodegroupAmiType.BOTTLEROCKET_X86_64,
      instanceTypes,
      labels,
      desiredSize,
      subnets,
      launchTemplateSpec: { id: lt.ref, version: lt.attrLatestVersionNumber },
      releaseVersion,
    })

    this.nodegroup.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))
    this.nodegroup.role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'))
  }
}

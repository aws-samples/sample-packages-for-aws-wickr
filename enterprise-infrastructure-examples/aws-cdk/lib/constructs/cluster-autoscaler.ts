import { Construct } from 'constructs'
import { CfnJson, Tags } from 'aws-cdk-lib'
import { Nodegroup, ICluster } from 'aws-cdk-lib/aws-eks'
import { Effect, PolicyStatement, Policy } from 'aws-cdk-lib/aws-iam'

interface ClusterAutoScalerProps {
  nodegroups: Nodegroup[]
  cluster: ICluster
}
export class ClusterAutoScaler extends Construct {
  constructor(scope: Construct, id: string, props: ClusterAutoScalerProps) {
    super(scope, id)

    const { cluster } = props
    const clusterName = new CfnJson(this, 'clusterName', {
      value: cluster.clusterName,
    })
    const serviceAccount = cluster.addServiceAccount('EksCasSA', {
      name: 'cluster-autoscaler',
      namespace: 'kube-system',
    })

    serviceAccount.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: ['*'],
        actions: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:DescribeAutoScalingInstances',
          'autoscaling:DescribeLaunchConfigurations',
          'autoscaling:DescribeTags',
          'autoscaling:SetDesiredCapacity',
          'autoscaling:TerminateInstanceInAutoScalingGroup',
          'ec2:DescribeLaunchTemplateVersions',
          'ec2:DescribeInstanceTypes',
          'ec2:DescribeInstances',
        ],
      })
    )

    for (const ng of props.nodegroups) {
      Tags.of(ng).add(`k8s.io/cluster-autoscaler/${clusterName}`, 'owned', { applyToLaunchedInstances: true })
      Tags.of(ng).add('k8s.io/cluster-autoscaler-enabled', 'true', { applyToLaunchedInstances: true })
    }
  }
}

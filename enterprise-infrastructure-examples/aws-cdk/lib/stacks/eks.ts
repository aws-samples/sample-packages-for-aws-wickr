import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Cluster, ClusterLoggingTypes, EndpointAccess, KubernetesPatch, Nodegroup, CfnAddon } from 'aws-cdk-lib/aws-eks'
import {
  AccountRootPrincipal,
  Effect,
  IRole,
  ManagedPolicy,
  OpenIdConnectPrincipal,
  PolicyDocument,
  PolicyStatement,
  Role,
} from 'aws-cdk-lib/aws-iam'
import { IKey } from 'aws-cdk-lib/aws-kms'
import { IBucket } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { EksNodeGroup } from '../constructs/nodegroup'
import { ApplicationLoadBalancer, NetworkLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
import { CLUSTER_VERSION } from '../constants/versions'
import { ClusterAutoScaler } from '../constructs/cluster-autoscaler'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'
import { readFileSync } from 'fs'

export interface EksStackProps extends cdk.StackProps {
  vpc: ec2.IVpc
  key: IKey
  bucket: IBucket
  database: DatabaseCluster
  alb: ApplicationLoadBalancer
  nlb?: NetworkLoadBalancer
}

export class EksStack extends cdk.Stack {
  readonly cluster: Cluster
  readonly clusterAdmin: IRole
  public messagingSecurityGroup: ec2.SecurityGroup
  private clusterVersion: string
  readonly config: IWickrEnvironmentConfig

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, private readonly props: EksStackProps) {
    super(scope, id, props)

    this.config = config
    const namespace = config.namespace
    this.clusterAdmin = new Role(this, 'WickrEksClusterAdmin', {
      assumedBy: new AccountRootPrincipal(),
    })

    // We need to check if we're in GovCloud using a CfnCondition because this uses the
    // AWS::Partition value which isn't known at synthesis time
    const isGovCloud = new cdk.CfnCondition(this, 'GovCloudCondition', {
      expression: cdk.Fn.conditionEquals(cdk.Stack.of(this).partition, 'aws-us-gov'),
    })

    this.clusterVersion = config.clusterVersion

    if (!CLUSTER_VERSION[this.clusterVersion]) {
      throw new Error(`Unsupported cluster version: ${this.clusterVersion}`)
    }

    this.cluster = new Cluster(this, 'WickrEnterprise', {
      vpc: props.vpc,
      mastersRole: this.clusterAdmin,
      defaultCapacity: 0,
      version: CLUSTER_VERSION[this.clusterVersion].kubernetesVersion,
      secretsEncryptionKey: props.key,
      albController: {
        version: CLUSTER_VERSION[this.clusterVersion].albControllerVersion,
        // Override controller image URL for GovCloud. Otherwise the image will fail to pull.
        // See: https://docs.aws.amazon.com/eks/latest/userguide/add-ons-images.html
        repository: cdk.Fn.conditionIf(
          isGovCloud.logicalId,
          '013241004608.dkr.ecr.us-gov-west-1.amazonaws.com/amazon/aws-load-balancer-controller',
          '602401143452.dkr.ecr.us-west-2.amazonaws.com/amazon/aws-load-balancer-controller'
        ).toString(),
      },
      endpointAccess: EndpointAccess.PRIVATE,
      clusterLogging: [
        ClusterLoggingTypes.API,
        ClusterLoggingTypes.AUDIT,
        ClusterLoggingTypes.AUTHENTICATOR,
        ClusterLoggingTypes.CONTROLLER_MANAGER,
        ClusterLoggingTypes.SCHEDULER,
      ],
      kubectlLayer: CLUSTER_VERSION[this.clusterVersion].kubectlLayerVersion(this),
    })

    this.addBastion()

    const messagingNg = this.addMessagingNodegroup(this.cluster)
    const callingNg = this.addCallingNodegroup(this.cluster)

    if (config.eksEnableAutoscaler) {
      this.enableClusterAutoScaler(this.cluster, [messagingNg.nodegroup, callingNg.nodegroup])
    }

    this.configureAddons(this.cluster)

    const ns = this.cluster.addManifest('EksDefaultNamespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: namespace,
      },
    })

    // Set the namespace manifest resource to retain on delete to prevent ordering issues when destroying stacks
    const nsResource = ns.node.defaultChild as cdk.CfnResource
    nsResource.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)

    const fileproxySa = this.cluster.addServiceAccount('FileproxyServiceAccount', {
      name: 'fileproxy',
      namespace,
    })

    props.bucket.grantReadWrite(fileproxySa)
    props.key.grantEncryptDecrypt(fileproxySa)
    fileproxySa.node.addDependency(ns)

    new cdk.CfnOutput(this, 'WickrEnterpriseEksClusterArn', {
      value: this.cluster.clusterArn,
    })

    new cdk.CfnOutput(this, 'WickrEnterpriseEksClusterName', {
      value: this.cluster.clusterName,
      description: 'Name of the EKS Cluster.',
    })
  }

  private enableClusterAutoScaler(cluster: Cluster, nodegroups: Nodegroup[]) {
    new ClusterAutoScaler(this, 'ClusterAutoScaler', { cluster, nodegroups })
    new cdk.CfnOutput(this, 'ClusterAutoscalerEnabled', {
      value: '1',
      description: 'Indicates whether the ClusterAutoscaler has been enabled.',
    })
  }

  private createInstanceTypeArray(types: string): Array<ec2.InstanceType> {
    return types.split(',').map((t) => new ec2.InstanceType(t))
  }

  private addMessagingNodegroup(cluster: Cluster): EksNodeGroup {
    const messagingSg = (this.messagingSecurityGroup = new ec2.SecurityGroup(this, 'MessagingSecurityGroup', {
      description: 'EKS Messaging Nodegroup',
      vpc: cluster.vpc,
    }))

    messagingSg.connections.allowFrom(this.props.alb, ec2.Port.allTcp(), 'Allow traffic from ALB')
    messagingSg.connections.allowToDefaultPort(this.props.database, 'Allow connections to database')

    return new EksNodeGroup(this, 'MessagingNodeGroup', {
      cluster,
      clusterVersion: this.clusterVersion,
      instanceTypes: this.createInstanceTypeArray(this.config.eksDefaultInstanceTypes),
      desiredSize: this.config.eksDefaultDesiredSize,
      securityGroups: [messagingSg],
      releaseVersion: CLUSTER_VERSION[this.clusterVersion].nodeGroupReleaseVersion,
    })
  }

  private addCallingNodegroup(cluster: Cluster): EksNodeGroup {
    const callingSg = new ec2.SecurityGroup(this, 'CallingSecurityGroup', {
      description: 'EKS Calling Nodegroup',
      vpc: cluster.vpc,
    })

    callingSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udpRange(16384, 19999), 'Calling VOIP Traffic')
    callingSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.udpRange(16384, 19999), 'Calling VOIP Traffic')
    callingSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Calling TCP Proxy')
    callingSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(443), 'Calling TCP Proxy')

    // sg rules calling ingress
    if (this.props.nlb) {
      callingSg.connections.allowFrom(this.props.nlb!, ec2.Port.tcp(8443), 'Allow tcp traffic from NLB')
      callingSg.connections.allowFrom(this.props.nlb!, ec2.Port.udp(16384), 'Allow udp traffic from NLB')
      callingSg.connections.allowFrom(this.props.nlb!, ec2.Port.tcp(443), 'Allow https traffic from NLB')
    }

    return new EksNodeGroup(this, 'CallingNodeGroup', {
      cluster,
      clusterVersion: this.clusterVersion,
      instanceTypes: this.createInstanceTypeArray(this.config.eksCallingInstanceTypes),
      desiredSize: this.config.eksCallingDesiredSize,
      labels: { role: 'calling' },
      securityGroups: [callingSg],
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      releaseVersion: CLUSTER_VERSION[this.clusterVersion].nodeGroupReleaseVersion,
    })
  }

  private addBastion(): ec2.IInstance {
    const userDataScript = readFileSync('./lib/assets/user_data/bastion.sh', 'utf8');

    const bastion = new ec2.BastionHostLinux(this, 'Bastion', {
      instanceName: 'WickrBastionHost',
      vpc: this.props.vpc,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(10, { encrypted: true }),
        },
      ],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.NANO),
      userDataCausesReplacement: true,
    })

    bastion.instance.addUserData(userDataScript)
    bastion.connections.allowTo(this.cluster, ec2.Port.tcp(443), 'To EKS Control Plane')
    bastion.connections.allowToDefaultPort(this.props.database, 'To database')

    new cdk.CfnOutput(this, 'BastionSSMCommand', {
      value: `aws ssm start-session --region ${cdk.Stack.of(this).region} --target ${bastion.instanceId}`,
      description: 'Command to start an SSM session on the bastion',
    })

    new cdk.CfnOutput(this, 'BastionSSMProxyEKSCommand', {
      value: `aws ssm start-session --region ${cdk.Stack.of(this).region} --target ${
        bastion.instanceId
      } --document-name AWS-StartPortForwardingSession --parameters "portNumber=8888,localPortNumber=8888"`,
      description: 'Command to start forwarding Kubernetes API traffic to the proxy on the bastion',
    })

    new cdk.CfnOutput(this, 'BastionSSMProxyRDSCommand', {
      value: `aws ssm start-session --region ${cdk.Stack.of(this).region} --target ${
        bastion.instanceId
      } --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{"portNumber":["3306"],"localPortNumber":["3306"],"host":["${
        this.props.database.clusterEndpoint.hostname
      }"]}'`,
      description: 'Command to start forwarding RDS traffic to the proxy on the bastion',
    })

    return bastion
  }

  private configureAddons(cluster: Cluster) {
    const ebsKmsPolicy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          actions: ['kms:CreateGrant', 'kms:ListGrants', 'kms:RevokeGrant'],
          effect: Effect.ALLOW,
          resources: [this.props.key.keyArn],
          conditions: { Bool: { 'kms:GrantIsForAWSResource': 'true' } },
        }),
        new PolicyStatement({
          actions: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
          effect: Effect.ALLOW,
          resources: [this.props.key.keyArn],
        }),
      ],
    })

    const ebsRole = new Role(this, 'AmazonEKS_EBS_CSI_DriverRole', {
      assumedBy: new OpenIdConnectPrincipal(cluster.openIdConnectProvider),
      description: 'EKS EBS CSI Add-on Role',
      inlinePolicies: { WickrEksEbsCsiKmsPolicy: ebsKmsPolicy },
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEBSCSIDriverPolicy')],
    })

    new CfnAddon(this, 'EBSAddon', {
      addonName: 'aws-ebs-csi-driver',
      clusterName: cluster.clusterName,
      serviceAccountRoleArn: ebsRole.roleArn,
      addonVersion: CLUSTER_VERSION[this.clusterVersion].ebsAddonVersion,
    })

    this.cluster.addManifest('encrypted-gp3-storage-class', {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: {
        name: 'ebs-sc-gp3',
        annotations: {
          'storageclass.kubernetes.io/is-default-class': 'true',
        },
      },
      provisioner: 'ebs.csi.aws.com',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: true,
      parameters: {
        type: 'gp3',
        encrypted: 'true',
        fstype: 'ext4',
        kmsKeyId: this.props.key.keyArn,
      },
    })

    new KubernetesPatch(this, 'toggle-gp2-default-sc', {
      cluster: this.cluster,
      resourceName: 'storageclasses/gp2',
      applyPatch: {
        metadata: {
          annotations: {
            'storageclass.kubernetes.io/is-default-class': 'false',
          },
        },
      },
      restorePatch: {
        metadata: {
          annotations: {
            'storageclass.kubernetes.io/is-default-class': 'true',
          },
        },
      },
    })
  }
}

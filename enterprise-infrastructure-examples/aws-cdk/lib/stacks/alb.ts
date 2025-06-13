import * as cdk from 'aws-cdk-lib'
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { IVpc, Peer, Port } from 'aws-cdk-lib/aws-ec2'
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  TargetType,
  Protocol,
  IpAddressType,
  SslPolicy,
} from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import { Construct } from 'constructs'
import { tryGetHostedZone } from '../util'
import { ARecord, AaaaRecord, RecordTarget } from 'aws-cdk-lib/aws-route53'
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets'
import { IWickrEnvironmentConfig } from '../types/wickr-environment-config'

export interface AlbStackProps extends cdk.StackProps {
  vpc: IVpc
  certificate?: ICertificate
}

export class AlbStack extends cdk.Stack {
  readonly alb: ApplicationLoadBalancer
  readonly targetGroup: ApplicationTargetGroup
  readonly config: IWickrEnvironmentConfig

  constructor(scope: Construct, id: string, config: IWickrEnvironmentConfig, private readonly props: AlbStackProps) {
    super(scope, id, props)

    this.config = config
    const { vpc } = props

    this.targetGroup = new ApplicationTargetGroup(this, 'WickrDefaultTargetGroup', {
      healthCheck: {
        enabled: true,
        interval: cdk.Duration.seconds(30),
        // This is an internal endpoint which the Nginx Ingress Controller exposes for liveness/readiness probes
        path: '/healthz',
        port: '10254',
        protocol: Protocol.HTTP,
        timeout: cdk.Duration.seconds(2),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      targetType: TargetType.IP,
      vpc,
    })

    this.alb = new ApplicationLoadBalancer(this, 'Alb', {
      idleTimeout: cdk.Duration.seconds(60),
      internetFacing: true,
      ipAddressType: config.albDisableIpv6 ? IpAddressType.IPV4 : IpAddressType.DUAL_STACK,
      vpc,
      vpcSubnets: {
        subnets: config.albPrivateAddress ? vpc.privateSubnets : vpc.publicSubnets,
      },
    })

    this.alb.connections.allowTo(Peer.ipv4(vpc.vpcCidrBlock), Port.allTraffic())

    this.alb.addListener('HttpsListener', {
      certificates: props.certificate ? [props.certificate] : undefined,
      defaultTargetGroups: [this.targetGroup],
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      sslPolicy: SslPolicy.TLS12_EXT,
    })

    this.createDnsRecords(this.alb)

    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
    })

    new cdk.CfnOutput(this, 'AlbTargetGroupArn', {
      value: this.targetGroup.targetGroupArn,
    })
  }

  private createDnsRecords(alb: ApplicationLoadBalancer) {
    const zone = tryGetHostedZone(this, this.config)
    const domain = this.config.domain

    if (zone) {
      // The recordName value must end with a period or it is created as a subdomain
      const recordName = domain.endsWith('.') ? domain : `${domain}.`
      const target = RecordTarget.fromAlias(new LoadBalancerTarget(alb))

      new ARecord(this, 'WickrAlbARecord', { zone, recordName, target })
      new AaaaRecord(this, 'WickrAlbAaaaRecord', { zone, recordName, target })
    }
  }
}
